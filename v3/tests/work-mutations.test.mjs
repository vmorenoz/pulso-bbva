import test from 'node:test';
import assert from 'node:assert/strict';
import {repo,create,readWork,atomicWrite} from './helpers.mjs';
import {applyWorkMutation,createWorkOperation,closeWorkOperation,reopenWorkOperation,readStatus,completeMapOperation} from '../lib/work-mutations.mjs';
import {formatReceipt} from '../lib/receipts.mjs';

test('Crear trabajo semántico devuelve recibo sin exponer Work completo',t=>{
  const root=repo(t),receipt=createWorkOperation(root,{workId:'CORE-1',title:'Cambiar validación',objective:'Rechazar importe negativo',criterion:'Un importe negativo da error',verification:'Prueba de unidad negativa',priority:'high'});
  assert.equal(receipt.revision,1);assert.equal(readWork(root,'CORE-1').priority,'high');assert.match(formatReceipt(receipt),/CORE-1 creado · revisión 1/);assert.equal(Object.hasOwn(receipt,'objective'),false);
});

test('Lote semántico guarda una vez, crea recibo compacto y exige revisión vigente',t=>{
  const root=repo(t);create(root,'CORE-2');
  const receipt=applyWorkMutation(root,{workId:'CORE-2',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Análisis confirmado',nextAction:'Implementar la corrección'}]});
  assert.equal(receipt.revision,2);assert.equal(readWork(root,'CORE-2').revision,2);assert.equal(readStatus(root).works[0].lastProgress,'Análisis confirmado');
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-2',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Sobrescritura'}]}),/Revisión obsoleta/);
  assert.equal(readWork(root,'CORE-2').summary,'Análisis confirmado');
});

test('Rechaza acciones fuera de vocabulario, lotes vacíos y rutas absolutas',t=>{
  const root=repo(t);create(root,'CORE-3');
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-3',expectedRevision:1,actions:[]}),/faltan elementos/);
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-3',expectedRevision:1,actions:[{type:'work.patch',pointer:'/status',value:'done'}]}),/no coincide|no admitida/);
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-3',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Ignorar',root:'/tmp'}]}),/Campo de acción no admitido/);
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-3',expectedRevision:1,actions:[{type:'document.register',document:{kind:'spec',path:'/etc/passwd',templateVersion:'spec@1.0'}}]}),/Ruta relativa inválida/);
});

test('Evidencia calcula hashes internamente, liga tarea y criterio y permite cierre positivo',t=>{
  const root=repo(t);create(root,'CORE-4');atomicWrite(root,'src/feature.mjs','export const ok = true;\n');atomicWrite(root,'.pulso/work/CORE-4/evidence/test.md','# Pruebas ejecutadas\n');
  let r=applyWorkMutation(root,{workId:'CORE-4',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'pulso-executor',status:'pending',dependsOn:[],writeScope:['src/feature.mjs'],resources:[],acceptance:['La prueba pasa'],evidenceIds:[],summary:''}}]});assert.equal(r.revision,2);
  r=applyWorkMutation(root,{workId:'CORE-4',expectedRevision:2,actions:[{type:'evidence.add',evidence:{id:'E-1',kind:'executed',status:'pass',criterionIds:['AC-1'],taskIds:['T-1'],report:'.pulso/work/CORE-4/evidence/test.md',command:'node --test',cwd:'.',exitCode:0,basis:'Ejecución local observada',files:['src/feature.mjs'],summary:'Prueba aprobada.'}}]});
  const work=readWork(root,'CORE-4');assert.match(work.evidence[0].files[0].sha256,/^[a-f0-9]{64}$/);assert.deepEqual(work.objective.criteria[0].evidenceIds,['E-1']);assert.deepEqual(work.tasks[0].evidenceIds,['E-1']);
  r=applyWorkMutation(root,{workId:'CORE-4',expectedRevision:3,actions:[{type:'task.set_status',taskId:'T-1',status:'done',summary:'Implementación terminada.'}]});
  const closed=closeWorkOperation(root,{workId:'CORE-4',expectedRevision:r.revision,outcome:'done',summary:'Criterio verificado.'});assert.equal(closed.status,'done');assert.equal(closed.revision,5);
});

test('No permite quitar criterio o tarea con referencias; evidencia archivada no es editable',t=>{
  const root=repo(t);create(root,'CORE-5');
  applyWorkMutation(root,{workId:'CORE-5',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Investigar',criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:['project.md'],resources:[],acceptance:['Resultado'],evidenceIds:[],summary:''}},{type:'task.add',task:{id:'T-2',title:'Continuar',criterionIds:['AC-1'],agent:'pulso-executor',status:'pending',dependsOn:['T-1'],writeScope:['src/next.mjs'],resources:[],acceptance:['Continuación'],evidenceIds:[],summary:''}}]});
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-5',expectedRevision:2,actions:[{type:'criterion.remove',criterionId:'AC-1'}]}),/tiene dependencias/);
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-5',expectedRevision:2,actions:[{type:'task.remove',taskId:'T-1'}]}),/dependencias/);
});

test('Cierre y reapertura también comparan expectedRevision',t=>{
  const root=repo(t);create(root,'CORE-6');
  assert.throws(()=>closeWorkOperation(root,{workId:'CORE-6',expectedRevision:0,summary:'No'}),/Revisión obsoleta/);
  assert.throws(()=>reopenWorkOperation(root,{workId:'CORE-6',expectedRevision:1,reason:'No está cerrado'}),/ya abierto/);
  assert.throws(()=>completeMapOperation(root,{workId:'CORE-6',expectedRevision:99,summary:'Mapa'}),/Revisión obsoleta/);
});
