import {closeWork,createWork,readWork,reopenWork,saveWork,status,history,validateProject,assertObservedEvidence,syncWork,repair} from './artifacts.mjs';
import {assertID,now,safePath} from './fs.mjs';
import {workReceipt} from './receipts.mjs';
import {assertSchema} from './schema.mjs';

const text=(value,label,{required=true,max=4000}={})=>{
  if(typeof value!=='string'||(required&&!value.trim())||value.length>max)throw new Error(`${label}: texto inválido`);
  return value;
};
const list=(value,label,max=50)=>{
  if(!Array.isArray(value)||value.length>max||value.some(item=>typeof item!=='string'))throw new Error(`${label}: lista inválida`);
  return value;
};
const keys=(value,allowed)=>{for(const key of Object.keys(value))if(!allowed.includes(key))throw new Error(`Campo de acción no admitido: ${key}`);};


const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const criterionAcceptance=c=>({description:c.description,verification:c.verification});
const taskAcceptance=t=>Object.fromEntries(['criterionIds','dependsOn','writeScope','resources','acceptance'].map(key=>[key,structuredClone(t[key])]));
function recordAcceptanceChange(work,entity,entityId,before,after,action){
  const reason=text(action.reason,'Cambiar aceptación requiere reason',{max:1000});
  const record={at:now(),entity,entityId,before,after,reason};
  if(action.decisionRef!==undefined)record.decisionRef=text(action.decisionRef,'decisionRef',{max:1000});
  (work.acceptanceChanges??=[]).push(record);
}
function invalidateAcceptance(work,{criterionIds=[],taskIds=[]}={}){
  const affected=new Set([...taskIds,...work.tasks.filter(t=>t.criterionIds.some(id=>criterionIds.includes(id))).map(t=>t.id)]);
  let changed=true;while(changed){changed=false;for(const task of work.tasks)if(!affected.has(task.id)&&task.dependsOn.some(id=>affected.has(id))){affected.add(task.id);changed=true;}}
  const invalidated=new Set(work.evidence.filter(e=>e.taskIds.some(id=>affected.has(id))).map(e=>e.id));
  for(const criterion of work.objective.criteria)criterion.evidenceIds=criterionIds.includes(criterion.id)?[]:criterion.evidenceIds.filter(id=>!invalidated.has(id));
  for(const task of work.tasks)if(affected.has(task.id)){task.evidenceIds=[];if(task.status==='done')task.status='pending';}
  // Evidence links describe the immutable observation. Active acceptance links may be withdrawn.
}

export function createWorkOperation(root,input) {
  if(input?.priority==='urgent')throw new Error('priority debe ser low, normal, high o critical; urgent no está admitido');
  assertSchema('work-create',input);
  const priority=input.priority||'normal';
  if(!['low','normal','high','critical'].includes(priority))throw new Error('priority inválida');
  const work=createWork(root,{id:input.workId,title:text(input.title,'title',{max:240}),objective:text(input.objective,'objective'),criterion:text(input.criterion,'criterion'),verification:text(input.verification,'verification'),priority});
  return workReceipt(work,{operation:'work.create',changes:['objetivo y criterio registrados']});
}

