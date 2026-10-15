import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {adapterConfig} from '../../adapters/opencode/build.mjs';
import {toolContracts, validateToolInput} from '../../core/lib/tool-contracts.mjs';
import {checkSchemaVocabulary, validateSchema} from '../../core/lib/schema.mjs';
import {nativeToolSchemas, schemaToZod} from '../../adapters/opencode/plugin/schema-converter.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const zodURL = pathToFileURL(path.join(root, 'adapters/opencode/vendor/zod/index.js')).href;
const {z} = await import(zodURL);
const validator = {checkSchemaVocabulary, validateSchema};
const metadataSnapshot = project => {
  const folder = path.join(project, '.pulso');
  return Object.fromEntries(fs.readdirSync(folder, {recursive:true}).sort().filter(file => file !== 'project.md').map(file => {
    const target = path.join(folder, file);
    return [file, fs.statSync(target).isFile() ? fs.readFileSync(target, 'utf8') : null];
  }));
};
async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-v4-opencode-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const runtime = path.join(base, 'runtime'), project = path.join(base, 'project'), second = path.join(base, 'second'), homeDir = path.join(base, 'home');
  for (const target of [runtime, project, second, homeDir]) fs.mkdirSync(target, {recursive: true});
  fs.cpSync(path.join(root, 'core'), path.join(runtime, 'resources'), {recursive: true});
  for (const [source, target] of Object.entries(adapterConfig.runtimeFiles)) {
    fs.mkdirSync(path.dirname(path.join(runtime, target)), {recursive: true});
    fs.copyFileSync(path.join(root, 'adapters/opencode', source), path.join(runtime, target));
  }
  fs.cpSync(path.join(root, 'adapters/opencode/vendor'), path.join(runtime, 'plugin/vendor'), {recursive: true});
  fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify(adapterConfig.packageManifest()));
  const {PulsoPlugin} = await import(pathToFileURL(path.join(runtime, 'plugin/index.mjs')).href);
  const plugin = await PulsoPlugin({directory: project, homeDir});
  const requests = [];
  const context = {directory: project, abort: new AbortController().signal, async ask(request) {requests.push(request);}};
  const invoke = async (name, input) => JSON.parse((await plugin.tool[name].execute(name === 'pulso_history' ? input : {request: input}, context)).output);
  return {base, runtime, project, second, homeDir, plugin, context, requests, invoke};
}

for (const outcome of ['approved', 'denied', 'revoked']) test(`native close_by_user OpenCode ${outcome}`, async t => {
  const {invoke, plugin, context, requests, project, second} = await fixture(t);
  assert.equal((await invoke('pulso_workspace', {action:'prepare'})).ok, true);
  assert.equal((await invoke('pulso_work', {action:'create',workId:'USER-CLOSE',title:'T',objective:'O',criterion:'C',verification:'V'})).ok, true);
  const added = await invoke('pulso_work', {action:'update',workId:'USER-CLOSE',expectedRevision:1,actions:[
    {type:'criterion.add',criterion:{id:'AC-2',description:'Second criterion',verification:'User review',acceptanceMode:'both'}},
    ...['pending','blocked'].map((status, i) => ({type:'task.add',task:{id:`T-${i+1}`,title:'Review',criterionIds:['AC-1','AC-2'],agent:null,status,dependsOn:[],writeScope:[],resources:[],acceptance:['Approved']}})),
  ]});
  assert.equal(added.ok, true, JSON.stringify(added));
  const request = {action:'close_by_user',workId:'USER-CLOSE',expectedRevision:added.data.revision,operationId:'native-user-close',summary:'User approves delivery',source:{text:'Apruebo todo; cierra el objetivo.',messageRef:'user-message-1'},limitations:[]};
  assert.deepEqual(plugin.tool.pulso_work.args.request.parse(request), request);
  const before = metadataSnapshot(project);
  const ask = context.ask;
  context.ask = async permission => {
    await ask(permission);
    if (outcome === 'denied') throw new Error('permission denied');
    if (outcome === 'revoked') context.directory = second;
  };
  requests.length = 0;
  let closed;
  if (outcome === 'approved') closed = await invoke('pulso_work', request);
  else await assert.rejects(invoke('pulso_work', request), outcome === 'denied' ? /permission denied/ : /directory changed/);
  assert.deepEqual(requests, [{permission:'pulso_work',patterns:['close_by_user:USER-CLOSE'],always:['close_by_user:USER-CLOSE'],metadata:{action:'close_by_user',resource:'USER-CLOSE',mutating:true}}]);
  context.ask = ask;
  context.directory = project;
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

test('all shared descriptors convert; nested action refinements match shared validation', () => {
  const converted = nativeToolSchemas(toolContracts, z, validator);
  const valid = {
    pulso_workspace: [{action: 'status'}, {action: 'prepare'}],
    pulso_work: [{action: 'get', workId: 'W'}, {action: 'create', title: 'T', objective: 'O', criterion: 'C', verification: 'V'}, {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'work.set_overview', summary: 'S'}]}],
    pulso_history: [{}, {since: '2026-01-01T00:00:00Z'}],
    pulso_context: [{action: 'read'}, {action: 'set_context', scope: 'user', expectedRevision: 1, context: ''}],
  };
  for (const [name, inputs] of Object.entries(valid)) for (const input of inputs) {
    assert.deepEqual(converted[name].parse(input), input);
    assert.deepEqual(validateToolInput(name, input), input);
  }
  for (const input of [
    {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'work.set_overview'}]},
    {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'task.update', taskId: 'T', patch: {}}]},
    {action: 'get', workId: 'W', expectedBindingId: 'fake'},
    {action: 'create', title: ' ', objective: 'O', criterion: 'C', verification: 'V'},
  ]) {assert.equal(converted.pulso_work.safeParse(input).success, false);assert.throws(() => validateToolInput('pulso_work', input));}
  for (const schema of [{type: 'string', unsupported: true}, {type: 'string', format: 'email'}, {$ref: 'x'}, {type: ['string','null']}]) assert.throws(() => schemaToZod(schema, z, validator));
  const unicode = schemaToZod({type: 'string', maxLength: 1}, z, validator);
  assert.equal(unicode.parse('🚀'), '🚀');
  assert.equal(unicode.safeParse('🚀🚀').success, false);
  assert.equal(z.toJSONSchema(unicode).maxLength, 1);
  const numeric = schemaToZod({type:'integer',minimum:1,maximum:100},z,validator);
  assert.equal(z.toJSONSchema(numeric).type,'integer');
  assert.equal(z.toJSONSchema(numeric).maximum,100);
  assert.equal(converted.pulso_history.safeParse({since: '2026-02-31T00:00:00Z'}).success, false);
});

