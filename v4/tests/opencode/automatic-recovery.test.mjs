/** Real core + public SDK-shaped fixtures; not live OpenCode/LLM acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {adapterConfig} from '../../adapters/opencode/build.mjs';

const source = fileURLToPath(new URL('../../', import.meta.url));
const snapshot = root => Object.fromEntries(fs.readdirSync(root, {recursive: true}).sort().filter(file => fs.statSync(path.join(root, file)).isFile()).map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
function user(sessionID, id, text, extra = {}) {
  return {info: {id, sessionID, role: 'user', agent: 'pulso', time: {created: 1}, ...extra}, parts: [{id: `prt_${id}`, sessionID, messageID: id, type: 'text', text}]};
}
function assistant(sessionID, id, parentID, extra = {}) {
  return {info: {id, sessionID, role: 'assistant', mode: 'pulso', parentID, time: {created: 2, completed: 3}, ...extra}, parts: []};
}
async function fixture(t, {prepare = true} = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-auto-recovery-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const runtime = path.join(base, 'runtime'), root = path.join(base, 'project');
  fs.mkdirSync(root);fs.mkdirSync(path.join(runtime, 'plugin'), {recursive: true});
  fs.cpSync(path.join(source, 'core'), path.join(runtime, 'resources'), {recursive: true});
  fs.copyFileSync(path.join(source, 'adapters/opencode/plugin/recovery-policy.mjs'), path.join(runtime, 'plugin/recovery-policy.mjs'));
  for (const file of ['durable-hooks.mjs', 'delegation-observer.mjs']) fs.copyFileSync(path.join(source, 'adapters/opencode/plugin', file), path.join(runtime, 'plugin', file));
  const load = relative => import(pathToFileURL(path.join(runtime, relative)).href);
  const policyModule = await load('plugin/recovery-policy.mjs');
  const {executeTool} = await load('resources/lib/semantic-tools.mjs');
  const core = await load('resources/lib/continuity.mjs');
  const registry = await load('resources/lib/delegation-registry.mjs');
  const discovery = await load('resources/lib/continuity-discovery.mjs');
  const sessions = new Map(['ses_old', 'ses_new', 'ses_child'].map(id => [id, {id, projectID: 'native-project', directory: root, ...(id === 'ses_child' ? {parentID: 'ses_old'} : {})}]));
  const messages = new Map([
    ['ses_old', [user('ses_old', 'msg_old_user', 'Corrige el validador; no publiques.'), assistant('ses_old', 'msg_old_error', 'msg_old_user', {error: {name: 'APIError', data: {message: 'Network failed', isRetryable: false}}})]],
    ['ses_new', [user('ses_new', 'msg_new_user', 'Hola'), assistant('ses_new', 'msg_new_assistant', 'msg_new_user', {time: {created: 4}})]],
    ['ses_child', [user('ses_child', 'msg_child', 'Task prompt')]],
  ]);
  const requests = [], host = {statusMap: {}}; // The real host removes idle entries.
  const client = {session: {
    async get(input) {requests.push(['get', input]);const value = sessions.get(input.path.id);if (!value) throw new Error('404');return {data: structuredClone(value)};},
    async message(input) {requests.push(['message', input]);const value = messages.get(input.path.id)?.find(value => value.info.id === input.path.messageID);if (!value) throw new Error('404');return {data: structuredClone(value)};},
    async messages(input) {requests.push(['messages', input]);const all = messages.get(input.path.id);return {data: structuredClone(input.query.limit ? all?.slice(-input.query.limit) : all)};},
    async status(input) {requests.push(['status', input]);if (host.statusError) throw new Error('unreachable');return {data: structuredClone(host.statusMap)};},
  }};
  const context = {directory: root, sessionID: 'ses_new', messageID: 'msg_new_assistant', agent: 'pulso', abort: new AbortController().signal};
  const invoke = (name, args, sessionID = 'ses_old') => executeTool(name, args, {projectRoot: root, homeDir: path.join(base, 'home'), resourceRoot: path.join(runtime, 'resources'), nativeContext: {sessionID}});
  const call = async (name, args, sessionID) => {const result = await invoke(name, args, sessionID);assert.equal(result.ok, true, JSON.stringify(result));return result.data;};
  let continuity;
  if (prepare) {
    await call('pulso_workspace', {action: 'prepare'});
    await call('pulso_work', {action: 'create', workId: 'W', title: 'Validation', objective: 'Fix validation', criterion: 'Correct behavior', verification: 'Review'});
    continuity = await call('pulso_workspace', {action: 'bind_continuity', workId: 'W', requestKey: 'bind', objective: 'Fix validation', repositories: ['.'], constraints: ['Do not publish'], sourceText: 'FORGED MODEL SOURCE MUST NOT AUTHORIZE'});
  }
  const policy = policyModule.createRecoveryPolicy({directory: root, client});
  const hook = async () => {const output = {messages: structuredClone(messages.get('ses_new'))};await policy['experimental.chat.messages.transform']({}, output);return output;};
  const args = () => {const item = discovery.discoverContinuities(root).candidates[0];return {workId: item.workId, continuityId: item.continuityId, expectedResumeBasis: item.resumeBasis};};
  return {root, runtime, load, core, registry, discovery, policyModule, policy, sessions, messages, host, requests, client, context, continuity, invoke, call, hook, args};
}
async function durableAttempt(f) {
  await f.call('pulso_work', {action: 'update', workId: 'W', expectedRevision: 1, actions: [{type: 'task.add', task: {id: 'T', title: 'Inspect', criterionIds: ['AC-1'], agent: 'pulso-explorer', status: 'pending', dependsOn: [], writeScope: [], resources: [], acceptance: ['Report']}}]});
  const prepare = {action: 'prepare_delegation', contractVersion: 2, workId: 'W', expectedRevision: 2, continuityId: f.continuity.continuityId, intentRevision: 1, requestKey: 'prepare', taskIds: ['T'], objective: 'Inspect', inputs: [], output: 'conversation', constraints: [], templateId: 'exploration'};
  const prepared = await f.call('pulso_work', prepare);
  f.registry.recordNativeDispatch(f.root, {workId: 'W', delegationId: prepared.delegationId, sessionID: 'ses_old', callID: 'call_old', agent: prepared.agent, prompt: prepared.specialistPrompt});
  const part = {id: 'prt_native_task', messageID: 'msg_old_error', sessionID: 'ses_old', type: 'tool', tool: 'task', callID: 'call_old', state: {status: 'completed', input: {prompt: prepared.specialistPrompt, subagent_type: prepared.agent}, output: '<task id="ses_child" state="completed">\n<task_result>Verified findings</task_result>\n</task>', metadata: {parentSessionId: 'ses_old', sessionId: 'ses_child', truncated: false}, time: {start: 1, end: 2}}};
  return {prepare, prepared, part, read: () => f.registry.readDelegation(f.root, {workId: 'W', delegationId: prepared.delegationId})};
}
async function failedChild(f) {
  const task = await durableAttempt(f);
  delete f.messages.get('ses_old')[1].info.error;
  task.part.state.status = 'error';task.part.state.error = 'Child API request failed';delete task.part.state.output;
  f.messages.get('ses_old')[1].parts.push(task.part);
  f.messages.get('ses_child').push(assistant('ses_child', 'msg_child_error', 'msg_child', {agent: task.prepared.agent, error: {name: 'APIError', data: {message: 'Network failure', isRetryable: false}}}));
  return task;
}
async function runtimePlugin(f) {
  for (const [sourceFile, target] of Object.entries(adapterConfig.runtimeFiles)) {
    fs.mkdirSync(path.dirname(path.join(f.runtime, target)), {recursive: true});
    fs.copyFileSync(path.join(source, 'adapters/opencode', sourceFile), path.join(f.runtime, target));
  }
  fs.cpSync(path.join(source, 'adapters/opencode/vendor'), path.join(f.runtime, 'plugin/vendor'), {recursive: true});
  fs.writeFileSync(path.join(f.runtime, 'package.json'), JSON.stringify(adapterConfig.packageManifest()));
  const {PulsoPlugin} = await f.load('plugin/index.mjs');
  const plugin = await PulsoPlugin({directory: f.root, homeDir: path.join(f.runtime, 'home'), client: f.client});
  const asks = [];f.context.ask = async request => {asks.push(request);};
  const invoke = async (name, request) => JSON.parse((await plugin.tool[name].execute({request}, f.context)).output);
  return {plugin, asks, invoke};
}
async function guardedAuto(f, args, proof) {
  const {executeTool} = await f.load('resources/lib/semantic-tools.mjs');
  return executeTool('pulso_workspace', {action: 'resume_continuity', ...args, resumeMode: 'automatic'}, {projectRoot: f.root, homeDir: path.join(f.runtime, 'home'), resourceRoot: path.join(f.runtime, 'resources'), nativeContext: {sessionID: f.context.sessionID, messageID: f.context.messageID}, authorization: {kind: 'primary', projectRoot: f.root, sessionID: f.context.sessionID, agent: 'pulso'}, automaticRecovery: {proof, assertProof: (value, input) => f.policy.assertProof(value, input, f.context)}});
}

test('read-only hook discovers an interrupted owner with the real empty idle status map', async t => {
  const f = await fixture(t), before = snapshot(f.root), nativeBefore = structuredClone(f.messages);
  const output = await f.hook(), parts = output.messages[0].parts;
  assert.equal(parts.length, 2);assert.equal(parts[1].synthetic, true);
  assert.match(parts[1].text, /terminal_error/);assert.match(parts[1].text, /"status":"idle"/);
  assert.ok(!parts[1].text.includes('FORGED MODEL SOURCE'));
  assert.deepEqual(f.messages, nativeBefore);assert.deepEqual(snapshot(f.root), before);
  assert.ok(!fs.existsSync(path.join(f.root, '.pulso-write.lock')));
  for (const [, request] of f.requests) {assert.equal(request.query.directory, f.root);assert.equal(request.throwOnError, true);}
  assert.ok(f.requests.filter(([method]) => method === 'messages').every(([, request]) => request.query.limit === 501));
  await f.policy['experimental.chat.messages.transform']({}, output);
  assert.equal(output.messages[0].parts.filter(part => part.metadata?.pulsoRecovery).length, 1);
  const native = await runtimePlugin(f);
  assert.equal((await native.invoke('pulso_workspace', {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'})).ok, true);
  await f.policy['experimental.chat.messages.transform']({}, output);
  assert.equal(output.messages[0].parts.filter(part => part.metadata?.pulsoRecovery).length, 0, 'Do not retain stale ephemeral observations after adoption');
});

test('fresh projects are not prepared; no writes even on a greeting', async t => {
  const f = await fixture(t, {prepare: false});
  const output = await f.hook();assert.equal(output.messages[0].parts.length, 1);assert.deepEqual(fs.readdirSync(f.root), []);
});

test('effective role, ancestry and synthetic background source gate discovery', async t => {
  const f = await fixture(t), before = snapshot(f.root);
  for (const mode of ['other_agent', 'child', 'synthetic', 'ignored', 'foreign_root']) {
    const session = f.sessions.get('ses_new'), message = f.messages.get('ses_new')[0];
    if (mode === 'other_agent') message.info.agent = 'build';
    if (mode === 'child') session.parentID = 'ses_old';
    if (mode === 'synthetic') message.parts[0].synthetic = true;
    if (mode === 'ignored') message.parts[0].ignored = true;
    if (mode === 'foreign_root') session.directory = f.runtime;
    assert.equal((await f.hook()).messages[0].parts.length, 1, mode);
    message.info.agent = 'pulso';delete session.parentID;delete message.parts[0].synthetic;delete message.parts[0].ignored;session.directory = f.root;
  }
  assert.deepEqual(snapshot(f.root), before);
});

test('busy/retry, idle without failure, cancellation and unavailable host never qualify', async t => {
  const f = await fixture(t), error = f.messages.get('ses_old')[1];
  for (const type of ['busy', 'retry']) {
    f.host.statusMap = {ses_old: {type}};
    const observation = await f.policy.inspectInvocation(f.context);
    assert.equal(f.policyModule.recoveryDecision(observation, 'compatible').eligible, false);
  }
  f.host.statusMap = {};delete error.info.error;
  assert.equal(f.policyModule.recoveryDecision(await f.policy.inspectInvocation(f.context), 'compatible').eligible, false);
  error.info.error = {name: 'MessageAbortedError', data: {message: 'User aborted'}};
  assert.equal((await f.policy.inspectInvocation(f.context)).owner.interruption, 'user_abort');
  error.info.error = {name: 'APIError', data: {isRetryable: false, message: 'Network'}};
  f.host.statusError = true;
  assert.equal((await f.policy.inspectInvocation(f.context)).owner.status, 'unknown');
  f.host.statusError = false;f.sessions.delete('ses_old');
  assert.equal((await f.policy.inspectInvocation(f.context)).owner.status, 'unknown');
});

test('source proof is linked through the invoking assistant to the latest authentic user', async t => {
  const f = await fixture(t);
  const proof = await f.policyModule.nativePrimaryRequest(f.client, f.context, f.root);
  assert.equal(proof.request.userMessageID, 'msg_new_user');assert.equal(proof.request.text, 'Hola');
  f.messages.get('ses_new').push(user('ses_new', 'msg_newer', 'Cancela el objetivo anterior.'));
  await assert.rejects(f.policyModule.nativePrimaryRequest(f.client, f.context, f.root), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
  assert.equal((await f.hook()).messages[0].parts.length, 1);
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
  assert.match((await f.hook()).messages[0].parts[1].text, /Other active goal/);
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
  const limited = f.policyModule.createRecoveryPolicy({directory: f.root, client: f.client, maxMessages: 1});
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
  part.state.status = 'running';f.messages.get('ses_old')[1].parts.push(part);
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
  const f = await fixture(t), original = f.client.session.status;
  f.client.session.status = async input => {
    const result = await original(input);
    f.messages.get('ses_new').push(user('ses_new', 'msg_new_goal', 'Ahora solo quiero una explicación; no modifiques nada.'));
    return result;
  };
  const before = snapshot(f.root);
  await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
  assert.deepEqual(snapshot(f.root), before);
});

test('known host activity appearing during final source authentication invalidates proof', async t => {
  const f = await fixture(t), original = f.client.session.message;let assistantReads = 0;
  f.client.session.message = async input => {
    const response = await original(input);
    if (input.path.messageID === 'msg_new_assistant' && ++assistantReads === 2) f.host.statusMap.ses_old = {type: 'busy'};
    return response;
  };
  await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
});

test('native primary source rejects title/summarizer, foreign message parts and duplicate history', async t => {
  for (const mode of ['title', 'summary', 'foreign_part', 'duplicate_history', 'api_error_shape']) {
    const f = await fixture(t), messages = f.messages.get('ses_new');
    if (mode === 'title') messages[1].info.agent = 'title';
    if (mode === 'summary') messages[1].info.summary = true;
    if (mode === 'foreign_part') messages[0].parts[0].messageID = 'msg_foreign';
    if (mode === 'duplicate_history') messages.push(structuredClone(messages[0]));
    if (mode === 'api_error_shape') f.client.session.get = async () => ({error: {name: 'NotFoundError'}, data: f.sessions.get('ses_new')});
    await assert.rejects(f.policyModule.nativePrimaryRequest(f.client, f.context, f.root), undefined, mode);
  }
});

test('the shared transform does not inject into compaction history or an inactive/helper assistant', async t => {
  for (const mode of ['compaction_history', 'completed', 'summary', 'title']) {
    const f = await fixture(t), output = {messages: structuredClone(f.messages.get('ses_new'))}, current = f.messages.get('ses_new')[1].info;
    if (mode === 'compaction_history') f.messages.get('ses_new').push({info: {id: 'msg_compaction', sessionID: 'ses_new', role: 'user', agent: 'pulso', time: {created: 5}}, parts: [{id: 'prt_compaction', messageID: 'msg_compaction', sessionID: 'ses_new', type: 'compaction', auto: true}]});
    if (mode === 'completed') current.time.completed = 5;
    if (mode === 'summary') current.summary = true;
    if (mode === 'title') current.agent = 'title';
    const before = structuredClone(output);await f.policy['experimental.chat.messages.transform']({}, output);
    assert.deepEqual(output, before, mode);
  }
});

test('legacy native conversation includes context for approval without trusting sourceText', async t => {
  const f = await fixture(t);
  const explanation = assistant('ses_old', 'msg_scope', 'msg_old_user');
  explanation.parts = [{id: 'prt_scope', sessionID: 'ses_old', messageID: 'msg_scope', type: 'text', text: 'Haré la corrección ya solicitada, sin publicar.'}];
  f.messages.get('ses_old').splice(1, 0, explanation, user('ses_old', 'msg_approval', 'Sí, procede.'));
  const observation = await f.policy.inspectInvocation(f.context);
  assert.ok(observation.historicalContext.some(value => value.role === 'assistant' && value.text.includes('sin publicar')));
  assert.ok(observation.historicalContext.some(value => value.role === 'user' && value.text === 'Sí, procede.'));
  assert.equal(observation.candidates[0].intentSource, undefined);
  assert.ok(!JSON.stringify(observation).includes('FORGED MODEL SOURCE'));
});

test('historical exact native terminal replay repairs capture after restart, never from detection', async t => {
  const f = await fixture(t), task = await durableAttempt(f);
  f.messages.get('ses_old')[1].parts.push(task.part);
  const before = snapshot(f.root);await f.hook();assert.deepEqual(snapshot(f.root), before);
  assert.equal(task.read().returns.length, 0);
  const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
  const resumed = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs'), hooks = createDurableHooks({directory: f.root});
  const replay = part => hooks.event({event: {type: 'message.part.updated', properties: {part}}});
  const captured = await f.policy.replayStoredReturns(proof, resumed, replay);
  assert.equal(captured.stored.length, 1);assert.equal(captured.pending.length, 0);
  assert.equal(task.read().returns.length, 1);assert.equal(task.read().attempts[0].resolution, 'host_terminal');
  assert.equal(task.read().returns[0].markdown, task.part.state.output);
  assert.equal(task.read().accepted, null);
  const again = await f.policy.replayStoredReturns(proof, resumed, replay);
  assert.equal(again.stored.length, 0);assert.equal(task.read().returns.length, 1);
});

test('capture mutex failure preserves successful ownership and original lock; safe retry does not redispatch', async t => {
  const f = await fixture(t), task = await durableAttempt(f);
  f.messages.get('ses_old')[1].parts.push(task.part);
  const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
  const resumed = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs'), hooks = createDurableHooks({directory: f.root});
  const replay = part => hooks.event({event: {type: 'message.part.updated', properties: {part}}});
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
    f.messages.get('ses_old')[1].parts.push(task.part);
    const args = f.args(), proof = await f.policy.proveAutomaticResume(f.context, args, {disposition: 'compatible'});
    const resumed = await f.invoke('pulso_workspace', {action: 'resume_continuity', ...args}, 'ses_new');
    if (mode === 'running') task.part.state.output = '<task id="ses_child" state="running">\n<task_result>Still running</task_result>\n</task>';
    if (mode === 'child_mismatch') task.part.state.metadata.sessionId = 'ses_other';
    if (mode === 'error') task.part.state.status = 'error';
    if (mode === 'duplicate_call') f.messages.get('ses_old')[1].parts.push({...task.part, id: 'prt_duplicate'});
    const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs'), hooks = createDurableHooks({directory: f.root});
    const result = await f.policy.replayStoredReturns(proof, resumed, part => hooks.event({event: {type: 'message.part.updated', properties: {part}}}));
    assert.equal(result.stored.length, 0, mode);assert.equal(result.pending.length, 1, mode);
    assert.equal(task.read().attempts[0].resolution, 'unresolved', mode);assert.equal(task.read().returns.length, 0, mode);
  }
});

test('exact terminal child failure can recover idle coordination without resolving unknown command execution', async t => {
  const f = await fixture(t), task = await failedChild(f);
  f.messages.get('ses_child')[1].parts.push({id: 'prt_child_bash', messageID: 'msg_child_error', sessionID: 'ses_child', type: 'tool', tool: 'bash', callID: 'call_child_bash', state: {status: 'running', input: {command: 'long-running-check'}, time: {start: 1}}});
  const before = snapshot(f.root), observation = await f.policy.inspectInvocation(f.context);
  assert.equal(observation.owner.interruption, 'terminal_child_error');assert.equal(observation.owner.status, 'idle');
  assert.equal(observation.childSignals[0].hostToolsAllTerminal, false);
  assert.deepEqual(observation.childSignals[0].nonterminalTools, [{tool: 'bash', callID: 'call_child_bash', status: 'running'}]);
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
    if (mode === 'child_busy') f.host.statusMap.ses_child = {type: 'busy'};
    if (mode === 'child_retry') f.host.statusMap.ses_child = {type: 'retry', attempt: 2, message: 'Retrying', next: Date.now()};
    if (mode === 'parent_busy') f.host.statusMap.ses_old = {type: 'busy'};
    if (mode === 'parent_abort') f.messages.get('ses_old')[1].info.error = {name: 'MessageAbortedError', data: {message: 'Cancelled'}};
    if (mode === 'child_abort') childError.info.error = {name: 'MessageAbortedError', data: {message: 'Cancelled'}};
    if (mode === 'no_child_error') delete childError.info.error;
    if (mode === 'new_child_user') f.messages.get('ses_child').push(user('ses_child', 'msg_child_new', 'Changed instruction'));
    if (mode === 'new_parent_user') f.messages.get('ses_old').push(user('ses_old', 'msg_parent_cancel', 'Stop this work'));
    if (mode === 'wrong_parent') f.sessions.get('ses_child').parentID = 'ses_unrelated';
    if (mode === 'wrong_project') f.sessions.get('ses_child').projectID = 'another-project';
    if (mode === 'wrong_agent') childError.info.agent = 'build';
    if (mode === 'wrong_metadata') task.part.state.metadata.parentSessionId = 'ses_unrelated';
    if (mode === 'duplicate_child') f.messages.get('ses_old')[1].parts.push({...task.part, id: 'prt_other_link', callID: 'call_other_link'});
    if (mode === 'task_prose_only') f.sessions.delete('ses_child');
    const observation = await f.policy.inspectInvocation(f.context);
    assert.equal(f.policyModule.recoveryDecision(observation, 'compatible').eligible, false, mode);
    assert.equal(task.read().attempts[0].resolution, 'unresolved', mode);
  }
});

test('all child host tools terminal is a diagnostic, not fabricated return or physical cessation', async t => {
  const f = await fixture(t), task = await failedChild(f);
  f.messages.get('ses_child')[1].parts.push({id: 'prt_child_bash', messageID: 'msg_child_error', sessionID: 'ses_child', type: 'tool', tool: 'bash', callID: 'call_child_bash', state: {status: 'completed', input: {command: 'check'}, output: 'done', time: {start: 1, end: 2}}});
  const observation = await f.policy.inspectInvocation(f.context);
  assert.equal(observation.childSignals[0].hostToolsAllTerminal, true);
  assert.equal(observation.childSignals[0].physicalCessation, 'unknown');
  assert.equal(task.read().attempts[0].resolution, 'unresolved');assert.equal(task.read().returns.length, 0);
});

test('parent terminal error never overrides a known busy/retry child or child cancellation', async t => {
  for (const mode of ['busy', 'retry', 'cancelled', 'unknown']) {
    const f = await fixture(t);await failedChild(f);
    f.messages.get('ses_old')[1].info.error = {name: 'APIError', data: {message: 'Parent failure', isRetryable: false}};
    if (mode === 'cancelled') f.messages.get('ses_child')[1].info.error = {name: 'MessageAbortedError', data: {message: 'User cancelled'}};
    else if (mode === 'unknown') f.sessions.delete('ses_child');
    else f.host.statusMap.ses_child = {type: mode};
    assert.equal(f.policyModule.recoveryDecision(await f.policy.inspectInvocation(f.context), 'compatible').eligible, false, mode);
    await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}));
  }
});

test('old owner receiving a later user request during final source authentication invalidates proof', async t => {
  const f = await fixture(t), original = f.client.session.message;let assistantReads = 0;
  f.client.session.message = async input => {
    const response = await original(input);
    if (input.path.messageID === 'msg_new_assistant' && ++assistantReads === 2) f.messages.get('ses_old').push(user('ses_old', 'msg_old_cancel', 'Stop all work'));
    return response;
  };
  await assert.rejects(f.policy.proveAutomaticResume(f.context, f.args(), {disposition: 'compatible'}), error => error.code === 'AUTOMATIC_RECOVERY_STALE');
});

test('installed plugin ordinary greeting observes and permissioned automatic action adopts without special command', async t => {
  const f = await fixture(t), native = await runtimePlugin(f), before = snapshot(f.root);
  const output = {messages: structuredClone(f.messages.get('ses_new'))};
  await native.plugin['experimental.chat.messages.transform']({}, output);
  assert.match(output.messages[0].parts.at(-1).text, /Observación de continuidad/);assert.deepEqual(snapshot(f.root), before);
  f.requests.length = 0;
  f.context.ask = async request => {assert.equal(f.requests.length, 0, 'permission precedes native recovery reads');native.asks.push(request);};
  const args = {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'};
  const receipt = await native.invoke('pulso_workspace', args);
  assert.equal(receipt.ok, true, JSON.stringify(receipt));assert.equal(receipt.data.ownerSessionID, 'ses_new');
  assert.equal(receipt.data.recovery.ownerTransferred, true);assert.equal(receipt.data.recovery.capturePending, false);
  assert.deepEqual(native.asks[0], {permission: 'pulso_workspace', patterns: ['resume_continuity:W'], always: ['resume_continuity:W'], metadata: {action: 'resume_continuity', resource: 'W', mutating: true}});
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
  f.host.statusMap.ses_new = {type: 'busy'};
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
  f.messages.get('ses_old')[1].parts.push(task.part);
  const original = f.client.session.messages, lock = path.join(f.root, '.pulso-write.lock');let oldReads = 0;
  f.client.session.messages = async input => {
    const response = await original(input);
    if (input.path.id === 'ses_old' && ++oldReads === 3) {
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
    const controller = new AbortController();f.context.abort = controller.signal;
    f.context.ask = async () => {if (mode === 'denied') throw new Error('permission denied');if (mode === 'cancelled') controller.abort();if (mode === 'busy_after_ask') f.host.statusMap.ses_old = {type: 'busy'};};
    const invoke = () => native.invoke('pulso_workspace', {action: 'resume_continuity', ...f.args(), resumeMode: 'automatic'});
    if (mode === 'busy_after_ask') assert.equal((await invoke()).ok, false);else await assert.rejects(invoke());
    assert.deepEqual(snapshot(f.root), before, mode);
  }
});

test('native intent provenance stores references and hashes, refreshes on update and is optional for legacy', async t => {
  const f = await fixture(t), native = await runtimePlugin(f);
  f.messages.get('ses_new')[0].parts[0].text = 'Corrige el validador sin publicar.';
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
  f.messages.get('ses_old')[1].info.error = {name: 'APIError', data: {message: 'Parent failure', isRetryable: false}};
  await f.call('pulso_workspace', {action: 'update_intent', continuityId: f.continuity.continuityId, expectedRevision: 1, objective: 'Compatible update', constraints: [], compatibleDelegationIds: [task.prepared.delegationId]});
  f.host.statusMap.ses_child = {type: 'busy'};
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
  delete f.client.session.status;
  const unavailable = await native.invoke('pulso_workspace', {...args, resumeMode: 'automatic'});
  assert.equal(unavailable.ok, false);assert.deepEqual(snapshot(f.root), before);
  const explicit = await native.invoke('pulso_workspace', {...args, resumeMode: 'explicit'});
  assert.equal(explicit.ok, true, JSON.stringify(explicit));assert.equal(explicit.data.ownerSessionID, 'ses_new');
});
