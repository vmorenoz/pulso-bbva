/** Adapter-proved child assignments. This object is never accepted from model input. */
import {readContinuity,assertRepositoryScopes,checkContext,contentHash} from './continuity.mjs';
import {readDelegation} from './delegation-registry.mjs';
import {readWork,saveWork,checkAcceptance,completedTaskIds} from './artifacts.mjs';
import {withWorkspaceLock,now,fingerprint} from './fs.mjs';
import {validateToolInput} from './tool-contracts.mjs';
import {pageItems} from './pagination.mjs';

export function scopeError(message,code='ASSIGNMENT_SCOPE_DENIED'){return Object.assign(new Error(message),{code});}
export const assignmentCapabilities=Object.freeze({
  pulso_workspace:['get_assignment'],
  pulso_work:['get (assigned Work)','get_delegation (own)','get_assignment_receipts (own)','update_assignment (own nonterminal progress and exact output registration)'],
  pulso_history:['read (assigned Work)'],pulso_context:['read (project)','summary (project)'],
  excluded:['acceptance/evidence linking','terminal task status','global Work/context/continuity mutation','delegation/recursion','direct canonical filesystem edits']
});
export function currentAssignment(root,{authorization:a,nativeContext,...options}={}){
  checkContext(options);
  if(a?.kind!=='assignment'||a.projectRoot!==root||a.sessionID!==nativeContext?.sessionID||!a.parentSessionID||!a.parentCallID)throw scopeError('Falta prueba nativa de la asignación');
  const r=readDelegation(root,{workId:a.workId,delegationId:a.delegationId}),c=readContinuity(root,r.continuityId,{...options,skipOwner:true}),work=readWork(root,r.workId,{files:false});
  const attempt=r.attempts.find(v=>v.sessionID===a.parentSessionID&&v.callID===a.parentCallID);
  if(r.registered===false||r.hostContext?.projectRoot!==root||r.continuityId!==a.continuityId||r.delegation.agent!==a.agent||contentHash(r.specialistPrompt)!==a.promptHash||!attempt||attempt.agent!==a.agent||attempt.provenance!=='host_dispatch')throw scopeError('La prueba nativa no coincide con el encargo y su dispatch');
  // Do not impersonate the parent's nativeContext. Revalidate current authority
  // against its durable identity, inside the write lock as well as on reads.
  if(c.ownerSessionID!==a.parentSessionID||c.workId!==work.id||c.cycle!==work.cycle||r.cycle!==work.cycle||r.intentId!==c.intentId||r.intentRevision!==c.intentRevision&&!c.compatibleDelegationIds.includes(r.delegationId))throw scopeError('Asignación revocada por cambio de dueño, ciclo o intención','ASSIGNMENT_REVOKED');
  if(work.closure||work.status==='paused'||r.retired||r.reservationResolved||r.accepted||attempt.resolution!=='unresolved')throw scopeError('Asignación cerrada, pausada o resuelta','ASSIGNMENT_REVOKED');
  const completed=new Set(completedTaskIds(work));
  for(const id of r.delegation.taskIds){const task=work.tasks.find(t=>t.id===id);if(!task||task.agent!==a.agent||task.status==='cancelled'||completed.has(id))throw scopeError('Tarea ya realizada, cancelada o reasignada','ASSIGNMENT_REVOKED');}
  assertRepositoryScopes(root,r,c.repositories);
  checkAcceptance(work,{id:r.delegationId,acceptanceBasis:r.acceptanceBasis},{criterionIds:r.acceptanceBasis.criteria.map(v=>v.id),taskIds:r.delegation.taskIds});
  return {record:r,continuity:c,work};
}
export function authorizeTool(root,name,args,options){
  const a=options.authorization;
  if(a===undefined)return null; // Legacy adapters cannot grant assignment capabilities.
  if(a.kind==='primary'){
    if(a.projectRoot!==root||a.sessionID!==options.nativeContext?.sessionID||a.agent!=='pulso')throw scopeError('Contexto primario nativo inválido');
    return null;
  }
  const value=currentAssignment(root,options),r=value.record;
  const ownWork=args.workId===r.workId,ownDelegation=ownWork&&args.delegationId===r.delegationId;
  const allowed=name==='pulso_workspace'&&args.action==='get_assignment'
    ||name==='pulso_work'&&(args.action==='get'&&ownWork||['get_delegation','get_assignment_receipts','update_assignment'].includes(args.action)&&ownDelegation&&(!args.continuityId||args.continuityId===r.continuityId))
    ||name==='pulso_history'&&ownWork
    ||name==='pulso_context'&&['read','summary'].includes(args.action)&&args.scope==='project';
  if(!allowed)throw scopeError(`Acción fuera de la asignación: ${name}.${args.action||'read'}`);
  return value;
}
export function getAssignment(root,args,options){
  const {record:r,continuity:c,work}=currentAssignment(root,options);
  return {workId:work.id,revision:work.revision,cycle:work.cycle,delegationId:r.delegationId,continuityId:r.continuityId,intentRevision:c.intentRevision,agent:r.delegation.agent,taskIds:r.delegation.taskIds,objective:r.delegation.objective,constraints:r.delegation.constraints,output:r.delegation.output,writeScope:r.delegation.writeScope,currentIntent:{objective:c.objective,constraints:c.constraints,repositories:c.repositories},capabilities:assignmentCapabilities};
}
export function assignmentReceipts(root,args,options){
  const r=readDelegation(root,args),work=readWork(root,r.workId,{files:false});
  if(options.authorization?.kind==='assignment')currentAssignment(root,options);
  else readContinuity(root,r.continuityId,options);
  const items=(work.assignmentOperations||[]).filter(v=>v.delegationId===r.delegationId&&(!args.operationId||v.operationId===args.operationId));
  return {workId:work.id,revision:work.revision,delegationId:r.delegationId,...pageItems(items,{kind:'assignment-receipts',binding:{projectRoot:root,workId:work.id,delegationId:r.delegationId,operationId:args.operationId??null},snapshot:items,limit:args.limit||20,cursor:args.cursor})};
}
export function updateAssignment(root,args,options){
  validateToolInput('pulso_work',{...args,action:'update_assignment'});
  return withWorkspaceLock(root,()=>{
    const {record:r,continuity:c,work}=currentAssignment(root,options),a=options.authorization;
    if(args.workId!==r.workId||args.delegationId!==r.delegationId)throw scopeError('Work/encargo ajeno');
    const requestHash=contentHash({workId:args.workId,delegationId:args.delegationId,operationId:args.operationId,actions:args.actions});
    const previous=(work.assignmentOperations||[]).find(v=>v.delegationId===r.delegationId&&v.operationId===args.operationId);
    if(previous){if(previous.requestHash!==requestHash)throw scopeError('operationId ya aplicado con otra carga','OPERATION_CONFLICT');return {...previous,duplicate:true,currentRevision:work.revision,capabilities:assignmentCapabilities};}
    if(work.revision!==args.expectedRevision)throw Object.assign(new Error(`Revisión obsoleta; actual=${work.revision}. Releer y reconciliar.`),{code:'REVISION_STALE',revision:work.revision});
    const candidate=structuredClone(work),changes=[];
    for(const action of args.actions){
      if(action.type==='task.progress'){
        if(!r.delegation.taskIds.includes(action.taskId))throw scopeError('Tarea fuera de la asignación');
        const task=candidate.tasks.find(t=>t.id===action.taskId);
        if(action.status!==undefined)task.status=action.status;
        if(action.summary!==undefined)task.summary=action.summary;
        changes.push(structuredClone(action));
      }else if(action.type==='document.register'){
        const doc=action.document;
        if(r.delegation.output==='conversation'||doc.path!==r.delegation.output||!r.delegation.writeScope.some(p=>p==='.'||doc.path===p||doc.path.startsWith(p+'/')))throw scopeError('Sólo se registra el archivo output exacto del encargo');
        // No content write, no evidence links, no acceptance. Fingerprint records
        // bytes already produced by the specialist under its native file rights.
        const file=fingerprint(root,doc.path);
        if(candidate.documents.some(d=>d.path===doc.path))throw scopeError('Documento ya registrado; recuperar recibo, no duplicarlo');
        candidate.documents.push(structuredClone(doc));changes.push({...structuredClone(action),sha256:file.sha256});
      }else throw scopeError('Acción de asignación no admitida');
    }
    const operation={operationId:args.operationId,requestHash,workId:work.id,cycle:work.cycle,delegationId:r.delegationId,continuityId:r.continuityId,intentRevision:c.intentRevision,sessionID:a.sessionID,parentSessionID:a.parentSessionID,parentCallID:a.parentCallID,agent:a.agent,appliedRevision:work.revision+1,recordedAt:now(),changes};
    (candidate.assignmentOperations??=[]).push(operation);
    checkContext(options);currentAssignment(root,options);
    try{saveWork(root,candidate,args.expectedRevision);}
    catch(error){if(error.persistence?.applied)error.persistence={...error.persistence,operationId:operation.operationId,delegationId:r.delegationId,receipt:operation,recovery:'No repetir acciones. Leer get_assignment_receipts; el coordinador repara proyecciones con sync/recover.'};throw error;}
    return {...operation,duplicate:false,currentRevision:operation.appliedRevision,capabilities:assignmentCapabilities};
  });
}

