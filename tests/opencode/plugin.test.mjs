import {primaryReader,setupPlugin,createHost} from './native-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {adapterConfig} from '../../harness/build.mjs';
import {toolContracts, validateToolInput, validateInput} from '../../core/lib/tool-contracts.mjs';
import {checkSchemaVocabulary, validateSchema} from '../../core/lib/schema.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));

function permissionRequest(tool,action,resource,mutating,context) {
  return {sessionID:context.sessionID,agent:context.agent,action:tool,resources:[`${action}:${resource}`],save:[`${action}:${resource}`],source:{type:'tool',messageID:context.messageID,id:context.id},metadata:{action,resource,mutating}};
}
function subagentResult(text,sessionID) {
  return {output:{sessionID,status:'completed',output:text},content:`<subagent sessionID="${sessionID}" state="completed">\n${text}\n</subagent>`,metadata:{sessionID,status:'completed'}};
}
const metadataSnapshot = project => {
  const folder = path.join(project, '.pulso');
  return Object.fromEntries(fs.readdirSync(folder, {recursive:true}).sort().filter(file => file !== 'project.md').map(file => {
    const target = path.join(folder, file);
    return [file, fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : null];
  }));
};
async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-opencode-v2-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const runtime = path.join(base, 'runtime'), project = path.join(base, 'project'), second = path.join(base, 'second'), homeDir = path.join(base, 'home');
  for (const target of [runtime, project, second, homeDir]) fs.mkdirSync(target, {recursive: true});
  fs.cpSync(path.join(root, 'core'), path.join(runtime, 'resources'), {recursive: true});
  for (const [source, target] of Object.entries(adapterConfig.runtimeFiles)) {
    fs.mkdirSync(path.dirname(path.join(runtime, target)), {recursive: true});
    fs.copyFileSync(path.join(root, 'harness', source), path.join(runtime, target));
  }
  fs.cpSync(path.join(root, 'harness/vendor'), path.join(runtime, 'plugin/vendor'), {recursive: true});
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify(adapterConfig.packageManifest()));
  const module = await import(pathToFileURL(path.join(runtime, 'plugin/index.mjs')).href);
  const authority={directory:project};
  const reader=primaryReader(project),getSession=reader.getSession;
  reader.getSession=async sessionID=>({...await getSession(sessionID),location:{directory:authority.directory}});
  const native=await setupPlugin(module,{directory:project,homeDir,reader});
  t.after(()=>native.dispose());
  return {base,runtime,project,second,homeDir,...native,module,authority,nativeInputSchema:module.nativeInputSchema};
}

