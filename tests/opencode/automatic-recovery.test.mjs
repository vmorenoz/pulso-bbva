/** Real core + public SDK-shaped fixtures; not live OpenCode/LLM acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {adapterConfig} from '../../harness/build.mjs';

const source = fileURLToPath(new URL('../../', import.meta.url));
const snapshot = root => Object.fromEntries(fs.readdirSync(root, {recursive: true}).sort().filter(file => fs.statSync(path.join(root, file)).isFile()).map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
function user(sessionID,id,text,extra={}) { return {id,type:'user',text,time:{created:1},...extra}; }
function assistant(sessionID,id,parentID,extra={}) { return {id,type:'assistant',agent:'pulso',time:{created:2,completed:3},content:[],...extra}; }
async function fixture(t, {prepare = true} = {}) {
  // Match canonical runtime roots when the OS temporary directory is a symlink (macOS).
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-auto-recovery-')));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const runtime = path.join(base, 'runtime'), root = path.join(base, 'project');
  fs.mkdirSync(root);fs.mkdirSync(path.join(runtime, 'plugin'), {recursive: true});
  fs.cpSync(path.join(source, 'core'), path.join(runtime, 'resources'), {recursive: true});
  fs.copyFileSync(path.join(source, 'harness/plugin/recovery-policy.mjs'), path.join(runtime, 'plugin/recovery-policy.mjs'));
  for (const file of ['durable-hooks.mjs', 'delegation-observer.mjs', 'native-read.mjs']) fs.copyFileSync(path.join(source, 'harness/plugin', file), path.join(runtime, 'plugin', file));
  const load = relative => import(pathToFileURL(path.join(runtime, relative)).href);
  const policyModule = await load('plugin/recovery-policy.mjs');
  const {executeTool} = await load('resources/lib/semantic-tools.mjs');
  const core = await load('resources/lib/continuity.mjs');
  const registry = await load('resources/lib/delegation-registry.mjs');
  const discovery = await load('resources/lib/continuity-discovery.mjs');
  const sessions = new Map(['ses_old','ses_new','ses_child'].map(id => [id,{id,projectID:'native-project',location:{directory:root},agent:id==='ses_child'?'pulso-explorer':'pulso',outcome:id==='ses_old'?'failed':'succeeded',time:{created:1,updated:3,idle:3},...(id==='ses_child'?{parentID:'ses_old'}:{})}]));
  const messages = new Map([
    ['ses_old',[user('ses_old','msg_old_user','Corrige el validador; no publiques.'),assistant('ses_old','msg_old_error','msg_old_user',{error:{type:'provider',message:'Network failed'}})]],
    ['ses_new',[user('ses_new','msg_new_user','Hola'),assistant('ses_new','msg_new_assistant','msg_new_user',{time:{created:4}})]],
    ['ses_child',[user('ses_child','msg_child','Task prompt'),assistant('ses_child','msg_child_done','msg_child',{agent:'pulso-explorer'})]],
  ]);
  const requests=[],host={statusMap:{}};
  const client={session:{
    async get(input){requests.push(['get',input]);const value=sessions.get(input.sessionID);if(!value)throw new Error('404');return structuredClone(value);},
    message:{async get(input){requests.push(['message',input]);const value=messages.get(input.sessionID)?.find(value=>value.id===input.messageID);if(!value)throw new Error('404');return structuredClone(value);}},
    async active(input){requests.push(['active',input]);if(host.statusError)throw new Error('unreachable');return structuredClone(host.statusMap);},
  },message:{async list(input){requests.push(['messages',input]);const all=messages.get(input.sessionID);const start=input.cursor?Number(input.cursor):0;const data=all?.slice(start,start+input.limit);return {data:structuredClone(data),cursor:{...(start+input.limit<all.length?{next:String(start+input.limit)}:{})}}}}};
  const native={app:{name:'opencode',version:'2.1.2'},session:{get:input=>client.session.get(input)},options:{}};
  const {createNativeReader}=await load('plugin/native-read.mjs');
  const reader=await createNativeReader(native,{client});
  const context={sessionID:'ses_new',messageID:'msg_new_assistant',agent:'pulso',id:'call_current',signal:new AbortController().signal};
  const invoke = (name, args, sessionID = 'ses_old') => executeTool(name, args, {projectRoot: root, homeDir: path.join(base, 'home'), resourceRoot: path.join(runtime, 'resources'), nativeContext: {sessionID}});
  const call = async (name, args, sessionID) => {const result = await invoke(name, args, sessionID);assert.equal(result.ok, true, JSON.stringify(result));return result.data;};
  let continuity;
  if (prepare) {
    await call('pulso_workspace', {action: 'prepare'});
    await call('pulso_work', {action: 'create', workId: 'W', title: 'Validation', objective: 'Fix validation', criterion: 'Correct behavior', verification: 'Review'});
    continuity = await call('pulso_workspace', {action: 'bind_continuity', workId: 'W', requestKey: 'bind', objective: 'Fix validation', repositories: ['.'], constraints: ['Do not publish'], sourceText: 'FORGED MODEL SOURCE MUST NOT AUTHORIZE'});
  }
  const policy = policyModule.createRecoveryPolicy({directory: root, reader});
  const hook = async () => {const event={sessionID:'ses_new',agent:'pulso',system:[],messages:[{id:'msg_new_user',role:'user',content:[{type:'text',text:'Hola'}]}]};await policy.context(event);return event;};
  const args = () => {const item = discovery.discoverContinuities(root).candidates[0];return {workId: item.workId, continuityId: item.continuityId, expectedResumeBasis: item.resumeBasis};};
  return {root, runtime, load, core, registry, discovery, policyModule, policy, sessions, messages, host, requests, client, reader, native, context, continuity, invoke, call, hook, args};
}
async function durableAttempt(f) {
  await f.call('pulso_work', {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'task.add', task: {id: 'T', title: 'Inspect', criterionIds: ['AC-1'], agent: 'pulso-explorer', status: 'pending', dependsOn: [], writeScope: [], resources: [], acceptance: ['Report']}}]});
  const prepare = {action: 'prepare_delegation', contractVersion: 2, workId: 'W', expectedRevision: 2, continuityId: f.continuity.continuityId, intentRevision: 1, requestKey: 'prepare', taskIds: ['T'], objective: 'Inspect', inputs: [], output: 'conversation', constraints: [], templateId: 'exploration'};
  const prepared = await f.call('pulso_work', prepare);
  f.registry.recordNativeDispatch(f.root, {workId: 'W', delegationId: prepared.delegationId, sessionID: 'ses_old', callID: 'call_old', agent: prepared.agent, prompt: prepared.specialistPrompt});
  const part = {id:'call_old',type:'tool',name:'subagent',executed:false,state:{status:'completed',input:{prompt:prepared.specialistPrompt,agent:prepared.agent},content:[{type:'text',text:'<subagent sessionID="ses_child" state="completed">\nVerified findings\n</subagent>'}],metadata:{sessionID:'ses_child',status:'completed',truncated:false}},time:{created:1,ran:1,completed:2}};
  return {prepare, prepared, part, read: () => f.registry.readDelegation(f.root, {workId: 'W', delegationId: prepared.delegationId})};
}
async function failedChild(f) {
  const task = await durableAttempt(f);
  delete f.messages.get('ses_old')[1].error;f.sessions.get('ses_old').outcome='succeeded';f.sessions.get('ses_child').outcome='failed';f.messages.get('ses_child').splice(1);
  task.part.state.status = 'error';task.part.state.error = 'Child API request failed';delete task.part.state.output;
  f.messages.get('ses_old')[1].content.push(task.part);
  f.messages.get('ses_child').push(assistant('ses_child', 'msg_child_error', 'msg_child', {agent: task.prepared.agent, error:{type:'provider',message:'Network failure'}}));
  return task;
}
async function runtimePlugin(f) {
  for (const [sourceFile, target] of Object.entries(adapterConfig.runtimeFiles)) {
    fs.mkdirSync(path.dirname(path.join(f.runtime, target)), {recursive: true});
    fs.copyFileSync(path.join(source, 'harness', sourceFile), path.join(f.runtime, target));
  }
  fs.cpSync(path.join(source, 'harness/vendor'), path.join(f.runtime, 'plugin/vendor'), {recursive: true});
  fs.writeFileSync(path.join(f.runtime, 'package.json'), JSON.stringify(adapterConfig.packageManifest()));
  const {createPulsoPlugin}=await f.load('plugin/index.mjs');
  const registered={},hooks={},asks=[];
  f.permission=async request=>{asks.push(request)};
  const ctx={app:{name:'opencode',version:'2.1.2'},location:{directory:f.root},options:{},session:{...f.native.session,hook:async(name,callback)=>{hooks[name]=callback}},permission:{assert:request=>f.permission(request)},tool:{transform:async callback=>callback({add:definition=>{registered[definition.name]=definition}}),hook:async(name,callback)=>{hooks[name]=callback}},event:{async *subscribe(){}}};
  const dispose=await createPulsoPlugin({reader:f.reader,homeDir:path.join(f.runtime,'home')}).setup(ctx);
  const plugin={tool:registered,...hooks};
  const invoke=async(name,request)=>(await registered[name].execute({request},f.context)).output;
  return {plugin,asks,invoke,dispose};
}
async function guardedAuto(f, args, proof) {
  const {executeTool} = await f.load('resources/lib/semantic-tools.mjs');
  return executeTool('pulso_workspace', {action: 'resume_continuity', ...args, resumeMode: 'automatic'}, {projectRoot: f.root, homeDir: path.join(f.runtime, 'home'), resourceRoot: path.join(f.runtime, 'resources'), nativeContext: {sessionID: f.context.sessionID, messageID: f.context.messageID}, authorization: {kind: 'primary', projectRoot: f.root, sessionID: f.context.sessionID, agent: 'pulso'}, automaticRecovery: {proof, assertProof: (value, input) => f.policy.assertProof(value, input, f.context)}});
}

test('read-only hook discovers an interrupted owner with the real empty idle status map', async t => {
  const f = await fixture(t), before = snapshot(f.root), nativeBefore = structuredClone(f.messages);
  const output = await f.hook(), parts = output.system;
  assert.equal(parts.length,1);assert.equal(parts[0].type,'text');
  assert.match(parts[0].text, /terminal_error/);assert.match(parts[0].text, /"status":"idle"/);
  assert.ok(!parts[0].text.includes('FORGED MODEL SOURCE'));
  assert.deepEqual(f.messages, nativeBefore);assert.deepEqual(snapshot(f.root), before);
  assert.ok(!fs.existsSync(path.join(f.root, '.pulso-write.lock')));
  assert.ok(f.requests.filter(([method]) => method === 'messages').every(([, request]) => request.limit <= 200 && (request.order === 'asc' || request.cursor)));
  await f.policy.context(output);
  assert.equal(output.system.length, 1);
  const native = await runtimePlugin(f);
  assert.equal((await native.invoke('pulso_workspace', {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'})).ok, true);
  await f.policy.context(output);
  assert.equal(output.system.length, 0, 'Do not retain stale ephemeral observations after adoption');
});

test('fresh projects are not prepared; no writes even on a greeting', async t => {
  const f = await fixture(t, {prepare: false});
  const output = await f.hook();assert.equal(output.system.length, 0);assert.deepEqual(fs.readdirSync(f.root), []);
});

test('effective role, ancestry and synthetic background source gate discovery', async t => {
  const f = await fixture(t), before = snapshot(f.root);
  for (const mode of ['other_agent', 'child', 'synthetic', 'ignored', 'foreign_root']) {
    const session = f.sessions.get('ses_new'), message = f.messages.get('ses_new')[0];
    if (mode === 'other_agent') session.agent='build';
    if (mode === 'child') session.parentID = 'ses_old';
    if (mode === 'synthetic') message.type='synthetic';
    if (mode === 'ignored') message.type='compaction';
    if (mode === 'foreign_root') session.location.directory = f.runtime;
    assert.equal((await f.hook()).system.length, 0, mode);
    session.agent='pulso';delete session.parentID;message.type='user';session.location.directory=f.root;
  }
  assert.deepEqual(snapshot(f.root), before);
});

test('busy/retry, idle without failure, cancellation and unavailable host never qualify', async t => {
  const f = await fixture(t), error = f.messages.get('ses_old')[1];
  for (const type of ['busy', 'retry']) {
    f.host.statusMap={ses_old:{type:'running'}};error.retry=type==='retry'?{attempt:1}:undefined;
    const observation = await f.policy.inspectInvocation(f.context);
    assert.equal(f.policyModule.recoveryDecision(observation, 'compatible').eligible, false);
  }
  f.host.statusMap = {};delete error.error;
  assert.equal(f.policyModule.recoveryDecision(await f.policy.inspectInvocation(f.context), 'compatible').eligible, false);
  error.error = {type:'interrupted',message:'User aborted'};f.sessions.get('ses_old').outcome='interrupted';
  assert.equal((await f.policy.inspectInvocation(f.context)).owner.interruption, 'user_abort');
  error.error = {type:'provider',message:'Network'};f.sessions.get('ses_old').outcome='failed';
  f.host.statusError = true;
  assert.equal((await f.policy.inspectInvocation(f.context)).owner.status, 'unknown');
  f.host.statusError = false;f.sessions.delete('ses_old');
  assert.equal((await f.policy.inspectInvocation(f.context)).owner.status, 'unknown');
});

test('source proof is linked through the invoking assistant to the latest authentic user', async t => {
  const f = await fixture(t);
  const proof = await f.policyModule.nativePrimaryRequest(f.reader, f.context, f.root);
  assert.equal(proof.request.userMessageID, 'msg_new_user');assert.equal(proof.request.text, 'Hola');
  f.messages.get('ses_new').push(user('ses_new', 'msg_newer', 'Cancela el objetivo anterior.'));
  await assert.rejects(f.policyModule.nativePrimaryRequest(f.reader, f.context, f.root), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
  assert.equal((await f.hook()).system.length, 0);
});

test('semantic new goal/pause/cancel is not guessed from text or overridden by stored hints', async t => {
  const f = await fixture(t), observation = await f.policy.inspectInvocation(f.context);
  assert.equal(f.policyModule.recoveryDecision(observation).reason, 'review_required');
  assert.equal(f.policyModule.recoveryDecision(observation, 'compatible').eligible, true);
  for (const disposition of ['new_goal', 'pause', 'cancel', 'status_only']) {
    assert.deepEqual(f.policyModule.recoveryDecision(observation, disposition), {eligible: false, reason: disposition});
    await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition}));
  }
});

test('multiple active continuities are ambiguous, not selected by recency or focus', async t => {
  const f = await fixture(t);
  await f.call('pulso_workspace', {action: 'bind_continuity', workId: 'W', requestKey: 'another', objective: 'Other active goal', repositories: ['.'], constraints: []});
  const observation = await f.policy.inspectInvocation(f.context);
  assert.equal(observation.candidates.length, 2);
  assert.equal(f.policyModule.recoveryDecision(observation, 'compatible').reason, 'ambiguous');
  assert.match((await f.hook()).system[0].text, /Other active goal/);
});

test('paused, cancelled and closed-cycle Works are excluded without mutation', async t => {
  const f = await fixture(t);
  await f.call('pulso_work', {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'work.set_overview', status: 'paused'}]});
  let before = snapshot(f.root);assert.equal(f.discovery.discoverContinuities(f.root).candidates.length, 0);assert.deepEqual(snapshot(f.root), before);
  await f.call('pulso_work', {action: 'close', workId: 'W', expectedRevision: 2, outcome: 'cancelled', summary: 'User cancelled', limitations: []});
  before = snapshot(f.root);assert.equal(f.discovery.discoverContinuities(f.root).candidates.length, 0);assert.deepEqual(snapshot(f.root), before);
});

test('private proof cannot be forged, copied, redirected or replayed after changed intent', async t => {
  const f = await fixture(t), args = f.args(), before = snapshot(f.root);
  const proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
  assert.equal(proof.physicalCessation, 'unknown');assert.equal(proof.source.userMessageID, 'msg_new_user');
  assert.ok(!JSON.stringify(proof).includes('Hola'));assert.deepEqual(snapshot(f.root), before);
  assert.equal(f.policy.assertProof(proof, args, f.context), true);
  assert.throws(() => f.policy.assertProof({...proof}, args, f.context), /prueba privada/);
  assert.throws(() => f.policy.assertProof(proof, {...args, workId: 'OTHER'}, f.context), /ajena/);
  await f.call('pulso_workspace', {action: 'update_intent', continuityId: f.continuity.continuityId, expectedRevision: 1, objective: 'New restriction', constraints: ['Do not execute']});
  assert.throws(() => f.policy.assertProof(proof, args, f.context), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
});

test('discovery bounds fail closed instead of selecting from a partial candidate set', async t => {
  const f = await fixture(t);
  const result = f.discovery.discoverContinuities(f.root, {maxRecords: 0});
  assert.equal(result.complete, false);assert.equal(result.candidates.length, 0);
  const limited = f.policyModule.createRecoveryPolicy({directory: f.root, reader: f.reader, maxMessages: 1});
  await assert.rejects(limited.inspectInvocation(f.context), /límite/);
});

test('old terminal error followed by new host activity is not an orphan signal', async t => {
  const f = await fixture(t);
  f.messages.get('ses_old').push(user('ses_old', 'msg_owner_new', 'Keep working here'));
  const observation = await f.policy.inspectInvocation(f.context);
  assert.equal(observation.owner.interruption, 'unknown');
  assert.equal(f.policyModule.recoveryDecision(observation, 'compatible').eligible, false);
});

test('logical owner adoption preserves unresolved attempt and overlapping dispatch blockade', async t => {
  const f = await fixture(t);
  const {prepare, prepared, part} = await durableAttempt(f);
  part.state.status = 'running';f.messages.get('ses_old')[1].content.push(part);
  const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
  f.policy.assertProof(proof, args, f.context);
  const resumed = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
  assert.equal(resumed.ok, true);
  const record = f.registry.readDelegation(f.root, {workId: 'W', delegationId: prepared.delegationId});
  assert.equal(record.attempts[0].resolution, 'unresolved');assert.equal(record.reservationResolved, false);
  const duplicate = await f.invoke('pulso_work', {...prepare, requestKey: 'repeat'}, 'ses_new');
  assert.equal(duplicate.error.code, 'DELEGATION_NATIVE_UNRESOLVED');
  let replayed = 0;
  await assert.rejects(f.policy.replayStoredReturns(proof, {ok: false}, async () => {replayed++;}));
  const recovery = await f.policy.replayStoredReturns(proof, resumed, async () => {replayed++;});
  assert.equal(recovery.ownerTransferred, true);assert.equal(recovery.pending.length, 1);assert.equal(replayed, 0);
});

test('new request arriving during native inspection invalidates automatic proof', async t => {
  const f = await fixture(t), original = f.client.session.active;
  f.client.session.active = async input => {
    const result = await original(input);
    f.messages.get('ses_new').push(user('ses_new', 'msg_new_goal', 'Ahora solo quiero una explicación; no modifiques nada.'));
    return result;
  };
  const before = snapshot(f.root);
  await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
  assert.deepEqual(snapshot(f.root), before);
});

test('known host activity appearing during final source authentication invalidates proof', async t => {
  const f = await fixture(t), original = f.client.session.message.get;let assistantReads = 0;
  f.client.session.message.get = async input => {
    const response = await original(input);
    if (input.messageID === 'msg_new_assistant' && ++assistantReads === 2) f.host.statusMap.ses_old = {type:'running'};
    return response;
  };
  await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
});

test('native primary source rejects title/summarizer, foreign message parts and duplicate history', async t => {
  for (const mode of ['title', 'summary', 'foreign_part', 'duplicate_history', 'api_error_shape']) {
    const f = await fixture(t), messages = f.messages.get('ses_new');
    if (mode === 'title') messages[1].agent = 'title';
    if (mode === 'summary') messages[1].type='compaction';
    if (mode === 'foreign_part') f.client.session.message.get=async()=>({...messages[1],id:'msg_foreign'});
    if (mode === 'duplicate_history') messages.push(structuredClone(messages[0]));
    if (mode === 'api_error_shape') f.client.session.get = async () => ({error: {name: 'NotFoundError'}, data: f.sessions.get('ses_new')});
    await assert.rejects(f.policyModule.nativePrimaryRequest(f.reader, f.context, f.root), undefined, mode);
  }
});

test('context hook ignores helper agents and non-user triggers; no compaction hook is registered',async t=>{
  for(const mode of ['compaction_history','synthetic','title']){
    const f=await fixture(t),output={sessionID:'ses_new',agent:'pulso',system:[],messages:[{id:'msg_new_user',role:'user',content:[{type:'text',text:'Hola'}]}]};
    if(mode==='compaction_history')f.messages.get('ses_new').push({id:'msg_compaction',type:'compaction',status:'completed',summary:'Summary'});
    if(mode==='synthetic')f.messages.get('ses_new').push({id:'msg_synthetic',type:'synthetic',text:'Background complete'});
    if(mode==='title')output.agent='title';
    const before=structuredClone(output);await f.policy.context(output);assert.deepEqual(output,before,mode);
    const native=await runtimePlugin(f);assert.equal(native.plugin.compaction,undefined);
  }
});

test('legacy native conversation includes context for approval without trusting sourceText', async t => {
  const f = await fixture(t);
  const explanation = assistant('ses_old', 'msg_scope', 'msg_old_user');
  explanation.content = [{id: 'prt_scope', sessionID: 'ses_old', messageID: 'msg_scope', type: 'text', text: 'Haré la corrección ya solicitada, sin publicar.'}];
  f.messages.get('ses_old').splice(1, 0, explanation, user('ses_old', 'msg_approval', 'Sí, procede.'));
  const observation = await f.policy.inspectInvocation(f.context);
  assert.ok(observation.historicalContext.some(value => value.role === 'assistant' && value.text.includes('sin publicar')));
  assert.ok(observation.historicalContext.some(value => value.role === 'user' && value.text === 'Sí, procede.'));
  assert.equal(observation.candidates[0].intentSource, undefined);
  assert.ok(!JSON.stringify(observation).includes('FORGED MODEL SOURCE'));
});

test('historical exact native terminal replay repairs capture after restart, never from detection', async t => {
  const f = await fixture(t), task = await durableAttempt(f);
  f.messages.get('ses_old')[1].content.push(task.part);
  const before = snapshot(f.root);await f.hook();assert.deepEqual(snapshot(f.root), before);
  assert.equal(task.read().returns.length, 0);
  const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
  const resumed = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs'), hooks = createDurableHooks({directory: f.root,reader:f.reader});
  const replay = payload => hooks.replay(payload);
  const captured = await f.policy.replayStoredReturns(proof, resumed, replay);
  assert.equal(captured.stored.length, 1);assert.equal(captured.pending.length, 0);
  assert.equal(task.read().returns.length, 1);assert.equal(task.read().attempts[0].resolution, 'host_terminal');
  assert.equal(task.read().returns[0].markdown, task.part.state.content[0].text);
  assert.equal(task.read().accepted, null);
  const again = await f.policy.replayStoredReturns(proof, resumed, replay);
  assert.equal(again.stored.length, 0);assert.equal(task.read().returns.length, 1);
});

test('capture mutex failure preserves successful ownership and original lock; safe retry does not redispatch', async t => {
  const f = await fixture(t), task = await durableAttempt(f);
  f.messages.get('ses_old')[1].content.push(task.part);
  const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
  const resumed = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs'), hooks = createDurableHooks({directory: f.root,reader:f.reader});
  const replay = payload => hooks.replay(payload);
  const lock = path.join(f.root, '.pulso-write.lock');fs.mkdirSync(lock);fs.writeFileSync(path.join(lock, 'owner.json'), '{"fixture":"busy"}');
  const result = await f.policy.replayStoredReturns(proof, resumed, replay);
  assert.equal(result.ownerTransferred, true);assert.equal(result.pending[0].code, 'METADATA_BUSY');
  assert.equal(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'), '{"fixture":"busy"}');
  assert.equal(f.core.readContinuity(f.root, f.continuity.continuityId, {skipOwner: true}).ownerSessionID, 'ses_new');
  assert.equal(task.read().attempts[0].resolution, 'unresolved');
  fs.rmSync(lock, {recursive: true}); // Release only our test-created mutex.
  assert.equal((await f.policy.replayStoredReturns(proof, resumed, replay)).stored.length, 1);
  assert.equal(task.read().attempts.length, 1);
});

test('background running wrapper or mismatched child metadata never resolves a historical attempt', async t => {
  for (const mode of ['running', 'child_mismatch', 'error', 'duplicate_call']) {
    const f = await fixture(t), task = await durableAttempt(f);
    f.messages.get('ses_old')[1].content.push(task.part);
    const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
    const resumed = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
    if (mode === 'running') task.part.state.metadata.status='running';
    if (mode === 'child_mismatch') task.part.state.metadata.sessionID = 'ses_other';
    if (mode === 'error') task.part.state.status = 'error';
    if(mode==='duplicate_call')f.messages.get('ses_old')[1].content.push(structuredClone(task.part));
    const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs'), hooks = createDurableHooks({directory: f.root,reader:f.reader});
    const result = await f.policy.replayStoredReturns(proof, resumed, payload => hooks.replay(payload));
    assert.equal(result.stored.length, 0, mode);assert.equal(result.pending.length, 1, mode);
    assert.equal(task.read().attempts[0].resolution, 'unresolved', mode);assert.equal(task.read().returns.length, 0, mode);
  }
});

test('exact terminal child failure can recover idle coordination without resolving unknown command execution', async t => {
  const f = await fixture(t), task = await failedChild(f);
  f.messages.get('ses_child')[1].content.push({id:'call_child_bash', messageID: 'msg_child_error', type:'tool',name:'shell', state: {status: 'running', input: {command: 'long-running-check'}, time: {start: 1}}});
  const before = snapshot(f.root), observation = await f.policy.inspectInvocation(f.context);
  assert.equal(observation.owner.interruption, 'terminal_child_error');assert.equal(observation.owner.status, 'idle');
  assert.equal(observation.childSignals[0].hostToolsAllTerminal, false);
  assert.deepEqual(observation.childSignals[0].nonterminalTools, [{tool:'shell', callID: 'call_child_bash', status: 'running'}]);
  assert.equal(observation.childSignals[0].physicalCessation, 'unknown');assert.deepEqual(snapshot(f.root), before);
  const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
  const receipt = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
  let captures = 0;const replay = await f.policy.replayStoredReturns(proof, receipt, () => {captures++;});
  assert.equal(replay.ownerTransferred, true);assert.equal(replay.pending.length, 1);assert.equal(captures, 0);
  assert.equal(task.read().attempts[0].resolution, 'unresolved');assert.equal(task.read().returns.length, 0);
  const blocked = await f.invoke('pulso_work', {...task.prepare, requestKey: 'no-overlap'}, 'ses_new');
  assert.equal(blocked.error.code, 'DELEGATION_NATIVE_UNRESOLVED');
});

test('child failure proof rejects activity, cancellations, changed request and untrusted correlation', async t => {
  for (const mode of ['child_busy', 'child_retry', 'parent_busy', 'parent_abort', 'child_abort', 'no_child_error', 'new_child_user', 'new_parent_user', 'wrong_parent', 'wrong_project', 'wrong_agent', 'wrong_metadata', 'duplicate_child', 'task_prose_only']) {
    const f = await fixture(t), task = await failedChild(f), childError = f.messages.get('ses_child')[1];
    if (mode === 'child_busy') f.host.statusMap.ses_child = {type:'running'};
    if (mode === 'child_retry') f.host.statusMap.ses_child = {type:'running'};
    if (mode === 'parent_busy') f.host.statusMap.ses_old = {type:'running'};
    if(mode==='parent_abort'){f.messages.get('ses_old')[1].error={type:'interrupted',message:'Cancelled'};f.sessions.get('ses_old').outcome='interrupted';}
    if(mode==='child_abort'){childError.error={type:'interrupted',message:'Cancelled'};f.sessions.get('ses_child').outcome='interrupted';}
    if (mode === 'no_child_error') delete childError.error;
    if (mode === 'new_child_user') f.messages.get('ses_child').push(user('ses_child', 'msg_child_new', 'Changed instruction'));
    if (mode === 'new_parent_user') f.messages.get('ses_old').push(user('ses_old', 'msg_parent_cancel', 'Stop this work'));
    if (mode === 'wrong_parent') f.sessions.get('ses_child').parentID = 'ses_unrelated';
    if (mode === 'wrong_project') f.sessions.get('ses_child').projectID = 'another-project';
    if (mode === 'wrong_agent') childError.agent = 'build';
    if(mode==='wrong_metadata')task.part.state.metadata.sessionID='ses_unrelated';
    if (mode === 'duplicate_child') f.messages.get('ses_old')[1].content.push({...task.part, id: 'prt_other_link', callID: 'call_other_link'});
    if (mode === 'task_prose_only') f.sessions.delete('ses_child');
    const observation = await f.policy.inspectInvocation(f.context);
    assert.equal(f.policyModule.recoveryDecision(observation, 'compatible').eligible, false, mode);
    assert.equal(task.read().attempts[0].resolution, 'unresolved', mode);
  }
});

test('all child host tools terminal is a diagnostic, not fabricated return or physical cessation', async t => {
  const f = await fixture(t), task = await failedChild(f);
  f.messages.get('ses_child')[1].content.push({id:'call_child_bash', messageID: 'msg_child_error', type:'tool',name:'shell', state: {status: 'completed', input: {command: 'check'}, output: 'done', time: {start: 1, end: 2}}});
  const observation = await f.policy.inspectInvocation(f.context);
  assert.equal(observation.childSignals[0].hostToolsAllTerminal, true);
  assert.equal(observation.childSignals[0].physicalCessation, 'unknown');
  assert.equal(task.read().attempts[0].resolution, 'unresolved');assert.equal(task.read().returns.length, 0);
});

test('parent terminal error never overrides a known busy/retry child or child cancellation', async t => {
  for (const mode of ['busy', 'retry', 'cancelled', 'unknown']) {
    const f = await fixture(t);await failedChild(f);
    f.messages.get('ses_old')[1].error = {type:'provider',message:'Parent failure'};
    if(mode==='cancelled'){f.messages.get('ses_child')[1].error={type:'interrupted',message:'User cancelled'};f.sessions.get('ses_child').outcome='interrupted';}
    else if (mode === 'unknown') f.sessions.delete('ses_child');
    else f.host.statusMap.ses_child={type:'running'};
    assert.equal(f.policyModule.recoveryDecision(await f.policy.inspectInvocation(f.context), 'compatible').eligible, false, mode);
    await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}));
  }
});

test('old owner receiving a later user request during final source authentication invalidates proof', async t => {
  const f = await fixture(t), original = f.client.session.message.get;let assistantReads = 0;
  f.client.session.message.get = async input => {
    const response = await original(input);
    if (input.messageID === 'msg_new_assistant' && ++assistantReads === 2) f.messages.get('ses_old').push(user('ses_old', 'msg_old_cancel', 'Stop all work'));
    return response;
  };
  await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
});

test('installed plugin ordinary greeting observes and permissioned automatic action adopts without special command', async t => {
  const f = await fixture(t), native = await runtimePlugin(f), before = snapshot(f.root);
  const output={sessionID:'ses_new',agent:'pulso',system:[],messages:[{id:'msg_new_user',role:'user',content:[{type:'text',text:'Hola'}]}]};
  await native.plugin.context(output);
  assert.match(output.system.at(-1).text, /Observación de continuidad/);assert.deepEqual(snapshot(f.root), before);
  f.requests.length = 0;
  f.permission = async request => {assert.ok(f.requests.every(([method])=>method==='get'),'only native project identity may be read before permission');native.asks.push(request);};
  const args = {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'};
  const receipt = await native.invoke('pulso_workspace', args);
  assert.equal(receipt.ok, true, JSON.stringify(receipt));assert.equal(receipt.data.ownerSessionID, 'ses_new');
  assert.equal(receipt.data.recovery.ownerTransferred, true);assert.equal(receipt.data.recovery.capturePending, false);
  assert.deepEqual(native.asks[0], {sessionID:'ses_new',agent:'pulso',action:'pulso_workspace',resources:['resume_continuity:W'],save:['resume_continuity:W'],source:{type:'tool',messageID:'msg_new_assistant',id:'call_current'},metadata:{action:'resume_continuity',resource:'W',mutating:true}});
  const history = f.core.readContinuity(f.root, f.continuity.continuityId, {skipOwner: true}).history;
  assert.equal(history.length, 1);assert.equal(history[0].resumeMode, 'automatic');
  assert.equal(history[0].requestSource.userMessageID, 'msg_new_user');assert.equal(history[0].requestSource.text, undefined);
  assert.ok(!JSON.stringify(history).includes('Hola'));
});

test('automatic lost response replays exact applied transition once, never a later user request or goal', async t => {
  const f = await fixture(t), native = await runtimePlugin(f), args = {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'};
  assert.equal((await native.invoke('pulso_workspace', args)).ok, true);
  const after = snapshot(f.root);
  // The host is busy running this current request; receipt replay is not adoption.
  f.host.statusMap.ses_new = {type:'running'};
  const replay = await native.invoke('pulso_workspace', args);
  assert.equal(replay.ok, true, JSON.stringify(replay));assert.equal(replay.data.duplicate, true);assert.deepEqual(snapshot(f.root), after);
  await f.call('pulso_workspace', {action: 'bind_continuity', workId: 'W', requestKey: 'unrelated-after-resume', objective: 'Unrelated', repositories: ['.'], constraints: []});
  const withOther = snapshot(f.root), again = await native.invoke('pulso_workspace', args);
  assert.equal(again.ok, true, JSON.stringify(again));assert.equal(again.data.duplicate, true);assert.deepEqual(snapshot(f.root), withOther);
  f.messages.get('ses_new').push(user('ses_new', 'msg_newer_user', 'New goal'), assistant('ses_new', 'msg_newer_assistant', 'msg_newer_user'));
  f.context.messageID = 'msg_newer_assistant';
  assert.equal((await native.invoke('pulso_workspace', args)).ok, false);assert.deepEqual(snapshot(f.root), withOther);
});

test('automatic post-CAS capture failure reports partial success and repeats capture without redispatch', async t => {
  const f = await fixture(t), task = await durableAttempt(f), native = await runtimePlugin(f);
  f.messages.get('ses_old')[1].content.push(task.part);
  const original = f.client.message.list, lock = path.join(f.root, '.pulso-write.lock');let oldReads = 0;
  f.client.message.list = async input => {
    const response = await original(input);
    if (input.sessionID === 'ses_old' && ++oldReads === 3) {
      assert.equal(f.core.readContinuity(f.root, f.continuity.continuityId, {skipOwner: true}).ownerSessionID, 'ses_new');
      fs.mkdirSync(lock);fs.writeFileSync(path.join(lock, 'owner.json'), '{"fixture":"capture-busy"}');
    }
    return response;
  };
  const args = {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'}, receipt = await native.invoke('pulso_workspace', args);
  assert.equal(receipt.ok, true, JSON.stringify(receipt));assert.equal(receipt.data.recovery.ownerTransferred, true);
  assert.equal(receipt.data.recovery.capturePending, true);assert.equal(receipt.data.recovery.pending[0].code, 'METADATA_BUSY');
  assert.equal(task.read().attempts[0].resolution, 'unresolved');assert.equal(task.read().returns.length, 0);
  fs.rmSync(lock, {recursive: true}); // Only the mutex created by this test.
  const replay = await native.invoke('pulso_workspace', args);
  assert.equal(replay.ok, true, JSON.stringify(replay));assert.equal(replay.data.duplicate, true);assert.equal(replay.data.recovery.capturePending, false);
  assert.equal(task.read().returns.length, 1);assert.equal(task.read().attempts.length, 1);assert.equal(task.read().accepted, null);
  assert.equal(f.core.readContinuity(f.root, f.continuity.continuityId, {skipOwner: true}).history.length, 1);
});

test('automatic core guard requires private proof and rechecks canonical uniqueness and active state under mutex', async t => {
  for (const mode of ['missing_proof', 'paused', 'second_candidate', 'changed_intent', 'mutex']) {
    const f = await fixture(t), args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
    if (mode === 'paused') await f.call('pulso_work', {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'work.set_overview', status: 'paused'}]});
    if (mode === 'second_candidate') await f.call('pulso_workspace', {action: 'bind_continuity', workId: 'W', requestKey: 'second', objective: 'Different objective', repositories: ['.'], constraints: []});
    if (mode === 'changed_intent') await f.call('pulso_workspace', {action: 'update_intent', continuityId: f.continuity.continuityId, expectedRevision: 1, objective: 'Changed goal', constraints: []});
    if (mode === 'mutex') fs.mkdirSync(path.join(f.root, '.pulso-write.lock'));
    const before = snapshot(f.root), receipt = mode === 'missing_proof' ? await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args, resumeMode: 'automatic'}, 'ses_new') : await guardedAuto(f, args, proof);
    assert.equal(receipt.ok, false, mode);assert.deepEqual(snapshot(f.root), before, mode);
    assert.equal(f.core.readContinuity(f.root, f.continuity.continuityId, {skipOwner: true}).ownerSessionID, 'ses_old', mode);
  }
});

test('automatic denial/cancellation and activity during permission never adopt or capture', async t => {
  for (const mode of ['denied', 'cancelled', 'busy_after_ask']) {
    const f = await fixture(t), native = await runtimePlugin(f), before = snapshot(f.root);
    const controller = new AbortController();f.context.signal = controller.signal;
    f.permission = async () => {if (mode === 'denied') throw new Error('permission denied');if (mode === 'cancelled') controller.abort();if (mode === 'busy_after_ask') f.host.statusMap.ses_old = {type:'running'};};
    const invoke = () => native.invoke('pulso_workspace', {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'});
    if (mode === 'busy_after_ask') assert.equal((await invoke()).ok, false);else await assert.rejects(invoke());
    assert.deepEqual(snapshot(f.root), before, mode);
  }
});

test('native intent provenance stores references and hashes, refreshes on update and is optional for legacy', async t => {
  const f = await fixture(t), native = await runtimePlugin(f);
  f.messages.get('ses_new')[0].text = 'Corrige el validador sin publicar.';
  const bound = await native.invoke('pulso_workspace', {action: 'bind_continuity', workId: 'W', requestKey: 'native-source', objective: 'Validation', repositories: ['.'], constraints: ['Do not publish'], sourceText: 'MODEL DECLARATION'});
  assert.equal(bound.ok, true, JSON.stringify(bound));assert.equal(bound.data.intentSource.userMessageID, 'msg_new_user');
  assert.equal(bound.data.intentSource.textHash, f.core.contentHash('Corrige el validador sin publicar.'));assert.equal(bound.data.intentSource.text, undefined);
  const initial = f.core.readContinuity(f.root, bound.data.continuityId, {skipOwner: true}).intentSource;
  f.messages.get('ses_new').push(user('ses_new', 'msg_change', 'Ahora sólo inspecciona.'), assistant('ses_new', 'msg_change_assistant', 'msg_change'));
  f.context.messageID = 'msg_change_assistant';
  const updated = await native.invoke('pulso_workspace', {action: 'update_intent', continuityId: bound.data.continuityId, expectedRevision: 1, objective: 'Inspect only', constraints: ['Read-only']});
  assert.equal(updated.ok, true, JSON.stringify(updated));assert.equal(updated.data.intentSource.userMessageID, 'msg_change');assert.equal(updated.data.intentSource.intentRevision, 2);
  const current = f.core.readContinuity(f.root, bound.data.continuityId, {skipOwner: true});assert.deepEqual(current.history[0].intentSource, initial);
  assert.equal(f.core.readContinuity(f.root, f.continuity.continuityId, {skipOwner: true}).intentSource, undefined);
});

test('compatible older-intent and retired unresolved children still veto known activity', async t => {
  const f = await fixture(t), task = await failedChild(f);
  f.messages.get('ses_old')[1].error = {type:'provider',message:'Parent failure'};
  await f.call('pulso_workspace', {action: 'update_intent', continuityId: f.continuity.continuityId, expectedRevision: 1, objective: 'Compatible update', constraints: [], compatibleDelegationIds: [task.prepared.delegationId]});
  f.host.statusMap.ses_child = {type:'running'};
  const observed = await f.policy.inspectInvocation(f.context);
  assert.equal(observed.childSignals.length, 1);assert.equal(observed.childSignals[0].currentIntent, true);
  assert.equal(f.policyModule.recoveryDecision(observed, 'compatible').reason, 'child_active');
  await f.call('pulso_work', {action: 'reconcile_delegation', workId: 'W', delegationId: task.prepared.delegationId, continuityId: f.continuity.continuityId, intentRevision: 2, reason: 'Retired, not stopped', resolution: 'retired'});
  const retired = await f.policy.inspectInvocation(f.context);
  assert.equal(retired.childSignals.length, 1);assert.equal(retired.childSignals[0].currentIntent, false);
  assert.equal(f.policyModule.recoveryDecision(retired, 'compatible').reason, 'child_active');
});

test('missing automatic SDK capability does not block the existing explicit recovery path', async t => {
  const f = await fixture(t), native = await runtimePlugin(f), args = {action: 'resume_continuity', ...f.args()}, before = snapshot(f.root);
  delete f.client.session.active;
  const unavailable = await native.invoke('pulso_workspace', {...args, resumeMode: 'automatic'});
  assert.equal(unavailable.ok, false);assert.deepEqual(snapshot(f.root), before);
  const explicit = await native.invoke('pulso_workspace', {...args, resumeMode: 'explicit'});
  assert.equal(explicit.ok, true, JSON.stringify(explicit));assert.equal(explicit.data.ownerSessionID, 'ses_new');
});

test('full native transcript survives compaction and a fresh recovery instance without duplicate capture',async t=>{
  const f=await fixture(t),task=await durableAttempt(f);
  f.messages.get('ses_old')[1].content.push(task.part);
  f.messages.get('ses_old').push({id:'msg_old_compaction',type:'compaction',status:'completed',summary:'A compacted view deliberately omits the original call.'});
  let contextReads=0;f.native.session.context=async()=>{contextReads++;return []};
  // A new plugin instance has no volatile observer state and still uses full replay.
  const restarted=f.policyModule.createRecoveryPolicy({directory:f.root,reader:f.reader});
  const args=f.args(),proof=await restarted.proveAutomaticResume(f.context,args,{disposition:'compatible'});
  const resumed=await f.invoke('pulso_workspace',{action:'resume_continuity',...args},'ses_new');
  const {createDurableHooks}=await f.load('plugin/durable-hooks.mjs'),hooks=createDurableHooks({directory:f.root,reader:f.reader});
  assert.equal((await restarted.replayStoredReturns(proof,resumed,payload=>hooks.replay(payload))).stored.length,1);
  assert.equal((await restarted.replayStoredReturns(proof,resumed,payload=>hooks.replay(payload))).stored.length,0);
  assert.equal(task.read().attempts.length,1);assert.equal(task.read().returns.length,1);assert.equal(contextReads,0);
});

test('background launch stays unresolved; unique native terminal notification replays after restart',async t=>{
  const f=await fixture(t),task=await durableAttempt(f);
  task.part.state.metadata.status='running';task.part.state.content=[{type:'text',text:'The subagent is working in the background.'}];
  f.messages.get('ses_old')[1].content.push(task.part);
  const args=f.args(),proof=await f.policy.proveAutomaticResume(f.context,args,{disposition:'compatible'});
  const resumed=await f.invoke('pulso_workspace',{action:'resume_continuity',...args},'ses_new');
  const {createDurableHooks}=await f.load('plugin/durable-hooks.mjs'),hooks=createDurableHooks({directory:f.root,reader:f.reader});
  const replay=payload=>hooks.replay(payload);
  assert.equal((await f.policy.replayStoredReturns(proof,resumed,replay)).pending.length,1);
  const literal='<subagent sessionID="ses_child" state="completed" description="Inspect">\nVerified background findings\n</subagent>';
  f.messages.get('ses_old').push({id:'msg_child_notification',type:'synthetic',text:literal,metadata:{source:'subagent',childID:'ses_child',agent:'pulso-explorer',state:'completed'}});
  assert.equal((await f.policy.replayStoredReturns(proof,resumed,replay)).stored.length,1);
  assert.equal(task.read().returns[0].markdown,literal);assert.equal(task.read().attempts.length,1);
  assert.equal((await f.policy.replayStoredReturns(proof,resumed,replay)).stored.length,0);
});

test('background replay rejects ambiguous, running, failed and wrong-agent notifications',async t=>{
  for(const mode of ['duplicate','running','error','wrong_agent']){
    const f=await fixture(t),task=await durableAttempt(f);
    task.part.state.metadata.status='running';f.messages.get('ses_old')[1].content.push(task.part);
    const args=f.args(),proof=await f.policy.proveAutomaticResume(f.context,args,{disposition:'compatible'});
    const resumed=await f.invoke('pulso_workspace',{action:'resume_continuity',...args},'ses_new');
    const message={id:'msg_notice',type:'synthetic',text:'<subagent sessionID="ses_child" state="completed" description="Inspect">\nDone\n</subagent>',metadata:{source:'subagent',childID:'ses_child',agent:mode==='wrong_agent'?'other':'pulso-explorer',state:['running','error'].includes(mode)?mode:'completed'}};
    f.messages.get('ses_old').push(message);if(mode==='duplicate')f.messages.get('ses_old').push({...message,id:'msg_duplicate_notice'});
    let captures=0;const result=await f.policy.replayStoredReturns(proof,resumed,()=>{captures++});
    assert.equal(result.pending.length,1,mode);assert.equal(captures,0,mode);assert.equal(task.read().returns.length,0,mode);
  }
});

test('native reader completes paginated history and rejects overflow, repeated cursor and duplicate IDs',async t=>{
  const f=await fixture(t);
  f.messages.set('ses_new',Array.from({length:401},(_,index)=>user('ses_new',`msg_${index}`,`Message ${index}`)));
  const result=await f.reader.history('ses_new');assert.equal(result.length,401);
  assert.deepEqual(f.requests.filter(([method])=>method==='messages').map(([,input])=>[input.order,input.cursor,input.limit]),[['asc',undefined,200],[undefined,'200',200],[undefined,'400',101]]);
  await assert.rejects(f.reader.history('ses_new',{maxMessages:400}),/límite/);
  f.client.message.list=async()=>({data:[user('ses_new','msg_same','Text')],cursor:{next:'loop'}});
  await assert.rejects(f.reader.history('ses_new'),/Ambiguous|cursor/);
  f.client.message.list=async()=>({data:[],cursor:{next:'empty'}});
  await assert.rejects(f.reader.history('ses_new'),/cursor/);
  f.client.message.list=async()=>({data:[]});await assert.rejects(f.reader.history('ses_new'),/Incomplete/);
});

test('native reader rejects mismatched full-service ancestry/project/root and never treats context as full history',async t=>{
  const f=await fixture(t),{createNativeReader}=await f.load('plugin/native-read.mjs');
  for(const change of [{projectID:'foreign'},{parentID:'ses_other'},{location:{directory:f.runtime}},{agent:'other'}]){
    const reader=await createNativeReader(f.native,{client:{...f.client,session:{...f.client.session,get:async()=>({...f.sessions.get('ses_new'),...change})}}});
    await assert.rejects(reader.history('ses_new'),/does not match/);
  }
  const reader=await createNativeReader(f.native,{client:{session:f.client.session}});
  f.native.session.context=async()=>f.messages.get('ses_new');
  await assert.rejects(reader.history('ses_new')); // Missing full-history API stays unavailable.
});

test('official generated V2 client reads a bound loopback host, no model call or service start',async t=>{
  const f=await fixture(t),{createNativeReader}=await f.load('plugin/native-read.mjs');
  fs.cpSync(path.join(source,'harness/vendor'),path.join(f.runtime,'plugin/vendor'),{recursive:true});
  const requests=[];let version='2.1.2';
  const server=http.createServer((request,response)=>{
    const url=new URL(request.url,'http://localhost');requests.push([request.method,url.pathname]);response.setHeader('content-type','application/json');
    if(url.pathname==='/api/info')return response.end(JSON.stringify({version,pid:process.pid}));
    if(url.pathname==='/api/session/active')return response.end(JSON.stringify({data:{}}));
    if(url.pathname==='/api/session/ses_new')return response.end(JSON.stringify({data:f.sessions.get('ses_new')}));
    if(url.pathname==='/api/session/ses_new/message')return response.end(JSON.stringify({data:f.messages.get('ses_new'),cursor:{}}));
    if(url.pathname==='/api/session/ses_new/message/msg_new_assistant')return response.end(JSON.stringify({data:f.messages.get('ses_new')[1]}));
    response.statusCode=404;response.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const ctx={...f.native,options:{serviceUrl:`http://127.0.0.1:${server.address().port}`}};
  const reader=await createNativeReader(ctx);
  assert.equal((await reader.history('ses_new')).length,2);assert.equal((await reader.getMessage('ses_new','msg_new_assistant')).agent,'pulso');assert.deepEqual(await reader.status(),{});
  assert.ok(requests.every(([method])=>method==='GET'));assert.ok(!requests.some(([,target])=>/prompt|generate/.test(target)));
  version='2.1.3';await assert.rejects((await createNativeReader(ctx)).history('ses_new'),/version/);
  for(const serviceUrl of ['https://example.invalid','http://user:password@localhost','http://127.0.0.1/private'])await assert.rejects((await createNativeReader({...ctx,options:{serviceUrl}})).history('ses_new'),/local origin/);

});
