/** Synchronous file helpers. No agent sessions, queue, scheduler, timers or runtime state. */
import fs from 'node:fs';
import {generateWorkId} from './identity.mjs';
import {assertSchema} from './schema.mjs';
import {safePath,exists,readJSON,readText,writeJSON,atomicWrite,assertID,now,fingerprint,sha256} from './fs.mjs';
const terminal = status => ['done','cancelled'].includes(status);
const wp = id => `.pulso/work/${assertID(id)}/work.json`;
const unique = (values,label) => {if(new Set(values).size!==values.length)throw new Error(`${label}: duplicados`);};
const same = (a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const criterionMode=c=>c.acceptanceMode??'evidence';
/** Footprint is cycle-local, independent of current status and acceptance freshness. */
export const completedTaskIds=w=>[...new Set([...(w.completedTaskIds||[]),...w.tasks.filter(t=>t.status==='done').map(t=>t.id),...(w.results||[]).filter(r=>r.cycle===w.cycle).flatMap(r=>r.acceptedTaskIds)])];
export function assertTaskCancellation(work,taskId){
  if(completedTaskIds(work).includes(taskId)){const error=new Error(`Tarea realizada en este ciclo; no se puede cancelar: ${taskId}`);error.code='TASK_ALREADY_COMPLETED';throw error;}
}
// Work is canonical; history and state are repairable projections. Never hide a
// committed revision behind a generic failure when a projection write fails.
function projectWork(root,w,{focus=false}={}) {
  try {if(w.closure)recordClosure(root,w);putSummary(root,w,focus);}
  catch(cause) {
    const error=new Error(`Work ${w.id} revisión ${w.revision} persistido; proyecciones incompletas: ${cause.message}`,{cause});
    error.persistence={applied:true,partial:true,workId:w.id,revision:w.revision,recovery:'Releer el Work y ejecutar workspace.sync con su revisión persistida; si el índice está dañado, ejecutar workspace.recover. No repetir la mutación a ciegas.'};
    throw error;
  }
  return w;
}
function commitWork(root,w,options) {writeJSON(root,wp(w.id),w);return projectWork(root,w,options);}
function validateClosureInput(outcome,result,limitations) {
  if(!['done','cancelled'].includes(outcome)||typeof result!=='string'||!result.trim()||result.length>4000)throw new Error('Cierre requiere outcome y summary válidos');
  if(!Array.isArray(limitations)||limitations.length>30||limitations.some(value=>typeof value!=='string'||!value.trim()||value.length>1000))throw new Error('limitations: cada limitación requiere texto no vacío de hasta 1000 caracteres');
}
export function emptyState() {return {schemaVersion:1,revision:1,updatedAt:now(),focusWorkId:null,works:[]};}
export function initArtifacts(root) {
  if(!exists(root,'.pulso/state.json'))writeJSON(root,'.pulso/state.json',emptyState());
  if(!exists(root,'.pulso/history.jsonl'))atomicWrite(root,'.pulso/history.jsonl','');
  fs.mkdirSync(safePath(root,'.pulso/work'),{recursive:true});
}
export function validateWork(root,w,{files=true,fresh=false}={}) {
  assertSchema('work',w);
  unique(w.objective.criteria.map(c=>c.id),'Criterios');unique(w.tasks.map(t=>t.id),'Tareas');unique(w.evidence.map(e=>e.id),'Evidencias');
  unique(w.documents.map(d=>d.path),'Documentos');
  if (Date.parse(w.updatedAt)<Date.parse(w.createdAt))throw new Error('updatedAt anterior a createdAt');
  if (terminal(w.status)!==Boolean(w.closure))throw new Error('Cierre y estado terminal incoherentes');
  if(w.closure && (w.closure.cycle!==w.cycle || w.closure.outcome!==w.status || w.closure.id!==`${w.id}:c${w.cycle}`)) throw new Error('Identidad de cierre incoherente');
  const criteria=new Set(w.objective.criteria.map(c=>c.id)),tasks=new Map(w.tasks.map(t=>[t.id,t])), ev=new Map(w.evidence.map(e=>[e.id,e]));
  function refs(values,set,label){unique(values,label);for(const x of values)if(!set.has(x))throw new Error(`${label}: referencia inexistente ${x}`);}
  refs(w.completedTaskIds||[],tasks,'Huella de tareas completadas');
  for(const c of w.objective.criteria)refs(c.evidenceIds,ev,`Criterio ${c.id}`);
  for(const t of w.tasks) {
    refs(t.criterionIds,criteria,`Tarea ${t.id} criterios`);refs(t.dependsOn,tasks,`Tarea ${t.id} dependencias`);refs(t.evidenceIds,ev,`Tarea ${t.id} evidencias`);
    for(const p of t.writeScope)safePath(root,p);
    if(t.dependsOn.includes(t.id))throw new Error(`Autodependencia: ${t.id}`);
    if(t.status==='cancelled' && !t.summary.trim())throw new Error(`Tarea ${t.id} cancelada sin motivo`);
  }
  const visiting=new Set(),visited=new Set();
  function visit(id){if(visiting.has(id))throw new Error(`Ciclo de dependencias: ${id}`);if(visited.has(id))return;visiting.add(id);for(const d of tasks.get(id).dependsOn)visit(d);visiting.delete(id);visited.add(id);}
  for(const t of w.tasks)visit(t.id);
  const activeEvidence=new Set(terminal(w.status)?[]:[...w.objective.criteria.flatMap(c=>c.evidenceIds),...w.tasks.flatMap(t=>t.evidenceIds)]);
  for(const d of w.documents){
    safePath(root,d.path);
    const reports=w.evidence.filter(e=>e.report===d.path);
    if(files&&(!reports.length||reports.some(e=>activeEvidence.has(e.id)))&&!exists(root,d.path))throw new Error(`Documento no existe: ${d.path}`);
  }

  for(const e of w.evidence){
    refs(e.criterionIds,criteria,`Evidencia ${e.id} criterios`);refs(e.taskIds,tasks,`Evidencia ${e.id} tareas`);
    safePath(root,e.report);safePath(root,e.cwd,{allowDot:true});unique(e.files.map(f=>f.path),`Evidencia ${e.id} archivos`);
    if(files&&activeEvidence.has(e.id)&&!exists(root,e.report))throw new Error(`Informe no existe: ${e.report}`);
    for(const f of e.files){safePath(root,f.path);} if(e.acceptanceBasis){unique(e.acceptanceBasis.criteria.map(item=>item.id),`Base de criterio ${e.id}`);unique(e.acceptanceBasis.tasks.map(item=>item.id),`Base de tarea ${e.id}`);} // Historical paths may be deleted; current acceptance checks freshness at close.
    if(e.kind==='not_run' && e.status!=='not_run' && e.status!=='blocked')throw new Error(`Evidencia ${e.id}: not_run no puede aprobar`);
    if(e.kind==='executed' && e.status==='pass' && (e.exitCode!==0 || !e.command?.trim()))throw new Error(`Evidencia ${e.id}: ejecución PASS requiere comando y exitCode=0`);
    if(e.kind!=='executed' && e.exitCode!==null)throw new Error(`Evidencia ${e.id}: exitCode solo para ejecución`);
    if(e.origin==='user_acceptance'&&(e.kind!=='manual'||e.status!=='pass'||e.command!==null||e.taskIds.length))throw new Error(`Aceptación de usuario ${e.id}: requiere manual/pass, command:null y taskIds vacío`);
  }
  for(const c of w.objective.criteria)for(const id of c.evidenceIds)if(!ev.get(id).criterionIds.includes(c.id))throw new Error(`Enlace de criterio ${c.id}/${id} no es recíproco`);
  for(const t of w.tasks)for(const id of t.evidenceIds)if(!ev.get(id).taskIds.includes(t.id))throw new Error(`Enlace de tarea ${t.id}/${id} no es recíproco`);
  unique((w.results||[]).map(r=>r.id),'Resultados');
  unique((w.results||[]).map(r=>`${r.cycle}:${r.delegationId}`),'Encargos aceptados');
  for(const r of w.results||[]){
    refs(r.acceptedTaskIds,tasks,`Resultado ${r.id} tareas`);safePath(root,r.report);
    if(r.cycle>w.cycle||r.report!==`.pulso/work/${w.id}/results/${r.id}.json`)throw new Error(`Identidad de resultado inválida: ${r.id}`);
    for(const section of ['criteria','tasks'])unique(r.acceptanceBasis[section].map(item=>item.id),`Resultado ${r.id} base ${section}`);
  }
  if(w.closure){refs(w.closure.evidenceIds,ev,'Cierre evidencias');if(Date.parse(w.closure.at)<Date.parse(w.createdAt))throw new Error('Fecha de cierre anterior a creación');}
  if(w.status==='done')assertCompletion(root,w,{fresh:false});
  if(fresh&&!terminal(w.status)){
    const issues=completionReadiness(root,w).issues.filter(issue=>['EVIDENCE_STALE','USER_ACCEPTANCE_STALE','TASK_UNSUPPORTED','TASK_ACCEPTANCE_STALE'].includes(issue.code));
    if(issues.length){const error=new Error('Evidencia o aceptación de tareas no vigente');error.code='ACCEPTANCE_STALE';error.issues=issues;throw error;}
  }
  return w;
}
/** Stable acceptance fingerprints are observed by QA before and after checking.
 * The change counter prevents restoring old acceptance text from reviving an old PASS.
 * Neither these fingerprints nor file hashes prove execution or complete coverage.
 */
export function acceptanceBasis(work,{criterionIds=work.objective.criteria.map(c=>c.id),taskIds=work.tasks.map(t=>t.id)}={}){
  const count=(entity,id)=>(work.acceptanceChanges||[]).filter(change=>change.entity===entity&&change.entityId===id).length;
  const criterionHash=id=>{
    const c=work.objective.criteria.find(c=>c.id===id);if(!c)throw new Error(`Criterio inexistente: ${id}`);
    // Omit the default to preserve legacy hashes byte-for-byte. Non-default
    // modes participate explicitly; every mode change also advances the counter.
    return {id,sha256:sha256(JSON.stringify({workId:work.id,cycle:work.cycle,id,description:c.description,verification:c.verification,changes:count('criterion',id),...(criterionMode(c)==='evidence'?{}:{acceptanceMode:criterionMode(c)})}))};
  };
  const pending=new Set(),memo=new Map();
  const taskHash=id=>{
    if(memo.has(id))return memo.get(id);if(pending.has(id))throw new Error(`Ciclo de dependencias: ${id}`);
    const t=work.tasks.find(t=>t.id===id);if(!t)throw new Error(`Tarea inexistente: ${id}`);pending.add(id);
    const result={id,sha256:sha256(JSON.stringify({workId:work.id,cycle:work.cycle,id,criterionIds:t.criterionIds,criteria:t.criterionIds.map(criterionHash),acceptance:t.acceptance,writeScope:t.writeScope,resources:t.resources,dependsOn:t.dependsOn,dependencies:t.dependsOn.map(taskHash),changes:count('task',id)}))};
    pending.delete(id);memo.set(id,result);return result;
  };
  return {criteria:criterionIds.map(criterionHash),tasks:taskIds.map(taskHash)};
}
export function checkAcceptance(work,e,{criterionIds=e.criterionIds,taskIds=e.taskIds}={}){
  if(!e.acceptanceBasis)throw new Error(`Evidencia ${e.id} sin base observada de aceptación; requiere nueva observación`);
  const current=acceptanceBasis(work,{criterionIds,taskIds});
  for(const section of ['criteria','tasks'])for(const item of current[section]){
    if(e.acceptanceBasis[section].find(entry=>entry.id===item.id)?.sha256!==item.sha256)throw new Error(`Aceptación obsoleta ${e.id}: ${item.id}`);
  }
}
export function checkFresh(root,e,work,selection){
  for(const f of e.files){
    if(f.absent===true){if(exists(root,f.path))throw new Error(`Evidencia obsoleta ${e.id}: ${f.path} ya no está ausente`);}
    else if(!exists(root,f.path)||fingerprint(root,f.path).sha256!==f.sha256)throw new Error(`Evidencia obsoleta ${e.id}: ${f.path}`);
  }
  if(work)checkAcceptance(work,e,selection);
}
export function assertObservedEvidence(root,work,e){
  if(!e.acceptanceBasis)throw new Error(`Evidencia ${e.id} sin base observada de aceptación`);
  for(const [section,ids] of [['criteria',e.criterionIds],['tasks',e.taskIds]]){
    const observed=e.acceptanceBasis[section].map(entry=>entry.id);unique(observed,`Base observada ${section}`);
    if(!same([...observed].sort(),[...ids].sort()))throw new Error(`Base observada ${section} no corresponde a los vínculos`);
  }
  if(!e.files.some(file=>file.path===e.report&&typeof file.sha256==='string'))throw new Error('El informe/salida observado debe incluir su fingerprint en files');
  checkFresh(root,e,work);
}
export function readWork(root,id,options={}) {const w=readJSON(root,wp(id));if(w.id!==id)throw new Error('ID y ruta de Work no coinciden');return validateWork(root,w,options);}
export function status(root){const s=assertSchema('state',readJSON(root,'.pulso/state.json'));unique(s.works.map(w=>w.id),'Índice del proyecto');for(const w of s.works){if(w.path!==wp(w.id))throw new Error('Ruta del índice incoherente');if(w.progress.done>w.progress.total)throw new Error('Progreso del índice incoherente');}if(s.focusWorkId&&!s.works.some(w=>w.id===s.focusWorkId))throw new Error('Foco inexistente');return s;}
export function history(root){
  const text=readText(root,'.pulso/history.jsonl');const entries=[];
  for(const [i,line] of text.split('\n').entries()){if(!line.trim())continue;let e;try{e=JSON.parse(line);}catch{throw new Error(`Historial inválido en línea ${i+1}; no se sobrescribirá`);}assertSchema('history-entry',e);if(e.workPath!==wp(e.workId)||e.closureId!==`${e.workId}:c${e.cycle}`)throw new Error('Identidad inválida en historial');entries.push(e);}
  unique(entries.map(e=>e.closureId),'Cierres');return entries;
}
function summary(w){return {id:w.id,title:w.title,objective:w.objective.outcome,path:wp(w.id),status:w.status,priority:w.priority,workRevision:w.revision,cycle:w.cycle,progress:{done:w.tasks.filter(t=>t.status==='done').length,total:w.tasks.length},lastProgress:w.summary,blockers:w.blockers,decisionsPending:w.decisionsPending,nextAction:w.nextAction,updatedAt:w.updatedAt};}
function closureEntry(w){const c=w.closure;
  const entry={schemaVersion:1,closureId:c.id,workId:w.id,cycle:w.cycle,title:w.title,objective:w.objective.outcome,createdAt:w.createdAt,closedAt:c.at,outcome:c.outcome,summary:c.summary,limitations:c.limitations,evidenceIds:c.evidenceIds,workPath:wp(w.id)};
  return assertSchema('history-entry',entry);
}
function recordClosure(root,w){
  const h=history(root),entry=closureEntry(w);
  assertSchema('history-entry',entry);const old=h.find(e=>e.closureId===entry.closureId);
  if(old){if(!same(old,entry))throw new Error('Cierre existente diferente; requiere revisión humana');return;}
  // Logical append, whole-file atomic replacement to avoid partial trailing JSON records.
  atomicWrite(root,'.pulso/history.jsonl',h.concat(entry).map(x=>JSON.stringify(x)).join('\n')+'\n');
}
function putSummary(root,w,focus=false){
  const s=status(root),index=s.works.findIndex(x=>x.id===w.id);
  const before=JSON.stringify({works:s.works,focusWorkId:s.focusWorkId});
  if(terminal(w.status)){if(index>=0)s.works.splice(index,1);if(s.focusWorkId===w.id)s.focusWorkId=null;}
  else {const entry=summary(w);if(index<0)s.works.push(entry);else s.works[index]=entry;if(focus)s.focusWorkId=w.id;}
  if(before===JSON.stringify({works:s.works,focusWorkId:s.focusWorkId}))return s;
  s.revision++;s.updatedAt=now();writeJSON(root,'.pulso/state.json',assertSchema('state',s));return s;
}
export function syncWork(root,id,{focus=false}={}) {return projectWork(root,readWork(root,id,{files:false}),{focus});}
export function createWork(root,{id=generateWorkId(),title,objective,criterion,verification,priority='normal'}) {
  assertID(id);if(exists(root,wp(id)))throw new Error(`Trabajo ya existe: ${id}`);
  status(root);history(root);const ts=now();
  const w={schemaVersion:1,id,revision:1,cycle:1,title,objective:{id:'OBJ-1',outcome:objective,criteria:[{id:'AC-1',description:criterion,verification,evidenceIds:[]}]},status:'pending',priority,createdAt:ts,updatedAt:ts,summary:'Trabajo creado; alcance pendiente de revisión.',blockers:[],decisionsPending:[],nextAction:'Revisar contexto y criterio de aceptación',documents:[],tasks:[],evidence:[],acceptanceChanges:[],closure:null};
  validateWork(root,w);return commitWork(root,w,{focus:true});
}
export function saveWork(root,candidate,expectedRevision){
  assertSchema('work',candidate);const old=readWork(root,candidate.id,{files:false});
  if(!Number.isSafeInteger(expectedRevision)||old.revision!==expectedRevision||candidate.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${old.revision}. Releer y reconciliar, no sobrescribir.`);
  if(terminal(old.status)||terminal(candidate.status))throw new Error('Usar close/reopen para estados terminales');
  if(candidate.cycle!==old.cycle||candidate.createdAt!==old.createdAt||candidate.objective.id!==old.objective.id)throw new Error('Identidad/ciclo/fecha de creación inmutables');
  status(root);const priorHistory=history(root); // Preflight before persisting canonical data.
  const archivedIDs=new Set(priorHistory.filter(e=>e.workId===old.id).flatMap(e=>e.evidenceIds));
  for(const id of archivedIDs){const before=old.evidence.find(e=>e.id===id),after=candidate.evidence.find(e=>e.id===id);if(!same(before,after))throw new Error(`Evidencia archivada inmutable: ${id}`);}
  const w=structuredClone(candidate);
  w.completedTaskIds=[...new Set([...completedTaskIds(old),...completedTaskIds(w)])];
  for(const task of w.tasks)if(task.status==='cancelled')assertTaskCancellation(w,task.id);
  w.revision++;w.updatedAt=now();validateWork(root,w);
  const oldChanges=old.acceptanceChanges||[],newChanges=w.acceptanceChanges||[];
  if(newChanges.length<oldChanges.length||!same(newChanges.slice(0,oldChanges.length),oldChanges))throw new Error('Historial de aceptación inmutable');
  for(const before of old.evidence){
    const after=w.evidence.find(e=>e.id===before.id);if(!after)throw new Error(`La observación se conserva; retirar solo sus vínculos: ${before.id}`);
    const observed=e=>{const {summary,editedAt,...rest}=e;return rest;};
    if(!same(observed(before),observed(after)))throw new Error(`Observación de evidencia inmutable: ${before.id}; repetir con un ID nuevo`);
  }
  const oldResults=old.results||[],newResults=w.results||[];
  if(newResults.length<oldResults.length||!same(newResults.slice(0,oldResults.length),oldResults))throw new Error('Resultados aceptados inmutables');
  for(const record of newResults.slice(oldResults.length)){
    if(record.cycle!==w.cycle||fingerprint(root,record.report).sha256!==record.sha256)throw new Error(`Resultado sin informe incorporado íntegro: ${record.id}`);
    checkAcceptance(w,record,{criterionIds:[],taskIds:record.acceptedTaskIds});
  }
  for(const evidence of w.evidence.filter(e=>!old.evidence.some(previous=>previous.id===e.id)))assertObservedEvidence(root,w,evidence);
  const newlyDone=new Set(w.tasks.filter(t=>t.status==='done'&&old.tasks.find(previous=>previous.id===t.id)?.status!=='done').map(t=>t.id));
  if(newlyDone.size){
    const issues=completionReadiness(root,w).issues.filter(issue=>newlyDone.has(issue.entity)&&['TASK_UNSUPPORTED','TASK_ACCEPTANCE_STALE'].includes(issue.code));
    if(issues.length){const error=new Error('Completar tareas requiere resultado aceptado o evidencia pertinente');error.code='TASK_ACCEPTANCE_REQUIRED';error.issues=issues;throw error;}
  }
  return commitWork(root,w);
}
function assertObservedReport(e){if(!e.files.some(file=>file.path===e.report&&typeof file.sha256==='string'))throw new Error(`Evidencia ${e.id} sin informe/salida observado fingerprintado`);}
/** One exhaustive evaluator for reads and closure. Task history does not require
 * the implementation files to retain their old bytes; final criteria do. */
export function completionReadiness(root,w,{fresh=!terminal(w.status)}={}){
  const issues=[],used=new Set(),ev=new Map(w.evidence.map(e=>[e.id,e]));
  const issue=(code,entity,message)=>issues.push({code,entity,message});
  if(fresh)for(const document of w.documents){
    // Match the document existence rule of the prospective terminal Work.
    // Evidence reports are checked through their active final acceptance below.
    if(w.evidence.some(e=>e.report===document.path))continue;
    try{if(!exists(root,document.path))issue('DOCUMENT_MISSING',document.path,`Documento no existe: ${document.path}`);}
    catch(error){issue('DOCUMENT_INVALID',document.path,error.message);}
  }
  w.blockers.forEach((message,i)=>issue('BLOCKER',`blockers[${i}]`,message));
  w.decisionsPending.forEach((message,i)=>issue('DECISION_PENDING',`decisionsPending[${i}]`,message));
  for(const t of w.tasks)if(!terminal(t.status))issue('TASK_OPEN',t.id,`Tarea ${t.id}: ${t.status}`);
  if(fresh)for(const t of w.tasks)if(t.status==='cancelled'&&completedTaskIds(w).includes(t.id))issue('TASK_ALREADY_COMPLETED',t.id,`Tarea realizada en este ciclo; cancelación no admisible: ${t.id}`);
  for(const c of w.objective.criteria){
    const mode=criterionMode(c),requiresEvidence=mode!=='user',requiresUser=mode!=='evidence';
    let positive=false,userPositive=false;const userFailures=[];
    for(const id of c.evidenceIds){
      const e=ev.get(id);
      if(e?.origin==='user_acceptance'){
        if(!requiresUser)continue;
        try{
          if(e.kind!=='manual'||e.status!=='pass'||!e.criterionIds.includes(c.id))throw new Error(`Aceptación de usuario inválida: ${id}`);
          if(fresh){assertObservedReport(e);checkFresh(root,e,w,{criterionIds:[c.id],taskIds:[]});}
          userPositive=true;used.add(id);
        }catch(error){userFailures.push(error.message);}
        continue;
      }
      if(!requiresEvidence)continue;
      if(!e||e.status!=='pass'||e.kind==='not_run'||!e.criterionIds.includes(c.id)){issue('EVIDENCE_NOT_POSITIVE',c.id,`Evidencia no positiva: ${id}`);continue;}
      try{if(fresh){assertObservedReport(e);checkFresh(root,e,w,{criterionIds:[c.id],taskIds:[]});}positive=true;used.add(id);}
      catch(error){issue('EVIDENCE_STALE',c.id,error.message);}
    }
    if(requiresEvidence&&!positive)issue('CRITERION_UNSUPPORTED',c.id,`Falta evidencia final vigente: ${c.id}`);
    if(requiresUser&&!userPositive){
      issue('USER_ACCEPTANCE_REQUIRED',c.id,`Falta aceptación explícita vigente del usuario: ${c.id}`);
      for(const message of userFailures)issue('USER_ACCEPTANCE_STALE',c.id,message);
    }
  }
  for(const t of w.tasks.filter(t=>t.status==='done')){
    let supported=false;const failures=[];
    for(const r of (w.results||[]).filter(r=>r.cycle===w.cycle&&r.acceptedTaskIds.includes(t.id))){
      try{
        if(fresh){checkAcceptance(w,r,{criterionIds:[],taskIds:[t.id]});if(fingerprint(root,r.report).sha256!==r.sha256)throw new Error(`Informe de resultado alterado: ${r.id}`);}
        supported=true;
      }catch(error){failures.push(error.message);}
    }
    for(const id of t.evidenceIds){
      const e=ev.get(id);if(!e||e.origin==='user_acceptance'||e.status!=='pass'||e.kind==='not_run'||!e.taskIds.includes(t.id))continue;
      try{
        if(fresh){
          assertObservedReport(e);checkAcceptance(w,e,{criterionIds:[],taskIds:[t.id]});
          if(fingerprint(root,e.report).sha256!==e.files.find(file=>file.path===e.report).sha256)throw new Error(`Informe histórico alterado: ${e.id}`);
        }
        supported=true;used.add(id);
      }
      catch(error){failures.push(error.message);}
    }
    if(!supported){issue('TASK_UNSUPPORTED',t.id,`Falta resultado aceptado o evidencia pertinente: ${t.id}`);for(const message of failures)issue('TASK_ACCEPTANCE_STALE',t.id,message);}
  }
  return {ready:issues.length===0,issues,revision:w.revision,evidenceIds:[...used]};
}
function assertCompletion(root,w,options){
  const readiness=completionReadiness(root,w,options);
  if(!readiness.ready){const error=new Error(`Cierre pendiente: ${readiness.issues.length} impedimentos`);error.code='CLOSURE_NOT_READY';error.issues=readiness.issues;error.readiness=readiness;throw error;}
  return readiness.evidenceIds;
}
function prepareClosure(root,w,{outcome,summary:result,limitations}){
  const evid=outcome==='done'?assertCompletion(root,w):w.evidence.map(e=>e.id);
  w.completedTaskIds=completedTaskIds(w);
  if(outcome==='cancelled')for(const t of w.tasks)if(t.status!=='done'){
    assertTaskCancellation(w,t.id);
    if(!terminal(t.status)){t.status='cancelled';t.summary=`Cancelada al cerrar trabajo: ${result}`;}
  }
  w.revision++;w.status=outcome;w.summary=result;w.nextAction=null;w.updatedAt=now();
  w.closure={id:`${w.id}:c${w.cycle}`,cycle:w.cycle,at:w.updatedAt,outcome,summary:result,evidenceIds:evid,limitations};
  validateWork(root,w);return w;
}
export function closeWork(root,id,{outcome='done',summary:result,limitations=[]}={}){
  validateClosureInput(outcome,result,limitations);
  const w=readWork(root,id,{files:false});status(root);history(root);
  if(w.closure){if(w.closure.outcome!==outcome||w.closure.summary!==result||!same(w.closure.limitations,limitations))throw new Error('Trabajo ya cerrado con otro resultado');return syncWork(root,id);}
  prepareClosure(root,w,{outcome,summary:result,limitations});return commitWork(root,w);
}
export function reopenWork(root,id,reason){
  if(!reason?.trim())throw new Error('Reapertura requiere motivo');const w=readWork(root,id,{files:false});if(!w.closure)throw new Error('Trabajo ya abierto');status(root);recordClosure(root,w);
  w.cycle++;w.revision++;w.status='pending';w.closure=null;w.updatedAt=now();w.summary=`Reabierto: ${reason}`;w.nextAction='Revisar alcance, tareas y evidencia antes de continuar';
  w.completedTaskIds=[];
  // The original closure keeps its evidence references; active criteria/tasks need new acceptance.
  for(const c of w.objective.criteria)c.evidenceIds=[];
  for(const t of w.tasks){t.status='pending';t.evidenceIds=[];t.summary='Revisión requerida tras reapertura';}
  validateWork(root,w,{files:false});return commitWork(root,w,{focus:true});
}
export function repair(root,{files=false}={}){
  const oldHistory=history(root);const folder=safePath(root,'.pulso/work');const works=[];
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){if(item.isSymbolicLink())throw new Error('Symlink en work');if(item.isDirectory()){assertID(item.name);works.push(readWork(root,item.name,{files}));}}
  // Validate every work before any changes; never use a partial successful subset.
  const ids=new Set(works.map(w=>w.id));
  for(const e of oldHistory)if(!ids.has(e.workId))throw new Error(`Historial apunta a trabajo ausente: ${e.workId}; restaurar carpeta antes de reparar.`);
  let old;try{old=status(root);}catch{old=null;}
  if(old)for(const e of old.works)if(!ids.has(e.id))throw new Error(`Índice apunta a trabajo ausente: ${e.id}; no se descartará.`);
  // Reject every divergent closure before appending any missing one.
  for(const w of works)if(w.closure){const archived=oldHistory.find(e=>e.closureId===w.closure.id);if(archived&&!same(archived,closureEntry(w)))throw new Error('Cierre existente diferente; requiere revisión humana');}
  for(const w of works)if(w.closure)recordClosure(root,w);
  const s=emptyState();s.revision=(old?.revision||0)+1;s.works=works.filter(w=>!terminal(w.status)).map(summary);
  s.focusWorkId=s.works.some(w=>w.id===old?.focusWorkId)?old.focusWorkId:null;
  // Preserve malformed index before explicit repair, not silently discard it.
  if(!old&&exists(root,'.pulso/state.json'))atomicWrite(root,`.pulso/recovery/state-${Date.now()}.json`,readText(root,'.pulso/state.json'));
  writeJSON(root,'.pulso/state.json',s);return s;
}
export function validateProject(root,{fresh=false}={}){
  const s=status(root),h=history(root),seen=new Set();let count=0;
  for(const item of fs.readdirSync(safePath(root,'.pulso/work'),{withFileTypes:true})){
    if(item.isSymbolicLink())throw new Error('Symlink en work');if(!item.isDirectory())continue;
    const w=readWork(root,item.name,{fresh});seen.add(w.id);count++;
    const entry=s.works.find(x=>x.id===w.id);
    if(w.closure){if(entry)throw new Error(`Cerrado aún en índice: ${w.id}. Ejecutar sync.`);const archived=h.find(x=>x.closureId===w.closure.id);if(!archived)throw new Error(`Cierre sin historial: ${w.id}. Ejecutar sync.`);if(!same(archived,closureEntry(w)))throw new Error(`Cierre inconsistente con historial: ${w.id}`);}
    else if(!entry||!same(entry,summary(w)))throw new Error(`Índice desactualizado: ${w.id}. Ejecutar sync.`);
  }
  for(const entry of s.works)if(!seen.has(entry.id))throw new Error(`Índice sin archivo: ${entry.id}`);
  for(const entry of h)if(!seen.has(entry.workId))throw new Error(`Historial apunta a trabajo ausente: ${entry.workId}`);
  return {valid:true,works:count,active:s.works.length,closures:h.length,freshnessChecked:fresh};
}
export const inScope=(p,scopes)=>scopes.some(scope=>p===scope||p.startsWith(scope+'/'));
export function validateDelegation(root,delegation,{globalRoot,catalogPath='catalog.json',work=readWork(root,delegation.workId,{files:false}),canonical=false}={}){
  assertSchema('delegation',delegation);
  if(work.id!==delegation.workId||delegation.workRevision>work.revision)throw new Error('Identidad/revisión de encargo inválida');
  if(!globalRoot)throw new Error('Falta la raíz global confiable de plantillas');
  const catalog=readJSON(globalRoot,catalogPath),template=catalog.templates?.[delegation.templateId];
  if(!template||!catalog.specialists.some(a=>a.id===delegation.agent))throw new Error('Plantilla o agente fuera del catálogo global');
  readText(globalRoot,template); // Resolve and actually read the installed template through the same path guard.
  unique(delegation.taskIds,'Tareas del encargo');
  const tasks=delegation.taskIds.map(id=>{const task=work.tasks.find(t=>t.id===id);if(!task||task.agent!==delegation.agent)throw new Error(`Tarea no asignada al agente: ${id}`);return task;});
  for(const p of [...delegation.inputs,...(delegation.output==='conversation'?[]:[delegation.output]),...delegation.writeScope])safePath(root,p);
  const derived=key=>[...new Set(tasks.flatMap(t=>t[key]))];
  if(canonical)for(const key of ['writeScope','resources','acceptance'])if(!same(delegation[key],derived(key)))throw new Error(`Encargo no canónico: ${key}`);
  if(delegation.output!=='conversation'&&!inScope(delegation.output,delegation.writeScope))throw new Error('Output fuera del alcance de escritura');
  for(const scope of delegation.writeScope)if(!tasks.some(t=>inScope(scope,t.writeScope)))throw new Error(`Encargo fuera del alcance de la tarea: ${scope}`);
  for(const resource of delegation.resources)if(!derived('resources').includes(resource))throw new Error(`Recurso no autorizado: ${resource}`);
  // Resources can also contain capability labels; only guarded relative paths
  // authorize filesystem reads. Host roots never come from these strings.
  const readScope=[...delegation.writeScope,...delegation.resources.filter(p=>{try{safePath(root,p);return true;}catch{return false;}})];
  for(const p of delegation.inputs){if(!inScope(p,readScope))throw new Error(`Input no autorizado: ${p}`);if(!exists(root,p))throw new Error(`Input inaccesible: ${p}`);}
  return {work,tasks,readScope};
}
export function validateResultIdentity(delegation,result){
  assertSchema('delegation',delegation);assertSchema('result',result);
  for(const [left,right] of [['id','delegationId'],['workId','workId'],['workRevision','workRevision'],['agent','agent']])if(delegation[left]!==result[right])throw new Error(`Resultado no corresponde al encargo: ${right}`);
}
export function validateResult(root,delegation,result,{globalRoot,catalogPath='catalog.json',acceptanceBasis:priorBasis,canonical=false,requireOutput=true}={}){
  validateResultIdentity(delegation,result);
  const {work,readScope}=validateDelegation(root,delegation,{globalRoot,catalogPath,canonical});
  if(priorBasis){
    const criterionIds=[...new Set(work.tasks.filter(t=>delegation.taskIds.includes(t.id)).flatMap(t=>t.criterionIds))];
    const selection={criterionIds,taskIds:delegation.taskIds};
    for(const [section,ids] of [['criteria',criterionIds],['tasks',delegation.taskIds]])if(!same(priorBasis[section].map(x=>x.id).sort(),[...ids].sort()))throw new Error(`Base del encargo no corresponde: ${section}`);
    checkAcceptance(work,{id:delegation.id,acceptanceBasis:priorBasis},selection);
  }else if(work.revision!==delegation.workRevision)throw new Error('Revisión del encargo obsoleta; releer y reconciliar');
  for(const p of [...result.artifacts,...result.changedFiles]){
    safePath(root,p);if(!inScope(p,delegation.writeScope))throw new Error(`Resultado fuera del alcance de escritura: ${p}`);
    if(!exists(root,p))throw new Error(`Archivo declarado inexistente: ${p}`);
  }
  if(requireOutput&&delegation.output!=='conversation'&&result.status==='completed'&&!result.artifacts.includes(delegation.output))throw new Error('Resultado completed no declara el output del encargo');
  for(const check of result.checks)if(check.evidenceRef){safePath(root,check.evidenceRef);if(!inScope(check.evidenceRef,readScope))throw new Error('Referencia de evidencia no autorizada');if(!exists(root,check.evidenceRef))throw new Error('Referencia de evidencia inexistente');}
  return {valid:true,templateId:delegation.templateId,semanticAcceptance:'PENDING_REVIEW',note:'No prueba ejecución, identidad nativa ni ausencia de otros cambios. Revisar diff y evidencia.'};
}