for (const outcome of ['approved', 'denied', 'revoked']) test(`native close_by_user OpenCode ${outcome}`, async t => {
  const {invoke, tools,hooks,host,authority, context, requests, project, second} = await fixture(t);
  assert.equal((await invoke('pulso_workspace', {action:'prepare'})).ok, true);
  assert.equal((await invoke('pulso_work', {action:'create',workId:'USER-CLOSE',title:'T',objective:'O',criterion:'C',verification:'V'})).ok, true);
  const added = await invoke('pulso_work', {action:'update',workId:'USER-CLOSE',expectedRevision:1,actions:[
    {type:'criterion.add',criterion:{id:'AC-2',description:'Second criterion',verification:'User review',acceptanceMode:'both'}},
    ...['pending','blocked'].map((status, i) => ({type:'task.add',task:{id:`T-${i+1}`,title:'Review',criterionIds:['AC-1','AC-2'],agent:null,status,dependsOn:[],writeScope:[],resources:[],acceptance:['Approved']}})),
  ]});
  assert.equal(added.ok, true, JSON.stringify(added));
  const request = {action:'close_by_user',workId:'USER-CLOSE',expectedRevision:added.data.revision,operationId:'native-user-close',summary:'User approves delivery',source:{text:'Apruebo todo; cierra el objetivo.',messageRef:'user-message-1'},limitations:[]};
  assert.deepEqual(validateInput(tools.pulso_work.input,{request}),{request});
  const before = metadataSnapshot(project);
  const ask = host.permission.assert;
  host.permission.assert = async permission => {
    await ask(permission);
    if (outcome === 'denied') throw new Error('permission denied');
    if (outcome === 'revoked') authority.directory = second;
  };
  requests.length = 0;
  let closed;
  if (outcome === 'approved') closed = await invoke('pulso_work', request);
  else await assert.rejects(invoke('pulso_work', request), outcome === 'denied' ? /permission denied/ : /directory changed/);
  assert.deepEqual(requests, [permissionRequest('pulso_work','close_by_user','USER-CLOSE',true,context)]);
  host.permission.assert = ask;
  authority.directory = project;
  const status = await invoke('pulso_workspace', {action:'status'});
  assert.equal(status.ok, true, JSON.stringify(status));
  if (outcome !== 'approved') {
    assert.deepEqual(metadataSnapshot(project), before);
    assert.deepEqual(status.data.works.items.map(work => work.id), ['USER-CLOSE']);
    assert.deepEqual(fs.readdirSync(second), []);
    return;
  }
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.data.closed, true);
  assert.equal(closed.data.verification, 'user_approved');
  assert.deepEqual(closed.data.source, request.source);
  assert.equal(closed.data.operationId, request.operationId);
  assert.deepEqual(closed.data.readiness, {ready:true,issues:[],revision:added.data.revision+1,evidenceIds:[],authority:'user',verification:'user_approved'});
  assert.deepEqual(closed.data.approval, {authority:'user',verification:'user_approved',criterionIds:['AC-1','AC-2'],taskIds:['T-1','T-2'],cancelledTaskIds:[]});
  const work = await invoke('pulso_work', {action:'get',workId:request.workId,section:'all'});
  assert.equal(work.ok, true, JSON.stringify(work));
  assert.deepEqual(work.data.tasks.items.map(task => task.status), ['done','done']);
  assert.deepEqual(work.data.readiness, closed.data.readiness);
  const history = await invoke('pulso_history', {workId:request.workId});
  assert.equal(history.ok, true, JSON.stringify(history));
  assert.equal(history.data.items.length, 1);
  assert.deepEqual(history.data.items[0].userRequest.source, request.source);
  assert.deepEqual(history.data.items[0].userRequest.approval, closed.data.approval);
  assert.deepEqual(status.data.works.items, []);
});

test('native JSON Schemas preserve complete shared descriptors and action refinements', async t => {
  const {tools,nativeInputSchema}=await fixture(t);
  const valid={
    pulso_workspace:[{action:'status'},{action:'prepare'}],
    pulso_work:[{action:'get',workId:'W'},{action:'create',title:'T',objective:'O',criterion:'C',verification:'V'},{action:'update',workId:'W',expectedRevision:1,actions:[{type:'work.set_overview',summary:'S'}]}],
    pulso_history:[{},{since:'2026-01-01T00:00:00Z'}],
    pulso_context:[{action:'read'},{action:'set_context',scope:'user',expectedRevision:1,context:''}],
  };
  for(const [name,inputs] of Object.entries(valid)) {
    const serialized=JSON.parse(JSON.stringify(tools[name].input));
    assert.deepEqual(serialized,nativeInputSchema(name));
    assert.deepEqual(tools[name].options,{codemode:false,permission:name});
    assert.equal(tools[name].output.type,'object');
    assert.ok(tools[name].output.required.includes('ok'),'Native structured result requires a declared output schema');
    for(const input of inputs) {
      const envelope=name==='pulso_history'?input:{request:input};
      assert.deepEqual(validateInput(serialized,envelope),envelope);
      assert.deepEqual(validateToolInput(name,input),input);
    }
    if(name!=='pulso_history') for(const descriptor of Object.values(toolContracts[name].actionSchemas)) assert.ok(serialized.properties.request.anyOf.some(candidate=>JSON.stringify(candidate)===JSON.stringify(descriptor)));
  }
  for(const input of [
    {action:'update',workId:'W',expectedRevision:1,actions:[{type:'work.set_overview'}]},
    {action:'update',workId:'W',expectedRevision:1,actions:[{type:'task.update',taskId:'T',patch:{}}]},
    {action:'get',workId:'W',expectedBindingId:'fake'},
    {action:'create',title:' ',objective:'O',criterion:'C',verification:'V'},
  ]) {
    assert.throws(()=>validateInput(tools.pulso_work.input,{request:input}));
    assert.throws(()=>validateToolInput('pulso_work',input));
  }
  for(const schema of [{type:'string',unsupported:true},{type:'string',format:'email'},{$ref:'x'}]) assert.throws(()=>checkSchemaVocabulary(schema));
  assert.deepEqual(validateInput({type:'string',maxLength:1},'🚀'),'🚀');
  assert.throws(()=>validateInput({type:'string',maxLength:1},'🚀🚀'));
  const numeric={type:'integer',minimum:1,maximum:100};
  for(const invalid of [0,101,1.5,NaN,Infinity,'1']) assert.throws(()=>validateInput(numeric,invalid));
  assert.equal(validateInput(numeric,100),100);
  assert.throws(()=>validateInput(tools.pulso_history.input,{since:'2026-02-31T00:00:00Z'}));
});

