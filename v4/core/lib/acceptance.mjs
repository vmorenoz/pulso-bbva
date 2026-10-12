/** Incorporation only: native hosts still own invocation, permissions and sessions. */
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {acceptanceBasis,closeWork,completionReadiness,readWork,saveWork,validateDelegation,validateResult,validateResultIdentity} from './artifacts.mjs';
import {exists,fingerprint,now,readJSON,safePath,sha256,withWorkspaceLock,writeJSON} from './fs.mjs';
import {workReceipt} from './receipts.mjs';
import {validateDecision,validateToolInput} from './tool-contracts.mjs';
import {assertIntent,assertRepositoryScopes,checkContext,contentHash,projectIdentity,readContinuity} from './continuity.mjs';
import {delegationKey,findPrepared,getDelegation,recordReportedReturn,registerPrepared,resolveReported} from './delegation-registry.mjs';
import {assertSchema} from './schema.mjs';

const distinct=(values,label)=>{if(new Set(values).size!==values.length)throw new Error(`${label}: duplicados`);return values;};
const union=(tasks,key)=>[...new Set(tasks.flatMap(task=>task[key]))];
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>sha256(JSON.stringify(canonical(value)));
/** Specialist wire text only; canonical metadata stays with the orchestrator. */
function specialistPrompt(root,delegation,resourcePaths){
  const seen=new Set([delegation.objective]);
  const conditions=[...delegation.constraints,...delegation.acceptance].filter(value=>{if(seen.has(value))return false;seen.add(value);return true;});
  const paths=(label,values)=>values.length?`${label}:\n${[...new Set(values)].map(value=>`- ${value}`).join('\n')}`:null;
  return [
    '## Objetivo',
    `Encargo: ${delegation.id} · workId: ${delegation.workId} · ${delegation.taskIds.length===1?'taskId':'taskIds'}: ${delegation.taskIds.join(', ')}`,
    delegation.objective,
    '## Alcance',
    `Workspace: ${path.resolve(root)}`,
    paths('Inputs (relativos al workspace)',delegation.inputs),
    paths('Recursos de lectura (relativos al workspace)',resourcePaths.filter(p=>!delegation.inputs.includes(p)&&!delegation.writeScope.includes(p))),
    paths('Alcance de escritura (relativo al workspace)',delegation.writeScope)||'Alcance de escritura: ninguno.',
    '## Condiciones',
    conditions.length?conditions.map(value=>`- ${value}`).join('\n'):'Sin condiciones adicionales.',
    '## Entrega',
    delegation.output==='conversation'?null:`Archivo de salida (relativo al workspace): ${delegation.output}`,
    'Responde en Markdown con las secciones «## Resultado», «## Cambios o hallazgos» y «## Comprobación y pendientes». Describe el estado en lenguaje natural, los cambios o hallazgos, las comprobaciones realizadas y sus resultados, y las limitaciones o preguntas pendientes.'
  ].filter(value=>value!==null).join('\n\n');
}
/** Never derive identity, checks or permissions from report prose. */
function normalizeResult(delegation,result){
  if(!Object.hasOwn(result,'markdown'))return result;
  const {markdown,...fields}=result;
  return {schemaVersion:delegation.schemaVersion,delegationId:delegation.id,workId:delegation.workId,workRevision:delegation.workRevision,agent:delegation.agent,artifacts:[],changedFiles:[],checks:[],findings:[],questions:[],limitations:[],suggestedNextStep:null,...fields};
}
function currentWork(root,args){
  const work=readWork(root,args.workId,{files:false});
  if(args.contractVersion===2&&args.expectedRevision>work.revision){const error=new Error(`Revisión futura; actual=${work.revision}`);error.code='REVISION_FUTURE';error.revision=work.revision;throw error;}
  if(work.revision!==args.expectedRevision){const error=new Error(`Revisión obsoleta; actual=${work.revision}. Releer y reconciliar.`);error.code='REVISION_STALE';error.revision=work.revision;throw error;}
  return work;
}
function assertOpen(work){if(work.closure)throw new Error('Trabajo cerrado; requiere reapertura explícita');}
function saveWithDocument(root,work,record,body,{kind,...options}){
  // No multi-file transaction: a report may survive a failed Work write.
  // Hash only the actual bytes successfully written by core, never changedFiles.
  let written=false;
  try{
    if(exists(root,record.report))throw new Error('Documento de incorporación ya existe');
    checkContext(options);writeJSON(root,record.report,body);written=true;
    const file=fingerprint(root,record.report);
    if(kind==='result')record.sha256=file.sha256;
    else record.files=[file];
    work.documents.push({kind:kind==='result'?'review':'evidence',path:record.report,templateVersion:'core-acceptance-1'});
    checkContext(options);return saveWork(root,work,work.revision);
  }catch(error){
    if(written)error.persistence={applied:false,partial:true,workId:work.id,recovery:'Releer Work antes de reintentar; el documento puede haber quedado sin incorporar.',...error.persistence,documents:[record.report],...(kind==='result'?{resultId:record.id}:{evidenceId:record.id})};
    throw error;
  }
}

