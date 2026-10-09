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

test('public registrations are read-only at activation and generated schemas derive from common definitions', async t => {
  const {projects, homeDir, host, context} = await fixture(t);
  assert.deepEqual([...host.tools.keys()], names);
  assert.equal(context.subscriptions.length, 6);
  for (const directory of [...projects, homeDir]) assert.deepEqual(fs.readdirSync(directory), []);
  const manifest = await adapterConfig.packageManifest({coreRoot: path.join(root, 'core'), chatAgents: [], chatSkills: []});
  assert.equal(manifest.version, '4.0.0');
  for (const definition of manifest.contributes.languageModelTools) {
    const {expectedBindingId, ...properties} = definition.inputSchema.properties;
    assert.deepEqual(properties, toolContracts[definition.name].inputSchema.properties);
    if (definition.name !== 'pulso_history') assert.equal(expectedBindingId.type, 'string');
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
  const get = await invoke('pulso_work', {action: 'get', workId: 'W', section: 'criteria', limit: 1});
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
  const history=await invoke('pulso_history',{workId:'ROUNDTRIP',limit:1});
  assert.equal(history.data.items[0].outcome,'cancelled');
  assert.deepEqual(history.data.items[0].limitations,['No acceptance claimed']);
  assert.equal((await run('pulso_work',{action:'reopen',workId:'ROUNDTRIP',expectedRevision:2,reason:'New scope'})).ok,true);
  const work=await invoke('pulso_work',{action:'get',workId:'ROUNDTRIP'});
  assert.equal(work.data.cycle,2);assert.equal(work.data.revision,3);
  const memory=await invoke('pulso_context',{action:'read',scope:'all'});
  for(const scope of ['project','user']) {
    const saved=await run('pulso_context',{action:'set_preference',scope,expectedRevision:memory.data.revisions[scope],key:'language',value:'es',source:'user'});
    assert.equal(saved.ok,true,saved.output);
  }
  const saved=await invoke('pulso_context',{action:'read',scope:'all'});
  assert.equal(saved.data.entries.length,2);
});

test('native init records static evidence and closes; hash command exit codes are rejected without writes', async t => {
  const {invoke,status,projects,host}=await fixture(t),{bindingId}=await status();
  const run=input=>invoke('pulso_work',{...input,expectedBindingId:bindingId});
  assert.equal((await invoke('pulso_workspace',{action:'prepare',expectedBindingId:bindingId})).ok,true);
  assert.equal((await run({action:'create',workId:'INIT',title:'Mapear proyecto',objective:'Documentar contexto',criterion:'Mapa verificado',verification:'Revisión estática contra fuentes'})).ok,true);
  assert.equal((await run({action:'update',workId:'INIT',expectedRevision:1,actions:[{type:'task.add',task:{id:'map-project',title:'Mapear contexto',criterionIds:['AC-1'],agent:'pulso-explorer',status:'in_progress',dependsOn:[],writeScope:['.pulso/project.md'],resources:[],acceptance:['Mapa verificado contra fuentes'],evidenceIds:[],summary:''}}]})).ok,true);
  const observed=await invoke('pulso_work',{action:'get',workId:'INIT',section:'all'});
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
  const current=await invoke('pulso_work',{action:'get',workId:'INIT',section:'all'});
  assert.equal(current.data.evidence.items[0].exitCode,null);
  assert.equal(current.data.tasks.items[0].status,'done');
  const closed=await run({action:'close',workId:'INIT',expectedRevision:current.data.revision,summary:'Mapa aceptado con revisión estática',limitations:['No se ejecutaron tests ni build del producto.']});
  assert.equal(closed.ok,true,closed.output);
  const history=await invoke('pulso_history',{workId:'INIT'});
  assert.equal(history.data.items[0].outcome,'done');
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
