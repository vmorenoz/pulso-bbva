import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const coreDir=process.env.PULSO_TEST_CORE_DIR||fileURLToPath(new URL('../resources/lib/',import.meta.url));
const artifacts=await import(pathToFileURL(path.join(coreDir,'artifacts.mjs')));
const mutations=await import(pathToFileURL(path.join(coreDir,'work-mutations.mjs')));
const {initArtifacts,createWork,readWork,saveWork,closeWork,reopenWork,syncWork,status,history,validateProject,completeProjectMap}=artifacts;
const {applyWorkMutation,completeMapOperation,readHistory}=mutations;
const workId='WORK-1';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-core-integrity-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  initArtifacts(root);
  createWork(root,{id:workId,title:'Objetivo',objective:'Entrega comprobada',criterion:'Aceptación inicial',verification:'Revisar el informe'});
  fs.writeFileSync(path.join(root,'source.txt'),'unchanged product');
  fs.writeFileSync(path.join(root,'report.txt'),'PASS');
  return root;
}
function update(root,actions){return applyWorkMutation(root,{workId,expectedRevision:readWork(root,workId,{files:false}).revision,actions});}
function evidence(id='E-1'){
  return {id,kind:'static',status:'pass',criterionIds:['AC-1'],taskIds:['T-1'],report:'report.txt',cwd:'.',basis:'Revisión explícita',files:['source.txt'],summary:'Verificación positiva'};
}
function ready(root){
  update(root,[
    {type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'pulso-executor',status:'done',dependsOn:[],writeScope:['source.txt'],resources:[],acceptance:['Aceptación inicial'],evidenceIds:[],summary:'Completada'}},
    {type:'evidence.add',evidence:evidence()},
    {type:'document.register',document:{kind:'evidence',path:'report.txt',templateVersion:'qa@1.0'}}
  ]);
  return readWork(root,workId);
}
function snapshot(root){
  return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(item=>[item.name,item.isDirectory()?snapshot(path.join(root,item.name)):fs.readFileSync(path.join(root,item.name),'utf8')]);
}
function failRename(t,relative){
  const original=fs.renameSync;
  return t.mock.method(fs,'renameSync',(from,to)=>{if(to.endsWith(relative))throw new Error('injected write failure');return original(from,to);});
}
function expectPartial(callback,revision){
  assert.throws(callback,error=>{
    assert.deepEqual({...error.persistence,recovery:undefined},{applied:true,partial:true,workId,revision,recovery:undefined});
    assert.match(error.persistence.recovery,/sync.*revisión persistida.*recover/);
    assert.match(error.message,/persistido/);
    return true;
  });
}

for(const field of ['description','verification'])test(`criterion ${field} changes invalidate prior acceptance and persist reason, snapshots and revision`,t=>{
  const root=fixture(t),before=ready(root);
  update(root,[{type:'criterion.update',criterionId:'AC-1',[field]:'Nuevo requisito',reason:'Cambio solicitado por el usuario'}]);
  const changed=readWork(root,workId);
  assert.deepEqual(changed.objective.criteria[0].evidenceIds,[]);
  assert.deepEqual(changed.tasks[0].evidenceIds,[]);
  assert.equal(changed.tasks[0].status,'pending');
  assert.deepEqual(changed.evidence,before.evidence);
  const record=changed.acceptanceChanges[0];
  assert.equal(record.reason,'Cambio solicitado por el usuario');
  assert.equal(record.revision,changed.revision);
  assert.equal(record.targetType,'criterion');
  assert.deepEqual(record.before,before.objective.criteria[0]);
  assert.deepEqual(record.after,changed.objective.criteria[0]);
  assert.ok(Number.isFinite(Date.parse(record.at)));
  assert.throws(()=>closeWork(root,workId,{summary:'No debe cerrar'}),/tareas abiertas/);
  update(root,[{type:'task.set_status',taskId:'T-1',status:'done'}]);
  assert.throws(()=>closeWork(root,workId,{summary:'Tampoco debe cerrar'}),/Falta evidencia positiva/);
  update(root,[{type:'evidence.add',evidence:evidence('E-2')}]);
  assert.equal(closeWork(root,workId,{summary:'Aceptación nueva explícita'}).status,'done');
});

