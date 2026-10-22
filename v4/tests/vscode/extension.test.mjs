import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {adapterConfig} from '../../adapters/vscode/build.mjs';
import {toolDefinitions, toolContracts} from '../../core/lib/tool-contracts.mjs';
import {validateSchema} from '../../core/lib/schema.mjs';
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const names = toolDefinitions.map(value => value.name);
const folder = fsPath => ({name: path.basename(fsPath), uri: {scheme: 'file', fsPath}});
export async function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-v4-vscode-')));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const extensionPath = path.join(base, 'extension'), homeDir = path.join(base, 'home');
  const projects = ['a','b'].map(name => path.join(base, name));
  for (const target of [extensionPath, homeDir, ...projects]) fs.mkdirSync(target, {recursive: true});
  fs.cpSync(path.join(root, 'core'), path.join(extensionPath, 'resources'), {recursive: true});
  fs.writeFileSync(path.join(extensionPath, 'package.json'), JSON.stringify(await adapterConfig.packageManifest({coreRoot: path.join(root, 'core'), chatAgents: [], chatSkills: []})));
  for (const [source, target] of Object.entries(adapterConfig.runtimeFiles)) {
    fs.mkdirSync(path.dirname(path.join(extensionPath, target)), {recursive: true});
    fs.copyFileSync(path.join(root, 'adapters/vscode', source), path.join(extensionPath, target));
  }
  const tools = new Map(), commands = new Map(), picks = [];
  const host = {tools, commands, picks, choose: items => items[0], vscode: {
    workspace: {isTrusted: true, workspaceFolders: [folder(projects[0])]},
    lm: {registerTool(name, implementation) {tools.set(name, implementation);return {dispose() {tools.delete(name);}};}},
    LanguageModelToolResult: class {constructor(content) {this.content = content;}},
    LanguageModelTextPart: class {constructor(value) {this.value = value;}},
    window: {async showQuickPick(items, options, token) {picks.push({items, options, token});return host.choose(items);}, async showInformationMessage() {}},
    commands: {registerCommand(name, implementation) {commands.set(name, implementation);return {dispose() {commands.delete(name);}};}, async executeCommand() {}},
  }};
  const context = {extensionPath, subscriptions: []};
  await require(path.join(extensionPath, 'src/extension.cjs')).activateWith(host.vscode, context, {homeDir});
  t.after(() => context.subscriptions.forEach(value => value.dispose()));
  const invoke = async (name, input, token = {isCancellationRequested: false}) => JSON.parse((await tools.get(name).invoke({input}, token)).content[0].value);
  const status = () => invoke('pulso_workspace', {action: 'status'});
  return {base, extensionPath, homeDir, projects, host, context, invoke, status};
}

