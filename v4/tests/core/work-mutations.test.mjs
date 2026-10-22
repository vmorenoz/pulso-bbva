import test from 'node:test';
import {closureIssue,schemaIssue} from './assertions.mjs';
import assert from 'node:assert/strict';
import {repo,create,readWork,atomicWrite,fingerprint,ready,writeJSON} from './helpers.mjs';
import {applyWorkMutation,createWorkOperation,closeWorkOperation,reopenWorkOperation,readStatus} from '../../core/lib/work-mutations.mjs';
import {acceptanceBasis,closeWork,reopenWork} from '../../core/lib/artifacts.mjs';
import {now} from '../../core/lib/fs.mjs';
import {formatReceipt} from '../../core/lib/receipts.mjs';

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
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-3',expectedRevision:1,actions:[{type:'work.patch',pointer:'/status',value:'done'}]}),schemaIssue('$.actions[0].type'));
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-3',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Ignorar',root:'/tmp'}]}),schemaIssue('$.actions[0].root',/desconocido/));
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-3',expectedRevision:1,actions:[{type:'document.register',document:{kind:'spec',path:'/etc/passwd',templateVersion:'spec@1.0'}}]}),schemaIssue('$.actions[0].document.path',/patrón/));
});

test('Evidencia compara hashes observados, liga tarea y criterio y permite cierre positivo',t=>{
  const root=repo(t);create(root,'CORE-4');atomicWrite(root,'src/feature.mjs','export const ok = true;\n');atomicWrite(root,'.pulso/work/CORE-4/evidence/test.md','# Pruebas ejecutadas\n');
  let r=applyWorkMutation(root,{workId:'CORE-4',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Implementar',criterionIds:['AC-1'],agent:'pulso-executor',status:'pending',dependsOn:[],writeScope:['src/feature.mjs'],resources:[],acceptance:['La prueba pasa'],evidenceIds:[],summary:''}}]});assert.equal(r.revision,2);
  r=applyWorkMutation(root,{workId:'CORE-4',expectedRevision:2,actions:[{type:'evidence.add',evidence:{id:'E-1',kind:'executed',status:'pass',checkedAt:now(),criterionIds:['AC-1'],taskIds:['T-1'],report:'.pulso/work/CORE-4/evidence/test.md',command:'node --test',cwd:'.',exitCode:0,basis:'Ejecución local observada',files:[fingerprint(root,'src/feature.mjs'),fingerprint(root,'.pulso/work/CORE-4/evidence/test.md')],acceptanceBasis:acceptanceBasis(readWork(root,'CORE-4')),summary:'Prueba aprobada.'}}]});
  const work=readWork(root,'CORE-4');assert.match(work.evidence[0].files[0].sha256,/^[a-f0-9]{64}$/);assert.deepEqual(work.objective.criteria[0].evidenceIds,['E-1']);assert.deepEqual(work.tasks[0].evidenceIds,['E-1']);
  r=applyWorkMutation(root,{workId:'CORE-4',expectedRevision:3,actions:[{type:'task.set_status',taskId:'T-1',status:'done',summary:'Implementación terminada.'}]});
  const closed=closeWorkOperation(root,{workId:'CORE-4',expectedRevision:r.revision,outcome:'done',summary:'Criterio verificado.'});assert.equal(closed.status,'done');assert.equal(closed.revision,5);
});

test('No permite quitar criterio o tarea con referencias',t=>{
  const root=repo(t);create(root,'CORE-5');
  applyWorkMutation(root,{workId:'CORE-5',expectedRevision:1,actions:[{type:'task.add',task:{id:'T-1',title:'Investigar',criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:['project.md'],resources:[],acceptance:['Resultado'],evidenceIds:[],summary:''}},{type:'task.add',task:{id:'T-2',title:'Continuar',criterionIds:['AC-1'],agent:'pulso-executor',status:'pending',dependsOn:['T-1'],writeScope:['src/next.mjs'],resources:[],acceptance:['Continuación'],evidenceIds:[],summary:''}}]});
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-5',expectedRevision:2,actions:[{type:'criterion.remove',criterionId:'AC-1'}]}),/tiene dependencias/);
  assert.throws(()=>applyWorkMutation(root,{workId:'CORE-5',expectedRevision:2,actions:[{type:'task.remove',taskId:'T-1'}]}),/dependencias/);
});

test('Cierre y reapertura también comparan expectedRevision',t=>{
  const root=repo(t);create(root,'CORE-6');
  assert.throws(()=>closeWorkOperation(root,{workId:'CORE-6',expectedRevision:0,summary:'No'}),/Revisión obsoleta/);
  assert.throws(()=>reopenWorkOperation(root,{workId:'CORE-6',expectedRevision:1,reason:'No está cerrado'}),/ya abierto/);
});

const snapshot=(root,id)=>JSON.stringify({work:readWork(root,id,{files:false}),state:readStatus(root)});
const update=(root,id,actions)=>applyWorkMutation(root,{workId:id,expectedRevision:readWork(root,id,{files:false}).revision,actions});
const evidenceCopy=(work,id='E-2')=>({...structuredClone(work.evidence[0]),id,acceptanceBasis:acceptanceBasis(work,{criterionIds:work.evidence[0].criterionIds,taskIds:work.evidence[0].taskIds})});

test('Observó A y se escribió B antes de evidence.add: rechazo sin escritura',t=>{
  const root=repo(t),work=ready(root,'STALE-1'),observed=evidenceCopy(work),before=snapshot(root,work.id);
  atomicWrite(root,'src/value.mjs','export const value = 2;\n');
  assert.throws(()=>update(root,work.id,[{type:'evidence.add',evidence:observed}]),/obsoleta/);
  assert.equal(snapshot(root,work.id),before);
});

test('Editar resumen no rejuvenece checkedAt y no permite editar observación',t=>{
  const root=repo(t),work=ready(root,'EDIT-1'),before=structuredClone(work.evidence[0]);
  update(root,work.id,[{type:'evidence.update',evidenceId:'E-1',patch:{summary:'Aclaración editorial'}}]);
  const edited=readWork(root,work.id).evidence[0];assert.equal(edited.checkedAt,before.checkedAt);assert.ok(edited.editedAt);assert.deepEqual(edited.files,before.files);assert.deepEqual(edited.acceptanceBasis,before.acceptanceBasis);
  for(const patch of [{files:before.files},{checkedAt:now()},{status:'pass'},{command:'npm test'},{criterionIds:[]},{acceptanceBasis:before.acceptanceBasis}]){
    const unchanged=snapshot(root,work.id);assert.throws(()=>update(root,work.id,[{type:'evidence.update',evidenceId:'E-1',patch:{summary:'Intento',...patch}}]),schemaIssue(`$.actions[0].patch.${Object.keys(patch)[0]}`,/desconocido/));assert.equal(snapshot(root,work.id),unchanged);
  }
  atomicWrite(root,'src/value.mjs','otra versión');assert.throws(()=>closeWork(root,work.id,{summary:'Listo'}),closureIssue('EVIDENCE_STALE','AC-1',/src\/value.mjs/));
});

test('Observación antigua permanece legible pero no permite un cierre nuevo',t=>{
  const root=repo(t),work=ready(root,'OLD-1');delete work.evidence[0].acceptanceBasis;
  writeJSON(root,'.pulso/work/OLD-1/work.json',work);assert.doesNotThrow(()=>readWork(root,work.id));
  const before=snapshot(root,work.id);assert.throws(()=>closeWork(root,work.id,{summary:'Listo'}),closureIssue('EVIDENCE_STALE','AC-1',/sin base observada/));assert.equal(snapshot(root,work.id),before);
});

test('Cierre histórico sin base observada conserva su lectura sin reescribirlo',t=>{
  const root=repo(t);ready(root,'OLD-CLOSED');const work=closeWork(root,'OLD-CLOSED',{summary:'Cierre histórico'});delete work.evidence[0].acceptanceBasis;delete work.acceptanceChanges;
  writeJSON(root,'.pulso/work/OLD-CLOSED/work.json',work);assert.equal(readWork(root,work.id,{fresh:true}).closure.summary,'Cierre histórico');
});

for(const field of ['description','verification'])test(`Cambiar criterio ${field} guarda motivo, invalida aceptación y exige nueva observación`,t=>{
  const root=repo(t),work=ready(root,'CHANGE-1'),originalEvidence=structuredClone(work.evidence);
  update(root,work.id,[{type:'criterion.update',criterionId:'AC-1',[field]:'Nuevo requisito acordado',reason:'Nuevo requisito acordado',decisionRef:'D-7'}]);
  let changed=readWork(root,work.id);assert.deepEqual(changed.evidence,originalEvidence);assert.deepEqual(changed.objective.criteria[0].evidenceIds,[]);assert.equal(changed.tasks[0].status,'pending');assert.deepEqual(changed.tasks[0].evidenceIds,[]);
  assert.equal(changed.acceptanceChanges[0].entity,'criterion');
  assert.equal(changed.acceptanceChanges[0].reason,'Nuevo requisito acordado');assert.equal(changed.acceptanceChanges[0].decisionRef,'D-7');assert.deepEqual(changed.acceptanceChanges[0].before,{description:work.objective.criteria[0].description,verification:work.objective.criteria[0].verification,acceptanceMode:'evidence'});assert.deepEqual(changed.acceptanceChanges[0].after,{...changed.acceptanceChanges[0].before,[field]:'Nuevo requisito acordado'});assert.ok(Number.isFinite(Date.parse(changed.acceptanceChanges[0].at)));
  assert.throws(()=>closeWork(root,work.id,{summary:'Listo'}),closureIssue('TASK_OPEN','T-1'));
  const invalidated=snapshot(root,work.id);
  assert.throws(()=>update(root,work.id,[{type:'task.set_status',taskId:'T-1',status:'done'}]),{code:'TASK_ACCEPTANCE_REQUIRED'});
  assert.equal(snapshot(root,work.id),invalidated);
  const copied={...originalEvidence[0],id:'E-OLD'};assert.throws(()=>update(root,work.id,[{type:'evidence.add',evidence:copied}]),/Aceptación obsoleta/);
  update(root,work.id,[{type:'criterion.update',criterionId:'AC-1',[field]:work.objective.criteria[0][field],reason:'Se restaura el texto anterior'}]);
  assert.throws(()=>update(root,work.id,[{type:'evidence.add',evidence:copied}]),/Aceptación obsoleta/);
  changed=readWork(root,work.id);const renewed=evidenceCopy(changed);update(root,work.id,[{type:'evidence.add',evidence:renewed},{type:'task.set_status',taskId:'T-1',status:'done'}]);assert.equal(closeWork(root,work.id,{summary:'Aceptación nueva revisada'}).status,'done');
});

for(const [field,value] of Object.entries({writeScope:['src/extra.mjs'],acceptance:['Aceptación nueva'],title:'Título corregido'}))test(`Cambiar tarea ${field} requiere motivo, persiste historia y retira aceptación`,t=>{
  const root=repo(t),work=ready(root,'SCOPE-1'),before=snapshot(root,work.id);
  assert.throws(()=>update(root,work.id,[{type:'task.update',taskId:'T-1',patch:{[field]:value}}]),/reason/);assert.equal(snapshot(root,work.id),before);
  update(root,work.id,[{type:'task.update',taskId:'T-1',reason:'Ampliación autorizada',patch:{[field]:value}}]);
  const changed=readWork(root,work.id);assert.equal(changed.tasks[0].status,'pending');assert.deepEqual(changed.tasks[0].evidenceIds,[]);assert.deepEqual(changed.objective.criteria[0].evidenceIds,[]);assert.equal(changed.acceptanceChanges[0].entity,'task');assert.equal(changed.acceptanceChanges[0].reason,'Ampliación autorizada');
  assert.deepEqual(changed.evidence,work.evidence);
  assert.deepEqual(changed.acceptanceChanges[0].before[field],work.tasks[0][field]);
  assert.deepEqual(changed.acceptanceChanges[0].after,{...changed.acceptanceChanges[0].before,[field]:value});
  assert.ok(Number.isFinite(Date.parse(changed.acceptanceChanges[0].at)));
  assert.throws(()=>closeWork(root,work.id,{summary:'No debe cerrar'}),closureIssue('TASK_OPEN','T-1'));
  assert.throws(()=>update(root,work.id,[{type:'evidence.add',evidence:{...work.evidence[0],id:'E-OLD'}}]),/Aceptación obsoleta/);
});

test('Resumen editorial conserva aceptación; texto de criterio modificado la invalida',t=>{
  const root=repo(t),work=ready(root,'EDITORIAL');
  update(root,work.id,[{type:'task.update',taskId:'T-1',patch:{summary:'Resumen corregido'}}]);
  const changed=readWork(root,work.id);assert.equal(changed.tasks[0].status,'done');assert.deepEqual(changed.tasks[0].evidenceIds,['E-1']);assert.deepEqual(acceptanceBasis(changed),acceptanceBasis(work));assert.deepEqual(changed.acceptanceChanges,[]);
  update(root,work.id,[{type:'criterion.update',criterionId:'AC-1',description:work.objective.criteria[0].description+'.',reason:'Puntuación'}]);assert.deepEqual(readWork(root,work.id).objective.criteria[0].evidenceIds,[]);
});

test('Resultados de criterios independientes conservan sus vínculos y fingerprints',t=>{
  const root=repo(t),work=ready(root,'INDEPENDENT');
  update(root,work.id,[{type:'criterion.add',criterion:{id:'AC-2',description:'Segundo criterio',verification:'Otra comprobación'}},{type:'task.add',task:{...structuredClone(work.tasks[0]),id:'T-2',criterionIds:['AC-2'],evidenceIds:[],status:'pending'}}]);
  const current=readWork(root,work.id),second={...structuredClone(work.evidence[0]),id:'E-2',criterionIds:['AC-2'],taskIds:['T-2'],acceptanceBasis:acceptanceBasis(current,{criterionIds:['AC-2'],taskIds:['T-2']})};
  update(root,work.id,[{type:'evidence.add',evidence:second},{type:'task.set_status',taskId:'T-2',status:'done'}]);
  update(root,work.id,[{type:'criterion.update',criterionId:'AC-1',verification:'Método ampliado',reason:'Nueva verificación'}]);
  const changed=readWork(root,work.id);assert.deepEqual(changed.objective.criteria[1].evidenceIds,['E-2']);assert.deepEqual(changed.tasks[1].evidenceIds,['E-2']);assert.equal(changed.tasks[1].status,'done');assert.deepEqual(acceptanceBasis(changed,{criterionIds:['AC-2'],taskIds:['T-2']}),second.acceptanceBasis);
});

test('Evidencia archivada permanece totalmente inmutable al cambiar aceptación',t=>{
  const root=repo(t),work=ready(root,'ARCHIVE');closeWork(root,work.id,{summary:'Ciclo uno'});reopenWork(root,work.id,'Otro caso');
  update(root,work.id,[{type:'criterion.update',criterionId:'AC-1',verification:'Segundo ciclo',reason:'Caso nuevo'}]);assert.deepEqual(readWork(root,work.id).evidence,work.evidence);
  const before=snapshot(root,work.id);assert.throws(()=>update(root,work.id,[{type:'evidence.update',evidenceId:'E-1',patch:{summary:'Cambio histórico'}}]),/archivada inmutable/);assert.equal(snapshot(root,work.id),before);
});

test('Eliminar evidencia retira vínculos pero conserva observación e ID',t=>{
  const root=repo(t),work=ready(root,'RETAIN');update(root,work.id,[{type:'evidence.remove',evidenceId:'E-1'}]);
  const changed=readWork(root,work.id);assert.deepEqual(changed.evidence,work.evidence);assert.deepEqual(changed.objective.criteria[0].evidenceIds,[]);assert.equal(changed.tasks[0].status,'pending');
  assert.throws(()=>update(root,work.id,[{type:'evidence.add',evidence:work.evidence[0]}]),/duplicada/);
});

test('Observación de archivo ausente se contrasta al añadir y al cerrar',t=>{
  const root=repo(t),work=ready(root,'ABSENT');update(root,work.id,[{type:'evidence.remove',evidenceId:'E-1'}]);
  const evidence=evidenceCopy(readWork(root,work.id));evidence.files.push({path:'src/deleted.mjs',absent:true});
  update(root,work.id,[{type:'evidence.add',evidence},{type:'task.set_status',taskId:'T-1',status:'done'}]);atomicWrite(root,'src/deleted.mjs','ha vuelto');
  assert.throws(()=>closeWork(root,work.id,{summary:'Listo'}),closureIssue('EVIDENCE_STALE','AC-1',/ya no está ausente/));
});

test('Report y checkedAt son observados y obligatorios, nunca generados al añadir',t=>{
  const root=repo(t),work=ready(root,'REPORT'),before=snapshot(root,work.id);
  const noDate=evidenceCopy(work);delete noDate.checkedAt;assert.throws(()=>update(root,work.id,[{type:'evidence.add',evidence:noDate}]),schemaIssue('$.actions[0].evidence.checkedAt',/requerido/));
  const noReport=evidenceCopy(work);noReport.files=noReport.files.filter(file=>file.path!==noReport.report);assert.throws(()=>update(root,work.id,[{type:'evidence.add',evidence:noReport}]),/informe\/salida/);assert.equal(snapshot(root,work.id),before);
});

test('complete_map no es una acción y el mapa de plantilla no cierra un objetivo',t=>{
  const root=repo(t);create(root,'PRODUCT');atomicWrite(root,'.pulso/project.md','<!-- template: project@1.0 -->\nMapa anterior');const before=snapshot(root,'PRODUCT');
  assert.throws(()=>update(root,'PRODUCT',[{type:'complete_map',summary:'Mapa ya disponible'}]),schemaIssue('$.actions[0].type'));assert.throws(()=>closeWork(root,'PRODUCT',{summary:'Objetivo terminado'}),closureIssue('CRITERION_UNSUPPORTED','AC-1'));assert.equal(snapshot(root,'PRODUCT'),before);
});

for(const priority of ['low','normal','high','critical'])test(`Prioridad ${priority} válida en create/update/read`,t=>{
  const root=repo(t),id='PRIORITY';createWorkOperation(root,{workId:id,title:'Prioridad',objective:'Resultado',criterion:'Criterio',verification:'Verificar',priority});assert.equal(readWork(root,id).priority,priority);
  update(root,id,[{type:'work.set_overview',priority}]);assert.equal(readStatus(root).works[0].priority,priority);
});

test('urgent y propiedades desconocidas se rechazan antes de escribir',t=>{
  const root=repo(t);create(root,'STRICT');const before=snapshot(root,'STRICT');
  assert.throws(()=>update(root,'STRICT',[{type:'work.set_overview',priority:'urgent'}]),/priority.*urgent no está admitido/);assert.throws(()=>update(root,'STRICT',[{type:'task.add',task:{id:'T-1'}}]),schemaIssue('$.actions[0].task.title',/requerido/));assert.throws(()=>update(root,'STRICT',[{type:'evidence.add',evidence:{id:'E-1'}}]),schemaIssue('$.actions[0].evidence.kind',/requerido/));assert.equal(snapshot(root,'STRICT'),before);
});

test('Mapeo exclusivo aceptado usa tareas, evidencia observada y cierre ordinarios',t=>{
  const root=repo(t),id='MAP';createWorkOperation(root,{workId:id,title:'Mapear contexto',objective:'Documentar el contexto comprobado',criterion:'Mapa describe fuentes y límites',verification:'Revisión estática del mapa contra el repositorio'});
  atomicWrite(root,'.pulso/project.md','<!-- template: project@1.0 -->\n# Proyecto\nMapa revisado con sus fuentes y límites.\n');
  update(root,id,[{type:'task.add',task:{id:'T-1',title:'Explorar fuentes y documentar',criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:['.pulso/project.md'],resources:[],acceptance:['Mapa con fuentes y límites'],evidenceIds:[],summary:''}}]);
  const work=readWork(root,id),evidence={id:'E-1',kind:'static',status:'pass',checkedAt:now(),criterionIds:['AC-1'],taskIds:['T-1'],report:'.pulso/project.md',command:null,cwd:'.',exitCode:null,basis:'Mapa revisado explícitamente contra fuentes observadas; fixture de integridad.',files:[fingerprint(root,'.pulso/project.md')],acceptanceBasis:acceptanceBasis(work),summary:'Fuentes y límites comprobados.'};
  update(root,id,[{type:'evidence.add',evidence},{type:'task.set_status',taskId:'T-1',status:'done'}]);assert.equal(closeWork(root,id,{summary:'Contexto aceptado con evidencia observada.'}).status,'done');
});