test('numeric and boolean constants stay exact in published v2 schemas and runtime validation', async t => {
  const original=structuredClone(toolContracts),{tools}=await fixture(t),seen=new Set();
  function inspect(schema) {
    if(Object.hasOwn(schema,'const')&&typeof schema.const!=='string') {
      seen.add(schema.const);
      assert.deepEqual(JSON.parse(JSON.stringify(schema)),schema);
      assert.deepEqual(validateInput(schema,schema.const),schema.const);
      for(const wrong of [1,2,true,0,false,'1','2','true','0',null]) if(wrong!==schema.const) assert.throws(()=>validateInput(schema,wrong));
    }
    for(const child of Object.values(schema.properties||{})) inspect(child);
    if(schema.items) inspect(schema.items);
    for(const child of schema.anyOf||[]) inspect(child);
  }
  for(const tool of Object.values(tools)) inspect(tool.input);
  for(const value of [1,2,true,0]) assert.ok(seen.has(value));
  const evidence={id:'E',kind:'executed',status:'pass',checkedAt:'2026-10-13T00:00:00Z',criterionIds:['AC-1'],taskIds:[],report:'report.md',command:'node --test',cwd:'.',exitCode:0,basis:'Current source',files:[{path:'missing.txt',absent:true}],summary:'Passed',acceptanceBasis:{criteria:[],tasks:[]}};
  const update={action:'update',workId:'W',expectedRevision:1,actions:[{type:'evidence.add',evidence}]};
  const accept={action:'accept_result',contractVersion:2,workId:'W',expectedRevision:1,continuityId:'C',intentRevision:1,delegationId:'D',operationId:'O',returnId:'R',decision:{status:'blocked',summary:'Blocked'}};
  for(const request of [update,accept]) assert.deepEqual(validateInput(tools.pulso_work.input,{request}),{request});
  for(const wrong of [1,2,true,false,'0']) {const request=structuredClone(update);request.actions[0].evidence.exitCode=wrong;assert.throws(()=>validateInput(tools.pulso_work.input,{request}));}
  for(const wrong of [1,2,0,false,'true']) {const request=structuredClone(update);request.actions[0].evidence.files[0].absent=wrong;assert.throws(()=>validateInput(tools.pulso_work.input,{request}));}
  for(const wrong of [1,true,0,'2']) assert.throws(()=>validateInput(tools.pulso_work.input,{request:{...accept,contractVersion:wrong}}));
  assert.deepEqual(toolContracts,original);
});

test('native JSON Schema recursive mixed enums retain exact values without publication workarounds',()=>{
  const schema={type:'object',additionalProperties:false,required:['const','enum','items'],properties:{
    const:{type:'integer',const:2,description:'Contract version'},
    enum:{type:'array',items:{anyOf:[{type:'integer',enum:[0,1]},{type:'boolean',const:true}]}},
    items:{enum:['ready',2,true,null]},
  }};
  const original=structuredClone(schema),published=JSON.parse(JSON.stringify(schema));
  assert.deepEqual(published,original);
  for(const item of ['ready',2,true,null]) {const request={const:2,enum:[0,1,true],items:item};assert.deepEqual(validateInput(published,request),request);}
  for(const request of [{const:1,enum:[0],items:'ready'},{const:true,enum:[0],items:'ready'},{const:0,enum:[0],items:'ready'},{const:2,enum:[2],items:'ready'},{const:2,enum:[false],items:'ready'},{const:2,enum:[0],items:1},{const:2,enum:[0],items:false},{const:2,enum:[0],items:'2'}]) {
    assert.ok(validateSchema(original,request).length);
    assert.throws(()=>validateInput(published,request));
  }
  assert.deepEqual(schema,original);
});