test('task acceptance changes invalidate task and objective evidence; metadata-only updates preserve acceptance',t=>{
  const root=fixture(t),before=ready(root);
  update(root,[{type:'task.update',taskId:'T-1',patch:{title:'Título corregido'}}]);
  let work=readWork(root,workId);
  assert.equal(work.tasks[0].status,'done');
  assert.deepEqual(work.tasks[0].evidenceIds,['E-1']);
  assert.equal(work.acceptanceChanges,undefined);
  update(root,[{type:'task.update',taskId:'T-1',patch:{acceptance:['Aceptación más estricta']}}]);
  work=readWork(root,workId);
  assert.equal(work.tasks[0].status,'pending');
  assert.deepEqual(work.tasks[0].evidenceIds,[]);
  assert.deepEqual(work.objective.criteria[0].evidenceIds,[]);
  assert.deepEqual(work.evidence,before.evidence);
  assert.deepEqual(work.acceptanceChanges[0].before.acceptance,['Aceptación inicial']);
  assert.deepEqual(work.acceptanceChanges[0].after.acceptance,['Aceptación más estricta']);
  assert.match(work.acceptanceChanges[0].reason,/Cambio de aceptación/);
  assert.throws(()=>closeWork(root,workId,{summary:'No debe cerrar'}),/tareas abiertas/);
});

test('changing a task criterion reopens it and clears acceptance links on old and new criteria',t=>{
  const root=fixture(t);ready(root);
  update(root,[{type:'criterion.add',criterion:{id:'AC-2',description:'Segundo criterio',verification:'Revisión'}},{type:'task.update',taskId:'T-1',patch:{criterionIds:['AC-2']}}]);
  const work=readWork(root,workId);
  assert.equal(work.tasks[0].status,'pending');
  assert.ok(work.objective.criteria.every(criterion=>criterion.evidenceIds.length===0));
  assert.deepEqual(work.acceptanceChanges[0].before.criterionIds,['AC-1']);
  assert.deepEqual(work.acceptanceChanges[0].after.criterionIds,['AC-2']);
});

test('acceptance audit records and invalidated historical evidence cannot be rewritten',t=>{
  const root=fixture(t);ready(root);
  update(root,[{type:'criterion.update',criterionId:'AC-1',description:'Modificado',reason:'Revisión de alcance'}]);
  const work=readWork(root,workId),before=snapshot(root);
  const candidate=structuredClone(work);candidate.acceptanceChanges[0].reason='Ocultar el cambio';
  assert.throws(()=>saveWork(root,candidate,work.revision),/Historial de aceptación inmutable/);
  candidate.acceptanceChanges=[];
  assert.throws(()=>saveWork(root,candidate,work.revision),/Historial de aceptación inmutable/);
  assert.throws(()=>update(root,[{type:'evidence.update',evidenceId:'E-1',patch:{summary:'Reinterpretada'}}]),/Evidencia archivada inmutable/);
  assert.deepEqual(snapshot(root),before);
});

test('criterion no-op still records the reason without invalidating acceptance',t=>{
  const root=fixture(t),before=ready(root);
  update(root,[{type:'criterion.update',criterionId:'AC-1',description:before.objective.criteria[0].description,reason:'Confirmar texto vigente'}]);
  const work=readWork(root,workId);
  assert.deepEqual(work.objective.criteria,before.objective.criteria);
  assert.equal(work.tasks[0].status,'done');
  assert.equal(work.acceptanceChanges[0].reason,'Confirmar texto vigente');
});