for (const outcome of ['approved', 'cancelled', 'revoked']) test(`native close_by_user VSCode ${outcome}`, async t => {
  const {invoke, status, host, projects, extensionPath} = await fixture(t);
  const {bindingId} = await status();
  const run = (name, input) => invoke(name, {...input,expectedBindingId:bindingId});
  assert.equal((await run('pulso_workspace', {action:'prepare'})).ok, true);
  assert.equal((await run('pulso_work', {action:'create',workId:'USER-CLOSE',title:'T',objective:'O',criterion:'C',verification:'V'})).ok, true);
  const added = await run('pulso_work', {action:'update',workId:'USER-CLOSE',expectedRevision:1,actions:[
    {type:'criterion.add',criterion:{id:'AC-2',description:'Second criterion',verification:'User review',acceptanceMode:'both'}},
    ...['pending','blocked'].map((status, i) => ({type:'task.add',task:{id:`T-${i+1}`,title:'Review',criterionIds:['AC-1','AC-2'],agent:null,status,dependsOn:[],writeScope:[],resources:[],acceptance:['Approved']}})),
  ]});
  assert.equal(added.ok, true, JSON.stringify(added));
  const request = {action:'close_by_user',workId:'USER-CLOSE',expectedRevision:added.data.revision,operationId:'native-user-close',summary:'User approves delivery',source:{text:'Apruebo todo; cierra el objetivo.',messageRef:'user-message-1'},limitations:[],expectedBindingId:bindingId};
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath,'package.json'),'utf8'));
  const definition = manifest.contributes.languageModelTools.find(tool => tool.name === 'pulso_work');
  assert.deepEqual(validateSchema(definition.inputSchema, request), []);
  const confirmation = host.tools.get('pulso_work').prepareInvocation({input:request});
  assert.ok(confirmation.confirmationMessages);
  assert.match(JSON.stringify(confirmation.confirmationMessages), /close_by_user/);
  const snapshot = () => Object.fromEntries(fs.readdirSync(path.join(projects[0],'.pulso'),{recursive:true}).sort().map(file => {
    const target = path.join(projects[0],'.pulso',file);
    return [file,fs.statSync(target).isFile() ? fs.readFileSync(target,'utf8') : null];
  }));
  const before = snapshot();
  if (outcome !== 'approved') {
    if (outcome === 'revoked') await host.commands.get('pulso.selectProject')();
    await assert.rejects(invoke('pulso_work', request, {isCancellationRequested:outcome === 'cancelled'}), outcome === 'revoked' ? /binding changed or missing/ : /cancelled/);
    assert.deepEqual(snapshot(), before);
    const open = await status();
    assert.equal(open.ok, true, JSON.stringify(open));
    assert.deepEqual(open.data.works.items.map(work => work.id), ['USER-CLOSE']);
    return;
  }
  const closed = await invoke('pulso_work', request);
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.equal(closed.data.closed, true);
  assert.equal(closed.data.verification, 'user_approved');
  assert.deepEqual(closed.data.source, request.source);
  assert.equal(closed.data.operationId, request.operationId);
  assert.deepEqual(closed.data.readiness, {ready:true,issues:[],revision:added.data.revision+1,evidenceIds:[],authority:'user',verification:'user_approved'});
  assert.deepEqual(closed.data.approval, {authority:'user',verification:'user_approved',criterionIds:['AC-1','AC-2'],taskIds:['T-1','T-2'],cancelledTaskIds:[]});
  const work = await run('pulso_work', {action:'get',workId:request.workId,section:'all'});
  assert.equal(work.ok, true, JSON.stringify(work));
  assert.deepEqual(work.data.tasks.items.map(task => task.status), ['done','done']);
  assert.deepEqual(work.data.readiness, closed.data.readiness);
  const history = await run('pulso_history', {workId:request.workId});
  assert.equal(history.ok, true, JSON.stringify(history));
  assert.equal(history.data.items.length, 1);
  assert.deepEqual(history.data.items[0].userRequest.source, request.source);
  assert.deepEqual(history.data.items[0].userRequest.approval, closed.data.approval);
  const current = await status();
  assert.equal(current.ok, true, JSON.stringify(current));
  assert.deepEqual(current.data.works.items, []);
});