test('native v2 registrations are read-only at creation and every read asserts native permission', async t => {
  const {tools,hooks,host,authority, invoke, requests, project, homeDir} = await fixture(t);
  assert.deepEqual(Object.keys(tools), Object.keys(toolContracts));
  assert.deepEqual(fs.readdirSync(project), []);
  assert.deepEqual(fs.readdirSync(homeDir), []);
  for (const [name, input] of [['pulso_workspace',{action:'status'}],['pulso_work',{action:'get',workId:'W'}],['pulso_history',{}],['pulso_context',{action:'summary'}]]) await invoke(name, input);
  assert.equal(requests.length,5);
  assert.equal(requests.filter(request=>request.action.startsWith('pulso_')).length,4);
  assert.equal(requests.at(-1).action,'external_directory');
  assert.deepEqual(requests.at(-1).resources,[path.join(homeDir,'.pulso')+'/**']);
  assert.deepEqual(fs.readdirSync(project), []);
  assert.deepEqual(fs.readdirSync(homeDir), []);
});

test('native envelopes and model-selected roots fail before approval or writes', async t => {
  const {tools,hooks,host,authority, context, requests, project} = await fixture(t);
  for (const input of [{action:'prepare'}, {request:{action:'prepare'}, extra:true}, {request:{action:'prepare',root:project}}, {request:{action:'status',offset:0}}, {request:{action:'status',expectedBindingId:'fake'}}, {request:{action:'prepare',nativeContext:{sessionID:'forged'}}}]) {
    const result = (await tools.pulso_workspace.execute(input,context)).output;
    assert.equal(result.ok, false);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(fs.readdirSync(project), []);
});

test('denial, cancellation and root changes during native approval prevent writes', async t => {
  const {invoke, context, host, authority, project, second, homeDir} = await fixture(t);
  host.permission.assert = async () => {throw new Error('permission denied');};
  await assert.rejects(invoke('pulso_workspace',{action:'prepare'}), /permission denied/);
  host.permission.assert = async () => {authority.directory = second;};
  await assert.rejects(invoke('pulso_workspace',{action:'prepare'}), /directory changed/);
  authority.directory = project;
  const controller = new AbortController(); context.signal = controller.signal;
  host.permission.assert = async () => controller.abort();
  await assert.rejects(invoke('pulso_workspace',{action:'prepare'}), /cancelled/);
  for (const target of [project,second,homeDir]) assert.deepEqual(fs.readdirSync(target), []);
});

test('shared structured read and partial-persistence receipts survive native output wrapping', async t => {
  const {invoke, project} = await fixture(t);
  assert.equal((await invoke('pulso_workspace',{action:'prepare'})).ok,true);
  const create = await invoke('pulso_work',{action:'create',workId:'W',title:'T',objective:'O',criterion:'C',verification:'V'});
  assert.equal(create.ok,true,create.output);
  const get = await invoke('pulso_work',{action:'get',workId:'W',section:'criteria',limit:1});
  assert.equal(get.data.objective.criteria.items.length,1);
  assert.equal(get.data.hasMore,false);
  const state = path.join(fs.realpathSync(project),'.pulso/state.json');const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {if (to === state) throw new Error('injected projection write failure'); return rename(from, to);});
  const partial = await invoke('pulso_work',{action:'update',workId:'W',expectedRevision:1,actions:[{type:'work.set_overview',summary:'persisted'}]});
  assert.equal(partial.ok,false);
  assert.equal(partial.persistence.applied,true);
  assert.equal(partial.persistence.workId,'W');
  assert.equal(partial.persistence.revision,2);
});