test('independent criterion and task evidence both remain immutable after acceptance invalidation',t=>{
  const root=fixture(t);ready(root);
  update(root,[{type:'evidence.remove',evidenceId:'E-1'},
    {type:'evidence.add',evidence:{...evidence('E-criterion'),taskIds:[]}},
    {type:'evidence.add',evidence:{...evidence('E-task'),criterionIds:[]}}]);
  update(root,[{type:'task.update',taskId:'T-1',patch:{acceptance:['Requisito nuevo']}}]);
  for(const evidenceId of ['E-criterion','E-task'])assert.throws(()=>update(root,[{type:'evidence.remove',evidenceId}]),/Evidencia archivada inmutable/);
  assert.deepEqual(readWork(root,workId).acceptanceChanges.map(change=>change.targetType),['task','criterion']);
});

test('update index failure reports persisted revision and sync repairs without repeating mutation',t=>{
  const root=fixture(t),fault=failRename(t,path.join('.pulso','state.json'));
  expectPartial(()=>update(root,[{type:'work.set_overview',summary:'Persistido'}]),2);
  assert.equal(readWork(root,workId).revision,2);
  assert.equal(readWork(root,workId).summary,'Persistido');
  assert.equal(status(root).works[0].workRevision,1);
  fault.mock.restore();syncWork(root,workId);
  assert.equal(readWork(root,workId).revision,2);
  assert.equal(validateProject(root).valid,true);
});

test('create index failure exposes the newly persisted work and safe recovery',t=>{
  const root=fixture(t);fs.rmSync(path.join(root,'.pulso','work',workId),{recursive:true});
  // Reinitialize projections so create is the only canonical change under test.
  fs.writeFileSync(path.join(root,'.pulso','state.json'),JSON.stringify(artifacts.emptyState()));
  const fault=failRename(t,path.join('.pulso','state.json'));
  expectPartial(()=>createWork(root,{id:workId,title:'Nuevo',objective:'Objetivo',criterion:'Criterio',verification:'Revisión'}),1);
  fault.mock.restore();syncWork(root,workId);
  assert.equal(validateProject(root).valid,true);
});

for(const file of ['history.jsonl','state.json'])test(`close ${file} failure preserves canonical closure and repairs projections`,t=>{
  const root=fixture(t);ready(root);const fault=failRename(t,path.join('.pulso',file));
  expectPartial(()=>closeWork(root,workId,{summary:'Completado'}),3);
  const persisted=readWork(root,workId,{files:false});
  assert.equal(persisted.closure.id,`${workId}:c1`);
  fault.mock.restore();syncWork(root,workId);syncWork(root,workId);
  assert.equal(readWork(root,workId).revision,3);
  assert.equal(history(root).length,1);
  assert.equal(validateProject(root).valid,true);
});

test('reopen index failure identifies the new canonical cycle',t=>{
  const root=fixture(t);ready(root);closeWork(root,workId,{summary:'Hecho'});
  const fault=failRename(t,path.join('.pulso','state.json'));
  expectPartial(()=>reopenWork(root,workId,'Nuevo alcance'),4);
  assert.equal(readWork(root,workId).cycle,2);
  fault.mock.restore();syncWork(root,workId);
  assert.equal(validateProject(root).valid,true);
});

test('complete_map prevalidates all closure inputs and leaves every file unchanged on rejection',t=>{
  const root=fixture(t);fs.writeFileSync(path.join(root,'.pulso','project.md'),'<!-- template: project@1.0 -->\nContexto');
  const before=snapshot(root);
  for(const limitations of [[''],['   '],['x'.repeat(1001)],[42]]){
    assert.throws(()=>completeMapOperation(root,{workId,expectedRevision:1,summary:'Mapeo listo',limitations}),/limitation/);
    assert.throws(()=>completeProjectMap(root,workId,{summary:'Mapeo listo',limitations}),/limitations/);
    assert.deepEqual(snapshot(root),before);
  }
});