function assertStringLiteralsOnly(schema) {
  if (Object.hasOwn(schema, 'const')) assert.equal(typeof schema.const, 'string');
  if (schema.enum) assert.ok(schema.enum.every(value => typeof value === 'string'));
  for (const child of Object.values(schema.properties || {})) assertStringLiteralsOnly(child);
  if (schema.items) assertStringLiteralsOnly(schema.items);
  for (const key of ['anyOf', 'oneOf', 'allOf']) for (const child of schema[key] || []) assertStringLiteralsOnly(child);
  for (const child of Object.values(schema.$defs || {})) assertStringLiteralsOnly(child);
}

test('registered tool schemas serialize without non-string literals and preserve original contracts', async t => {
  const original = structuredClone(toolContracts);
  const {plugin} = await fixture(t);
  for (const definition of Object.values(plugin.tool)) {
    const serialized = JSON.parse(JSON.stringify(z.toJSONSchema(z.object(definition.args))));
    assertStringLiteralsOnly(serialized);
  }
  const seen = new Set();
  const check = schema => {
    if (Object.hasOwn(schema, 'const') && typeof schema.const !== 'string') {
      seen.add(schema.const);
      const native = schemaToZod(schema, z, validator);
      const published = JSON.parse(JSON.stringify(z.toJSONSchema(z.object({value:native})))).properties.value;
      assertStringLiteralsOnly(published);
      assert.equal(published.type, schema.type || typeof schema.const);
      assert.ok(published.description.includes(JSON.stringify(schema.const)));
      assert.deepEqual(native.parse(schema.const), schema.const);
      for (const wrong of [1, 2, true, 0, false, '1', '2', 'true', '0', null]) {
        if (wrong === schema.const) continue;
        assert.equal(native.safeParse(wrong).success, false);
      }
    }
    for (const child of Object.values(schema.properties || {})) check(child);
    if (schema.items) check(schema.items);
    for (const child of schema.anyOf || []) check(child);
  };
  for (const schema of Object.values(toolContracts.pulso_work.actionSchemas)) check(schema);
  for (const value of [1, 2, true, 0]) assert.ok(seen.has(value));
  const registered = z.object(plugin.tool.pulso_work.args);
  const evidence = {id:'E',kind:'executed',status:'pass',checkedAt:'2026-10-13T00:00:00Z',criterionIds:['AC-1'],taskIds:[],report:'report.md',command:'node --test',cwd:'.',exitCode:0,basis:'Current source',files:[{path:'missing.txt',absent:true}],summary:'Passed',acceptanceBasis:{criteria:[],tasks:[]}};
  const update = {action:'update',workId:'W',expectedRevision:1,actions:[{type:'evidence.add',evidence}]};
  const accept = {action:'accept_result',contractVersion:2,workId:'W',expectedRevision:1,continuityId:'C',intentRevision:1,delegationId:'D',operationId:'O',returnId:'R',decision:{status:'blocked',summary:'Blocked'}};
  for (const request of [update,accept]) assert.deepEqual(registered.parse({request}),{request});
  for (const wrong of [1,2,true,false,'0']) {
    const request = structuredClone(update);
    request.actions[0].evidence.exitCode = wrong;
    assert.equal(registered.safeParse({request}).success,false);
  }
  for (const wrong of [1,2,0,false,'true']) {
    const request = structuredClone(update);
    request.actions[0].evidence.files[0].absent = wrong;
    assert.equal(registered.safeParse({request}).success,false);
  }
  for (const wrong of [1,true,0,'2']) assert.equal(registered.safeParse({request:{...accept,contractVersion:wrong}}).success,false);
  assert.deepEqual(toolContracts, original);
});