export function applyWorkMutation(root,input) {
  if(input?.actions?.some?.(action=>action?.priority==='urgent'))throw new Error('priority debe ser low, normal, high o critical; urgent no está admitido');
  assertSchema('work-update',input);
  const {workId,expectedRevision,actions}=input;
  assertID(workId);
  if(!Number.isSafeInteger(expectedRevision))throw new Error('expectedRevision es obligatorio');
  if(!Array.isArray(actions)||actions.length<1||actions.length>20)throw new Error('actions debe contener entre 1 y 20 acciones');
  const work=readWork(root,workId,{files:false});
  if(work.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${work.revision}. Releer y reconciliar, no sobrescribir.`);
  const candidate=structuredClone(work),changes=[];
  for(const action of actions){
    if(!action||typeof action!=='object'||Array.isArray(action))throw new Error('Acción inválida');
    switch(action.type){
      case 'work.set_overview': {
        keys(action,['type','summary','blockers','decisionsPending','nextAction','priority','status']);
        if(Object.keys(action).length===1)throw new Error('work.set_overview requiere al menos un campo');
        if(action.summary!==undefined)candidate.summary=text(action.summary,'summary',{max:2000});
        if(action.blockers!==undefined)candidate.blockers=list(action.blockers,'blockers',30).map(x=>text(x,'blocker',{max:500}));
        if(action.decisionsPending!==undefined)candidate.decisionsPending=list(action.decisionsPending,'decisionsPending',30).map(x=>text(x,'decision',{max:500}));
        if(action.nextAction!==undefined)candidate.nextAction=action.nextAction===null?null:text(action.nextAction,'nextAction',{max:1000});
        if(action.priority!==undefined){if(!['low','normal','high','critical'].includes(action.priority))throw new Error('priority inválida');candidate.priority=action.priority;}
        if(action.status!==undefined){if(!['pending','in_progress','blocked','paused'].includes(action.status))throw new Error('work status terminal requiere close/reopen');candidate.status=action.status;}
        changes.push('resumen del trabajo actualizado');break;
      }
      case 'task.add': {
        keys(action,['type','task']);
        assertID(action.task?.id);if(candidate.tasks.some(t=>t.id===action.task.id))throw new Error(`Tarea duplicada: ${action.task.id}`);
        const task=structuredClone(action.task);
        task.title=text(task.title,'task.title',{max:300});
        candidate.tasks.push(task);changes.push(`${task.id} agregada`);break;
      }
      case 'task.update': {
        keys(action,['type','taskId','patch','reason','decisionRef']);
        assertID(action.taskId);const task=candidate.tasks.find(t=>t.id===action.taskId);if(!task)throw new Error(`Tarea inexistente: ${action.taskId}`);
        const patch=action.patch;if(!Object.keys(patch).length)throw new Error('task.update requiere un cambio');
        const before=taskAcceptance(task);
        Object.assign(task,structuredClone(patch));
        const after=taskAcceptance(task);
        if(!equal(before,after)){
          recordAcceptanceChange(candidate,'task',task.id,before,after,action);
          invalidateAcceptance(candidate,{taskIds:[task.id]});
        }
        changes.push(`${task.id} actualizada`);break;
      }
      case 'task.set_status': {
        keys(action,['type','taskId','status','summary']);
        assertID(action.taskId);const task=candidate.tasks.find(t=>t.id===action.taskId);if(!task)throw new Error(`Tarea inexistente: ${action.taskId}`);
        if(!['pending','in_progress','blocked','paused','done','cancelled'].includes(action.status))throw new Error('Estado de tarea inválido');
        task.status=action.status;if(action.summary!==undefined)task.summary=text(action.summary,'task.summary',{max:2000});
        if(action.status==='cancelled'&&!task.summary.trim())throw new Error('Tarea cancelada requiere motivo');
        changes.push(`${task.id} ${action.status==='done'?'completada':action.status}`);break;
      }
      case 'evidence.add': {
        keys(action,['type','evidence']);
        const e=structuredClone(action.evidence);assertID(e.id);if(candidate.evidence.some(x=>x.id===e.id))throw new Error(`Evidencia duplicada: ${e.id}; repetir requiere ID nuevo`);
        safePath(root,e.report);text(e.summary,'evidence.summary',{max:2000});
        assertObservedEvidence(root,candidate,e);
        candidate.evidence.push(e);
        for(const id of e.criterionIds){const c=candidate.objective.criteria.find(x=>x.id===id);if(!c)throw new Error(`Criterio inexistente: ${id}`);if(!c.evidenceIds.includes(e.id))c.evidenceIds.push(e.id);}
        for(const id of e.taskIds){const t=candidate.tasks.find(x=>x.id===id);if(!t)throw new Error(`Tarea inexistente: ${id}`);if(!t.evidenceIds.includes(e.id))t.evidenceIds.push(e.id);}
        changes.push(`${e.id} registrada`);break;
      }
      case 'evidence.update': {
        keys(action,['type','evidenceId','patch']);
        const evidence=candidate.evidence.find(e=>e.id===action.evidenceId);if(!evidence)throw new Error(`Evidencia inexistente: ${action.evidenceId}`);
        evidence.summary=text(action.patch.summary,'evidence.summary',{max:2000});
        evidence.editedAt=action.patch.editedAt??now();
        changes.push(`${evidence.id} resumen corregido; observación conservada`);break;
      }
      case 'evidence.remove': {
        keys(action,['type','evidenceId']);
        if(!candidate.evidence.some(e=>e.id===action.evidenceId))throw new Error(`Evidencia inexistente: ${action.evidenceId}`);
        for(const c of candidate.objective.criteria)c.evidenceIds=c.evidenceIds.filter(id=>id!==action.evidenceId);
        for(const t of candidate.tasks)if(t.evidenceIds.includes(action.evidenceId)){t.evidenceIds=t.evidenceIds.filter(id=>id!==action.evidenceId);if(t.status==='done')t.status='pending';}
        changes.push(`${action.evidenceId} retirada de aceptación; observación conservada`);break;
      }
      case 'criterion.add': {
        keys(action,['type','criterion']);
        const criterion=structuredClone(action.criterion);assertID(criterion?.id);if(candidate.objective.criteria.some(c=>c.id===criterion.id))throw new Error(`Criterio duplicado: ${criterion.id}`);
        criterion.description=text(criterion.description,'criterion.description',{max:4000});criterion.verification=text(criterion.verification,'criterion.verification',{max:4000});criterion.evidenceIds=[];
        candidate.objective.criteria.push(criterion);changes.push(`${criterion.id} agregada`);break;
      }
      case 'criterion.update': {
        keys(action,['type','criterionId','reason','decisionRef','description','verification']);
        const criterion=candidate.objective.criteria.find(c=>c.id===action.criterionId);if(!criterion)throw new Error(`Criterio inexistente: ${action.criterionId}`);
        if(action.description===undefined&&action.verification===undefined)throw new Error('criterion.update requiere descripción o verificación');
        const before=criterionAcceptance(criterion);
        if(action.description!==undefined)criterion.description=text(action.description,'criterion.description',{max:4000});
        if(action.verification!==undefined)criterion.verification=text(action.verification,'criterion.verification',{max:4000});
        const after=criterionAcceptance(criterion);
        if(!equal(before,after)){
          recordAcceptanceChange(candidate,'criterion',criterion.id,before,after,action);
          invalidateAcceptance(candidate,{criterionIds:[criterion.id]});
        }
        changes.push(`${criterion.id} actualizado con motivo registrado`);break;
      }
      case 'criterion.remove': {
        keys(action,['type','criterionId']);
        assertID(action.criterionId);const criterion=candidate.objective.criteria.find(c=>c.id===action.criterionId);if(!criterion)throw new Error(`Criterio inexistente: ${action.criterionId}`);
        if(criterion.evidenceIds.length||candidate.evidence.some(e=>e.criterionIds.includes(action.criterionId))||candidate.tasks.some(t=>t.criterionIds.includes(action.criterionId)))throw new Error(`Criterio ${action.criterionId} tiene dependencias`);
        candidate.objective.criteria=candidate.objective.criteria.filter(c=>c.id!==action.criterionId);changes.push(`${action.criterionId} retirada`);break;
      }
      case 'task.remove': {
        keys(action,['type','taskId']);
        assertID(action.taskId);const task=candidate.tasks.find(t=>t.id===action.taskId);if(!task)throw new Error(`Tarea inexistente: ${action.taskId}`);
        if(task.evidenceIds.length||candidate.evidence.some(e=>e.taskIds.includes(action.taskId))||candidate.tasks.some(t=>t.dependsOn.includes(action.taskId)))throw new Error(`Tarea ${action.taskId} tiene dependencias`);
        candidate.tasks=candidate.tasks.filter(t=>t.id!==action.taskId);changes.push(`${action.taskId} retirada`);break;
      }
      case 'document.register': {
        keys(action,['type','document']);
        const doc=structuredClone(action.document);safePath(root,doc?.path);
        if(candidate.documents.some(d=>d.path===doc.path))throw new Error(`Documento ya registrado: ${doc.path}`);
        candidate.documents.push(doc);changes.push('documento registrado');break;
      }
      case 'document.unregister': {
        keys(action,['type','path']);
        safePath(root,action.path);if(candidate.evidence.some(e=>e.report===action.path))throw new Error('El documento es informe de evidencia vigente');
        if(!candidate.documents.some(d=>d.path===action.path))throw new Error(`Documento no registrado: ${action.path}`);
        candidate.documents=candidate.documents.filter(d=>d.path!==action.path);changes.push('documento retirado del registro');break;
      }
      default: throw new Error(`Acción no admitida: ${action.type}`);
    }
  }
  const saved=saveWork(root,candidate,expectedRevision);
  return workReceipt(saved,{changes});
}

export function closeWorkOperation(root,{workId,expectedRevision,outcome='done',summary,limitations=[]}) {
  assertID(workId);const current=readWork(root,workId,{files:false});
  if(current.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${current.revision}. Releer y reconciliar, no sobrescribir.`);
  const closed=closeWork(root,workId,{outcome,summary:text(summary,'summary'),limitations:list(limitations,'limitations',30)});
  return workReceipt(closed,{operation:'work.close',changes:[outcome==='done'?'trabajo cerrado':'trabajo cancelado']});
}

