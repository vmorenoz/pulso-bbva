/** Adapter contract checks with real core and public hook shapes; NOT native host conversation acceptance. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {adapterConfig} from '../../adapters/opencode/build.mjs';

const source = fileURLToPath(new URL('../../',import.meta.url));
// Observed persisted tool shapes, supplied to public hook/event contracts here.
// Their presence in SQLite does NOT prove a live hook receives the same payload.
const literal = (text='Bloqueado: falta acceso al recurso.') => `<task id="ses_child" state="completed">\n<task_result>${text}</task_result>\n</task>`;
const nativeOutput = (text=literal(),extra={}) => ({title:'Task',output:text,metadata:{parentSessionId:'ses_parent',sessionId:'ses_child',model:'observed-model',truncated:false,...extra}});
const nativeEvent = (f,output=nativeOutput(),status='completed',args=f.args) => ({event:{type:'message.part.updated',properties:{part:{type:'tool',id:'part_task',messageID:'msg_task',...f.call,state:{status,input:args,output:output.output,metadata:output.metadata}}}}});
async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(),'pulso-durable-hooks-'));
  t.after(() => fs.rmSync(base,{recursive:true,force:true}));
  const runtime = path.join(base,'runtime'), project = path.join(base,'project');
  fs.mkdirSync(project);
  fs.cpSync(path.join(source,'core'),path.join(runtime,'resources'),{recursive:true});
  for (const [from,to] of Object.entries(adapterConfig.runtimeFiles)) {
    fs.mkdirSync(path.dirname(path.join(runtime,to)),{recursive:true});
    fs.copyFileSync(path.join(source,'adapters/opencode',from),path.join(runtime,to));
  }
  fs.cpSync(path.join(source,'adapters/opencode/vendor'),path.join(runtime,'plugin/vendor'),{recursive:true});
  fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify(adapterConfig.packageManifest()));
  const load = relative => import(pathToFileURL(path.join(runtime,relative)).href);
  const {PulsoPlugin} = await load('plugin/index.mjs');
  const {readDelegation} = await load('resources/lib/delegation-registry.mjs');
  const plugin = await PulsoPlugin({directory:project,homeDir:path.join(base,'home')});
  const context = {directory:project,sessionID:'ses_parent',messageID:'msg_prepare',callID:'call_prepare',async ask() {}};
  const invoke = async (name,request) => {
    const receipt = JSON.parse((await plugin.tool[name].execute({request},context)).output);
    assert.equal(receipt.ok,true,JSON.stringify(receipt));
    return receipt.data;
  };
  await invoke('pulso_workspace',{action:'prepare'});
  await invoke('pulso_work',{action:'create',workId:'W',title:'Contract',objective:'Check adapter',criterion:'C',verification:'V'});
  await invoke('pulso_work',{action:'update',workId:'W',expectedRevision:1,actions:['T1','T2'].map(id => ({type:'task.add',task:{id,title:id,criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Report'],evidenceIds:[],summary:''}}))});
  const bound = await invoke('pulso_workspace',{action:'bind_continuity',workId:'W',requestKey:'bind_one',objective:'Check adapter',repositories:['.'],constraints:[]});
  const prepared = await invoke('pulso_work',{action:'prepare_delegation',contractVersion:2,workId:'W',expectedRevision:2,continuityId:bound.continuityId,intentRevision:bound.intentRevision,requestKey:'prepare_one',taskIds:['T1','T2'],objective:'Report findings',inputs:[],output:'conversation',constraints:[],templateId:'exploration'});
  const delegationId = prepared.delegationId || prepared.delegation?.id;
  assert.ok(delegationId,'Preparation must expose a durable ID');
  const record = await readDelegation(project,{workId:'W',delegationId});
  assert.deepEqual(record.nativeContext,{sessionID:'ses_parent',messageID:'msg_prepare',callID:'call_prepare'});
  const args = {subagent_type:'pulso-explorer',prompt:record.specialistPrompt,description:'Contract fixture'};
  const call = {tool:'task',sessionID:'ses_parent',callID:'call_task'};
  const before = (a=args,c=call) => plugin['tool.execute.before'](c,{args:a});
  const after = (output,c=call,a=args) => plugin['tool.execute.after']({...c,args:a},output);
  return {project,plugin,record,read:() => readDelegation(project,{workId:'W',delegationId}),args,call,before,after,invoke,context,bound,load};
}

test('v2 dispatch validates full prompt, role, all tasks and native parent; duplicates reject',async t => {
  const f = await fixture(t);
  for (const args of [{...f.args,prompt:f.args.prompt+'\nEdited'},{...f.args,subagent_type:'pulso-executor'},{...f.args,prompt:f.args.prompt.replace('T1, T2','T1')}]) await assert.rejects(f.before(args));
  await assert.rejects(f.before(f.args,{...f.call,sessionID:'ses_other'}),/Continuidad de otra sesión/);
  await f.before();
  await assert.rejects(f.before());
  await assert.rejects(f.before(f.args,{...f.call,callID:'call_duplicate'}));
  assert.equal((await f.read()).attempts.length,1);
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs');
  const restarted = createDurableHooks({directory:f.project});
  await assert.rejects(restarted['tool.execute.before'](f.call,{args:f.args}));
});

test('foreground capture preserves literal bytes and gives returnId separately; multi-task telemetry stays passive',async t => {
  const f = await fixture(t);
  await f.before();
  const original = literal();
  const output = nativeOutput(original);
  await f.after(output);
  assert.equal(output.output,original);
  assert.equal(output.metadata.status,undefined);
  assert.equal(output.metadata.pulsoDurable.capture,'stored',JSON.stringify(output.metadata.pulsoDurable));
  assert.ok(output.metadata.pulsoDurable.returnId);
  assert.equal(output.metadata.pulsoDurable.acceptance,'not_assessed');
  const saved = await f.read();
  assert.equal(saved.returns.length,1);
  assert.equal(saved.returns[0].markdown,original);
  assert.equal(saved.returns[0].provenance,'host_capture');
  assert.equal(saved.returns[0].completeness,'complete');
  assert.equal(saved.attempts[0].resolution,'host_terminal');
  assert.equal(saved.accepted,null);
  const attempts = await f.invoke('pulso_workspace',{action:'attempts',workId:'W'});
  assert.deepEqual(attempts.items[0].taskIds,['T1','T2']);
  assert.equal(attempts.items[0].acceptance,'not_assessed');
});

test('running is pending, truncation never complete, capture failures leave the original untouched',async t => {
  const f = await fixture(t);
  await f.before();
  const running = nativeOutput('<task id="ses_child" state="running">\n<task_result>Started</task_result>\n</task>');
  await f.after(running);
  assert.equal(running.metadata.pulsoDurable.capture,'pending');
  assert.equal((await f.read()).returns.length,0);
  const unknown = {output:'A prose claim: completed successfully',metadata:{}};
  await f.after(unknown);
  assert.equal(unknown.metadata.pulsoDurable.capture,'pending');
  assert.equal((await f.read()).returns.length,0);
  const truncated = nativeOutput(literal('Partial original'),{truncated:true});
  await f.after(truncated);
  assert.equal(truncated.output,literal('Partial original'));
  assert.equal(truncated.metadata.pulsoDurable.completeness,'truncated');
  const failed = nativeOutput(literal('Keep this original'));
  fs.renameSync(f.project,f.project+'-moved');
  t.after(() => fs.rmSync(f.project+'-moved',{recursive:true,force:true}));
  await f.after(failed);
  assert.equal(failed.output,literal('Keep this original'));
  assert.equal(failed.metadata.pulsoDurable.capture,'pending');
  assert.ok(failed.metadata.pulsoDurable.error);
});

test('current intent invalidates dispatch; arbitrary and unregistered legacy tasks pass through',async t => {
  const f = await fixture(t);
  for (const prompt of ['An arbitrary task','workId: W\ntaskId: T1','Encargo: absent · workId: W · taskIds: T1, T2']) {
    const args = {...f.args,prompt};
    const output = {output:'Native original',metadata:{}};
    await f.before(args);
    await f.after(output,f.call,args);
    assert.deepEqual(output,{output:'Native original',metadata:{}});
  }
  await f.invoke('pulso_workspace',{action:'update_intent',continuityId:f.bound.continuityId,expectedRevision:f.bound.revision,objective:'Stop previous work',constraints:['Do not dispatch'],compatibleDelegationIds:[]});
  await assert.rejects(f.before());
  assert.equal((await f.read()).attempts.length,0);
});

test('terminal wrapper requires exact structure and consistent native parent/child, never report prose',async t => {
  const f = await fixture(t);
  await f.before();
  for (const output of [nativeOutput(literal()+'extra'),nativeOutput(literal(),{parentSessionId:'ses_other'}),nativeOutput(literal(),{sessionId:'ses_other'}),nativeOutput(literal(),{parentSessionId:undefined}),nativeOutput(literal('<task_result>nested</task_result>')),nativeOutput('completed successfully')]) {
    const original = output.output;
    await f.after(output);
    assert.equal(output.output,original);
    assert.equal(output.metadata.pulsoDurable.capture,'pending');
  }
  assert.equal((await f.read()).returns.length,0);
  assert.equal((await f.read()).attempts[0].resolution,'unresolved');
  const {nativeContext} = await f.load('plugin/durable-hooks.mjs');
  assert.deepEqual(nativeContext({sessionID:'native',messageID:'m',callID:'c',args:{sessionID:'forged'}}),{sessionID:'native',messageID:'m',callID:'c'});
});

test('external metadata tree is rejected without writing; capture stays explicitly pending',async t => {
  const f = await fixture(t);
  const metadata = path.join(f.project,'.pulso'), outside = path.join(path.dirname(f.project),'external-metadata');
  fs.renameSync(metadata,outside);
  fs.symlinkSync(outside,metadata);
  const snapshot = fs.readFileSync(path.join(outside,'delegations-v2.json'),'utf8');
  await assert.rejects(f.before(),/External metadata tree/);
  const output = nativeOutput(literal('Preserve original'));
  await f.after(output);
  assert.equal(output.output,literal('Preserve original'));
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  assert.equal(fs.readFileSync(path.join(outside,'delegations-v2.json'),'utf8'),snapshot);
});

test('METADATA_BUSY after capture replays through given event after hook recreation, idempotently',async t => {
  const f = await fixture(t);
  await f.before();
  const output = nativeOutput(), event = nativeEvent(f,output), originalEvent = structuredClone(event);
  const lock = path.join(f.project,'.pulso-write.lock');
  fs.mkdirSync(lock); // Real core contention; fixture owns and removes only this directory.
  await f.after(output);
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  assert.equal(output.metadata.pulsoDurable.code,'METADATA_BUSY');
  assert.equal((await f.plugin.event(event)).code,'METADATA_BUSY');
  assert.equal((await f.read()).returns.length,0);
  fs.rmdirSync(lock);
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs');
  const replay = createDurableHooks({directory:f.project});
  const receipt = await replay.event(event);
  assert.equal(receipt.capture,'stored',JSON.stringify(receipt));
  assert.equal((await f.plugin.event(event)).returnId,receipt.returnId);
  assert.deepEqual(event,originalEvent);
  assert.equal((await f.read()).returns.length,1);
  await f.after(output);
  assert.equal(output.metadata.pulsoDurable.returnId,receipt.returnId);
});

test('background after/running events stay unresolved; completed child event validates parent/call and captures',async t => {
  const f = await fixture(t), args = {...f.args,background:true};
  await f.before(args);
  const output = nativeOutput();
  await f.after(output,f.call,args);
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  const event = nativeEvent(f,nativeOutput(),'running',args);
  assert.equal((await f.plugin.event(event)).capture,'pending');
  event.event.properties.part.state.status = 'completed';
  event.event.properties.part.callID = 'unregistered_call';
  assert.equal((await f.plugin.event(event)).capture,'pending');
  event.event.properties.part.callID = f.call.callID;
  event.event.properties.part.state.metadata.parentSessionId = 'wrong_parent';
  assert.equal((await f.plugin.event(event)).capture,'pending');
  assert.equal((await f.read()).attempts[0].resolution,'unresolved');
  event.event.properties.part.state.metadata.parentSessionId = f.call.sessionID;
  assert.equal((await f.plugin.event(event)).capture,'stored');
  assert.equal((await f.read()).returns[0].markdown,literal());
});

test('legacy without identity/registry passes through; existing corrupt registry or missing identity rejects',async t => {
  const f = await fixture(t);
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs');
  const legacy = path.join(path.dirname(f.project),'legacy');
  fs.mkdirSync(legacy);
  const hooks = createDurableHooks({directory:legacy});
  const before = () => hooks['tool.execute.before'](f.call,{args:f.args});
  await assert.doesNotReject(before());
  fs.mkdirSync(path.join(legacy,'.pulso'));
  fs.writeFileSync(path.join(legacy,'.pulso/state.json'),'{}');
  await assert.doesNotReject(before());
  fs.writeFileSync(path.join(legacy,'.pulso/delegations-v2.json'),'broken registry');
  await assert.rejects(before());
  fs.copyFileSync(path.join(f.project,'.pulso/project.json'),path.join(legacy,'.pulso/project.json'));
  await assert.rejects(before());
});

test('missing referenced durable snapshot is corruption, never legacy passthrough',async t => {
  const f = await fixture(t);
  const index = JSON.parse(fs.readFileSync(path.join(f.project,'.pulso/delegations-v2.json'),'utf8'));
  const entry = index.records.find(r => r.delegationId === f.record.delegationId);
  assert.ok(entry.snapshotRef?.path);
  fs.unlinkSync(path.join(f.project,entry.snapshotRef.path));
  await assert.rejects(f.before());
  const output = nativeOutput();
  await f.after(output);
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  assert.ok(output.metadata.pulsoDurable.error);
});

test('explicit reported reconciliation is available when no terminal event can be supplied',async t => {
  const f = await fixture(t);
  await f.before();
  const output = nativeOutput('No verifiable native envelope');
  await f.after(output);
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  await f.invoke('pulso_work',{action:'reconcile_delegation',workId:'W',delegationId:f.record.delegationId,continuityId:f.bound.continuityId,intentRevision:f.bound.intentRevision,resolution:'explicitly_reconciled',reason:'Explicit fixture declaration; no native completion observation',source:{text:'Reconcile this pending attempt by declaration; do not claim native termination.'}});
  const record = await f.read();
  assert.equal(record.attempts[0].resolution,'explicitly_reconciled');
  assert.equal(record.returns.length,0);
  assert.equal(record.accepted,null);
});

test('missing index with durable blobs rejects dispatch and capture without rebuilding authority',async t => {
  const f = await fixture(t);
  const indexPath = path.join(f.project,'.pulso/delegations-v2.json');
  const index = JSON.parse(fs.readFileSync(indexPath,'utf8'));
  const snapshotPath = path.join(f.project,index.records.find(r => r.delegationId === f.record.delegationId).snapshotRef.path);
  const snapshot = fs.readFileSync(snapshotPath,'utf8');
  fs.unlinkSync(indexPath);
  await assert.rejects(f.before(),/Durable registry missing while delegation blobs exist/);
  const output = nativeOutput();
  await f.after(output);
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  assert.match(output.metadata.pulsoDurable.error,/Durable registry missing/);
  assert.equal(output.output,literal());
  assert.equal(fs.existsSync(indexPath),false);
  assert.equal(fs.readFileSync(snapshotPath,'utf8'),snapshot);
});

test('unrelated missing delegation ID passes through an existing durable registry without mutation',async t => {
  const f = await fixture(t);
  const indexPath = path.join(f.project,'.pulso/delegations-v2.json');
  const beforeIndex = fs.readFileSync(indexPath,'utf8');
  const {readDelegation} = await f.load('resources/lib/delegation-registry.mjs');
  assert.throws(() => readDelegation(f.project,{workId:'W',delegationId:'legacy_unregistered'}),{code:'DELEGATION_NOT_FOUND'});
  const args = {...f.args,prompt:'Encargo: legacy_unregistered · workId: W · taskIds: T1, T2'};
  const output = nativeOutput(), original = structuredClone(output);
  await assert.doesNotReject(f.before(args));
  await assert.doesNotReject(f.after(output,f.call,args));
  assert.deepEqual(output,original);
  assert.equal(await f.plugin.event(nativeEvent(f,output,'completed',args)),null);
  assert.equal(fs.readFileSync(indexPath,'utf8'),beforeIndex);
  assert.equal((await f.read()).attempts.length,0);
});

test('explicit resumption transfers dispatch ownership without changing the prepared snapshot',async t => {
  const f = await fixture(t);
  const index = JSON.parse(fs.readFileSync(path.join(f.project,'.pulso/delegations-v2.json'),'utf8'));
  const snapshotPath = path.join(f.project,index.records.find(r => r.delegationId === f.record.delegationId).snapshotRef.path);
  const originalSnapshot = fs.readFileSync(snapshotPath,'utf8');
  const resumedCall = {...f.call,sessionID:'ses_resumed'};
  await assert.rejects(f.before(f.args,resumedCall),/Continuidad de otra sesión/);
  assert.equal((await f.read()).attempts.length,0);
  Object.assign(f.context,{sessionID:resumedCall.sessionID,messageID:'msg_resume',callID:'call_resume'});
  const resumed = await f.invoke('pulso_workspace',{action:'bind_continuity',workId:'W',continuityId:f.bound.continuityId,requestKey:'explicit_resume',objective:f.bound.objective,repositories:f.bound.repositories,constraints:f.bound.constraints});
  assert.equal(resumed.ownerSessionID,resumedCall.sessionID);
  assert.equal(resumed.intentRevision,f.bound.intentRevision);
  assert.equal((await f.read()).attempts.length,0);
  // The old native parent supplies the same canonical prompt and callID: current ownership still rejects it.
  await assert.rejects(f.before(),/Continuidad de otra sesión/);
  await f.before(f.args,resumedCall);
  const dispatched = await f.read();
  assert.equal(dispatched.attempts.length,1);
  assert.equal(dispatched.attempts[0].sessionID,resumedCall.sessionID);
  assert.equal(dispatched.attempts[0].callID,f.call.callID);
  assert.deepEqual(dispatched.nativeContext,f.record.nativeContext);
  assert.equal(dispatched.specialistPrompt,f.args.prompt);
  assert.equal(fs.readFileSync(snapshotPath,'utf8'),originalSnapshot);
  const wrongParent = nativeOutput();
  await f.after(wrongParent,f.call);
  assert.equal(wrongParent.metadata.pulsoDurable.capture,'pending');
  const output = nativeOutput(literal(),{parentSessionId:resumedCall.sessionID});
  await f.after(output,resumedCall);
  assert.equal(output.metadata.pulsoDurable.capture,'stored',JSON.stringify(output.metadata.pulsoDurable));
  assert.equal((await f.read()).returns[0].sessionID,resumedCall.sessionID);
  assert.equal(fs.readFileSync(snapshotPath,'utf8'),originalSnapshot);
});