export function assignmentWorkProjection(work,r){
  const tasks=work.tasks.filter(t=>r.delegation.taskIds.includes(t.id)),criterionIds=new Set(tasks.flatMap(t=>t.criterionIds));
  const readable=[...r.delegation.inputs,...r.delegation.writeScope,...r.delegation.resources];
  return {...work,projection:'assignment',completeWork:false,delegationId:r.delegationId,capabilities:assignmentCapabilities,
    tasks,objective:{...work.objective,criteria:work.objective.criteria.filter(c=>criterionIds.has(c.id))},
    documents:work.documents.filter(d=>readable.some(p=>p==='.'||d.path===p||d.path.startsWith(p+'/'))),
    evidence:work.evidence.filter(e=>e.taskIds.some(id=>r.delegation.taskIds.includes(id))),
    results:(work.results||[]).filter(v=>v.delegationId===r.delegationId),
    assignmentOperations:(work.assignmentOperations||[]).filter(v=>v.delegationId===r.delegationId),
    acceptanceChanges:(work.acceptanceChanges||[]).filter(v=>v.entity==='task'?r.delegation.taskIds.includes(v.entityId):criterionIds.has(v.entityId)),
    completedTaskIds:(work.completedTaskIds||[]).filter(id=>r.delegation.taskIds.includes(id))};
}