test('recursive publication handles numeric, boolean and mixed enums without weakening runtime validation', () => {
  const schema = {type:'object',additionalProperties:false,required:['const','enum','items'],properties:{
    const:{type:'integer',const:2,description:'Contract version'},
    enum:{type:'array',items:{anyOf:[{type:'integer',enum:[0,1]},{type:'boolean',const:true}]}},
    items:{enum:['ready',2,true,null]},
  }};
  const original = structuredClone(schema);
  const native = z.object({request:schemaToZod(schema,z,validator)});
  const published = JSON.parse(JSON.stringify(z.toJSONSchema(native)));
  assertStringLiteralsOnly(published);
  assert.equal(published.properties.request.properties.const.description, 'Contract version\nAllowed values: 2.');
  assert.deepEqual(published.properties.request.properties.items.anyOf.map(branch => branch.type), ['string','number','boolean','null']);
  for (const item of ['ready',2,true,null]) {
    const request = {const:2,enum:[0,1,true],items:item};
    assert.deepEqual(native.parse({request}), {request});
  }
  for (const request of [
    {const:1,enum:[0],items:'ready'},
    {const:true,enum:[0],items:'ready'},
    {const:0,enum:[0],items:'ready'},
    {const:2,enum:[2],items:'ready'},
    {const:2,enum:[false],items:'ready'},
    {const:2,enum:[0],items:1},
    {const:2,enum:[0],items:false},
    {const:2,enum:[0],items:'2'},
  ]) {
    assert.ok(validateSchema(original,request).length);
    assert.equal(native.safeParse({request}).success,false);
  }
  assert.deepEqual(schema,original);
});

test('real SDK registrations are read-only at creation and every read asks native permission', async t => {
  const {plugin, invoke, requests, project, homeDir} = await fixture(t);
  assert.deepEqual(Object.keys(plugin.tool), Object.keys(toolContracts));
  assert.deepEqual(fs.readdirSync(project), []);
  assert.deepEqual(fs.readdirSync(homeDir), []);
  for (const [name, input] of [['pulso_workspace',{action:'status'}],['pulso_work',{action:'get',workId:'W'}],['pulso_history',{}],['pulso_context',{action:'summary'}]]) await invoke(name, input);
  assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request.permission.startsWith('pulso_') && request.patterns.length === 1));
  assert.deepEqual(fs.readdirSync(project), []);
  assert.deepEqual(fs.readdirSync(homeDir), []);
});

test('native envelopes and model-selected roots fail before approval or writes', async t => {
  const {plugin, context, requests, project} = await fixture(t);
  for (const input of [{action:'prepare'}, {request:{action:'prepare'}, extra:true}, {request:{action:'prepare',root:project}}, {request:{action:'status',offset:0}}, {request:{action:'status',expectedBindingId:'fake'}}, {request:{action:'prepare',nativeContext:{sessionID:'forged'}}}]) {
    const result = JSON.parse((await plugin.tool.pulso_workspace.execute(input,context)).output);
    assert.equal(result.ok, false);
  }
  assert.equal(requests.length, 0);
  assert.deepEqual(fs.readdirSync(project), []);
});