test('attempt extensions are read-only, native-only and never declare acceptance', async t => {
  const {invoke, project} = await fixture(t);
  for (const action of ['attempts','reconcile_attempts']) {
    assert.throws(() => validateToolInput('pulso_workspace',{action}));
    const result=await invoke('pulso_workspace',{action});
    assert.equal(result.ok,true);
    assert.equal(result.data.liveness,'unknown');
    assert.equal(result.data.acceptance,'not_assessed');
  }
  assert.deepEqual(fs.readdirSync(project),[]);
});


test('native lifecycle preserves close/reopen receipts and scoped memory provenance', async t => {
  const {invoke}=await fixture(t);
  assert.equal((await invoke('pulso_workspace',{action:'prepare'})).ok,true);
  assert.equal((await invoke('pulso_work',{action:'create',workId:'ROUNDTRIP',title:'T',objective:'O',criterion:'C',verification:'V'})).ok,true);
  assert.equal((await invoke('pulso_work',{action:'close',workId:'ROUNDTRIP',expectedRevision:1,outcome:'cancelled',summary:'User changed scope',limitations:['No acceptance claimed']})).ok,true);
  const history=await invoke('pulso_history',{workId:'ROUNDTRIP',limit:1});
  assert.equal(history.data.items[0].outcome,'cancelled');
  assert.deepEqual(history.data.items[0].limitations,['No acceptance claimed']);
  assert.equal((await invoke('pulso_work',{action:'reopen',workId:'ROUNDTRIP',expectedRevision:2,reason:'New scope'})).ok,true);
  const work=await invoke('pulso_work',{action:'get',workId:'ROUNDTRIP'});
  assert.equal(work.data.cycle,2);assert.equal(work.data.revision,3);
  const memory=await invoke('pulso_context',{action:'read',scope:'all'});
  for(const scope of ['project','user'])assert.equal((await invoke('pulso_context',{action:'set_preference',scope,expectedRevision:memory.data.revisions[scope],key:'language',value:'es',source:'user'})).ok,true);
  const saved=await invoke('pulso_context',{action:'read',scope:'all'});
  assert.equal(saved.data.entries.length,2);
});