export function prepareDelegation(root,args,options={}){
  validateToolInput('pulso_work',{...args,action:'prepare_delegation'});
  if(args.contractVersion!==2)return prepareLegacy(root,args,options);
  return withWorkspaceLock(root,()=>{
    readContinuity(root,args.continuityId,options);
    const {expectedRevision,action,...request}=args,requestHash=contentHash(request);
    const previous=findPrepared(root,args,requestHash,options);
    if(previous)return previous;
    const continuity=assertIntent(root,args,options);
    const work=currentWork(root,args);assertOpen(work);
    for(const id of args.taskIds)if(work.tasks.find(t=>t.id===id)?.status==='done'||work.completedTaskIds?.includes(id)){
      const prior=(work.results||[]).filter(r=>r.cycle===work.cycle&&r.acceptedTaskIds.includes(id)).at(-1);
      const basis=acceptanceBasis(work,{criterionIds:[],taskIds:[id]}).tasks[0];
      if(!prior||!work.acceptanceChanges?.some(c=>c.entity==='task'&&c.entityId===id)||prior.acceptanceBasis.tasks.find(t=>t.id===id)?.sha256===basis.sha256)throw new Error('Tarea ya realizada; requiere revisión deliberada de aceptación o nueva tarea');
    }
    const delegationId=delegationKey(args);
    const prepared=prepareLegacy(root,{workId:args.workId,taskIds:args.taskIds,delegationId,objective:args.objective,inputs:args.inputs,output:args.output,constraints:[...continuity.constraints,...args.constraints],templateId:args.templateId},options);
    assertRepositoryScopes(root,{delegation:prepared.delegation,integrationResources:args.integrationResources,stableReadScope:args.stableReadScope},continuity.repositories);
    const record={...prepared,contractVersion:2,delegationId,projectId:projectIdentity(root),workId:work.id,cycle:work.cycle,preparedFromRevision:work.revision,preparedAt:now(),continuityId:continuity.continuityId,intentId:continuity.intentId,intentRevision:continuity.intentRevision,intentionRevision:continuity.intentRevision,requestKey:args.requestKey,requestHash,integrationResources:args.integrationResources||[],stableReadScope:args.stableReadScope||[],returns:[],attempts:[],reconciliations:[],reservationResolved:false,retired:false,resourceVersion:'core-acceptance-2',nativeContext:options.nativeContext??null,note:'Snapshot durable anterior a la observación. Preparado no significa emitido. Recuperar por delegationId; no retransmitir base.'};
    const catalog=readJSON(options.resourceRoot,'agents/catalog.json');
    record.resourceSnapshot=[fingerprint(options.resourceRoot,'agents/catalog.json'),fingerprint(options.resourceRoot,catalog.templates[args.templateId])];
    return registerPrepared(root,record,options);
  });
}
function prepareLegacy(root,args,{resourceRoot}={}){
  validateToolInput('pulso_work',{...args,action:'prepare_delegation'});
  const work=readWork(root,args.workId,{files:false});assertOpen(work);
  distinct(args.taskIds,'Tareas del encargo');
  const tasks=args.taskIds.map(id=>{const task=work.tasks.find(task=>task.id===id);if(!task||!task.agent)throw new Error(`Tarea sin asignación: ${id}`);return task;});
  if(tasks.some(task=>task.agent!==tasks[0].agent))throw new Error('El encargo requiere un único agente asignado');
  if(tasks.some(task=>task.status==='cancelled'))throw new Error('No preparar tareas canceladas');
  const delegation={schemaVersion:1,id:args.delegationId,workId:work.id,workRevision:work.revision,taskIds:[...args.taskIds],agent:tasks[0].agent,objective:args.objective,inputs:[...args.inputs],output:args.output,writeScope:union(tasks,'writeScope'),resources:union(tasks,'resources'),constraints:[...args.constraints],acceptance:union(tasks,'acceptance'),questions:[],templateId:args.templateId};
  const {readScope,resourcePaths}=validateDelegation(root,delegation,{work,globalRoot:resourceRoot,catalogPath:'agents/catalog.json',canonical:true});
  const basis=acceptanceBasis(work,{criterionIds:union(tasks,'criterionIds'),taskIds:args.taskIds});
  return {delegation,acceptanceBasis:basis,specialistPrompt:specialistPrompt(root,delegation,resourcePaths),hostContext:{projectRoot:root,resourceRoot,readBase:root,cwd:root,paths:{inputs:delegation.inputs.map(p=>safePath(root,p)),output:delegation.output==='conversation'?null:safePath(root,delegation.output),writeScope:delegation.writeScope.map(p=>safePath(root,p)),readScope:readScope.map(p=>safePath(root,p))}},note:'Enviar specialistPrompt al especialista; conservar delegation, acceptanceBasis y hostContext en el orquestador. Lectura sin reserva ni ejecución. Inputs son rutas accesibles autorizadas; incluir texto conversacional real en objective/constraints o en un input autorizado. output=conversation es retorno inline, sin archivo ni permiso de escritura del especialista; core conserva su propio documento al incorporar.'};
}