test('public registrations are read-only at activation and generated schemas derive from common definitions', async t => {
  const {projects, homeDir, host, context} = await fixture(t);
  assert.deepEqual([...host.tools.keys()], names);
  assert.equal(context.subscriptions.length, 7);
  for (const directory of [...projects, homeDir]) assert.deepEqual(fs.readdirSync(directory), []);
  const manifest = await adapterConfig.packageManifest({coreRoot: path.join(root, 'core'), chatAgents: [], chatSkills: []});
  assert.equal(manifest.version, JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
  for (const definition of manifest.contributes.languageModelTools) {
    const {expectedBindingId, ...properties} = definition.inputSchema.properties;
    assert.deepEqual(properties, toolContracts[definition.name].inputSchema.properties);
    assert.equal(expectedBindingId.type, 'string');
    assert.ok(!definition.inputSchema.properties.sessionID);
    assert.ok(!definition.inputSchema.properties.offset);
  }
  assert.equal(manifest.contributes.chatParticipants, undefined);
});

test('prepareInvocation validates without selecting a root and asks native confirmation for mutations', async t => {
  const {host, projects} = await fixture(t);
  const tool = host.tools.get('pulso_workspace');
  assert.equal(tool.prepareInvocation({input: {action: 'status'}}).confirmationMessages, undefined);
  assert.ok(tool.prepareInvocation({input: {action: 'prepare'}}).confirmationMessages);
  for (const input of [null, {}, {action: 'status', root: projects[1]}, {action: 'attempts'}, {action: 'status', request: {}}, {action: 'status', offset: 0}]) {
    assert.throws(() => tool.prepareInvocation({input}));
    await assert.rejects(tool.invoke({input}, {}));
  }
  assert.equal(host.picks.length, 0);
});

test('binding is stripped and all mutations reject missing/stale opaque tokens', async t => {
  const {invoke, status, projects, homeDir, host} = await fixture(t);
  const first = await status();
  assert.equal(first.workspace, projects[0]);
  assert.equal(first.ok, true);
  for (const [name, action] of Object.entries(toolContracts).flatMap(([name, contract]) => contract.mutatingActions.map(action => [name, action]))) {
    const fields = {
      prepare: {}, recover: {}, sync: {workId: 'W', expectedRevision: 1},
      bind_continuity: {workId:'W',requestKey:'bind',objective:'O',repositories:['.'],constraints:[]},
      update_intent: {continuityId:'C',expectedRevision:1,objective:'O',constraints:[]},
      resume_continuity: {workId:'W',continuityId:'C',expectedResumeBasis:'a'.repeat(64)},
      prepare_delegation: {contractVersion:2,workId:'W',expectedRevision:1,continuityId:'C',intentRevision:1,requestKey:'prepare',taskIds:['T'],objective:'O',inputs:[],output:'report.md',constraints:[],templateId:'implementation'},
      reconcile_delegation: {workId:'W',delegationId:'D',continuityId:'C',intentRevision:1,reason:'R',resolution:'not_dispatched'},
      accept_result: {contractVersion:2,workId:'W',expectedRevision:1,delegationId:'D',continuityId:'C',intentRevision:1,operationId:'accept',reportedReturn:{captureKey:'return',markdown:'Report'},decision:{}},
      accept_delivery: {workId:'W',expectedRevision:1,summary:'S',criterionIds:['AC-1'],source:{text:'Approved'},limitations:[]},
      close_by_user: {workId:'W',expectedRevision:1,operationId:'close-user',summary:'S',source:{text:'Approved'},limitations:[]},
      create: {title: 'T', objective: 'O', criterion: 'C', verification: 'V'},
      update: {workId: 'W', expectedRevision: 1, actions: [{type: 'work.set_overview', summary: 'S'}]},
      block: {workId: 'W', expectedRevision: 1, summary: 'S', reason: 'R'},
      close: {workId: 'W', expectedRevision: 1, summary: 'S'}, reopen: {workId: 'W', expectedRevision: 1, reason: 'R'},
      set_context: {scope: 'project', expectedRevision: 1, context: 'C'},
      set_preference: {scope: 'user', expectedRevision: 1, key: 'K', value: 'V', source: 'user'},
      remove_preference: {scope: 'user', expectedRevision: 1, key: 'K'},
      add_learning: {scope: 'project', expectedRevision: 1, note: 'N', source: 'observed'},
    }[action];
    for (const expectedBindingId of [undefined, 'stale']) await assert.rejects(invoke(name, {action, ...fields, ...(expectedBindingId ? {expectedBindingId} : {})}), /binding changed or missing/);
  }
  for (const directory of [...projects, homeDir]) assert.deepEqual(fs.readdirSync(directory), []);
  const prepared = await invoke('pulso_workspace', {action: 'prepare', expectedBindingId: first.bindingId});
  assert.equal(prepared.ok, true, prepared.output);
  const created = await invoke('pulso_work', {action: 'create', title: 'T', objective: 'O', criterion: 'C', verification: 'V', expectedBindingId: first.bindingId});
  assert.equal(created.ok, true, created.output);
  host.vscode.workspace.workspaceFolders = projects.map(folder);
  host.choose = items => items[1];
  const second = await status();
  assert.notEqual(first.bindingId, second.bindingId);
  await assert.rejects(invoke('pulso_workspace', {action: 'prepare', expectedBindingId: first.bindingId}), /binding changed or missing/);
  assert.deepEqual(fs.readdirSync(projects[1]), []);
});

test('native trust/cancellation/root checks apply to reads and global preference writes', async t => {
  const {host, status, invoke, projects, homeDir} = await fixture(t);
  const {bindingId} = await status();
  const request = {action: 'set_preference', scope: 'user', key: 'K', value: 'V', source: 'user', expectedRevision: 1, expectedBindingId: bindingId};
  host.vscode.workspace.isTrusted = false;
  await assert.rejects(status(), /trusted workspace/);
  await assert.rejects(invoke('pulso_context', request), /trusted workspace/);
  host.vscode.workspace.isTrusted = true;
  await assert.rejects(invoke('pulso_context', request, {isCancellationRequested: true}), /cancelled/);
  host.vscode.workspace.workspaceFolders = [];
  await assert.rejects(status(), /No open local/);
  for (const directory of [...projects, homeDir]) assert.deepEqual(fs.readdirSync(directory), []);
});

test('native result preserves canonical structured read pages and partial-persistence facts', async t => {
  const {status, invoke, projects} = await fixture(t);
  const {bindingId} = await status();
  const run = (name, input) => invoke(name, {...input, expectedBindingId: bindingId});
  assert.equal((await run('pulso_workspace', {action: 'prepare'})).ok, true);
  assert.equal((await run('pulso_work', {action: 'create', workId: 'W', title: 'T', objective: 'O', criterion: 'C', verification: 'V'})).ok, true);
  const get = await run('pulso_work', {action: 'get', workId: 'W', section: 'criteria', limit: 1});
  assert.equal(get.data.objective.criteria.items.length, 1);
  assert.equal(get.data.hasMore, false);
  // Projection failure happens after canonical work.json commits revision 2.
  const state = path.join(projects[0], '.pulso/state.json');
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {if (to === state) throw new Error('injected projection write failure'); return rename(from, to);});
  const partial = await run('pulso_work', {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'work.set_overview', summary: 'persisted'}]});
  assert.equal(partial.ok, false);
  assert.equal(partial.persistence.applied, true);
  assert.equal(partial.persistence.workId, 'W');
  assert.equal(partial.persistence.revision, 2);
});

