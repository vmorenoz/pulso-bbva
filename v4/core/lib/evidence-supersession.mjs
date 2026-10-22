/** Replace selected acceptance links, never an immutable observation or requirement.
 * Equivalence is a scoped coordinator decision recorded in reason. Core does not
 * parse verification prose, infer a remote run, or turn a user report into execution.
 */
import {acceptanceBasis,checkFresh,completionReadiness,readWork,saveWork,syncWork} from './artifacts.mjs';
import {checkContext,contentHash} from './continuity.mjs';
import {now,withWorkspaceLock} from './fs.mjs';
import {schemaError,validateSchema} from './schema.mjs';
import {workReceipt} from './receipts.mjs';

const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const ids={type:'array',minItems:1,maxItems:50,items:id};
const text={type:'string',minLength:1,maxLength:2000,pattern:'\\S'};
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const requestProperties={workId:id,operationId:id,evidenceId:id,replacementEvidenceId:id,criterionIds:ids,reason:text};
export const evidenceSupersessionInputSchema=object({...requestProperties,expectedRevision:{type:'integer',minimum:1}});
const basis=object({criteria:{type:'array',minItems:1,maxItems:50,items:object({id,sha256:hash})},tasks:{type:'array',maxItems:0,items:object({id,sha256:hash})}});
export const evidenceSupersessionsSchema={type:'array',description:'Append-only, cycle-scoped decisions replacing selected criterion acceptance links; observations remain immutable.',items:object({
  ...requestProperties,requestHash:hash,cycle:{type:'integer',minimum:1},appliedRevision:{type:'integer',minimum:2},at:{type:'string',format:'date-time'},acceptanceBasis:basis
})};

const same=(a,b)=>contentHash(a)===contentHash(b);
function assertShape(schema,value,label){const issues=validateSchema(schema,value);if(issues.length)throw schemaError(label,issues);}
function fail(message,issue,entity,code='EVIDENCE_SUPERSESSION_INVALID'){
  const error=new Error(message);error.code=code;error.issues=[{code:issue,entity,message}];throw error;
}
function requestOf(value){return Object.fromEntries(Object.keys(requestProperties).map(key=>[key,key==='criterionIds'?[...value[key]].sort():value[key]]));}
function distinct(values){return new Set(values).size===values.length;}
function ordinaryPass(evidence){return evidence&&evidence.origin!=='user_acceptance'&&evidence.status==='pass'&&['executed','static','manual'].includes(evidence.kind);}
const unperformed=evidence=>evidence&&evidence.origin!=='user_acceptance'&&['not_run','blocked'].includes(evidence.status);

/** Glue into validateWork, and into saveWork with the previous canonical Work.
 * Historical bases are checked against their immutable evidence, not today's
 * criterion definitions. Reopen and later requirement changes retain this audit.
 */
