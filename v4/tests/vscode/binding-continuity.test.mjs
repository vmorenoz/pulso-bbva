// Deterministic adapter logic only: public VS Code API and semantic execution
// are doubles. These tests do not certify Local agent or Copilot Agent Host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createWorkspaceResolver} from '../../adapters/vscode/src/workspace.mjs';
import {nativeDefinitions, requiresBinding, unwrapInput} from '../../adapters/vscode/src/native-contracts.mjs';
import {toolDefinitions, validateToolInput} from '../../core/lib/tool-contracts.mjs';
import {adapterConfig, nativeBoundary} from '../../adapters/vscode/build.mjs';

const require = createRequire(import.meta.url);
const source = fileURLToPath(new URL('../../adapters/vscode/src/', import.meta.url));
const contracts = new URL('../../core/lib/tool-contracts.mjs', import.meta.url).href;
const folder = fsPath => ({name:path.basename(fsPath),uri:{scheme:'file',fsPath}});
function hostFixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-binding-')));
  t.after(() => fs.rmSync(base, {recursive:true,force:true}));
  const roots = ['a','b'].map(name => path.join(base,name));
  roots.forEach(root => fs.mkdirSync(root));
  const listeners = {folders:new Set(),trust:new Set()};
  const event = key => listener => {listeners[key].add(listener);return {dispose(){listeners[key].delete(listener);}};};
  const tools = new Map(), commands = new Map();
  const vscode = {
    workspace:{isTrusted:true,workspaceFolders:[folder(roots[0])],
      onDidChangeWorkspaceFolders:event('folders'),onDidGrantWorkspaceTrust:event('trust')},
    window:{showQuickPick:async items => items[0],showInformationMessage:async()=>{}},
    lm:{registerTool(name,tool){tools.set(name,tool);return {dispose(){tools.delete(name);}};}},
    commands:{registerCommand(name,fn){commands.set(name,fn);return {dispose(){commands.delete(name);}};}},
    LanguageModelToolResult:class {constructor(content){this.content=content;}},
    LanguageModelTextPart:class {constructor(value){this.value=value;}},
  };
  const emit = key => {for(const listener of listeners[key]) listener();};
  const change = root => {vscode.workspace.workspaceFolders=[folder(root)];emit('folders');};
  return {base,roots,vscode,tools,commands,listeners,emit,change};
}
async function extensionFixture(t) {
  const f = hostFixture(t), extensionPath=path.join(f.base,'extension');
  fs.mkdirSync(path.join(extensionPath,'resources/lib'),{recursive:true});
  fs.cpSync(source,path.join(extensionPath,'src'),{recursive:true});
  fs.writeFileSync(path.join(extensionPath,'package.json'),JSON.stringify(await adapterConfig.packageManifest({
    coreRoot:fileURLToPath(new URL('../../core/',import.meta.url)),chatAgents:[],chatSkills:[],
  })));
  fs.writeFileSync(path.join(extensionPath,'resources/lib/tool-contracts.mjs'),`export * from ${JSON.stringify(contracts)};`);
  const semantic=path.join(extensionPath,'resources/lib/semantic-tools.mjs');
  fs.writeFileSync(semantic,'let handler; export function setHandler(value){handler=value;} export async function executeTool(...args){return handler(...args);}');
  const {setHandler}=await import(pathToFileURL(semantic).href);
  const calls=[];
  setHandler(async(name,input,context)=>{context.assertContext();calls.push({name,input,context});return {ok:true,output:'double',data:input};});
  const context={extensionPath,subscriptions:[]};
  await require(path.join(extensionPath,'src/extension.cjs')).activateWith(f.vscode,context,{homeDir:f.base});
  t.after(()=>context.subscriptions.forEach(item=>item.dispose()));
  const invoke=async(name,input,token={isCancellationRequested:false})=>JSON.parse((await f.tools.get(name).invoke({input,
    toolInvocationToken:new Proxy({}, {get(){throw new Error('opaque invocation token must not be decoded');}})},token)).content[0].value);
  return {...f,context,calls,setHandler,invoke,status:()=>invoke('pulso_workspace',{action:'status'})};
}

test('all four schemas admit binding; only unanchored discovery is exempt',()=>{
  for(const definition of nativeDefinitions(toolDefinitions)) {
    assert.equal(definition.inputSchema.properties.expectedBindingId.type,'string');
  }
  assert.equal(requiresBinding('pulso_workspace',{action:'status'}),false);
  for(const [name,input] of [
    ['pulso_workspace',{action:'status',continuityId:'C'}],['pulso_workspace',{action:'status',cursor:'page'}],
    ['pulso_workspace',{action:'get_continuity',continuityId:'C'}],['pulso_work',{action:'get',workId:'W'}],
    ['pulso_work',{action:'get_delegation',workId:'W',delegationId:'D'}],['pulso_history',{}],
    ['pulso_context',{action:'summary',scope:'user'}],
  ]) assert.equal(requiresBinding(name,input),true);
  const history=toolDefinitions.find(item=>item.name==='pulso_history');
  assert.deepEqual(unwrapInput(history,{workId:'W',expectedBindingId:'opaque'},validateToolInput),{semantic:{workId:'W'},expectedBindingId:'opaque'});
});