test('only catalog role and canonical task correlation can start passive observation', async t => {
  const {invoke,tools,hooks,host,authority,project}=await fixture(t);
  const call={tool:'subagent',sessionID:'ses_parent',messageID:'msg_parent',agent:'pulso',id:'call_one'};
  const valid={agent:'pulso-explorer',prompt:'workId: W\ntaskId: T\nPrivate assignment'};
  await hooks['execute.before']({...call,input:valid});
  assert.deepEqual(fs.readdirSync(project),[]);
  await invoke('pulso_workspace',{action:'prepare'});
  await invoke('pulso_work',{action:'create',workId:'W',title:'T',objective:'O',criterion:'C',verification:'V'});
  const added=await invoke('pulso_work',{action:'update',workId:'W',expectedRevision:1,actions:[{type:'task.add',task:{id:'T',title:'Explore',criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Return findings'],evidenceIds:[],summary:''}}]});
  assert.equal(added.ok,true,added.output);
  const workFile=path.join(project,'.pulso/work/W/work.json'),before=fs.readFileSync(workFile,'utf8');
  for(const bad of [{...valid,agent:'unknown'},{...valid,agent:'pulso-executor'},{...valid,prompt:'workId: W\ntaskId: T\ntaskId: X'}])await hooks['execute.before']({...call,input:bad});
  assert.equal(fs.existsSync(path.join(project,'.pulso/delegation-attempts')),false);
  await hooks['execute.before']({...call,input:valid});
  await hooks['execute.after']({...call,input:valid,status:'completed',result:{metadata:{sessionID:'ses_child',status:'completed'},output:{sessionID:'ses_child',status:'completed',output:'Private result'},content:'Private result'}});
  const attempts=await invoke('pulso_workspace',{action:'attempts'});
  assert.equal(attempts.data.items.length,1);
  assert.equal(attempts.data.items[0].status,'tool_returned');
  assert.equal(attempts.data.items[0].acceptance,'not_assessed');
  assert.equal(fs.readFileSync(workFile,'utf8'),before);
  assert.equal(JSON.stringify(attempts).includes('Private'),false);
});

for (const existing of [false, true]) test(`native initialization maps without Work bookkeeping; existing objective=${existing}`, async t => {
  const {invoke,tools,hooks,host,authority,project,requests,emit} = await fixture(t);
  const manifest = {name:'fixture-service',type:'module',scripts:{test:'node --test'}};
  fs.writeFileSync(path.join(project,'package.json'),JSON.stringify(manifest));
  assert.equal((await invoke('pulso_workspace',{action:'status'})).ok,true);
  assert.equal(fs.existsSync(path.join(project,'.pulso')),false);
  assert.equal((await invoke('pulso_workspace',{action:'prepare'})).ok,true);
  if (existing) {
    assert.equal((await invoke('pulso_work',{action:'create',workId:'KEEP',title:'Product',objective:'Implement product',criterion:'Behavior',verification:'Tests'})).ok,true);
    assert.equal((await invoke('pulso_workspace',{action:'bind_continuity',workId:'KEEP',requestKey:'keep',objective:'Implement product',repositories:['.'],constraints:[]})).ok,true);
  }
  const before = metadataSnapshot(project), approvals = requests.length;
  const prompt = `mode: project_initialization\nWorkspace: ${project}\nreadBase: ${project}\nresources: [package.json]\noutput: .pulso/project.md\nwriteScope: [.pulso/project.md]\nMapear contexto con fuentes reales y la guía project instalada. Sin cambios de producto.`;
  const args = {agent:'pulso-explorer',description:'Mapa contextual',prompt};
  const call = {tool:'subagent',sessionID:'ses_init',messageID:'msg_init',agent:'pulso',id:'call_init'};
  await hooks['execute.before']({...call,input:args});
  // Native specialist is simulated; actual plugin hooks/core run against an isolated fixture.
  const observed = JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
  const document = `# Proyecto\n\nServicio ${observed.name}; módulos ${observed.type}.\nComando observado: ${observed.scripts.test} (no ejecutado).\nFuente: package.json. Negocio: pendiente de confirmar.\n`;
  fs.writeFileSync(path.join(project,'.pulso/project.md'),document);
  const output = subagentResult('## Resultado\nCompletado\n## Cambios o hallazgos\n.pulso/project.md\n## Comprobación y pendientes\nFuentes leídas; negocio por confirmar.','ses_map');
  const original = structuredClone(output);
  await hooks['execute.after']({...call,input:args,status:'completed',result:output});
  // An uncorrelated native completion event cannot create a managed assignment.
  emit({type:'session.tool.success',data:{sessionID:call.sessionID,assistantMessageID:call.messageID,id:call.id}});
  await new Promise(setImmediate);
  assert.deepEqual(output,original); // No durable capture or acceptance injected.
  assert.equal(requests.length,approvals); // Hooks did not ask for a Work operation.
  assert.deepEqual(metadataSnapshot(project),before); // No tasks, continuity, evidence, history or telemetry writes.
  assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),document);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project,'package.json'))),manifest);
  assert.equal((await invoke('pulso_workspace',{action:'prepare'})).ok,true);
  assert.equal((await invoke('pulso_workspace',{action:'status'})).ok,true);
  assert.deepEqual(metadataSnapshot(project),before);
  assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),document);
  if (!existing) {
    assert.deepEqual(fs.readdirSync(path.join(project,'.pulso/work')),[]);
    assert.ok(requests.every(request => request.action === 'external_directory' || request.action === 'pulso_workspace' && /^(status|prepare):/.test(request.resources[0])));
  }
});

