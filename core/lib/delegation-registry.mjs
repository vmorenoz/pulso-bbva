/** Immutable snapshots and literal transports. The Work alone owns acceptance. */
import fs from 'node:fs';
import {assertID,exists,now,readJSON,safePath,sha256,withWorkspaceLock,writeJSON} from './fs.mjs';
import {checkAcceptance,completedTaskIds,readWork} from './artifacts.mjs';
import {assertSchema} from './schema.mjs';
import {validateToolInput} from './tool-contracts.mjs';
import {assertIntent,checkContext,contentHash,projectIdentity,readContinuity,readSidecar,scopePath,writeSidecar} from './continuity.mjs';

const folder=id=>`.pulso/delegations-v2/${assertID(id)}`;
export const delegationKey=args=>`DEL-${contentHash({continuityId:args.continuityId,requestKey:args.requestKey})}`;
const returnKey=(id,provenance,key)=>`RET-${contentHash({delegationId:id,provenance,key})}`;
function readBlob(root,relative,expectedHash){
  const {checksum,...body}=readJSON(root,relative);
  if(body.format!==2||body.projectId!==projectIdentity(root)||checksum!==contentHash(body)||expectedHash&&checksum!==expectedHash)throw new Error(`Blob corrupto o identidad ajena: ${relative}`);
  return body;
}
function immutableBlob(root,relative,body,options){
  const checksum=contentHash(body);
  if(exists(root,relative)){readBlob(root,relative,checksum);return {path:relative,sha256:checksum};}
  checkContext(options);writeJSON(root,relative,{...body,checksum});return {path:relative,sha256:checksum};
}
// The atomic index is the commit authority for administrative state/claims. It
// references immutable per-delegation snapshots, states and capture blobs. Never
// rebuild it from a partial directory scan or guess which orphan state committed.
function indexEntry(r,snapshotRef,recordRef){
  return {
    contractVersion:2,projectId:r.projectId,workId:r.workId,delegationId:r.delegationId,continuityId:r.continuityId,cycle:r.cycle,intentRevision:r.intentRevision,
    requestKey:r.requestKey,requestHash:r.requestHash,snapshotRef,recordRef,
    delegation:{taskIds:r.delegation.taskIds,writeScope:r.delegation.writeScope},stableReadScope:r.stableReadScope,integrationResources:r.integrationResources,
    reservationResolved:r.reservationResolved,retired:r.retired,
    attempts:r.attempts.map(({callID,sessionID,resolution})=>({callID,sessionID,resolution})),
    returns:r.returns.map(({returnId,captureKey,provenance})=>({returnId,captureKey,provenance})),
    reconciliations:r.reconciliations.map(({resolution})=>({resolution}))
  };
}
function loadRecord(root,entry){
  const snapshot=readBlob(root,entry.snapshotRef.path,entry.snapshotRef.sha256).snapshot;
  const state=readBlob(root,entry.recordRef.path,entry.recordRef.sha256);
  if(state.delegationId!==entry.delegationId||contentHash(state.snapshotRef)!==contentHash(entry.snapshotRef))throw new Error('Identidad de estado incoherente');
  const r={...snapshot,...state.record};
  assertSchema('delegation',r.delegation);
  if(contentHash(indexEntry(r,entry.snapshotRef,entry.recordRef))!==contentHash(entry)||r.delegation.id!==entry.delegationId||r.delegation.workId!==entry.workId)throw new Error('Snapshot/índice de encargo incoherente');
  return r;
}
function commitRecord(root,value,r,options,snapshotRef){
  const previous=value.records.find(v=>v.delegationId===r.delegationId);
  snapshotRef??=previous?.snapshotRef;
  if(!snapshotRef){
    const {returns,attempts,reconciliations,reservationResolved,retired,...snapshot}=r;
    snapshotRef=immutableBlob(root,`${folder(r.delegationId)}/snapshot.json`,{format:2,projectId:r.projectId,snapshot},options);
  }
  const record={returns:r.returns,attempts:r.attempts,reconciliations:r.reconciliations,reservationResolved:r.reservationResolved,retired:r.retired};
  const body={format:2,projectId:r.projectId,delegationId:r.delegationId,snapshotRef,record};
  const recordRef=immutableBlob(root,`${folder(r.delegationId)}/records/${contentHash(body)}.json`,body,options);
  const entry=indexEntry(r,snapshotRef,recordRef),i=value.records.findIndex(v=>v.delegationId===r.delegationId);
  if(i<0)value.records.push(entry);else value.records[i]=entry;
  writeSidecar(root,'delegations',value,options);
}