test('no caller identity is guessed and stale post-await context is checked', async t => {
  const {host, invoke} = await fixture(t);
  const token = new Proxy({isCancellationRequested: false}, {get(target, key) {assert.equal(key, 'isCancellationRequested'); return target[key];}});
  const result = await invoke('pulso_workspace', {action: 'status'}, token);
  assert.equal(result.ok, true);
  assert.equal(host.picks.length, 0);
});

test('native lifecycle returns close/reopen receipts and revision-bound project/user memory', async t => {
  const {invoke,status}=await fixture(t),{bindingId}=await status();
  const run=(name,input)=>invoke(name,{...input,expectedBindingId:bindingId});
  assert.equal((await run('pulso_workspace',{action:'prepare'})).ok,true);
  assert.equal((await run('pulso_work',{action:'create',workId:'ROUNDTRIP',title:'T',objective:'O',criterion:'C',verification:'V'})).ok,true);
  assert.equal((await run('pulso_work',{action:'close',workId:'ROUNDTRIP',expectedRevision:1,outcome:'cancelled',summary:'User changed scope',limitations:['No acceptance claimed']})).ok,true);
  const history=await run('pulso_history',{workId:'ROUNDTRIP',limit:1});
  assert.equal(history.data.items[0].outcome,'cancelled');
  assert.deepEqual(history.data.items[0].limitations,['No acceptance claimed']);
  assert.equal((await run('pulso_work',{action:'reopen',workId:'ROUNDTRIP',expectedRevision:2,reason:'New scope'})).ok,true);
  const work=await run('pulso_work',{action:'get',workId:'ROUNDTRIP'});
  assert.equal(work.data.cycle,2);assert.equal(work.data.revision,3);
  const memory=await run('pulso_context',{action:'read',scope:'all'});
  for(const scope of ['project','user']) {
    const saved=await run('pulso_context',{action:'set_preference',scope,expectedRevision:memory.data.revisions[scope],key:'language',value:'es',source:'user'});
    assert.equal(saved.ok,true,saved.output);
  }
  const saved=await run('pulso_context',{action:'read',scope:'all'});
  assert.equal(saved.data.entries.length,2);
});

