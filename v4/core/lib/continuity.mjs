/** Durable intention, never a synthetic host session or an authorization token. */
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {assertID,exists,now,readJSON,safePath,sha256,withWorkspaceLock,writeJSON} from './fs.mjs';
import {isUUID} from './identity.mjs';
import {readWork} from './artifacts.mjs';
import {validateToolInput} from './tool-contracts.mjs';
import {listDelegations} from './delegation-registry.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const contentHash=value=>sha256(JSON.stringify(canonical(value)));
/** Reject aliases before canonical segment comparisons; only the literal root is special. */
export function scopePath(root,value){
  safePath(root,value,{allowDot:value==='.'});
  return path.posix.normalize(value);
}
export function assertRepositoryScopes(root,record,repositories){
  const bases=repositories.map(p=>scopePath(root,p));
  for(const p of [...record.delegation.writeScope,...(record.stableReadScope||[]),...(record.integrationResources||[])]){
    const normalized=scopePath(root,p);
    if(!bases.some(base=>base==='.'||normalized===base||normalized.startsWith(base+'/')))throw new Error(`Scope fuera de repositorios de la continuidad: ${p}`);
  }
}
export function checkContext(options={}) {
  const result=(options.assertContext||(()=>{}))();
  if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw new Error('assertContext debe comprobar el contexto síncronamente');}
}
export function projectIdentity(root){
  const value=readJSON(root,'.pulso/project.json');
  if(value.schemaVersion!==1||!isUUID(value.projectId))throw new Error('Identidad local inválida');
  return value.projectId;
}
// Atomic metadata sidecars; large delegation bodies live in immutable per-ID blobs.
// Checksums detect accidental corruption, not malicious writers with filesystem access.
export function readSidecar(root,name){
  const projectId=projectIdentity(root),file=`.pulso/${name}-v2.json`;
  if(!exists(root,file))return {format:2,projectId,revision:0,records:[]};
  const {checksum,...value}=readJSON(root,file);
  if(value.format!==2||value.projectId!==projectId||!Number.isSafeInteger(value.revision)||value.revision<1||!Array.isArray(value.records)||checksum!==contentHash(value))throw new Error(`Registro ${name} corrupto o identidad ajena; no se sobrescribe`);
  return value;
}
export function writeSidecar(root,name,value,options){
  const next={...value,revision:value.revision+1};
  checkContext(options);writeJSON(root,`.pulso/${name}-v2.json`,{...next,checksum:contentHash(next)});
}
export function assertOwner(value,{nativeContext}={}){
  if(value.ownerSessionID&&value.ownerSessionID!==nativeContext?.sessionID)throw new Error('Continuidad de otra sesión; retomar explícitamente con bind_continuity y continuityId');
}
function validateRecord(root,value){
  assertID(value.continuityId);assertID(value.workId);
  if(value.contractVersion!==2||!Number.isSafeInteger(value.intentRevision)||value.intentRevision<1||value.revision!==value.intentRevision||!Array.isArray(value.compatibleDelegationIds)||!Array.isArray(value.history)||!Array.isArray(value.repositories)||!Array.isArray(value.constraints))throw new Error('Continuidad corrupta');
  for(const p of value.repositories)scopePath(root,p);
  return value;
}
export function readContinuity(root,continuityId,options={}){
  assertID(continuityId);checkContext(options);
  const store=readSidecar(root,'continuities');
  store.records.forEach(value=>validateRecord(root,value));
  const value=store.records.find(value=>value.continuityId===continuityId);
  if(!value)throw new Error('Continuidad no encontrada');
  if(!options.skipOwner)assertOwner(value,options);
  return value;
}
export function assertIntent(root,args,options={},record){
  const c=readContinuity(root,args.continuityId,options),work=readWork(root,c.workId,{files:false});
  if(args.workId&&args.workId!==c.workId||c.cycle!==work.cycle||args.intentRevision!==c.intentRevision)throw new Error('Intención/ciclo obsoleto o Work ajeno');
  if(record&&(record.continuityId!==c.continuityId||record.cycle!==c.cycle||record.intentRevision!==c.intentRevision&&!c.compatibleDelegationIds.includes(record.delegationId)))throw new Error('Encargo obsoleto para la intención vigente');
  if(record)assertRepositoryScopes(root,record,c.repositories);
  return c;
}
export function bindContinuity(root,args,options={}){
  validateToolInput('pulso_workspace',{...args,action:'bind_continuity'});
  return withWorkspaceLock(root,()=>{
    checkContext(options);
    const store=readSidecar(root,'continuities'),work=readWork(root,args.workId,{files:false});
    store.records.forEach(value=>validateRecord(root,value));
    for(const p of args.repositories)scopePath(root,p);
    if(!args.repositories.length)throw new Error('repositories requiere al menos una raíz relativa');
    const requestHash=contentHash({workId:args.workId,objective:args.objective,repositories:args.repositories,constraints:args.constraints,sourceText:args.sourceText??null});
    let value=args.continuityId?store.records.find(v=>v.continuityId===args.continuityId):store.records.find(v=>v.requestKey===args.requestKey);
    if(args.continuityId&&!value)throw new Error('Continuidad no encontrada');
    if(value){
      if(value.workId!==work.id||value.cycle!==work.cycle)throw new Error('Continuidad de otro Work/ciclo');
      if(!args.continuityId){assertOwner(value,options);if(value.requestHash!==requestHash)throw new Error('requestKey de continuidad con otro contenido');return value;}
      // Explicit resumption does not rewrite intention or the original bind request.
      if(args.objective!==value.objective||contentHash(args.repositories)!==contentHash(value.repositories)||contentHash(args.constraints)!==contentHash(value.constraints))throw new Error('Retoma requiere intención vigente; usar update_intent para cambiarla');
      const owner=options.nativeContext?.sessionID??null;
      if(value.ownerSessionID===owner)return value;
      value.history.push({at:now(),type:'resumed',previousSessionID:value.ownerSessionID,sessionID:owner});value.ownerSessionID=owner;
    }else{
      if(work.closure)throw new Error('Trabajo cerrado');
      value={contractVersion:2,continuityId:`CONT-${randomUUID()}`,projectId:store.projectId,workId:work.id,cycle:work.cycle,requestKey:args.requestKey,requestHash,intentId:`INT-${randomUUID()}`,intentRevision:1,revision:1,objective:args.objective,repositories:args.repositories,constraints:args.constraints,sourceText:args.sourceText??null,ownerSessionID:options.nativeContext?.sessionID??null,compatibleDelegationIds:[],history:[],createdAt:now()};store.records.push(value);
    }
    writeSidecar(root,'continuities',store,options);return value;
  });
}
export function updateIntent(root,args,options={}){
  validateToolInput('pulso_workspace',{...args,action:'update_intent'});
  return withWorkspaceLock(root,()=>{
    const value=readContinuity(root,args.continuityId,options);
    if(value.revision!==args.expectedRevision)throw new Error(`Revisión de intención obsoleta; actual=${value.revision}`);
    const work=readWork(root,value.workId,{files:false});
    if(work.cycle!==value.cycle||work.closure)throw new Error('Continuidad de ciclo cerrado');
    const compatible=args.compatibleDelegationIds||[],records=listDelegations(root,{continuityId:value.continuityId,work});
    if(new Set(compatible).size!==compatible.length)throw new Error('Compatibilidades duplicadas');
    for(const id of compatible){const r=records.find(r=>r.delegationId===id);if(!r||r.continuityId!==value.continuityId||r.retired||r.intentRevision!==value.intentRevision&&!value.compatibleDelegationIds.includes(id))throw new Error('Compatibilidad ajena, retirada u obsoleta');}
    const repositories=args.repositories??value.repositories;
    if(!repositories.length)throw new Error('repositories vacío');
    for(const p of repositories)scopePath(root,p);
    for(const id of compatible)assertRepositoryScopes(root,records.find(r=>r.delegationId===id),repositories);
    value.history.push({at:now(),type:'intent',intentRevision:value.intentRevision,objective:value.objective,constraints:value.constraints,repositories:value.repositories,compatibleDelegationIds:compatible});
    Object.assign(value,{objective:args.objective,constraints:args.constraints,repositories,compatibleDelegationIds:compatible,intentRevision:value.intentRevision+1,revision:value.revision+1});
    const store=readSidecar(root,'continuities');store.records[store.records.findIndex(v=>v.continuityId===value.continuityId)]=value;
    writeSidecar(root,'continuities',store,options);return value;
  });
}
export function getContinuity(root,args,options={}){
  // Atomic files plus a bounded optimistic retry: reads never create/acquire a lock.
  for(let attempt=0;attempt<3;attempt++){
    const value=readContinuity(root,args.continuityId,options),work=readWork(root,value.workId,{files:false});
    const records=listDelegations(root,{continuityId:value.continuityId,work});
    const delegations=records.map(r=>({delegationId:r.delegationId,state:r.state,returnIds:r.returns.slice(-10).map(v=>v.returnId),returnCount:r.returns.length,resultId:r.accepted?.id??null,reservationResolved:r.reservationResolved,notDispatched:!r.returns.length&&!r.attempts.length&&r.reconciliations.some(v=>v.resolution==='not_dispatched'),current:r.cycle===work.cycle&&(r.intentRevision===value.intentRevision||value.compatibleDelegationIds.includes(r.delegationId))&&!r.retired}));
    if(contentHash(value)!==contentHash(readContinuity(root,args.continuityId,options))||work.revision!==readWork(root,value.workId,{files:false}).revision)continue;
    const pending=delegations.filter(r=>!r.reservationResolved||r.state!=='accepted'&&r.state!=='retired'&&!r.notDispatched),accepted=delegations.filter(r=>r.state==='accepted');
    const limit=50;
    const history=value.history.slice(-20).map(({at,type,intentRevision,objective})=>({at,type,...(intentRevision?{intentRevision}:{}),...(objective?{objective:objective.slice(0,400)}:{})}));
    return {...value,history,historyTotal:value.history.length,currentRevision:work.revision,delegations:delegations.slice(-limit),pending:pending.slice(-limit),accepted:accepted.slice(-limit),totals:{delegations:delegations.length,pending:pending.length,accepted:accepted.length},truncated:delegations.length>limit||value.history.length>20||records.some(r=>r.returns.length>10),nextAction:null,note:'Cápsula derivada acotada; historial resumido sin restricciones antiguas. nextAction global no activa esta continuidad. Capturas y aceptaciones no acreditan PASS actual ni cese físico.'};
  }
  throw new Error('Continuidad cambió durante la lectura; reintentar consulta');
}
