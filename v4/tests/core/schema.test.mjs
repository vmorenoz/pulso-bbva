import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {schema,assertSchema,validateSchema,checkSchemaVocabulary} from '../../core/lib/schema.mjs';
const example=name=>JSON.parse(fs.readFileSync(new URL(`../../core/templates/${name}.json`,import.meta.url),'utf8'));
for(const name of ['work','objective','task','delegation','result','evidence','state','history-entry'])test(`Plantilla JSON ${name} cumple su schema`,()=>assert.doesNotThrow(()=>assertSchema(name,example(name))));
test('Campos requeridos',()=>{const w=example('work');delete w.objective;assert.throws(()=>assertSchema('work',w),/requerido/);});
test('Rechaza propiedades no conocidas',()=>{const w=example('work');w.scheduler={};assert.throws(()=>assertSchema('work',w),/desconocido/);});
test('Rechaza tipos erróneos',()=>{const w=example('work');w.tasks='T-1';assert.throws(()=>assertSchema('work',w),/tipo/);});
test('Fechas imposibles no se normalizan silenciosamente',()=>{const w=example('work');w.createdAt='2026-02-30T00:00:00Z';assert.throws(()=>assertSchema('work',w),/fecha/);});
test('Rechaza ID con traversal',()=>{const w=example('work');w.id='../otra';assert.throws(()=>assertSchema('work',w),/patrón/);});
test('Rechaza estado no documentado',()=>{const w=example('work');w.status='PASS';assert.throws(()=>assertSchema('work',w),/enum/);});
test('No ignora keywords JSON Schema desconocidas',()=>assert.throws(()=>validateSchema({type:'string',not:{}},'x'),/no soportada/));
test('No importa schemas mediante nombres arbitrarios',()=>assert.throws(()=>schema('../secrets'),/inválido/));
test('Todos los schemas usan el vocabulario implementado',()=>{for(const file of fs.readdirSync(new URL('../../core/schemas/',import.meta.url)))checkSchemaVocabulary(JSON.parse(fs.readFileSync(new URL('../../core/schemas/'+file,import.meta.url),'utf8')));});

const minimalActions=[
  {type:'work.set_overview',priority:'critical'},
  {type:'task.add',task:example('task')},
  {type:'task.update',taskId:'T-1',patch:{title:'Título'}},
  {type:'task.set_status',taskId:'T-1',status:'pending'},
  {type:'task.remove',taskId:'T-1'},
  {type:'criterion.add',criterion:{id:'AC-2',description:'Criterio',verification:'Comprobar'}},
  {type:'criterion.update',criterionId:'AC-1',description:'Actualizado',reason:'Acordado'},
  {type:'criterion.remove',criterionId:'AC-2'},
  {type:'document.register',document:{kind:'evidence',path:'report.md',templateVersion:'evidence@1.0'}},
  {type:'document.unregister',path:'report.md'},
  {type:'evidence.add',evidence:example('evidence')},
  {type:'evidence.update',evidenceId:'E-1',patch:{summary:'Corrección'}},
  {type:'evidence.remove',evidenceId:'E-1'}
];
for(const action of minimalActions)test(`Acción ${action.type}: forma mínima, faltantes, extras y tipos`,()=>{
  const check=value=>assertSchema('work-update',{workId:'WORK-1',expectedRevision:1,actions:[value]});
  assert.doesNotThrow(()=>check(action));
  assert.throws(()=>check({...action,unknown:true}),/no coincide/);
  const variant=schema('work-update').properties.actions.items.anyOf.find(item=>item.properties.type.const===action.type);
  for(const required of variant.required){const incomplete=structuredClone(action);delete incomplete[required];assert.throws(()=>check(incomplete),/no coincide/);}
  const [field]=Object.keys(action).filter(key=>key!=='type');assert.throws(()=>check({...action,[field]:42}),/no coincide/);
});
test('evidence.add no tiene alternativa genérica para eludir su contrato observado',()=>{
  const value={workId:'WORK-1',expectedRevision:1,actions:[{type:'evidence.add',evidence:example('evidence')}]};
  for(const key of ['checkedAt','acceptanceBasis','files','report','cwd']){const missing=structuredClone(value);delete missing.actions[0].evidence[key];assert.throws(()=>assertSchema('work-update',missing));}
});
test('Datos históricos admiten ausencia de la nueva base observada sin sintetizarla',()=>{
  const evidence=example('evidence');delete evidence.acceptanceBasis;assert.doesNotThrow(()=>assertSchema('evidence',evidence));assert.equal(evidence.acceptanceBasis,undefined);
});

for(const key of ['action','type'])test(`anyOf diagnóstico coherente para ${key} const y enum`,()=>{
  for(const discriminator of [{const:'selected'},{enum:['selected','alias']}]){
    const selected={type:'object',properties:{[key]:discriminator,status:{enum:['pass','fail']},first:{type:'string'},second:{type:'string'}},required:[key,'first','second']};
    const other={type:'object',properties:{[key]:{const:'other'},status:{const:'pass'}},required:[key]};
    for(const anyOf of [[other,selected],[selected,other]]){
      const shape={anyOf};
      assert.deepEqual(validateSchema(shape,{[key]:'selected',status:'pass'}),['$.first: requerido','$.second: requerido']);
      assert.deepEqual(validateSchema(shape,{[key]:'selected',status:'pass',first:'a',second:'b'}),[]);
      for(const value of [{status:'pass'},{[key]:'unknown',status:'pass'},{[key]:'selected',status:'unknown'}])assert.ok(validateSchema(shape,value).length);
    }
  }
});
test('anyOf sin discriminadores conserva rechazo y valida todas las alternativas',()=>{
  const shape={anyOf:[{type:'string',minLength:2},{type:'integer',minimum:1}]};
  for(const value of [null,'',0])assert.ok(validateSchema(shape,value).length);
  for(const value of ['ok',1])assert.deepEqual(validateSchema(shape,value),[]);
  assert.throws(()=>validateSchema({anyOf:[{const:'ok'},{not:{}}]},'ok'),/no soportada/);
});