test('explicit persistent mapping Work records static evidence; hash command exit codes reject without writes (not pulso-init)', async t => {
  const {invoke,status,projects,host}=await fixture(t),{bindingId}=await status();
  const run=input=>invoke('pulso_work',{...input,expectedBindingId:bindingId});
  assert.equal((await invoke('pulso_workspace',{action:'prepare',expectedBindingId:bindingId})).ok,true);
  assert.equal((await run({action:'create',workId:'INIT',title:'Mapear proyecto',objective:'Documentar contexto',criterion:'Mapa verificado',verification:'Revisión estática contra fuentes'})).ok,true);
  assert.equal((await run({action:'update',workId:'INIT',expectedRevision:1,actions:[{type:'task.add',task:{id:'map-project',title:'Mapear contexto',criterionIds:['AC-1'],agent:'pulso-explorer',status:'in_progress',dependsOn:[],writeScope:['.pulso/project.md'],resources:[],acceptance:['Mapa verificado contra fuentes'],evidenceIds:[],summary:''}}]})).ok,true);
  const observed=await run({action:'get',workId:'INIT',section:'all'});
  assert.equal(observed.data.objective.criteria.items.length,1);
  assert.equal(observed.data.objective.criteria.items[0].id,'AC-1');
  const document=Buffer.from('<!-- template: project@1.0 -->\n# Proyecto\nContexto revisado contra fuentes.\n');
  fs.writeFileSync(path.join(projects[0],'.pulso/project.md'),document);
  const evidence={id:'project-context-reviewed',kind:'static',status:'pass',checkedAt:new Date().toISOString(),criterionIds:['AC-1'],taskIds:['map-project'],report:'.pulso/project.md',command:null,cwd:'.',exitCode:null,basis:'Revisión estática del mapa contra fuentes; no se ejecutaron pruebas.',files:[{path:'.pulso/project.md',sha256:createHash('sha256').update(document).digest('hex')}],summary:'Contexto revisado.',acceptanceBasis:observed.data.acceptanceBasis};
  const request={action:'update',workId:'INIT',expectedRevision:observed.data.revision,expectedBindingId:bindingId,actions:[{type:'evidence.add',evidence},{type:'task.set_status',taskId:'map-project',status:'done'}]};
  const manifest=await adapterConfig.packageManifest({coreRoot:path.join(root,'core'),chatAgents:[],chatSkills:[]});
  const definition=manifest.contributes.languageModelTools.find(tool=>tool.name==='pulso_work');
  const invalid=structuredClone(request);
  Object.assign(invalid.actions[0].evidence,{command:'shasum -a 256 .pulso/project.md',exitCode:0});
  const workPath=path.join(projects[0],'.pulso/work/INIT/work.json'),before=fs.readFileSync(workPath);
  assert.ok(validateSchema(definition.inputSchema,invalid).length);
  assert.throws(()=>host.tools.get('pulso_work').prepareInvocation({input:invalid}));
  await assert.rejects(invoke('pulso_work',invalid));
  assert.deepEqual(fs.readFileSync(workPath),before);
  assert.deepEqual(validateSchema(definition.inputSchema,request),[]);
  const saved=await invoke('pulso_work',request);
  assert.equal(saved.ok,true,saved.output);
  const current=await run({action:'get',workId:'INIT',section:'all'});
  assert.equal(current.data.evidence.items[0].exitCode,null);
  assert.equal(current.data.tasks.items[0].status,'done');
  const closed=await run({action:'close',workId:'INIT',expectedRevision:current.data.revision,summary:'Mapa aceptado con revisión estática',limitations:['No se ejecutaron tests ni build del producto.']});
  assert.equal(closed.ok,true,closed.output);
  const history=await invoke('pulso_history',{workId:'INIT',expectedBindingId:bindingId});
  assert.equal(history.data.items[0].outcome,'done');
});