export function acceptResult(root,args,options={}){
  validateToolInput('pulso_work',{...args,action:'accept_result'});
  return withWorkspaceLock(root,()=>assertSchema('work-receipt',args.contractVersion===2?acceptDurable(root,args,options):acceptLegacy(root,args,options)));
}
function historicalReceipt(root,work,previous,record,returnId){
  const c=readContinuity(root,record.continuityId,{skipOwner:true});
  const current=work.cycle===record.cycle&&!record.retired&&(record.intentRevision===c.intentRevision||c.compatibleDelegationIds.includes(record.delegationId));
  let currentBasis=false;
  try{currentBasis=contentHash(acceptanceBasis(work,{criterionIds:record.acceptanceBasis.criteria.map(v=>v.id),taskIds:record.acceptanceBasis.tasks.map(v=>v.id)}))===contentHash(record.acceptanceBasis);}catch{}
  return {...workReceipt(work,{operation:'work.accept_result',changes:[]}),resultId:previous.id,report:previous.report,acceptedTaskIds:previous.acceptedTaskIds,returnId,operationId:previous.operationId,duplicate:true,applied:true,appliedRevision:previous.appliedRevision,currentRevision:work.revision,currentIntent:current,currentBasis,currentPass:false,note:'Aceptación histórica; no acredita PASS actual ni renueva la base.'};
}
function acceptDurable(root,args,options){
  const record=getDelegation(root,args,options);
  let returnId=args.returnId,captureConfirmed=false;
  try{
    if(args.reportedReturn)returnId=recordReportedReturn(root,{workId:args.workId,delegationId:args.delegationId,...args.reportedReturn,reportedTerminal:args.reportedTerminal===true&&!record.accepted},options);
    const latest=getDelegation(root,args,options),captured=latest.returns.find(v=>v.returnId===returnId);
    if(!captured)throw new Error('returnId no corresponde al encargo');
    captureConfirmed=true;
    const decisionHash=contentHash({projectId:record.projectId,workId:record.workId,cycle:record.cycle,delegationId:record.delegationId,continuityId:record.continuityId,intentRevision:args.intentRevision,returnId,decision:args.decision});
    let work=readWork(root,args.workId,{files:false});
    const previous=(work.results||[]).find(r=>r.operationId===args.operationId);
    if(previous){if(previous.decisionHash!==decisionHash)throw new Error('operationId ya comprometida con otro contenido');return historicalReceipt(root,work,previous,record,returnId);}
    if(args.reportedTerminal)resolveReported(root,{...args,resolution:'reported_terminal'},options);
    work=currentWork(root,args);
    assertIntent(root,args,options,record);
    if(record.retired)throw new Error('Encargo retirado');
    if((work.results||[]).some(r=>r.delegationId===record.delegationId))throw new Error('Encargo ya aceptado; recuperar operationId original');
    validateDecision(args.decision);
    const {acceptedTaskIds,...result}=args.decision;
    const legacy={workId:args.workId,expectedRevision:args.expectedRevision,delegation:record.delegation,acceptanceBasis:record.acceptanceBasis,result:{...result,markdown:captured.markdown},...(acceptedTaskIds!==undefined?{acceptedTaskIds}:{}),summary:args.decision.summary};
    const metadata={contractVersion:2,operationId:args.operationId,decisionHash,returnId,continuityId:record.continuityId,intentRevision:args.intentRevision,appliedRevision:work.revision+1};
    const accepted=acceptLegacy(root,legacy,{...options,durableMetadata:metadata});
    return {...accepted,...metadata,applied:true,currentRevision:metadata.appliedRevision,currentPass:false,persistence:{applied:true,captured:true,returnId}};
  }catch(error){
    // Preserve capture even when revision, basis, semantic candidate or projection fails.
    if(returnId&&(captureConfirmed||args.reportedReturn))error.persistence={...error.persistence,captured:true,returnId,workId:args.workId,delegationId:args.delegationId};
    throw error;
  }
}
function acceptLegacy(root,args,{resourceRoot,durableMetadata,...options}={}){
  validateToolInput('pulso_work',{...args,action:'accept_result'});
  const reported=args.result;
  args={...args,result:normalizeResult(args.delegation,reported),acceptedTaskIds:args.acceptedTaskIds??[]};
  const work=currentWork(root,args);
  validateResultIdentity(args.delegation,args.result);
  if(args.delegation.workId!==work.id)throw new Error('El encargo no corresponde a workId');
  distinct(args.acceptedTaskIds,'Tareas aceptadas');
  if(args.acceptedTaskIds.some(id=>!args.delegation.taskIds.includes(id)))throw new Error('acceptedTaskIds fuera del encargo');
  if(args.acceptedTaskIds.length&&args.result.status!=='completed')throw new Error('Sólo un resultado completed puede acreditar tareas realizadas; otros retornos requieren acceptedTaskIds vacío');
  const payload={delegation:args.delegation,acceptanceBasis:args.acceptanceBasis,result:args.result,acceptedTaskIds:args.acceptedTaskIds,summary:args.summary,...(Object.hasOwn(reported,'markdown')?{markdown:reported.markdown}:{})};
  const requestHash=digest(payload),previous=(work.results||[]).find(r=>r.cycle===work.cycle&&r.delegationId===args.delegation.id);
  if(previous){
    if(previous.requestHash!==requestHash)throw new Error('Encargo ya aceptado con otro contenido; el resultado histórico es inmutable');
    return {...workReceipt(work,{operation:'work.accept_result',changes:[]}),resultId:previous.id,report:previous.report,acceptedTaskIds:previous.acceptedTaskIds,duplicate:true,readiness:completionReadiness(root,work)};
  }
  assertOpen(work);
  validateResult(root,args.delegation,args.result,{globalRoot:resourceRoot,catalogPath:'agents/catalog.json',acceptanceBasis:args.acceptanceBasis,canonical:true,requireOutput:false});
  const id=`RES-${randomUUID()}`,registeredAt=now();
  const record={id,cycle:work.cycle,registeredAt,delegationId:args.delegation.id,requestHash,report:`.pulso/work/${work.id}/results/${id}.json`,sha256:'',acceptedTaskIds:[...args.acceptedTaskIds],acceptanceBasis:structuredClone(args.acceptanceBasis)};
  if(durableMetadata)Object.assign(record,durableMetadata);
  for(const taskId of args.acceptedTaskIds){
    const task=work.tasks.find(task=>task.id===taskId);
    if(task.status==='cancelled')throw new Error(`Tarea cancelada: ${taskId}`);
    task.status='done';task.summary=args.summary;
  }
  (work.results??=[]).push(record);
  const saved=saveWithDocument(root,work,record,{schemaVersion:1,id,registeredAt,provenance:'orchestrator-accepted-reported-result',...payload,...(durableMetadata?{durable:durableMetadata}:{})},{kind:'result',...options});
  return {...workReceipt(saved,{operation:'work.accept_result',changes:args.acceptedTaskIds.map(id=>`${id} completada con resultado aceptado`)}),resultId:id,report:record.report,acceptedTaskIds:record.acceptedTaskIds,duplicate:false,readiness:completionReadiness(root,saved)};
}