test('denial, cancellation and root changes during native approval prevent writes', async t => {
  const {invoke, context, project, second, homeDir} = await fixture(t);
  context.ask = async () => {throw new Error('permission denied');};
  await assert.rejects(invoke('pulso_workspace',{action:'prepare'}), /permission denied/);
  context.ask = async () => {context.directory = second;};
  await assert.rejects(invoke('pulso_workspace',{action:'prepare'}), /directory changed/);
  context.directory = project;
  const controller = new AbortController(); context.abort = controller.signal;
  context.ask = async () => controller.abort();
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
  const {invoke,plugin,project}=await fixture(t);
  const call={tool:'task',sessionID:'session_parent',callID:'call_one'};
  const valid={subagent_type:'pulso-explorer',prompt:'workId: W\ntaskId: T\nPrivate assignment'};
  await plugin['tool.execute.before'](call,{args:valid});
  assert.deepEqual(fs.readdirSync(project),[]);
  await invoke('pulso_workspace',{action:'prepare'});
  await invoke('pulso_work',{action:'create',workId:'W',title:'T',objective:'O',criterion:'C',verification:'V'});
  const added=await invoke('pulso_work',{action:'update',workId:'W',expectedRevision:1,actions:[{type:'task.add',task:{id:'T',title:'Explore',criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Return findings'],evidenceIds:[],summary:''}}]});
  assert.equal(added.ok,true,added.output);
  const workFile=path.join(project,'.pulso/work/W/work.json'),before=fs.readFileSync(workFile,'utf8');
  for(const bad of [{...valid,subagent_type:'unknown'},{...valid,subagent_type:'pulso-executor'},{...valid,prompt:'workId: W\ntaskId: T\ntaskId: X'}])await plugin['tool.execute.before'](call,{args:bad});
  assert.equal(fs.existsSync(path.join(project,'.pulso/delegation-attempts')),false);
  await plugin['tool.execute.before'](call,{args:valid});
  await plugin['tool.execute.after']({...call,args:valid},{metadata:{sessionId:'session_child'},output:'Private result'});
  const attempts=await invoke('pulso_workspace',{action:'attempts'});
  assert.equal(attempts.data.items.length,1);
  assert.equal(attempts.data.items[0].status,'tool_returned');
  assert.equal(attempts.data.items[0].acceptance,'not_assessed');
  assert.equal(fs.readFileSync(workFile,'utf8'),before);
  assert.equal(JSON.stringify(attempts).includes('Private'),false);
});

for (const existing of [false, true]) test(`native initialization maps without Work bookkeeping; existing objective=${existing}`, async t => {
  const {invoke,plugin,project,requests} = await fixture(t);
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
  const args = {subagent_type:'pulso-explorer',description:'Mapa contextual',prompt};
  const call = {tool:'task',sessionID:'ses_init',callID:'call_init'};
  await plugin['tool.execute.before'](call,{args});
  // Native specialist is simulated; actual plugin hooks/core run against an isolated fixture.
  const observed = JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
  const document = `# Proyecto\n\nServicio ${observed.name}; módulos ${observed.type}.\nComando observado: ${observed.scripts.test} (no ejecutado).\nFuente: package.json. Negocio: pendiente de confirmar.\n`;
  fs.writeFileSync(path.join(project,'.pulso/project.md'),document);
  const output = {output:'## Resultado\nCompletado\n## Cambios o hallazgos\n.pulso/project.md\n## Comprobación y pendientes\nFuentes leídas; negocio por confirmar.',metadata:{sessionId:'ses_map',parentSessionId:'ses_init',truncated:false}};
  const original = structuredClone(output);
  await plugin['tool.execute.after']({...call,args},output);
  await plugin.event({event:{type:'message.part.updated',properties:{part:{...call,type:'tool',state:{status:'completed',input:args,...output}}}}});
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
    assert.ok(requests.every(request => request.permission === 'pulso_workspace' && /^(status|prepare):/.test(request.patterns[0])));
  }
});

test('failed initialization return preserves the seed and creates no Work blocker or durable attempt', async t => {
  const {invoke,plugin,project} = await fixture(t);
  assert.equal((await invoke('pulso_workspace',{action:'prepare'})).ok,true);
  const before = metadataSnapshot(project), seed = fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8');
  const args = {subagent_type:'pulso-explorer',description:'Mapa contextual',prompt:`mode: project_initialization\nWorkspace: ${project}\nreadBase: ${project}\noutput: .pulso/project.md\nwriteScope: [.pulso/project.md]\nInspeccionar fuentes autorizadas.`};
  const call = {tool:'task',sessionID:'ses_init',callID:'call_failed'};
  await plugin['tool.execute.before'](call,{args});
  const output = {output:'## Resultado\nBloqueado: lectura nativa denegada. No se ha producido el mapa.',metadata:{}};
  const original = structuredClone(output);
  await plugin['tool.execute.after']({...call,args},output);
  assert.deepEqual(output,original);
  assert.deepEqual(metadataSnapshot(project),before);
  assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),seed);
  assert.deepEqual(fs.readdirSync(path.join(project,'.pulso/work')),[]);
});