export function reopenWorkOperation(root,{workId,expectedRevision,reason}) {
  assertID(workId);const current=readWork(root,workId,{files:false});
  if(current.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${current.revision}. Releer y reconciliar, no sobrescribir.`);
  const opened=reopenWork(root,workId,text(reason,'reason'));
  return workReceipt(opened,{operation:'work.reopen',changes:['trabajo reabierto']});
}

export function readStatus(root){return status(root);}
export function syncWorkOperation(root,{workId,expectedRevision}){
  assertID(workId);const current=readWork(root,workId,{files:false});
  if(!Number.isSafeInteger(expectedRevision)||current.revision!==expectedRevision)throw new Error(`Revisión obsoleta; actual=${current.revision}. Releer y reconciliar, no sobrescribir.`);
  status(root);history(root);
  return workReceipt(syncWork(root,workId),{changes:['proyecciones sincronizadas']});
}
export function recoverWorkspaceOperation(root){
  const state=repair(root,{files:true});
  return {operation:'workspace.recover',recovered:true,state,validation:validateProject(root)};
}
export function readHistory(root,{workId,since,until,limit=20,offset=0}={}){
  if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('limit debe estar entre 1 y 100');
  if(!Number.isSafeInteger(offset)||offset<0)throw new Error('offset debe ser entero no negativo');
  const validDate=value=>value===undefined||typeof value==='string'&&Number.isFinite(Date.parse(value));
  if(!validDate(since)||!validDate(until))throw new Error('since/until debe ser fecha ISO válida');
  const entries=history(root).filter(e=>(!workId||e.workId===workId)&&(!since||Date.parse(e.closedAt)>=Date.parse(since))&&(!until||Date.parse(e.closedAt)<=Date.parse(until)));
  return entries.reverse().slice(offset,offset+limit);
}
export function validateWorkspace(root,{fresh=false}={}){return validateProject(root,{fresh});}