for(const file of ['history.jsonl','state.json'])test(`complete_map commits once and identical retry repairs ${file} without duplicating data`,t=>{
  const root=fixture(t);fs.writeFileSync(path.join(root,'.pulso','project.md'),'<!-- template: project@1.0 -->\nContexto');
  const input={workId,expectedRevision:1,summary:'Mapeo listo',limitations:['Revisión estática']};
  const fault=failRename(t,path.join('.pulso',file));
  expectPartial(()=>completeMapOperation(root,input),2);
  const persisted=readWork(root,workId,{files:false});
  assert.equal(persisted.status,'done');assert.equal(persisted.tasks.length,1);assert.equal(persisted.evidence.length,1);
  fault.mock.restore();
  const receipt=completeMapOperation(root,input);
  assert.equal(receipt.revision,2);assert.equal(history(root).length,1);
  assert.equal(validateProject(root).valid,true);
  const before=snapshot(root);
  assert.deepEqual(completeMapOperation(root,input),receipt);
  assert.deepEqual(completeMapOperation(root,{...input,expectedRevision:2}),receipt);
  assert.deepEqual(snapshot(root),before);
  assert.throws(()=>completeMapOperation(root,{...input,summary:'Otro resultado'}),/Revisión obsoleta/);
  assert.throws(()=>completeMapOperation(root,{...input,expectedRevision:2,limitations:[]}),/otro resultado/);
  assert.deepEqual(snapshot(root),before);
});

test('missing historical reports and registered report documents do not block reopened updates, recover or cancel',t=>{
  const root=fixture(t),before=ready(root);closeWork(root,workId,{summary:'Primera entrega'});
  fs.unlinkSync(path.join(root,'report.txt'));fs.unlinkSync(path.join(root,'source.txt'));
  reopenWork(root,workId,'Continuar con otra entrega');
  update(root,[{type:'work.set_overview',summary:'Nuevo ciclo'}]);
  assert.deepEqual(readWork(root,workId).evidence,before.evidence);
  assert.equal(mutations.recoverWorkspaceOperation(root).validation.valid,true);
  assert.equal(validateProject(root,{fresh:true}).valid,true);
  assert.equal(closeWork(root,workId,{outcome:'cancelled',summary:'Sin continuación'}).status,'cancelled');
  assert.equal(history(root).length,2);
});

test('active missing reports and stale evidence remain rejected, while cancellation stays available',t=>{
  const root=fixture(t);ready(root);
  fs.unlinkSync(path.join(root,'report.txt'));
  assert.throws(()=>update(root,[{type:'work.set_overview',summary:'No debe guardar'}]),/Documento no existe|Informe no existe/);
  assert.throws(()=>closeWork(root,workId,{summary:'No debe cerrar'}),/Informe no existe/);
  fs.writeFileSync(path.join(root,'report.txt'),'PASS');fs.writeFileSync(path.join(root,'source.txt'),'changed');
  assert.throws(()=>closeWork(root,workId,{summary:'Tampoco debe cerrar'}),/Evidencia obsoleta/);
  fs.unlinkSync(path.join(root,'report.txt'));
  assert.equal(closeWork(root,workId,{outcome:'cancelled',summary:'Cancelado sin evidencia vigente'}).status,'cancelled');
});

test('readHistory offset pages newest first and validates nonnegative integer input',t=>{
  const root=fixture(t);
  for(let i=0;i<3;i++){closeWork(root,workId,{outcome:'cancelled',summary:`Ciclo ${i+1}`});if(i<2)reopenWork(root,workId,'Continuar');}
  assert.deepEqual(readHistory(root,{limit:2}).map(entry=>entry.cycle),[3,2]);
  assert.deepEqual(readHistory(root,{limit:2,offset:2}).map(entry=>entry.cycle),[1]);
  for(const offset of [-1,1.2,'1',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>readHistory(root,{offset}),/offset/);
});