test('reads reject absent/stale bindings and never replace an explicitly stale discovery token',async t=>{
  const f=await extensionFixture(t), first=await f.status();
  for(const [name,input] of [['pulso_work',{action:'get',workId:'W'}],['pulso_history',{workId:'W'}],
    ['pulso_context',{action:'read'}],['pulso_workspace',{action:'status',continuityId:'C'}]]) {
    for(const binding of [undefined,'stale']) await assert.rejects(f.invoke(name,{...input,...(binding?{expectedBindingId:binding}:{})}),/binding changed or missing/);
    const result=await f.invoke(name,{...input,expectedBindingId:first.bindingId});
    assert.equal(result.workspace,first.workspace);
    assert.equal(result.generation,first.generation);
    assert.equal(f.calls.at(-1).input.expectedBindingId,undefined);
  }
  await assert.rejects(f.invoke('pulso_workspace',{action:'status',expectedBindingId:'stale'}),/binding changed or missing/);
});

test('events catch A→B→A between rereads, trust grant and same-root reselection',async t=>{
  const f=hostFixture(t), resolver=createWorkspaceResolver(f.vscode);
  t.after(()=>resolver.dispose());
  const first=await resolver.resolveContext();
  assert.ok(Object.isFrozen(first));
  f.change(f.roots[1]);f.change(f.roots[0]);
  assert.throws(()=>resolver.assertContext(first),/changed/);
  const next=await resolver.resolveContext();
  assert.ok(next.generation>first.generation);
  await resolver.select();
  assert.throws(()=>resolver.assertContext(next),/binding changed/);
  const selected=await resolver.resolveContext();
  f.emit('trust');
  assert.throws(()=>resolver.assertContext(selected),/changed/);
  resolver.dispose();
  assert.equal(f.listeners.folders.size,0);assert.equal(f.listeners.trust.size,0);
});

test('events during picker reject B→A even though its final folder signature matches',async t=>{
  const f=hostFixture(t), resolver=createWorkspaceResolver(f.vscode);
  t.after(()=>resolver.dispose());
  f.vscode.window.showQuickPick=async items=>{f.change(f.roots[1]);f.change(f.roots[0]);return items[0];};
  await assert.rejects(resolver.select(),/folders changed/);
});

test('snapshot acquired before await cannot silently adopt a reselected binding',async t=>{
  const f=hostFixture(t),resolver=createWorkspaceResolver(f.vscode);
  t.after(()=>resolver.dispose());
  const pending=resolver.resolveContext();
  f.change(f.roots[1]);f.change(f.roots[0]);
  const original=await pending;
  assert.throws(()=>resolver.assertContext(original),/changed/);
});

test('precommit context check stops writes; postcommit receipt keeps original snapshot',async t=>{
  const f=await extensionFixture(t),first=await f.status();
  let writes=0;
  f.setHandler(async(name,input,context)=>{
    f.change(f.roots[1]);f.change(f.roots[0]);
    await Promise.resolve();context.assertContext();writes++;
  });
  await assert.rejects(f.invoke('pulso_workspace',{action:'prepare',expectedBindingId:first.bindingId}),/changed/);
  assert.equal(writes,0);
  f.setHandler(async()=>({ok:true,output:'discovery'}));
  const bound=await f.status();
  f.setHandler(async(name,input,context)=>{
    context.assertContext();writes++;
    f.change(f.roots[1]);
    await Promise.resolve();
    return {ok:true,output:'committed',data:{workId:'W',revision:2},persistence:{applied:true}};
  });
  const receipt=await f.invoke('pulso_workspace',{action:'prepare',expectedBindingId:bound.bindingId});
  assert.equal(writes,1);assert.equal(receipt.contextChanged,true);
  assert.equal(receipt.workspace,f.roots[0]);assert.equal(receipt.bindingId,bound.bindingId);
  assert.equal(receipt.generation,bound.generation);assert.equal(receipt.persistence.applied,true);
  assert.equal(receipt.data.revision,2);
});

test('directed read preserves its bound snapshot after same-root reselection',async t=>{
  const f=await extensionFixture(t),bound=await f.status();
  f.setHandler(async()=>{await f.commands.get('pulso.selectProject')();return {ok:true,output:'read',data:{workId:'W'}};});
  const receipt=await f.invoke('pulso_history',{workId:'W',expectedBindingId:bound.bindingId});
  assert.equal(receipt.contextChanged,true);assert.equal(receipt.bindingId,bound.bindingId);
  assert.equal(receipt.workspace,bound.workspace);assert.equal(receipt.data.workId,'W');
});

