import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {toolDefinitions,toolContracts,validateToolInput,isMutating,mutationSchema} from '../../core/lib/tool-contracts.mjs';
import {validateSchema} from '../../core/lib/schema.mjs';

const create={action:'create',title:'Objetivo',objective:'Resultado',criterion:'Aceptación',verification:'Comprobar'};
const fixtures={
  pulso_workspace:{prepare:{action:'prepare'},status:{action:'status'},validate:{action:'validate'},sync:{action:'sync',workId:'W-1',expectedRevision:1},recover:{action:'recover'}},
  pulso_work:{get:{action:'get',workId:'W-1'},create,update:{action:'update',workId:'W-1',expectedRevision:1,actions:[{type:'work.set_overview',summary:'Actualizado'}]},block:{action:'block',workId:'W-1',expectedRevision:1,summary:'Bloqueado',reason:'Entorno'},close:{action:'close',workId:'W-1',expectedRevision:1,summary:'Cerrado'},reopen:{action:'reopen',workId:'W-1',expectedRevision:1,reason:'Nueva revisión'}},
  pulso_context:{read:{action:'read'},summary:{action:'summary'},set_context:{action:'set_context',scope:'project',expectedRevision:1,context:''},set_preference:{action:'set_preference',scope:'user',expectedRevision:1,key:'idioma',value:'español',source:'user'},remove_preference:{action:'remove_preference',scope:'user',expectedRevision:1,key:'idioma'},add_learning:{action:'add_learning',scope:'project',expectedRevision:1,note:'Observación',source:'observed'}}
};
test('exactly four flat advertised descriptors derive all fields from action schemas',()=>{
  assert.deepEqual(toolDefinitions.map(value=>value.name),['pulso_workspace','pulso_work','pulso_history','pulso_context']);
  for(const def of toolDefinitions){
    assert.equal(def.toolReferenceName,def.name);assert.equal(def.inputSchema.additionalProperties,false);
    assert.equal(Object.hasOwn(def.inputSchema.properties,'request'),false);
    if(toolContracts[def.name].actionSchemas){
      const fields=new Set(Object.values(toolContracts[def.name].actionSchemas).flatMap(shape=>Object.keys(shape.properties)));
      assert.deepEqual(Object.keys(def.inputSchema.properties).sort(),[...fields].sort());
    }
    for(const key of ['projectRoot','root','homeDir','resourceRoot','expectedBindingId','bindingId','sessionID','offset'])assert.equal(Object.hasOwn(def.inputSchema.properties,key),false);
  }
  assert.equal(Object.hasOwn(toolContracts.pulso_workspace.actionSchemas,'attempts'),false);
  assert.equal(Object.hasOwn(toolContracts.pulso_workspace.actionSchemas,'reconcile_attempts'),false);
  assert.equal(Object.isFrozen(toolContracts.pulso_work.inputSchema),true);
});
for(const [name,actions] of Object.entries(fixtures))for(const [action,input] of Object.entries(actions)){
  test(`${name}/${action} has action-specific required fields and rejects extras`,()=>{
    assert.equal(validateToolInput(name,input),input);
    const descriptor=toolContracts[name];
    for(const key of descriptor.actionSchemas[action].required){const missing={...input};delete missing[key];assert.throws(()=>validateToolInput(name,missing));}
    for(const field of ['root','projectRoot','homeDir','expectedBindingId','request','offset','arbitrary'])assert.throws(()=>validateToolInput(name,{...input,[field]:1}));
    for(const field of Object.keys(descriptor.inputSchema.properties).filter(key=>!Object.hasOwn(descriptor.actionSchemas[action].properties,key))){
      const alternate=Object.values(actions).find(value=>Object.hasOwn(value,field));
      if(alternate)assert.throws(()=>validateToolInput(name,{...input,[field]:alternate[field]}));
    }
    assert.equal(isMutating(name,input),descriptor.mutatingActions.includes(action));
  });
}
test('semantic no-op mutations are rejected in descriptors before invocation',()=>{
  for(const input of [{type:'work.set_overview'},{type:'task.update',taskId:'T-1',patch:{}},{type:'criterion.update',criterionId:'C-1',reason:'Nueva aceptación'}]){
    assert.ok(validateSchema(mutationSchema,input).length);
    assert.throws(()=>validateToolInput('pulso_work',{...fixtures.pulso_work.update,actions:[input]}));
  }
});
test('advertised evidence rules reject static exit codes and invalid execution PASS inputs',()=>{
  const evidence=JSON.parse(fs.readFileSync(new URL('../../core/templates/evidence.json',import.meta.url),'utf8'));
  const request=patch=>({...fixtures.pulso_work.update,actions:[{type:'evidence.add',evidence:{...evidence,...patch}}]});
  const advertised=toolContracts.pulso_work.inputSchema;
  for(const kind of ['static','manual','not_run']){
    const valid=request({kind,status:kind==='not_run'?'not_run':'pass',command:null,exitCode:null});
    assert.deepEqual(validateSchema(advertised,valid),[]);
    assert.doesNotThrow(()=>validateToolInput('pulso_work',valid));
    for(const exitCode of [0,1]){
      const invalid=request({kind,command:'shasum -a 256 .pulso/project.md',exitCode});
      assert.ok(validateSchema(advertised,invalid).length);
      assert.throws(()=>validateToolInput('pulso_work',invalid));
    }
  }
  for(const status of ['pass','fail']){
    const invalid=request({kind:'not_run',status,command:null,exitCode:null});
    assert.ok(validateSchema(advertised,invalid).length);
    assert.throws(()=>validateToolInput('pulso_work',invalid));
  }
  assert.doesNotThrow(()=>validateToolInput('pulso_work',request({kind:'executed',status:'pass',command:'node --test',exitCode:0})));
  for(const patch of [{command:null,exitCode:0},{command:'   ',exitCode:0},{command:'node --test',exitCode:null},{command:'node --test',exitCode:1}]){
    assert.throws(()=>validateToolInput('pulso_work',request({kind:'executed',status:'pass',...patch})));
  }
  assert.throws(()=>validateToolInput('pulso_work',request({kind:'executed',status:'pass',command:'x'.repeat(4001),exitCode:0})));
  for(const status of ['fail','blocked','not_run'])assert.doesNotThrow(()=>validateToolInput('pulso_work',request({kind:'executed',status,command:null,exitCode:null})));
});
test('invalid semantic inputs and model-selected roots fail closed',()=>{
  for(const action of ['complete_map','attempts','reconcile_attempts','arbitrary'])assert.throws(()=>validateToolInput('pulso_workspace',{action}));
  assert.throws(()=>validateToolInput('missing',{}));
  assert.throws(()=>validateToolInput('pulso_work',{...create,title:'   '}));
  assert.throws(()=>validateToolInput('pulso_work',{...create,priority:'urgent'}));
  assert.throws(()=>validateToolInput('pulso_work',{...fixtures.pulso_work.update,expectedRevision:0}));
  assert.throws(()=>validateToolInput('pulso_work',{...fixtures.pulso_work.update,actions:[{type:'task.set_status',taskId:'T-1',status:'done',root:'/tmp'}]}));
  assert.throws(()=>validateToolInput('pulso_context',{...fixtures.pulso_context.set_context,scope:'all'}));
  assert.throws(()=>validateToolInput('pulso_history',{since:'2026-02-30T00:00:00Z'}));
  assert.throws(()=>validateToolInput('pulso_history',{since:'2026-01-02T00:00:00Z',until:'2026-01-01T00:00:00Z'}));
  assert.throws(()=>validateToolInput('pulso_history',{limit:101}));
  assert.throws(()=>validateToolInput('pulso_history',{offset:0}));
  assert.throws(()=>validateToolInput('pulso_history',new Date()));
  assert.throws(()=>validateToolInput('pulso_work',{action:'get',workId:'W-1',limit:undefined}));
  assert.throws(()=>validateToolInput('pulso_work',{action:'validate_result',delegation:{},result:{}}));
});