/** Only explicit validation waits are removable. Technical decisions, blockers,
 * dependencies and tasks are never inferred away from prose. Scoped marker:
 * validation-pending:AC-1,AC-2. The two exact unscoped labels mean all criteria. */
function validationWaitResolved(message,criterionIds,allCriteriaCovered){
  const match=/^validation-pending:([A-Za-z0-9_-]+(?:,[A-Za-z0-9_-]+)*)$/.exec(message);
  if(match)return match[1].split(',').every(id=>criterionIds.includes(id));
  return allCriteriaCovered&&['Pendiente de validación del usuario','Validación pendiente del usuario'].includes(message);
}
export function acceptDelivery(root,args,options={}){
  return withWorkspaceLock(root,()=>assertSchema('work-receipt',acceptDeliveryLocked(root,args,options)));
}
function acceptDeliveryLocked(root,args,options){
  validateToolInput('pulso_work',{...args,action:'accept_delivery'});
  checkContext(options);
  const {expectedRevision,action,...request}=args,decisionHash=contentHash(request);
  if(args.operationId){
    const current=readWork(root,args.workId,{files:false}),previous=current.evidence.find(e=>e.operationId===args.operationId);
    if(previous){
      if(previous.decisionHash!==decisionHash)throw new Error('operationId de aceptación con otro contenido');
      return {...workReceipt(current,{operation:'work.accept_delivery',changes:[]}),acceptanceRecorded:true,evidenceId:previous.id,report:previous.report,duplicate:true,applied:true,appliedRevision:previous.appliedRevision,currentRevision:current.revision,closed:Boolean(current.closure),currentPass:false,note:'Declaración histórica; no acredita vigencia ni repite cierre.'};
    }
  }
  const work=currentWork(root,args);assertOpen(work);distinct(args.criterionIds,'Criterios aceptados');
  const priorIssues=completionReadiness(root,work).issues;
  // An incoming declaration can discharge only the user lane, never ordinary
  // evidence failures. No inference from criterion descriptions or user prose.
  const criterionIssues=['EVIDENCE_NOT_POSITIVE','EVIDENCE_STALE','CRITERION_UNSUPPORTED','USER_ACCEPTANCE_REQUIRED','USER_ACCEPTANCE_STALE'];
  const supportedCriteria=work.objective.criteria.filter(c=>!priorIssues.some(issue=>issue.entity===c.id&&criterionIssues.includes(issue.code)&&!(args.criterionIds.includes(c.id)&&['USER_ACCEPTANCE_REQUIRED','USER_ACCEPTANCE_STALE'].includes(issue.code)))).map(c=>c.id);
  // This basis describes the declaration being incorporated now, not a past run.
  const basis=acceptanceBasis(work,{criterionIds:args.criterionIds,taskIds:[]});
  const id=`EV-${randomUUID()}`,registeredAt=now(),report=`.pulso/work/${work.id}/evidence/${id}.json`;
  const evidence={id,kind:'manual',origin:'user_acceptance',status:'pass',checkedAt:registeredAt,criterionIds:[...args.criterionIds],taskIds:[],report,command:null,cwd:'.',exitCode:null,basis:'Aceptación manual declarada por el orquestador y registrada ahora; no acredita ejecución ni cobertura automatizada. Procedencia en el informe.',files:[],summary:args.summary,acceptanceBasis:basis};
  if(args.operationId)Object.assign(evidence,{operationId:args.operationId,decisionHash,appliedRevision:work.revision+1});
  work.evidence.push(evidence);
  // Keep ordinary evidence links: a declaration must never waive their checks.
  for(const criterion of work.objective.criteria)if(args.criterionIds.includes(criterion.id))criterion.evidenceIds.push(id);
  const covered=work.objective.criteria.every(c=>supportedCriteria.includes(c.id));
  const resolvedWaits=[];
  for(const field of ['blockers','decisionsPending'])work[field]=work[field].filter(message=>{
    const resolved=validationWaitResolved(message,supportedCriteria,covered);if(resolved)resolvedWaits.push({field,message});return !resolved;
  });
  if(work.nextAction&&validationWaitResolved(work.nextAction,supportedCriteria,covered)){resolvedWaits.push({field:'nextAction',message:work.nextAction});work.nextAction=null;}
  const saved=saveWithDocument(root,work,evidence,{schemaVersion:1,id,registeredAt,origin:'user_acceptance',observation:'Declaración incorporada en registeredAt; no se conoce la fecha de una eventual comprobación externa.',provenance:'orchestrator-reported-user-acceptance',source:args.source,criterionIds:args.criterionIds,acceptanceBasis:basis,summary:args.summary,limitations:args.limitations,resolvedWaits},{kind:'evidence',...options});
  const readiness=completionReadiness(root,saved);
  const accepted={acceptanceRecorded:true,evidenceId:id,report,resolvedWaits};
  if(!readiness.ready)return {...workReceipt(saved,{operation:'work.accept_delivery',changes:['aceptación manual registrada; cierre pendiente']}),...accepted,closed:false,readiness};
  try{
    checkContext(options);const closed=closeWork(root,work.id,{summary:args.summary,limitations:args.limitations});
    return {...workReceipt(closed,{operation:'work.accept_delivery',changes:['aceptación manual registrada','trabajo cerrado']}),...accepted,closed:true,readiness:completionReadiness(root,closed)};
  }catch(error){
    // The accepted revision is already durable, even if closure/projection fails.
    let current;
    try{current=readWork(root,work.id,{files:false});}catch(readError){
      readError.persistence={applied:true,partial:true,workId:work.id,acceptanceRevision:saved.revision,evidenceId:id,documents:[report],recovery:'Aceptación persistida; no repetir. Recuperar lectura de Work y reconciliar cierre/proyecciones.'};throw readError;
    }
    const diagnostic=completionReadiness(root,current);
    diagnostic.issues.push({code:'CLOSURE_PERSISTENCE_FAILED',entity:work.id,message:error.message});diagnostic.ready=false;
    return {...workReceipt(current,{operation:'work.accept_delivery',changes:['aceptación manual conservada; revisar cierre/proyecciones']}),...accepted,closed:Boolean(current.closure),readiness:diagnostic,closeError:{code:error.code||'CLOSURE_FAILED',message:error.message},...(error.persistence?{persistence:error.persistence}:{})};
  }
}