test('two explicit continuity handles pass independently; reload/window gets a fresh binding',async t=>{
  const f=await extensionFixture(t),bound=await f.status();
  const results=await Promise.all(['chat-a-objective','chat-b-objective'].map(continuityId=>
    f.invoke('pulso_workspace',{action:'get_continuity',continuityId,expectedBindingId:bound.bindingId})));
  assert.deepEqual(results.map(result=>result.data.continuityId),['chat-a-objective','chat-b-objective']);
  const other=createWorkspaceResolver(f.vscode);t.after(()=>other.dispose());
  const second=await other.resolveContext();
  assert.equal(second.root,bound.workspace);assert.notEqual(second.bindingId,bound.bindingId);
  assert.throws(()=>other.assertBinding(second.root,bound.bindingId),/binding changed/);
  other.dispose();
  const reloaded=createWorkspaceResolver(f.vscode);t.after(()=>reloaded.dispose());
  assert.notEqual((await reloaded.resolveContext()).bindingId,second.bindingId);
});

test('trust and cancellation protect reads, reported writes and prepare; token identity stays opaque',async t=>{
  const f=await extensionFixture(t),bound=await f.status();
  const prepare={action:'prepare_delegation',contractVersion:2,continuityId:'C',intentRevision:1,expectedRevision:1,
    requestKey:'P',workId:'W',taskIds:['T'],objective:'O',inputs:[],output:'report.md',constraints:[],templateId:'implementation',expectedBindingId:bound.bindingId};
  assert.ok(f.tools.get('pulso_work').prepareInvocation({input:prepare}).confirmationMessages);
  await assert.rejects(f.invoke('pulso_work',{...prepare,expectedBindingId:undefined}),/invalid binding token/);
  const {expectedBindingId,...unbound}=prepare;
  await assert.rejects(f.invoke('pulso_work',unbound),/binding changed or missing/);
  const token=new Proxy({isCancellationRequested:true},{get(target,key){assert.equal(key,'isCancellationRequested');return target[key];}});
  await assert.rejects(f.invoke('pulso_work',prepare,token),/cancelled/);
  f.vscode.workspace.isTrusted=false;
  await assert.rejects(f.invoke('pulso_history',{expectedBindingId:bound.bindingId}),/trusted workspace/);
  assert.equal(f.calls.length,1);
});

test('v2 reported return reaches execution intact even with a semantically invalid candidate',async t=>{
  const f=await extensionFixture(t),bound=await f.status();
  const input={action:'accept_result',contractVersion:2,workId:'W',delegationId:'D',continuityId:'C',intentRevision:1,
    operationId:'O',expectedRevision:1,reportedReturn:{captureKey:'R',markdown:'# Literal\nUnchanged bytes.\n',completeness:'complete'},
    decision:{status:'invalid-semantic-state',acceptedTaskIds:['unknown'],summary:'Candidate'},reportedTerminal:true};
  const result=await f.invoke('pulso_work',{...input,expectedBindingId:bound.bindingId});
  assert.deepEqual(result.data,input);
  await assert.rejects(f.invoke('pulso_work',{...input,returnId:'R',expectedBindingId:bound.bindingId}));
  assert.match(nativeBoundary,/preparar → delegar → incorporar/);
  assert.match(nativeBoundary,/orchestrator_reported/);
  assert.doesNotMatch(nativeBoundary,/prepare_delegation es lectura|result\.markdown/);
});

test('prepare transports the literal specialist prompt without launching or wrapping a subagent',async t=>{
  const f=await extensionFixture(t),bound=await f.status();
  const specialistPrompt='# Encargo literal\n\nUnicode: á → 漢字\n```json\n{"literal":true}\n```\n';
  let calls=0;
  f.setHandler(async(name,input)=>{
    calls++;
    assert.equal(name,'pulso_work');
    assert.equal(input.action,'prepare_delegation');
    assert.equal(input.expectedBindingId,undefined);
    return {ok:true,output:'prepared',data:{delegationId:'D',specialistPrompt}};
  });
  const result=await f.invoke('pulso_work',{action:'prepare_delegation',contractVersion:2,continuityId:'C',intentRevision:1,
    expectedRevision:1,requestKey:'P',workId:'W',taskIds:['T'],objective:'O',inputs:[],output:'conversation',constraints:[],
    templateId:'implementation',expectedBindingId:bound.bindingId});
  assert.equal(result.data.specialistPrompt,specialistPrompt);
  assert.equal(calls,1);
  assert.deepEqual([...f.tools.keys()].sort(),['pulso_context','pulso_history','pulso_work','pulso_workspace']);
  assert.match(nativeBoundary,/specialistPrompt exacto, sin reescribir ni envolver su texto/);
  assert.match(nativeBoundary,/no acredita captura durable, sesiones reanudables ni terminación física/);
});