export function validateEvidenceSupersessions(work,previous){
  const records=work.evidenceSupersessions??[];
  assertShape(evidenceSupersessionsSchema,records,'evidenceSupersessions');
  if(previous){
    const before=previous.evidenceSupersessions??[];
    if(records.length<before.length||!same(records.slice(0,before.length),before))fail('Historial de sustituciones de evidencia inmutable','AUDIT_IMMUTABLE','evidenceSupersessions');
  }
  if(!distinct(records.map(record=>record.operationId)))fail('operationId de sustitución duplicada','AUDIT_OPERATION_DUPLICATE','evidenceSupersessions');
  let lastRevision=1,lastCycle=1;
  for(const record of records){
    const source=work.evidence.find(e=>e.id===record.evidenceId),replacement=work.evidence.find(e=>e.id===record.replacementEvidenceId);
    if(record.workId!==work.id||record.cycle>work.cycle||record.cycle<lastCycle||record.appliedRevision>work.revision||record.appliedRevision<=lastRevision)fail('Sustitución de otro Work/ciclo o revisión inválida','AUDIT_IDENTITY_INVALID',record.operationId);
    lastRevision=record.appliedRevision;lastCycle=record.cycle;
    if(Date.parse(record.at)<Date.parse(work.createdAt)||Date.parse(record.at)>Date.parse(work.updatedAt))fail('Fecha de sustitución fuera de la historia del Work','AUDIT_TIME_INVALID',record.operationId);
    if(record.requestHash!==contentHash(requestOf(record))||!distinct(record.criterionIds)||record.evidenceId===record.replacementEvidenceId)fail('Identidad de sustitución inconsistente','AUDIT_REQUEST_INVALID',record.operationId);
    if(!unperformed(source)||!ordinaryPass(replacement))fail('Observaciones de sustitución inexistentes o no admisibles','AUDIT_EVIDENCE_INVALID',record.operationId);
    if(work.evidence.indexOf(replacement)<=work.evidence.indexOf(source)||Date.parse(replacement.checkedAt)<Date.parse(source.checkedAt))fail('Evidencia sustituta anterior al intento no completado','AUDIT_OBSERVATION_ORDER_INVALID',record.operationId);
    if(!same(record.acceptanceBasis.criteria.map(value=>value.id).sort(),[...record.criterionIds].sort()))fail('Base de sustitución no corresponde a los criterios','AUDIT_BASIS_INVALID',record.operationId);
    for(const criterionId of record.criterionIds){
      if(!work.objective.criteria.some(c=>c.id===criterionId)||!source.criterionIds.includes(criterionId)||!replacement.criterionIds.includes(criterionId))fail('Criterio ajeno a las observaciones de sustitución','AUDIT_CRITERION_INVALID',criterionId);
      const recorded=record.acceptanceBasis.criteria.find(value=>value.id===criterionId);
      if(replacement.acceptanceBasis?.criteria.find(value=>value.id===criterionId)?.sha256!==recorded.sha256)fail('Base histórica de sustitución no corresponde a la evidencia','AUDIT_BASIS_INVALID',criterionId);
    }
  }
  return records;
}

/** Pure Work transformation, apart from reading fingerprints of the replacement.
 * The public operation below supplies the mutex, current Work and native context.
 * This helper does not persist, close, approve a user lane, or complete tasks.
 */
