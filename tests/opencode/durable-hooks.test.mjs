/** Native OpenCode 2.1.2 hook contracts with real core; host/provider double, no model calls. */
import {primaryReader,setupPlugin} from './native-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {adapterConfig} from '../../adapters/opencode/build.mjs';
const source=fileURLToPath(new URL('../../',import.meta.url));
const literal=(text='Bloqueado: falta acceso al recurso.')=>`<subagent sessionID="ses_child" state="completed">\n${text}\n</subagent>`;
const nativeOutput=(text=literal(),extra={})=>({output:{sessionID:'ses_child',status:'completed',output:text.startsWith('<subagent sessionID="ses_child" state="completed">\n')&&text.endsWith('\n</subagent>')?text.slice('<subagent sessionID="ses_child" state="completed">\n'.length,-'\n</subagent>'.length):text},content:text,metadata:{sessionID:'ses_child',status:'completed',truncated:false,...extra}});
const nativeReplay=(f,output=nativeOutput(),status='completed',args=f.args)=>({sessionID:f.call.sessionID,messageID:f.call.messageID,part:{type:'tool',name:'subagent',id:f.call.id,executed:false,state:{status,input:args,content:[{type:'text',text:output.content}],metadata:output.metadata}}});
async function fixture(t) {
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pulso-durable-hooks-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const runtime=path.join(base,'runtime'),project=path.join(base,'project');fs.mkdirSync(project);
  fs.cpSync(path.join(source,'core'),path.join(runtime,'resources'),{recursive:true});
  for(const [from,to] of Object.entries(adapterConfig.runtimeFiles)){fs.mkdirSync(path.dirname(path.join(runtime,to)),{recursive:true});fs.copyFileSync(path.join(source,'adapters/opencode',from),path.join(runtime,to));}
  fs.cpSync(path.join(source,'adapters/opencode/vendor'),path.join(runtime,'plugin/vendor'),{recursive:true});
  fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify(adapterConfig.packageManifest()));
  const load=relative=>import(pathToFileURL(path.join(runtime,relative)).href),module=await load('plugin/index.mjs');
  const {readDelegation}=await load('resources/lib/delegation-registry.mjs');
  const child={id:'ses_child',parentID:'ses_parent',projectID:'native-project',location:{directory:project},agent:'pulso-explorer'};
  const histories=new Map(),reader={...primaryReader(project),async getSession(id){return id==='ses_child'?structuredClone(child):{id,projectID:'native-project',location:{directory:project},agent:'pulso'};},async history(id){return structuredClone(histories.get(id)||[]);}};
  const host=await setupPlugin(module,{directory:project,homeDir:path.join(base,'home'),reader});t.after(host.dispose);
  const context={agent:'pulso',sessionID:'ses_parent',messageID:'msg_prepare',id:'call_prepare',signal:new AbortController().signal};
  const invoke=async(name,request)=>{const receipt=await host.invoke(name,request,context);assert.equal(receipt.ok,true,JSON.stringify(receipt));return receipt.data;};
  await invoke('pulso_workspace',{action:'prepare'});
  await invoke('pulso_work',{action:'create',workId:'W',title:'Contract',objective:'Check adapter',criterion:'C',verification:'V'});
  await invoke('pulso_work',{action:'update',workId:'W',expectedRevision:1,actions:['T1','T2'].map(id=>({type:'task.add',task:{id,title:id,criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Report'],evidenceIds:[],summary:''}}))});
  const bound=await invoke('pulso_workspace',{action:'bind_continuity',workId:'W',requestKey:'bind_one',objective:'Check adapter',repositories:['.'],constraints:[]});
  const prepared=await invoke('pulso_work',{action:'prepare_delegation',contractVersion:2,workId:'W',expectedRevision:2,continuityId:bound.continuityId,intentRevision:bound.intentRevision,requestKey:'prepare_one',taskIds:['T1','T2'],objective:'Report findings',inputs:[],output:'conversation',constraints:[],templateId:'exploration'});
  const delegationId=prepared.delegationId||prepared.delegation?.id,record=await readDelegation(project,{workId:'W',delegationId});
  assert.deepEqual(record.nativeContext,{sessionID:'ses_parent',messageID:'msg_prepare',callID:'call_prepare'});
  assert.equal(prepared.agent,record.delegation.agent);assert.equal(prepared.specialistPrompt,record.specialistPrompt);
  const args={agent:prepared.agent,prompt:prepared.specialistPrompt,description:'Contract fixture'};
  const call={tool:'subagent',agent:'pulso',sessionID:'ses_parent',messageID:'msg_parent',id:'call_task'};
  const {createDurableHooks}=await load('plugin/durable-hooks.mjs'),durable=createDurableHooks({directory:project,reader});
  const before=(a=args,c=call)=>host.hooks['execute.before']({...c,input:a});
  const after=(result,c=call,a=args)=>host.hooks['execute.after']({...c,input:a,status:'completed',result});
  return {...host,project,record,read:()=>readDelegation(project,{workId:'W',delegationId}),args,call,before,after,invoke,context,bound,load,reader,child,histories,durable};
}

test('v2 dispatch validates role, all tasks and native parent; duplicates reject',async t => {
  const f = await fixture(t);
  for (const args of [{...f.args,agent:'pulso-executor'},{...f.args,prompt:f.args.prompt.replace('T1, T2','T1')}]) await assert.rejects(f.before(args));
  await assert.rejects(f.before(f.args,{...f.call,sessionID:'ses_other'}),/Continuidad de otra sesión/);
  await f.before();
  await assert.rejects(f.before());
  await assert.rejects(f.before(f.args,{...f.call,id:'call_duplicate'}));
  assert.equal((await f.read()).attempts.length,1);
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs');
  const restarted = createDurableHooks({directory:f.project,reader:f.reader});
  await assert.rejects(restarted.before({...f.call,input:f.args}));
});

test('canonical mismatch diagnostics distinguish causes without exposing prompt content before dispatch',async t => {
  const f = await fixture(t), prompt = f.args.prompt;
  const header = prompt.split('\n').find(line => line.startsWith('Encargo: '));
  const cases = [
    [{agent:'pulso-executor'},['role(expected="pulso-explorer", received="pulso-executor")'],['prompt(','task(','header(']],
    [{agent:undefined},['received=<missing>'],['prompt(']],
    [{agent:'SECRET_PAYLOAD\nforged'},['received=<redacted invalid role>'],[]],
    [{prompt:prompt.replace('T1, T2','T2, T1')},['task('],['header(','prompt(']],
    [{prompt:prompt.replace('T1, T2','T1')},['task('],['header(','prompt(']],
    [{prompt:prompt.replace('T1, T2','T1, T1')},['header(','task('],['prompt(']],
    [{prompt:prompt+'\n'+header},['header(identityCount=2','task('],['prompt(']],
    [{prompt:'SECRET_PAYLOAD\n'+prompt,agent:'pulso-executor'},['role('],['prompt(']],
  ];
  const indexPath = path.join(f.project,'.pulso/delegations-v2.json');
  const originalIndex = fs.readFileSync(indexPath,'utf8');
  for (const [patch,present,absent] of cases) {
    await assert.rejects(f.before({...f.args,...patch}),error => {
      for (const text of present) assert.ok(error.message.includes(text),error.message);
      for (const text of absent) if (!(patch.prompt && text === 'prompt(')) assert.ok(!error.message.includes(text),error.message);
      assert.ok(!error.message.includes('SECRET_PAYLOAD'));
      assert.ok(!error.message.includes(f.project));
      return true;
    });
    assert.equal((await f.read()).attempts.length,0);
    assert.equal(fs.readFileSync(indexPath,'utf8'),originalIndex);
  }
  assert.equal((await f.read()).attempts.length,0);
  await f.before();
  assert.equal((await f.read()).attempts.length,1);
});

test('native dispatch rejects edited bytes without mutation; after-hook and replay retain strict proof',async t => {
  const edits = [p => p+'SECRET_PAYLOAD',p => 'mode: project_initialization\n'+p,p => p.slice(0,-1),p => p.replace('Report findings','SECRET_PAYLOAD'),p => p.replaceAll('\n','\r\n')];
  for (const edit of edits) {
    const f=await fixture(t),edited={...f.args,prompt:edit(f.args.prompt)},original=structuredClone(edited);
    await assert.rejects(f.before(edited),/prompt\(firstDifference:/);
    assert.deepEqual(edited,original);assert.equal((await f.read()).attempts.length,0);
    const output=nativeOutput();await f.after(output,f.call,edited);
    assert.equal(output.metadata.pulsoDurable.capture,'pending');
    assert.ok(!output.metadata.pulsoDurable.error.includes('SECRET_PAYLOAD'));
    assert.equal((await f.durable.replay(nativeReplay(f,nativeOutput(),'completed',edited))).capture,'pending');
    assert.equal((await f.read()).returns.length,0);
    // A fresh canonical call is safe: the rejected call never dispatched a child.
    await f.before();await f.after(output);
    assert.equal(output.metadata.pulsoDurable.capture,'stored');assert.equal((await f.read()).returns.length,1);
  }
});

test('foreground capture preserves literal bytes and gives returnId separately; multi-task telemetry stays passive',async t => {
  const f = await fixture(t);
  await f.before();
  const original = literal();
  const output = nativeOutput(original);
  await f.after(output);
  assert.equal(output.content,original);
  assert.equal(output.metadata.status,'completed');
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
  const running = {output:{sessionID:'ses_child',status:'running',output:'Started'},content:'Started',metadata:{sessionID:'ses_child',status:'running'}};
  await f.after(running);
  assert.equal(running.metadata.pulsoDurable.capture,'pending');
  assert.equal((await f.read()).returns.length,0);
  const unknown = {output:'A prose claim: completed successfully',metadata:{}};
  await f.after(unknown);
  assert.equal(unknown.metadata.pulsoDurable.capture,'pending');
  assert.equal((await f.read()).returns.length,0);
  const truncated = nativeOutput(literal('Partial original'),{truncated:true});
  await f.after(truncated);
  assert.equal(truncated.content,literal('Partial original'));
  assert.equal(truncated.metadata.pulsoDurable.completeness,'truncated');
  const failed = nativeOutput(literal('Keep this original'));
  fs.renameSync(f.project,f.project+'-moved');
  t.after(() => fs.rmSync(f.project+'-moved',{recursive:true,force:true}));
  await f.after(failed);
  assert.equal(failed.content,literal('Keep this original'));
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
  for (const output of [nativeOutput(literal()+'extra'),nativeOutput(literal(),{sessionID:'ses_other'}),nativeOutput(literal(),{sessionID:undefined}),nativeOutput(literal(),{status:undefined}),nativeOutput('completed successfully')]) {
    const original = output.content;
    await f.after(output);
    assert.equal(output.content,original);
    assert.equal(output.metadata.pulsoDurable.capture,'pending');
  }
  f.child.parentID='ses_wrong';
  const wrongParent=nativeOutput();await f.after(wrongParent);assert.equal(wrongParent.metadata.pulsoDurable.capture,'pending');
  assert.equal((await f.read()).returns.length,0);
  assert.equal((await f.read()).attempts[0].resolution,'unresolved');
  const {nativeContext} = await f.load('plugin/durable-hooks.mjs');
  assert.deepEqual(nativeContext({sessionID:'native',messageID:'m',id:'c',input:{sessionID:'forged'}}),{sessionID:'native',messageID:'m',callID:'c'});
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
  assert.equal(output.content,literal('Preserve original'));
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  assert.equal(fs.readFileSync(path.join(outside,'delegations-v2.json'),'utf8'),snapshot);
});

test('METADATA_BUSY after capture replays through given event after hook recreation, idempotently',async t => {
  const f = await fixture(t);
  await f.before();
  const output = nativeOutput(), event = nativeReplay(f,output), originalEvent = structuredClone(event);
  const lock = path.join(f.project,'.pulso-write.lock');
  fs.mkdirSync(lock); // Real core contention; fixture owns and removes only this directory.
  await f.after(output);
  assert.equal(output.metadata.pulsoDurable.capture,'pending');
  assert.equal(output.metadata.pulsoDurable.code,'METADATA_BUSY');
  assert.equal((await f.durable.replay(event)).code,'METADATA_BUSY');
  assert.equal((await f.read()).returns.length,0);
  fs.rmdirSync(lock);
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs');
  const replay = createDurableHooks({directory:f.project,reader:f.reader});
  const receipt = await replay.replay(event);
  assert.equal(receipt.capture,'stored',JSON.stringify(receipt));
  assert.equal((await f.durable.replay(event)).returnId,receipt.returnId);
  assert.deepEqual(event,originalEvent);
  assert.equal((await f.read()).returns.length,1);
  await f.after(output);
  assert.equal(output.metadata.pulsoDurable.returnId,receipt.returnId);
});

test('background launch remains unresolved; native synthetic completion validates parent/call before capture',async t=>{
  const f=await fixture(t),args={...f.args,background:true};await f.before(args);
  const launch={output:{sessionID:'ses_child',status:'running',output:'Background'},content:'Background',metadata:{sessionID:'ses_child',status:'running'}};
  await f.after(launch,f.call,args);assert.equal(launch.metadata.pulsoDurable.capture,'pending');
  const replay=nativeReplay(f,launch,'completed',args);
  assert.equal((await f.durable.replay(replay)).capture,'pending');
  f.histories.set(f.call.sessionID,[{id:f.call.messageID,type:'assistant',agent:'pulso',content:[replay.part]}]);
  const completion={id:'msg_notification',type:'synthetic',text:'<subagent sessionID="ses_child" state="completed" description="Contract fixture">\nLiteral background report\n</subagent>',metadata:{source:'subagent',childID:'ses_child',agent:f.args.agent,state:'completed'}};
  replay.completion=completion;
  replay.part.id='unregistered';assert.equal((await f.durable.replay(replay)).capture,'pending');
  replay.part.id=f.call.id;
  f.child.parentID='wrong_parent';assert.equal((await f.durable.replay(replay)).capture,'pending');
  f.child.parentID=f.call.sessionID;
  assert.equal((await f.read()).attempts[0].resolution,'unresolved');
  f.reader.getMessage=async(sessionID,messageID)=>{assert.equal(sessionID,f.call.sessionID);assert.equal(messageID,completion.id);return completion;};
  const result=await f.durable.event({type:'session.inbox.delivered',data:{sessionID:f.call.sessionID,inboxID:completion.id}});assert.equal(result.capture,'stored',JSON.stringify(result));
  assert.equal((await f.read()).returns[0].markdown,completion.text);
  assert.equal((await f.durable.replay(replay)).returnId,result.returnId);
  assert.equal((await f.read()).returns.length,1);
});

test('legacy without identity/registry passes through; existing corrupt registry or missing identity rejects',async t => {
  const f = await fixture(t);
  const {createDurableHooks} = await f.load('plugin/durable-hooks.mjs');
  const legacy = path.join(path.dirname(f.project),'legacy');
  fs.mkdirSync(legacy);
  const hooks = createDurableHooks({directory:legacy});
  const before = () => hooks.before({...f.call,input:f.args});
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
  assert.equal(output.content,literal());
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
  assert.equal(await f.durable.replay(nativeReplay(f,output,'completed',args)),null);
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
  const capsule = await f.invoke('pulso_workspace',f.bound.readWith);
  Object.assign(f.context,{sessionID:resumedCall.sessionID,messageID:'msg_resume',id:'call_resume'});
  const resumed = await f.invoke('pulso_workspace',{action:'bind_continuity',workId:'W',continuityId:f.bound.continuityId,requestKey:'explicit_resume',objective:capsule.objective,repositories:capsule.repositories,constraints:capsule.constraints});
  assert.equal(resumed.ownerSessionID,resumedCall.sessionID);
  assert.equal(resumed.intentRevision,f.bound.intentRevision);
  assert.equal((await f.read()).attempts.length,0);
  // The old native parent supplies the same canonical prompt and callID: current ownership still rejects it.
  await assert.rejects(f.before(),/Continuidad de otra sesión/);
  await f.before(f.args,resumedCall);
  const dispatched = await f.read();
  assert.equal(dispatched.attempts.length,1);
  assert.equal(dispatched.attempts[0].sessionID,resumedCall.sessionID);
  assert.equal(dispatched.attempts[0].callID,f.call.id);
  assert.deepEqual(dispatched.nativeContext,f.record.nativeContext);
  assert.equal(dispatched.specialistPrompt,f.args.prompt);
  assert.equal(fs.readFileSync(snapshotPath,'utf8'),originalSnapshot);
  const wrongParent = nativeOutput();
  await f.after(wrongParent,f.call);
  assert.equal(wrongParent.metadata.pulsoDurable.capture,'pending');
  f.child.parentID=resumedCall.sessionID;
  const output = nativeOutput();
  await f.after(output,resumedCall);
  assert.equal(output.metadata.pulsoDurable.capture,'stored',JSON.stringify(output.metadata.pulsoDurable));
  assert.equal((await f.read()).returns[0].sessionID,resumedCall.sessionID);
  assert.equal(fs.readFileSync(snapshotPath,'utf8'),originalSnapshot);
});

test('failed native task can resume in a new session with confirmed continuity, without duplicate same-task dispatch',async t => {
  const f = await fixture(t);
  // Preconditions are deliberately known before the session is lost. This covers
  // the supported recovery path, not discovery of an inaccessible old capsule.
  const capsule = await f.invoke('pulso_workspace',f.bound.readWith);
  await f.before();
  const failed = nativeOutput('Network connection lost; no verified terminal return',{status:'error'});
  const diagnosis = await f.durable.replay(nativeReplay(f,failed,'error'));
  assert.equal(diagnosis.capture,'pending');
  let original = await f.read();
  assert.equal(original.attempts[0].resolution,'unresolved');
  assert.equal(original.reservationResolved,false);
  assert.equal(original.returns.length,0);
  assert.equal(original.accepted,null);

  Object.assign(f.context,{sessionID:'ses_after_network_failure',messageID:'msg_resume',id:'call_resume'});
  const resumed = await f.invoke('pulso_workspace',{action:'bind_continuity',workId:'W',continuityId:capsule.continuityId,requestKey:'resume_after_failure',objective:capsule.objective,repositories:capsule.repositories,constraints:capsule.constraints});
  assert.equal(resumed.continuityId,capsule.continuityId);
  assert.equal(resumed.intentRevision,capsule.intentRevision);
  assert.equal(resumed.ownerSessionID,f.context.sessionID);
  assert.equal((await f.invoke('pulso_workspace',f.bound.readWith)).pending[0].delegationId,original.delegationId);
  await assert.rejects(f.before(f.args,{...f.call,sessionID:f.context.sessionID}),/already dispatched/);

  const prepare={action:'prepare_delegation',contractVersion:2,workId:'W',expectedRevision:2,continuityId:capsule.continuityId,intentRevision:capsule.intentRevision,requestKey:'replacement_after_failure',taskIds:['T1','T2'],objective:'Report findings',inputs:[],output:'conversation',constraints:[],templateId:'exploration'};
  const attempt=async request=>(await f.tools.pulso_work.execute({request},f.context)).output;
  const assertReserved=async()=>{
    const receipt=await attempt(prepare);
    assert.equal(receipt.ok,false);
    assert.match(receipt.error.message,/Reserva incompatible/);
    assert.ok(receipt.error.message.includes(original.delegationId));
  };
  await assertReserved();
  const reconcile={action:'reconcile_delegation',workId:'W',delegationId:original.delegationId,continuityId:capsule.continuityId,intentRevision:capsule.intentRevision,reason:'Explicit recovery after the previous session lost network access'};
  await f.invoke('pulso_work',{...reconcile,resolution:'retired'});
  assert.equal((await f.read()).reservationResolved,false,'retirement alone cannot claim native termination');
  await assertReserved();
  await f.invoke('pulso_work',{...reconcile,resolution:'explicitly_reconciled',source:{text:'Retire the previous attempt and continue in this session; physical termination was not observed.'}});
  original=await f.read();
  assert.equal(original.retired,true);
  assert.equal(original.reservationResolved,true);
  assert.equal(original.attempts[0].resolution,'explicitly_reconciled');
  assert.equal(original.returns.length,0);
  assert.equal(original.accepted,null);
  assert.match(original.reconciliations.at(-1).limitations.join(' '),/no certifica.*cese físico/);

  const replacement=await f.invoke('pulso_work',prepare);
  assert.notEqual(replacement.delegationId,original.delegationId);
  assert.equal((await f.invoke('pulso_work',prepare)).delegationId,replacement.delegationId,'retry uses the same request key');
  const args={agent:replacement.agent,prompt:replacement.specialistPrompt,description:'Recovery contract fixture'};
  const call={tool:'subagent',agent:'pulso',sessionID:f.context.sessionID,messageID:f.context.messageID,id:'replacement_dispatch'};
  await f.before(args,call);
  await assert.rejects(f.before(args,{...call,id:'duplicate_dispatch'}),/already dispatched/);
  const replacementRecord=await f.invoke('pulso_work',replacement.readWith);
  assert.equal(replacementRecord.attempts.length,1);
  assert.equal(replacementRecord.attempts[0].sessionID,f.context.sessionID);
  assert.deepEqual((await f.read()).nativeContext,f.record.nativeContext);
  const work=await f.invoke('pulso_work',{action:'get',workId:'W',section:'all'});
  assert.equal(work.revision,2);
  assert.ok(work.tasks.items.every(task=>task.status==='pending'));
  assert.equal(work.results.total,0);
  assert.equal(work.evidence.total,0);
});


test('raw native after-hook without truncation metadata replays persisted truncated:false idempotently',async t=>{
  const f=await fixture(t);await f.before();
  const raw=nativeOutput();delete raw.metadata.truncated;
  await f.after(raw);assert.equal(raw.metadata.pulsoDurable.completeness,'complete');
  const first=await f.read();
  const result=await f.durable.replay(nativeReplay(f,nativeOutput()));
  assert.equal(result.capture,'stored');assert.equal(result.returnId,first.returns[0].returnId);
  assert.equal((await f.read()).returns.length,1);
});

test('raw capture orphan survives failed index commit and repairs through persisted native replay',async t=>{
  const f=await fixture(t);await f.before();
  const output=nativeOutput();delete output.metadata.truncated;
  const rename=fs.renameSync;let failed=false;
  fs.renameSync=(from,to)=>{if(to===path.join(f.project,'.pulso/delegations-v2.json')&&!failed){failed=true;throw Object.assign(new Error('fixture index commit failed'),{code:'EIO'});}return rename(from,to);};
  try{await f.after(output);}finally{fs.renameSync=rename;}
  assert.equal(failed,true);assert.equal(output.metadata.pulsoDurable.capture,'pending');
  const receipt=await f.durable.replay(nativeReplay(f,nativeOutput()));
  assert.equal(receipt.capture,'stored',JSON.stringify(receipt));
  const record=await f.read();assert.equal(record.returns.length,1);assert.equal(record.returns[0].completeness,'complete');
  assert.equal((await f.durable.replay(nativeReplay(f,nativeOutput()))).returnId,receipt.returnId);
});