test('initialization preparation and map need no Work; binding/trust guards and reuse remain effective', async t => {
  const {invoke,status,projects,host} = await fixture(t);
  const project = projects[0], {bindingId} = await status();
  assert.equal(fs.existsSync(path.join(project,'.pulso')),false);
  await assert.rejects(invoke('pulso_workspace',{action:'prepare'}),/binding changed or missing/);
  assert.equal((await invoke('pulso_workspace',{action:'prepare',expectedBindingId:bindingId})).ok,true);
  const snapshot = () => Object.fromEntries(fs.readdirSync(path.join(project,'.pulso'),{recursive:true}).sort().filter(file => file !== 'project.md').map(file => {
    const target = path.join(project,'.pulso',file);
    return [file,fs.statSync(target).isFile() ? fs.readFileSync(target,'utf8') : null];
  }));
  const before = snapshot();
  // agent/edit belong to the native host, not this extension. Simulate only the
  // Explorer's scoped write; real extension/core preparation and guards run here.
  fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'fixture',type:'module'}));
  const source = JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8'));
  const document = `# Proyecto\n\n${source.name}: módulos ${source.type} según package.json.\nNegocio pendiente de confirmar; sin pruebas ejecutadas.\n`;
  fs.writeFileSync(path.join(project,'.pulso/project.md'),document);
  assert.deepEqual(snapshot(),before);
  assert.deepEqual(fs.readdirSync(path.join(project,'.pulso/work')),[]);
  assert.equal((await invoke('pulso_workspace',{action:'prepare',expectedBindingId:bindingId})).ok,true);
  assert.equal((await status()).ok,true);
  assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),document);
  assert.deepEqual(snapshot(),before);
  host.vscode.workspace.isTrusted = false;
  await assert.rejects(invoke('pulso_workspace',{action:'prepare',expectedBindingId:bindingId}),/trusted workspace/);
  host.vscode.workspace.isTrusted = true;
  await host.commands.get('pulso.selectProject')();
  await assert.rejects(invoke('pulso_workspace',{action:'prepare',expectedBindingId:bindingId}),/binding changed or missing/);
  assert.deepEqual(snapshot(),before);
});

test('a host change after a committed native operation retains its receipt and marks context drift', async t => {
  const {invoke,status,host,projects}=await fixture(t),{bindingId}=await status();
  await invoke('pulso_workspace',{action:'prepare',expectedBindingId:bindingId});
  const rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(from,to)=>{
    const result=rename(from,to);
    if(to.endsWith('/work/W/work.json'))queueMicrotask(()=>{host.vscode.workspace.isTrusted=false;});
    return result;
  });
  const receipt=await invoke('pulso_work',{action:'create',workId:'W',title:'T',objective:'O',criterion:'C',verification:'V',expectedBindingId:bindingId});
  assert.equal(receipt.ok,false);
  assert.equal(receipt.contextChanged,true);
  assert.equal(receipt.data.workId,'W');
  assert.equal(JSON.parse(fs.readFileSync(path.join(projects[0],'.pulso/work/W/work.json'))).revision,1);
});
