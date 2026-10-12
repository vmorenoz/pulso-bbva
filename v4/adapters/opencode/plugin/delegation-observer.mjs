/** Passive OpenCode v1 telemetry. Never mutates Work or claims a live agent. */
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {safePath,atomicWrite} from '../resources/lib/fs.mjs';

const folder='.pulso/delegation-attempts';
const validID=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);
const rank={in_progress:0,background_running:1,tool_returned:2,error:3,cancelled:4};
const key=(sessionID,callID)=>createHash('sha256').update(JSON.stringify([sessionID,callID])).digest('hex');
const file=(sessionID,callID)=>`${folder}/${key(sessionID,callID)}.json`;

// Only explicit, unambiguous labels are correlation. Never store the prompt.
export function correlation(prompt){
  const result={};
  if(typeof prompt!=='string'||prompt.length>65536)return result;
  const headers=[...prompt.matchAll(/^Encargo: ([A-Za-z0-9][A-Za-z0-9_-]{0,79}) · workId: ([A-Za-z0-9][A-Za-z0-9_-]{0,79}) · taskIds?: ([A-Za-z0-9][A-Za-z0-9_, -]*)$/gm)];
  if(headers.length===1){
    const taskIds=headers[0][3].split(', ');
    if(taskIds.length&&new Set(taskIds).size===taskIds.length&&taskIds.every(id=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id)))return {delegationId:headers[0][1],workId:headers[0][2],taskIds,...(taskIds.length===1?{taskId:taskIds[0]}:{})};
  }
  if(headers.length)return {correlationConflicts:['delegationId','workId','taskIds']};
  for(const label of ['workId','taskId']){
    const values=[...prompt.matchAll(new RegExp(`(?:^|[\\s{,])"?${label}"?\\s*[:=]\\s*"?([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?=["\\s,}]|$)`,'g'))].map(match=>match[1]);
    if(values.length&&new Set(values).size===1)result[label]=values[0];
    else if(values.length)result.correlationConflicts=[...(result.correlationConflicts||[]),label];
  }
  return result;
}

function readAttempt(root,relative){
  const target=safePath(root,relative);
  if(fs.statSync(target).size>8192)throw new Error('Intento demasiado grande');
  const value=JSON.parse(fs.readFileSync(target,'utf8'));
  // Legacy 'completed' meant only the native tool returned, never acceptance.
  if(value.status==='completed')value.status='tool_returned';
  if(value.schemaVersion!==1||!validID(value.sessionID)||!validID(value.callID)||!Object.hasOwn(rank,value.status)||relative!==file(value.sessionID,value.callID))throw new Error('Intento inválido');
  return value;
}

/** Read-only reconciliation: unfinished attempts remain unknown, including after restart. */
export function readDelegationAttempts(root,{workId,sessionID,limit=20}={}){
  const target=safePath(root,folder);
  if(!fs.existsSync(target))return [];
  const values=[];
  for(const entry of fs.readdirSync(target)){
    if(!/^[a-f0-9]{64}\.json$/.test(entry))continue;
    const value=readAttempt(root,`${folder}/${entry}`);
    if(workId&&value.workId!==workId||sessionID&&value.sessionID!==sessionID)continue;
    values.push({...value,liveness:'unknown',acceptance:'not_assessed',requiresReview:['in_progress','background_running'].includes(value.status)});
  }
  return values.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.callID.localeCompare(b.callID)).slice(0,Math.max(1,Math.min(100,limit)));
}

export function createDelegationObserver(root){
  // Hook failures are deliberately contained; telemetry must never prevent task execution.
  const safe=fn=>async(...args)=>{try{fn(...args);}catch{}};
  function observe(input,args,status,source,metadata={}){
    if(input.tool!=='task'||!validID(input.sessionID)||!validID(input.callID))return;
    const relative=file(input.sessionID,input.callID),target=safePath(root,relative);
    const old=fs.existsSync(target)?readAttempt(root,relative):null;
    const value=old?{...old}:{schemaVersion:1,sessionID:input.sessionID,callID:input.callID,status:'in_progress',createdAt:new Date().toISOString(),...correlation(args?.prompt)};
    if(args?.background===true||metadata?.status==='running')value.background=true;
    if(value.background&&value.status==='tool_returned')value.status='background_running';
    if(value.background&&status==='tool_returned')status='background_running';
    const correlated=correlation(args?.prompt);
    for(const label of correlated.correlationConflicts||[]){
      delete value[label];value.correlationConflicts=[...new Set([...(value.correlationConflicts||[]),label])].sort();
    }
    for(const [label,id] of Object.entries(correlated).filter(([label])=>label!=='correlationConflicts')){
      if(value.correlationConflicts?.includes(label))continue;
      if(value[label]&&JSON.stringify(value[label])!==JSON.stringify(id)){
        delete value[label];value.correlationConflicts=[...(value.correlationConflicts||[]),label].sort();
      }else value[label]=id;
    }
    // Late before/running/completed events cannot erase an observed error or abort.
    if(rank[status]>rank[value.status]){value.status=status;value.source=source;}
    if(!old)value.source=source;
    const child=metadata?.sessionId;
    if(validID(child)&&!value.childSessionConflict){
      if(value.childSessionID&&value.childSessionID!==child){delete value.childSessionID;value.childSessionConflict=true;}
      else value.childSessionID=child;
    }
    if(old&&JSON.stringify(old)===JSON.stringify(value))return;
    value.updatedAt=new Date().toISOString();
    atomicWrite(root,relative,JSON.stringify(value)+'\n');
  }
  function sessionEvent(event){
    const {sessionID,error,status}=event.properties||{};
    if(!validID(sessionID))return;
    const target=safePath(root,folder);
    if(!fs.existsSync(target))return;
    for(const entry of fs.readdirSync(target)){
      if(!/^[a-f0-9]{64}\.json$/.test(entry))continue;
      const value=readAttempt(root,`${folder}/${entry}`);
      if(value.sessionID!==sessionID&&value.childSessionID!==sessionID)continue;
      if(event.type==='session.error'&&(['in_progress','background_running'].includes(value.status)||value.status==='error'&&error?.name==='MessageAbortedError')){
        // The typed abort discriminator is confirmation; arbitrary error text is not.
        observe({tool:'task',...value},null,error?.name==='MessageAbortedError'?'cancelled':'error','session.error');
      }else if(event.type==='session.status'&&['idle','busy','retry'].includes(status?.type)&&['in_progress','background_running'].includes(value.status)&&value.sessionStatus!==status.type){
        value.sessionStatus=status.type;value.updatedAt=new Date().toISOString();
        atomicWrite(root,file(value.sessionID,value.callID),JSON.stringify(value)+'\n');
      }
    }
  }
  return {
    'tool.execute.before':safe((input,output)=>observe(input,output.args,'in_progress','tool.execute.before')),
    'tool.execute.after':safe((input,output)=>observe(input,input.args,'tool_returned','tool.execute.after',output.metadata)),
    event:safe(({event})=>{
      if(event.type==='message.part.updated'){
        const part=event.properties?.part;
        if(part?.type!=='tool'||part.tool!=='task')return;
        const status=part.state?.status;
        if(!['pending','running','completed','error'].includes(status))return;
        observe(part,part.state.input,status==='pending'||status==='running'?'in_progress':status==='completed'?'tool_returned':status,'message.part.updated',part.state.metadata);
      }else if(event.type==='session.error'||event.type==='session.status')sessionEvent(event);
    })
  };
}