function store(root){
  if(!exists(root,'.pulso/delegations-v2.json')&&exists(root,'.pulso/delegations-v2'))throw new Error('Índice de encargos ausente con blobs existentes; recuperar autoridad íntegra, no reconstruir parcialmente');
  const value=readSidecar(root,'delegations'),seen=new Set();
  for(const r of value.records){
    assertID(r.delegationId);assertID(r.workId);assertID(r.continuityId);
    if(r.contractVersion!==2||r.projectId!==value.projectId||seen.has(r.delegationId)||!Array.isArray(r.returns)||!Array.isArray(r.attempts)||!Array.isArray(r.reconciliations)||!Array.isArray(r.integrationResources)||!Array.isArray(r.stableReadScope)||!Array.isArray(r.delegation?.taskIds)||!Array.isArray(r.delegation?.writeScope)||typeof r.reservationResolved!=='boolean')throw new Error('Registro de encargos corrupto');
    seen.add(r.delegationId);
    for(const p of [...r.delegation.writeScope,...r.stableReadScope,...r.integrationResources])scopePath(root,p);
    if(r.snapshotRef?.path!==`${folder(r.delegationId)}/snapshot.json`||!new RegExp(`^${folder(r.delegationId)}/records/[a-f0-9]{64}\\.json$`).test(r.recordRef?.path))throw new Error('Referencia de registro corrupta');
  }
  return value;
}
function derived(root,r,work){
  work??=readWork(root,r.workId,{files:false});
  const accepted=(work.results||[]).find(v=>v.delegationId===r.delegationId&&v.cycle===r.cycle);
  return {...r,accepted:accepted??null,state:accepted?'accepted':r.retired?'retired':r.returns.length?'return_stored':r.attempts.length?'dispatch_recorded':'prepared'};
}
export function listDelegations(root,{continuityId,work}={}){
  const cache=new Map(work?[[work.id,work]]:[]);
  return store(root).records.filter(r=>!continuityId||r.continuityId===continuityId).map(r=>{
    if(!cache.has(r.workId))cache.set(r.workId,readWork(root,r.workId,{files:false}));
    return derived(root,r,cache.get(r.workId));
  });
}
export function pendingDelegations(root,work){
  if(!exists(root,'.pulso/delegations-v2.json')&&!exists(root,'.pulso/delegations-v2'))return [];
  // Critical: never readWork here. completionReadiness may run inside readWork.
  return store(root).records.filter(r=>r.workId===work.id&&r.cycle===work.cycle).map(r=>derived(root,r,work)).filter(r=>!r.reservationResolved||!r.accepted&&!r.retired&&!notDispatched(r));
}
const notDispatched=r=>!r.attempts.length&&!r.returns.length&&r.reconciliations.some(v=>v.resolution==='not_dispatched');
export function readDelegation(root,{workId,delegationId,continuityId},options={}){
  assertID(workId);assertID(delegationId);checkContext(options);
  const entry=store(root).records.find(r=>r.delegationId===delegationId&&r.workId===workId);
  if(!entry){
    const snapshotPath=`${folder(delegationId)}/snapshot.json`;
    if(!exists(root,snapshotPath)){const error=new Error('Encargo no encontrado');error.code='DELEGATION_NOT_FOUND';throw error;}
    const snapshot=readBlob(root,snapshotPath).snapshot;
    if(snapshot.workId!==workId||snapshot.delegationId!==delegationId||continuityId&&snapshot.continuityId!==continuityId)throw new Error('Snapshot de identidad ajena');
    return {...snapshot,returns:[],attempts:[],reconciliations:[],reservationResolved:false,retired:false,registered:false,state:'prepared',accepted:null,recovery:'Snapshot huérfano; reintentar misma requestKey para registrar claims. No autoriza dispatch.'};
  }
  if(continuityId&&entry.continuityId!==continuityId)throw new Error('Encargo no encontrado o continuidad ajena');
  const r=loadRecord(root,entry);
  const refs=new Map(r.returns.map(v=>[v.returnId,v])),directory=`${folder(delegationId)}/returns`;
  // Only this delegation's directory. Deterministic IDs make a capture durable
  // and discoverable even if its subsequent administrative index commit failed.
  if(exists(root,directory))for(const name of fs.readdirSync(safePath(root,directory)))if(/^RET-[a-f0-9]{64}\.json$/.test(name)){
    const id=name.slice(0,-5);if(!refs.has(id))refs.set(id,{returnId:id,blobPath:`${directory}/${name}`,orphan:true});
  }
  r.returns=[...refs.values()].map(ref=>{
    if(ref.blobPath!==`${directory}/${assertID(ref.returnId)}.json`)throw new Error('Ruta de captura ajena al encargo');
    const body=readBlob(root,ref.blobPath,ref.blobHash),v=body.capture;
    if(body.delegationId!==delegationId||body.workId!==workId||v.returnId!==ref.returnId||v.sha256!==sha256(v.markdown)||v.length!==Buffer.byteLength(v.markdown))throw new Error('Captura corrupta');
    return {...v,...(ref.orphan?{orphan:true}:{})};
  });
  return derived(root,r);
}
export function getDelegation(root,args,options={}){
  const r=readDelegation(root,args,options),c=readContinuity(root,r.continuityId,options),work=readWork(root,r.workId,{files:false});
  return {...r,currentRevision:work.revision,currentIntent:work.cycle===r.cycle&&!r.retired&&(r.intentRevision===c.intentRevision||c.compatibleDelegationIds.includes(r.delegationId))};
}
const overlap=(a,b)=>a===b||a==='.'||b==='.'||a.startsWith(b+'/')||b.startsWith(a+'/');
function conflicts(a,b){
  if(a.workId===b.workId&&a.cycle===b.cycle&&a.delegation.taskIds.some(id=>b.delegation.taskIds.includes(id)))return true;
  const aw=a.delegation.writeScope,bw=b.delegation.writeScope;
  return aw.some(p=>[...bw,...b.stableReadScope].some(q=>overlap(p,q)))||bw.some(p=>a.stableReadScope.some(q=>overlap(p,q)))||a.integrationResources.some(p=>b.integrationResources.some(q=>overlap(p,q)));
}
function recoveryError(r,code,message){
  const error=new Error(message);error.code=code;
  error.recovery={workId:r.workId,continuityId:r.continuityId,delegationId:r.delegationId,readWith:{tool:'pulso_work',action:'get_delegation',workId:r.workId,continuityId:r.continuityId,delegationId:r.delegationId},nextActions:['accept_result','reconcile_delegation'],reservationResolved:r.reservationResolved,nativeCessation:'unknown',note:code==='DELEGATION_AWAITING_INCORPORATION'?'La reserva está resuelta, pero esta tarea espera incorporación o retirada explícita del encargo. Revisar capturas; no repetir trabajo por un fallo de registro.':'Recuperar el encargo y sus capturas antes de decidir. Un error de red o una reconciliación administrativa no certifica cancelación ni cese físico; no autoriza redispatch.'};
  return error;
}
export function assertClaims(root,candidate){
  for(const r of store(root).records){
    if(r.delegationId===candidate.delegationId)continue;
    const sameTask=r.workId===candidate.workId&&r.cycle===candidate.cycle&&r.delegation.taskIds.some(id=>candidate.delegation.taskIds.includes(id));
    const awaitingIncorporation=sameTask&&!r.retired&&!derived(root,r).accepted&&!notDispatched(r);
    if(awaitingIncorporation||!r.reservationResolved&&conflicts(r,candidate)){
      const unresolved=r.attempts.some(a=>a.resolution==='unresolved');
      throw recoveryError(r,unresolved?'DELEGATION_NATIVE_UNRESOLVED':awaitingIncorporation&&r.reservationResolved?'DELEGATION_AWAITING_INCORPORATION':'DELEGATION_RESERVATION_CONFLICT',`Reserva incompatible: ${r.delegationId}; recuperar e incorporar o reconciliar antes de repetir`);
    }
  }
}
export function findPrepared(root,args,requestHash,options={}){
  const r=store(root).records.find(r=>r.continuityId===args.continuityId&&r.requestKey===args.requestKey);
  if(r&&r.requestHash!==requestHash)throw new Error('requestKey del encargo con otro contenido');
  if(r)return readDelegation(root,r,options);
  const delegationId=delegationKey(args),snapshotPath=`${folder(delegationId)}/snapshot.json`;
  if(!exists(root,snapshotPath))return null;
  const snapshot=readBlob(root,snapshotPath).snapshot;
  if(snapshot.requestHash!==requestHash)throw new Error('requestKey del snapshot huérfano con otro contenido');
  assertIntent(root,args,options,snapshot);
  const work=readWork(root,snapshot.workId,{files:false});
  // An uncommitted snapshot never authorized dispatch. Recovering it must not
  // bypass eligibility just because completing tasks leaves their basis intact.
  // Deliberate repairs require a NEW snapshot through normal preparation.
  if(work.closure)throw new Error('Trabajo cerrado; no registrar snapshot huérfano');
  const completed=new Set(completedTaskIds(work));
  for(const id of snapshot.delegation.taskIds){
    const task=work.tasks.find(t=>t.id===id);
    if(!task||!task.agent||task.agent!==snapshot.delegation.agent)throw new Error(`Tarea inexistente o sin asignación original: ${id}`);
    if(task.status==='cancelled'||completed.has(id))throw new Error(`Tarea cancelada o ya realizada; no registrar snapshot huérfano: ${id}`);
  }
  checkAcceptance(work,{id:delegationId,acceptanceBasis:snapshot.acceptanceBasis},{criterionIds:snapshot.acceptanceBasis.criteria.map(v=>v.id),taskIds:snapshot.delegation.taskIds});
  return registerPrepared(root,{...snapshot,returns:[],attempts:[],reconciliations:[],reservationResolved:false,retired:false},options);
}
export function registerPrepared(root,record,options={}){
  return withWorkspaceLock(root,()=>{
    checkContext(options);assertClaims(root,record);
    const value=store(root);
    // Establish the authority before creating any blob directory. Missing index
    // alongside existing blobs is always corruption, never an empty workspace.
    if(value.revision===0){writeSidecar(root,'delegations',value,options);value.revision=1;}
    try{commitRecord(root,value,record,options);return derived(root,record);}
    catch(error){error.persistence={...error.persistence,delegationId:record.delegationId,workId:record.workId,recovery:'Reintentar la misma requestKey; snapshot inmutable recuperable, sin autorizar dispatch antes del commit del índice.'};throw error;}
  });
}
function edit(root,args,options,callback){
  return withWorkspaceLock(root,()=>{
    checkContext(options);assertID(args.workId);assertID(args.delegationId);
    const value=store(root),entry=value.records.find(r=>r.delegationId===args.delegationId&&r.workId===args.workId);
    if(!entry)throw new Error('Encargo no encontrado');
    const r=loadRecord(root,entry);
    const result=callback(r,value);
    if(result?.unchanged)return result.value;
    try{commitRecord(root,value,r,options);return result;}
    catch(error){
      const capture=r.returns.find(v=>!entry.returns.some(old=>old.returnId===v.returnId));
      if(capture)error.persistence={...error.persistence,captured:true,returnId:capture.returnId,workId:r.workId,delegationId:r.delegationId,recovery:'Captura conservada por ID; reintentar misma clave para reparar el índice sin volver a emitir.'};
      throw error;
    }
  });
}
function runtimeText(value,label){if(typeof value!=='string'||!value.trim()||value.length>2000)throw new Error(`${label} nativo inválido`);}
function captureInput(args){
  if(typeof args.markdown!=='string'||!args.markdown.trim()||Buffer.byteLength(args.markdown)>4000000)throw new Error('Markdown inválido o demasiado grande');
  if(args.completeness!==undefined&&!['complete','truncated','unknown'].includes(args.completeness))throw new Error('Completitud inválida');
}
export function recordNativeDispatch(root,args,{assertContext=()=>{}}={}){
  return edit(root,args,{assertContext},(r,value)=>{
    for(const key of ['sessionID','callID','agent'])runtimeText(args[key],key);
    if(args.prompt!==r.specialistPrompt||args.agent!==r.delegation.agent)throw new Error('Prompt/rol nativo no corresponde al snapshot');
    const c=readContinuity(root,r.continuityId,{nativeContext:{sessionID:args.sessionID},assertContext});
    assertIntent(root,{workId:r.workId,continuityId:r.continuityId,intentRevision:c.intentRevision},{nativeContext:{sessionID:args.sessionID},assertContext},r);
    const work=readWork(root,r.workId,{files:false});
    if(work.closure||r.delegation.taskIds.some(id=>work.tasks.find(t=>t.id===id)?.status==='cancelled'))throw new Error('Encargo cerrado/cancelado');
    checkAcceptance(work,{id:r.delegationId,acceptanceBasis:r.acceptanceBasis},{criterionIds:r.acceptanceBasis.criteria.map(v=>v.id),taskIds:r.delegation.taskIds});
    const other=value.records.flatMap(v=>v.attempts.map(a=>({r:v,a}))).find(v=>v.a.callID===args.callID&&v.a.sessionID===args.sessionID);
    if(other){if(other.r.delegationId!==r.delegationId||other.a.sessionID!==args.sessionID)throw new Error('Correlación callID incompatible');return {unchanged:true,value:other.a};}
    if(r.retired||r.reservationResolved||r.attempts.length||derived(root,r).accepted)throw new Error('Encargo ya emitido/resuelto; no redispatch');
    assertClaims(root,r);
    const attempt={callID:args.callID,sessionID:args.sessionID,agent:args.agent,recordedAt:now(),resolution:'unresolved',provenance:'host_dispatch'};
    r.attempts.push(attempt);return attempt;
  });
}
function addCapture(root,r,args,provenance,key,options){
  captureInput(args);
  const previous=r.returns.find(v=>v.provenance===provenance&&v.captureKey===key);
  const hash=contentHash({markdown:args.markdown,completeness:args.completeness??'unknown',childSessionID:args.childSessionID??null});
  if(previous){
    const saved=readBlob(root,previous.blobPath,previous.blobHash);
    if(saved.delegationId!==r.delegationId||saved.workId!==r.workId||saved.capture.returnId!==previous.returnId)throw new Error('Captura ajena al encargo');
    if(previous.captureHash!==hash){const error=new Error('Captura con otra carga; conservar original');error.persistence={captured:true,returnId:previous.returnId,workId:r.workId,delegationId:r.delegationId,note:'La captura original permanece; no se guardó la carga distinta.'};throw error;}
    return {unchanged:true,value:previous.returnId};
  }
  const returnId=returnKey(r.delegationId,provenance,key),blobPath=`${folder(r.delegationId)}/returns/${returnId}.json`;
  let capture={returnId,captureKey:key,captureHash:hash,markdown:args.markdown,sha256:sha256(args.markdown),length:Buffer.byteLength(args.markdown),receivedAt:now(),completeness:args.completeness??'unknown',provenance,...(provenance==='host_capture'?{sessionID:args.sessionID,callID:args.callID,...(args.childSessionID?{childSessionID:args.childSessionID}:{})}:{})};
  if(exists(root,blobPath)){
    const body=readBlob(root,blobPath);capture=body.capture;
    if(body.delegationId!==r.delegationId||body.workId!==r.workId||capture.returnId!==returnId||capture.captureHash!==hash){const error=new Error('Captura huérfana con otra carga; conservar original');error.persistence={captured:true,returnId,workId:r.workId,delegationId:r.delegationId};throw error;}
  }
  let ref;
  try{ref=immutableBlob(root,blobPath,{format:2,projectId:r.projectId,delegationId:r.delegationId,workId:r.workId,capture},options);}
  catch(error){
    try{const saved=readBlob(root,blobPath);if(saved.capture?.returnId===returnId&&saved.capture?.captureHash===hash)error.persistence={...error.persistence,captured:true,returnId,workId:r.workId,delegationId:r.delegationId};}catch{}
    throw error;
  }
  const {markdown,...metadata}=capture;
  r.returns.push({...metadata,blobPath,blobHash:ref.sha256});
  return returnId;
}
export function recordNativeReturn(root,args,{assertContext=()=>{}}={}){
  return edit(root,args,{assertContext},r=>{
    for(const key of ['sessionID','callID'])runtimeText(args[key],key);
    if(args.childSessionID!==undefined)runtimeText(args.childSessionID,'childSessionID');
    const attempt=r.attempts.find(a=>a.callID===args.callID&&a.sessionID===args.sessionID);
    if(!attempt)throw new Error('Retorno sin dispatch correlacionado');
    // Late returns survive changed intention/owner. Correlation is the original trusted call.
    const result=addCapture(root,r,args,'host_capture',args.callID,{assertContext});
    if(!result?.unchanged||attempt.resolution!=='host_terminal'){attempt.resolution='host_terminal';attempt.terminalAt=now();r.reservationResolved=true;return result?.unchanged?result.value:result;}
    return result;
  });
}
export function recordReportedReturn(root,args,options={}){
  assertID(args.captureKey);
  return edit(root,args,options,r=>{
    readContinuity(root,r.continuityId,options);
    const result=addCapture(root,r,args,'orchestrator_reported',args.captureKey,options);
    // One administrative commit for the normal reported return + terminal.
    // A native unresolved attempt must NOT throw here: first commit the capture,
    // then let accept_result reject the contradictory terminal declaration.
    if(args.reportedTerminal===true&&!r.reservationResolved&&!r.attempts.some(a=>a.resolution==='unresolved')){
      r.reconciliations.push({at:now(),resolution:'reported_terminal',reason:'reportedTerminal en accept_result',provenance:'orchestrator_reported'});
      r.reservationResolved=true;
      return result?.unchanged?result.value:result;
    }
    return result;
  });
}
export function resolveReported(root,args,options={}){
  return edit(root,args,options,r=>{
    if(args.continuityId!==r.continuityId)throw new Error('Continuidad ajena');
    readContinuity(root,r.continuityId,options);
    const explicit=args.resolution==='explicitly_reconciled';
    if(explicit&&(!args.reason?.trim()||!args.source?.text?.trim()))throw new Error('Reconciliación explícita requiere reason y source.text');
    const nativeUnresolved=r.attempts.some(a=>a.resolution==='unresolved');
    if(nativeUnresolved&&args.resolution!=='retired'&&!explicit)throw recoveryError(r,'DELEGATION_NATIVE_UNRESOLVED','Intento nativo sin terminal observado; declaración no lo resuelve');
    // Capture blobs are durable facts even when their index commit failed.
    // Read only this delegation under the existing writer lock; do not promote
    // orphan captures or infer a host terminal from their presence.
    if(args.resolution==='not_dispatched'&&(r.attempts.length||readDelegation(root,args,options).returns.length))throw new Error('not_dispatched contradice intento/retorno');
    if(r.reservationResolved&&(!args.resolution||args.resolution!=='retired'||r.retired))return {unchanged:true,value:r};
    r.reconciliations.push({at:now(),resolution:args.resolution||'reported_terminal',reason:args.reason||'reportedTerminal en accept_result',provenance:'orchestrator_reported',...(args.source?{source:structuredClone(args.source)}:{}),...(explicit?{limitations:['Resolución administrativa reportada; no certifica terminal, cancelación ni cese físico del host.']}:{})});
    if(explicit)for(const a of r.attempts)if(a.resolution==='unresolved'){a.resolution='explicitly_reconciled';a.reconciledAt=now();}
    r.reservationResolved=explicit||!nativeUnresolved;if(args.resolution==='retired')r.retired=true;
    return r;
  });
}
export function reconcileDelegation(root,args,options={}){
  validateToolInput('pulso_work',{...args,action:'reconcile_delegation'});
  return withWorkspaceLock(root,()=>{assertIntent(root,args,options);resolveReported(root,args,options);return getDelegation(root,args,options);});
}