test('failed initialization return preserves the seed and creates no Work blocker or durable attempt', async t => {
  const {invoke,tools,hooks,host,authority,project} = await fixture(t);
  assert.equal((await invoke('pulso_workspace',{action:'prepare'})).ok,true);
  const before = metadataSnapshot(project), seed = fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8');
  const args = {agent:'pulso-explorer',description:'Mapa contextual',prompt:`mode: project_initialization\nWorkspace: ${project}\nreadBase: ${project}\noutput: .pulso/project.md\nwriteScope: [.pulso/project.md]\nInspeccionar fuentes autorizadas.`};
  const call = {tool:'subagent',sessionID:'ses_init',messageID:'msg_init',agent:'pulso',id:'call_failed'};
  await hooks['execute.before']({...call,input:args});
  const output = subagentResult('## Resultado\nBloqueado: lectura nativa denegada. No se ha producido el mapa.','ses_map');
  const original = structuredClone(output);
  await hooks['execute.after']({...call,input:args,status:'completed',result:output});
  assert.deepEqual(output,original);
  await hooks['execute.after']({...call,input:args,status:'error',error:{message:'Native read denied'}});
  assert.deepEqual(metadataSnapshot(project),before);
  assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),seed);
  assert.deepEqual(fs.readdirSync(path.join(project,'.pulso/work')),[]);
});

for (const outcome of ['approved','denied','revoked','cancelled']) test(`new-session recovery requests current native permission: ${outcome}`,async t=>{
  const f=await fixture(t);f.context.sessionID='ses_old';
  assert.equal((await f.invoke('pulso_workspace',{action:'prepare'})).ok,true);
  assert.equal((await f.invoke('pulso_work',{action:'create',workId:'RESUME',title:'Recover',objective:'Original',criterion:'Preserved',verification:'Read saved state'})).ok,true);
  const bound=await f.invoke('pulso_workspace',{action:'bind_continuity',workId:'RESUME',requestKey:'original',objective:'Exact objective',repositories:['.'],constraints:['No new execution']});assert.equal(bound.ok,true);
  f.context.sessionID='ses_new';const before=metadataSnapshot(f.project),inspect={action:'inspect_continuities',workId:'RESUME',continuityId:bound.data.continuityId};
  const deniedRead=await f.invoke('pulso_workspace',{action:'get_continuity',continuityId:bound.data.continuityId});
  assert.equal(deniedRead.error.code,'CONTINUITY_OWNER_MISMATCH');assert.equal(deniedRead.error.recovery.readWith.action,'inspect_continuities');
  f.requests.length=0;
  const inspected=await f.invoke('pulso_workspace',inspect);assert.equal(inspected.ok,true);assert.equal(inspected.data.adopted,false);assert.deepEqual(metadataSnapshot(f.project),before);
  assert.deepEqual(f.requests,[permissionRequest('pulso_workspace','inspect_continuities','RESUME',false,f.context)]);
  const args={action:'resume_continuity',workId:'RESUME',continuityId:bound.data.continuityId,expectedResumeBasis:inspected.data.items[0].resumeBasis},ask=f.host.permission.assert,controller=new AbortController();f.context.signal=controller.signal;f.requests.length=0;
  f.host.permission.assert=async request=>{await ask(request);if(outcome==='denied')throw new Error('permission denied');if(outcome==='revoked')f.authority.directory=f.second;if(outcome==='cancelled')controller.abort();};
  if(outcome==='approved'){
    const result=await f.invoke('pulso_workspace',args);assert.equal(result.ok,true);assert.equal(result.data.ownerSessionID,'ses_new');
    assert.equal((await f.invoke('pulso_workspace',{action:'get_continuity',continuityId:bound.data.continuityId})).ok,true);
  }else{
    await assert.rejects(f.invoke('pulso_workspace',args),outcome==='denied'?/permission denied/:outcome==='revoked'?/directory changed/:/cancelled/);
    assert.deepEqual(metadataSnapshot(f.project),before);assert.deepEqual(fs.readdirSync(f.second),[]);
  }
  assert.deepEqual(f.requests[0],permissionRequest('pulso_workspace','resume_continuity','RESUME',true,f.context));
});

test('recovery inspection denied by native host is read-denied, not a fallback ownership transfer',async t=>{
  const f=await fixture(t);f.context.sessionID='ses_old';
  await f.invoke('pulso_workspace',{action:'prepare'});await f.invoke('pulso_work',{action:'create',workId:'RESUME',title:'Recover',objective:'Original',criterion:'Preserved',verification:'Read saved state'});
  const before=metadataSnapshot(f.project);f.context.sessionID='ses_new';f.host.permission.assert=async()=>{throw new Error('permission denied');};
  await assert.rejects(f.invoke('pulso_workspace',{action:'inspect_continuities',workId:'RESUME'}),/permission denied/);assert.deepEqual(metadataSnapshot(f.project),before);
});