export function prepareEvidenceSupersession(root,work,input){
  assertShape(evidenceSupersessionInputSchema,input,'supersede_evidence');
  validateEvidenceSupersessions(work);
  if(input.workId!==work.id)fail('Work ajeno a la sustitución','WORK_MISMATCH','workId');
  if(!distinct(input.criterionIds))fail('Criterios de sustitución duplicados','CRITERIA_DUPLICATE','criterionIds');
  const request=requestOf(input),requestHash=contentHash(request);
  const previous=(work.evidenceSupersessions??[]).find(record=>record.operationId===input.operationId);
  if(previous){
    if(previous.requestHash!==requestHash)fail('operationId de sustitución con otro contenido','OPERATION_CONFLICT',input.operationId);
    if(previous.cycle!==work.cycle)fail('Sustitución de un ciclo cerrado; no se aplica al ciclo reabierto','CYCLE_MISMATCH',input.operationId);
    return {work,record:previous,duplicate:true};
  }
  if(work.closure||['done','cancelled'].includes(work.status))fail('Trabajo cerrado; requiere reapertura explícita','WORK_CLOSED',work.id);
  if(work.revision!==input.expectedRevision)fail(`Revisión obsoleta; actual=${work.revision}. Releer y reconciliar.`, 'REVISION_STALE','expectedRevision','REVISION_CONFLICT');
  if(input.evidenceId===input.replacementEvidenceId)fail('La evidencia sustituta debe ser distinta','SAME_EVIDENCE',input.replacementEvidenceId);
  const source=work.evidence.find(e=>e.id===input.evidenceId),replacement=work.evidence.find(e=>e.id===input.replacementEvidenceId);
  if(!unperformed(source))fail('Solo se sustituye un intento not_run/blocked; no se retira un FAIL real ni aceptación de usuario','SOURCE_NOT_UNPERFORMED',input.evidenceId);
  if(!ordinaryPass(replacement))fail('La sustitución requiere evidencia PASS ordinaria; aceptación de usuario no acredita comprobación','REPLACEMENT_NOT_POSITIVE',input.replacementEvidenceId);
  if(work.evidence.indexOf(replacement)<=work.evidence.indexOf(source)||Date.parse(replacement.checkedAt)<Date.parse(source.checkedAt))fail('Evidencia sustituta anterior al intento no completado','REPLACEMENT_NOT_LATER',replacement.id);
  for(const criterionId of request.criterionIds){
    const criterion=work.objective.criteria.find(c=>c.id===criterionId);
    if(!criterion||!source.criterionIds.includes(criterionId)||!criterion.evidenceIds.includes(source.id))fail(`Criterio ${criterionId} sin vínculo activo a la evidencia sustituida`,'SOURCE_NOT_LINKED',criterionId);
    if(!replacement.criterionIds.includes(criterionId)||!criterion.evidenceIds.includes(replacement.id))fail(`Criterio ${criterionId} no cubierto por la evidencia sustituta vinculada`,'REPLACEMENT_NOT_LINKED',criterionId);
  }
  if(!replacement.files.some(file=>file.path===replacement.report&&typeof file.sha256==='string'))fail('Evidencia sustituta sin informe observado fingerprintado','REPLACEMENT_REPORT_MISSING',replacement.id);
  try{checkFresh(root,replacement,work,{criterionIds:request.criterionIds,taskIds:[]});}
  catch(error){fail(error.message,'REPLACEMENT_STALE',replacement.id);}
  const candidate=structuredClone(work);
  for(const criterionId of request.criterionIds){
    const criterion=candidate.objective.criteria.find(c=>c.id===criterionId);
    criterion.evidenceIds=criterion.evidenceIds.filter(evidenceId=>evidenceId!==source.id);
  }
  const record={...request,requestHash,cycle:work.cycle,appliedRevision:work.revision+1,at:now(),acceptanceBasis:acceptanceBasis(work,{criterionIds:request.criterionIds,taskIds:[]})};
  (candidate.evidenceSupersessions??=[]).push(record);
  return {work:candidate,record,duplicate:false};
}

function receipt(root,work,record,duplicate){
  return {...workReceipt(work,{operation:'work.apply',changes:duplicate?[]:[`${record.evidenceId} sustituida solo para ${record.criterionIds.join(', ')} por ${record.replacementEvidenceId}; observación conservada`]}),
    operationId:record.operationId,evidenceId:record.replacementEvidenceId,duplicate,applied:true,appliedRevision:record.appliedRevision,currentRevision:work.revision,
    readiness:completionReadiness(root,work),note:duplicate?'Decisión histórica recuperada; no repite sustitución ni acredita vigencia actual.':'Solo se sustituyeron vínculos de los criterios indicados; no se cambiaron requisitos, tareas ni observaciones.'};
}

/** Coordinator-only mutation; the adapter must retain its native approval gate. */
export function supersedeEvidence(root,input,options={}){
  assertShape(evidenceSupersessionInputSchema,input,'supersede_evidence');
  return withWorkspaceLock(root,()=>{
    checkContext(options);
    const current=readWork(root,input.workId,{files:false});
    const prepared=prepareEvidenceSupersession(root,current,input);
    checkContext(options);
    // Canonical commit and audit share one Work revision. A projection failure
    // preserves that commit; exact replay repairs the projection without redoing it.
    const saved=prepared.duplicate?syncWork(root,current.id):saveWork(root,prepared.work,input.expectedRevision);
    return receipt(root,saved,prepared.record,prepared.duplicate);
  });
}