test('non-JSON and forged native identity inputs fail before permission or persistence',async t=>{
  const f=await fixture(t),before=f.requests.length;
  const cyclic={action:'status'};cyclic.self=cyclic;
  for(const request of [undefined,()=>{},new Date(),{action:'status',extra:NaN},cyclic,Object.assign(Object.create({foreign:true}),{action:'status'})]) {
    const result=await f.tools.pulso_workspace.execute({request},f.context);
    assert.equal(result.output.ok,false);
  }
  for(const key of ['sessionID','messageID','agent','id','signal']) {
    const context={...f.context,[key]:undefined};
    const result=await f.tools.pulso_workspace.execute({request:{action:'prepare'}},context);
    assert.equal(result.output.ok,false);
  }
  assert.equal(f.requests.length,before);
  assert.deepEqual(fs.readdirSync(f.project),[]);
  assert.deepEqual(fs.readdirSync(f.homeDir),[]);
});

test('plugin unload cancels retained invocation without granting permission or writes',async t=>{
  const f=await fixture(t);await f.dispose();
  const result=await f.invoke('pulso_workspace',{action:'prepare'});
  assert.equal(result.ok,false);
  assert.match(result.error.message,/cancelled/);
  assert.equal(f.requests.length,0);
  assert.deepEqual(fs.readdirSync(f.project),[]);
});

test('native setup accepts only exact OpenCode and rejects other host identities',async t=>{
  const f=await fixture(t);
  for(const app of [
    {name:'opencode',version:'1.18.2'},
    {name:'opencode',version:'2.1.3'},
    {name:'other',version:'2.1.2'},
    {name:'pulso',version:'0.1.0'},
    {name:'pulso',version:'2.1.2'},
  ]) {
    const native=createHost({directory:f.project});native.host.app=app;
    await assert.rejects(f.module.createPulsoPlugin({reader:native.reader,homeDir:f.homeDir}).setup(native.host),/requires|compatible|incompatible|OpenCode/i);
    assert.equal(Object.keys(native.tools).length,0);
  }
  for(const app of [{name:'cli',version:'2.1.2'},{name:'opencode',version:'2.1.2'}]) {
    const native=createHost({directory:f.project});native.host.app=app;
    const dispose=await f.module.createPulsoPlugin({reader:native.reader,homeDir:f.homeDir}).setup(native.host);
    assert.equal(Object.keys(native.tools).length,4);await dispose();
  }
  assert.deepEqual(fs.readdirSync(f.project),[]);
  assert.deepEqual(fs.readdirSync(f.homeDir),[]);
});


for(const request of [{tool:'pulso_workspace',args:{action:'prepare'}},{tool:'pulso_context',args:{action:'read',scope:'user'}},{tool:'pulso_context',args:{action:'summary'}},{tool:'pulso_context',args:{action:'set_context',scope:'user',expectedRevision:1,context:'Denied'}}])test(`external user metadata permission fails closed for ${request.tool}:${request.args.action}`,async t=>{
  const f=await fixture(t);const controller=new AbortController();f.context.signal=controller.signal;
  const source={type:'tool',messageID:f.context.messageID,id:f.context.id};
  f.host.permission.assert=async p=>{if(p.action==='external_directory'){assert.deepEqual(p.resources,[path.join(f.homeDir,'.pulso')+'/**']);assert.deepEqual(p.source,source);throw new Error('external directory denied');}};
  await assert.rejects(f.invoke(request.tool,request.args),/external directory denied/);
  assert.deepEqual(fs.readdirSync(f.project),[]);assert.deepEqual(fs.readdirSync(f.homeDir),[]);
  f.host.permission.assert=async p=>{if(p.action==='external_directory')controller.abort();};
  await assert.rejects(f.invoke(request.tool,request.args),/cancelled/);
  assert.deepEqual(fs.readdirSync(f.project),[]);assert.deepEqual(fs.readdirSync(f.homeDir),[]);
});
