/** Core + disk + fresh Node processes. No host, model or adapter mocks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {executeTool,isMutating} from '../../core/lib/semantic-tools.mjs';
import {delegationKey,listDelegations,readDelegation,recordNativeDispatch,recordNativeReturn} from '../../core/lib/delegation-registry.mjs';
import {closeWork,completionReadiness,readWork} from '../../core/lib/artifacts.mjs';
import {readJSON} from '../../core/lib/fs.mjs';
import {assertSchema} from '../../core/lib/schema.mjs';

async function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-durable-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const projectRoot=path.join(temp,'workspace'),homeDir=path.join(temp,'home');fs.mkdirSync(projectRoot);fs.mkdirSync(homeDir);
  const context={projectRoot,homeDir,resourceRoot:fileURLToPath(new URL('../../core',import.meta.url))};
  const invoke=(tool,args,extra={})=>executeTool(tool,args,{...context,...extra});
  const call=async(tool,args,extra)=>{const r=await invoke(tool,args,extra);assert.equal(r.ok,true,JSON.stringify(r));if(r.data?.operation?.startsWith('work.'))assertSchema('work-receipt',r.data);return r.data;};
  await call('pulso_workspace',{action:'prepare'});
  const {workId}=await call('pulso_work',{action:'create',title:'Durable core fixture',objective:'Observe durable core behavior',criterion:'Preserve result',verification:'Real disk and Node assertions'});
  const work=()=>readWork(projectRoot,workId,{files:false});
  await call('pulso_work',{action:'update',workId,expectedRevision:work().revision,actions:['T-1','T-2','T-3'].map((id,i)=>({type:'task.add',task:{id,title:id,criterionIds:['AC-1'],agent:'pulso-executor',status:'in_progress',dependsOn:[],writeScope:[`repo/${i}`],resources:[],acceptance:['Preserve original result']}}))});
  const continuity=await call('pulso_workspace',{action:'bind_continuity',workId,requestKey:'bind-1',objective:'Fixture',repositories:['repo'],constraints:[]});
  const prep={action:'prepare_delegation',contractVersion:2,workId,expectedRevision:work().revision,continuityId:continuity.continuityId,intentRevision:1,requestKey:'prepare-1',taskIds:['T-1'],objective:'Real core fixture',inputs:[],output:'conversation',constraints:[],templateId:'implementation'};
  // White-box assertions explicitly recover the original snapshot; the public
  // preparation response itself remains compact and is tested separately.
  const prepare=async overrides=>{const result=await call('pulso_work',{...prep,...overrides});return call('pulso_work',result.readWith);};
  const accept=(record,overrides={})=>({action:'accept_result',contractVersion:2,workId,expectedRevision:work().revision,continuityId:continuity.continuityId,intentRevision:1,delegationId:record.delegationId,operationId:'accept-1',reportedReturn:{captureKey:'capture-1',markdown:'## Resultado\n\nLiteral report.\n'},decision:{status:'completed',summary:'Preserved',acceptedTaskIds:['T-1']},reportedTerminal:true,...overrides});
  return {context,projectRoot,call,invoke,workId,work,continuity,prep,prepare,accept};
}

test('v2 snapshot survives fresh process, same request reuses original revision and prompt',async t=>{
  const f=await fixture(t),r=await f.prepare();
  assert.equal(isMutating('pulso_work',f.prep),true);
  assert.equal(isMutating('pulso_work',{action:'prepare_delegation'}),true);
  assert.equal(r.contractVersion,2);assert.equal(r.intentionRevision,1);
  const moduleURL=new URL('../../core/lib/delegation-registry.mjs',import.meta.url).href;
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {readDelegation} from ${JSON.stringify(moduleURL)};console.log(JSON.stringify(readDelegation(process.argv[1],JSON.parse(process.argv[2]))));`,f.projectRoot,JSON.stringify({workId:f.workId,delegationId:r.delegationId})],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);const restored=JSON.parse(child.stdout);
  assert.deepEqual(restored.delegation,r.delegation);assert.deepEqual(restored.acceptanceBasis,r.acceptanceBasis);assert.equal(restored.specialistPrompt,r.specialistPrompt);
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'work.set_overview',summary:'Independent overview'}]});
  assert.equal((await f.prepare({expectedRevision:999})).delegationId,r.delegationId);
  const conflict=await f.invoke('pulso_work',{...f.prep,objective:'Changed'});assert.equal(conflict.ok,false);assert.match(conflict.error.message,/requestKey/);
});

test('public v2 prepare is compact and accepts by IDs without retrieving the canonical contract',async t=>{
  const f=await fixture(t),prepared=await f.call('pulso_work',f.prep);
  assert.deepEqual(Object.keys(prepared).sort(),['agent','assignmentCapabilities','contractVersion','continuityId','delegationId','intentRevision','preparedFromRevision','readWith','specialistPrompt','state','workId'].sort());
  assert.equal(prepared.agent,'pulso-executor');
  assert.deepEqual(await f.call('pulso_work',{...f.prep,expectedRevision:999}),prepared);
  assert.equal(prepared.preparedFromRevision,f.work().revision);assert.equal(prepared.state,'prepared');
  assert.equal(prepared.readWith.action,'get_delegation');assert.equal(prepared.readWith.delegationId,prepared.delegationId);
  const accepted=await f.call('pulso_work',f.accept(prepared));assert.equal(accepted.applied,true);
  const original=await f.call('pulso_work',prepared.readWith);
  assert.equal(original.specialistPrompt,prepared.specialistPrompt);assert.equal(original.delegation.id,prepared.delegationId);
  assert.equal(original.delegation.agent,prepared.agent);
  assert.ok(original.acceptanceBasis.tasks.length);assert.equal(original.hostContext.projectRoot,f.projectRoot);
});

test('legacy prepare retains its original receipt shape and does not create durable records',async t=>{
  const f=await fixture(t);
  const {contractVersion,expectedRevision,continuityId,intentRevision,requestKey,...legacy}=f.prep;
  const prepared=await f.call('pulso_work',{...legacy,delegationId:'legacy-prepare'});
  assert.deepEqual(Object.keys(prepared).sort(),['delegation','acceptanceBasis','specialistPrompt','hostContext','note'].sort());
  assert.equal(prepared.delegation.agent,'pulso-executor');
  assert.equal(prepared.delegation.id,'legacy-prepare');
  assert.equal(typeof prepared.specialistPrompt,'string');
  assert.equal(fs.existsSync(path.join(f.projectRoot,'.pulso/delegations-v2.json')),false);
});

test('reported capture and terminal become visible together even when revision rejects acceptance',async t=>{
  const f=await fixture(t),r=await f.prepare(),observed=[];
  const response=await f.invoke('pulso_work',f.accept(r,{expectedRevision:999}),{assertContext(){
    const entry=readJSON(f.projectRoot,'.pulso/delegations-v2.json').records.find(v=>v.delegationId===r.delegationId);
    if(entry.returns.length)observed.push({resolved:entry.reservationResolved,reconciliations:entry.reconciliations.length});
  }});
  assert.equal(response.ok,false);assert.equal(response.error.code,'REVISION_FUTURE');assert.equal(response.persistence.captured,true);
  assert.ok(observed.length>0);assert.ok(observed.every(v=>v.resolved&&v.reconciliations===1),'no observer sees a committed reported capture without its coherent terminal declaration');
  const saved=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});assert.equal(saved.returns.length,1);assert.equal(saved.reconciliations.length,1);assert.equal(saved.reconciliations[0].provenance,'orchestrator_reported');assert.equal((f.work().results||[]).length,0);
});

test('duplicate capture can newly declare terminal once without replacing literal or adding reconciliations',async t=>{
  const f=await fixture(t),r=await f.prepare(),args=f.accept(r,{decision:{status:'invalid'},reportedTerminal:false});
  const captured=await f.invoke('pulso_work',args);assert.equal(captured.ok,false);assert.equal(captured.persistence.captured,true);
  const first=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});assert.equal(first.reservationResolved,false);assert.equal(first.reconciliations.length,0);
  const declared=await f.invoke('pulso_work',{...args,reportedTerminal:true});assert.equal(declared.ok,false);assert.equal(declared.persistence.returnId,captured.persistence.returnId);
  const terminal=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});assert.equal(terminal.reservationResolved,true);assert.equal(terminal.reconciliations.length,1);assert.deepEqual(terminal.returns,first.returns);
  const indexPath=path.join(f.projectRoot,'.pulso/delegations-v2.json'),bytes=fs.readFileSync(indexPath);
  const retry=await f.invoke('pulso_work',{...args,reportedTerminal:true});assert.equal(retry.ok,false);assert.equal(retry.persistence.returnId,captured.persistence.returnId);assert.deepEqual(fs.readFileSync(indexPath),bytes);
});

test('valid report is captured before malformed semantics/revision; reuse returnId and lost receipt',async t=>{
  const f=await fixture(t),r=await f.prepare();
  const bad=await f.invoke('pulso_work',f.accept(r,{decision:{status:'nonsense'},expectedRevision:999}));
  assert.equal(bad.ok,false);assert.equal(bad.persistence.captured,true);
  const restored=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});
  assert.equal(restored.returns.length,1);assert.equal(restored.returns[0].returnId,bad.persistence.returnId);assert.equal(restored.returns[0].provenance,'orchestrator_reported');
  assert.equal(restored.reservationResolved,true);assert.equal((f.work().results||[]).length,0);
  const repeatPreparation=await f.invoke('pulso_work',{...f.prep,requestKey:'do-not-repeat'});assert.equal(repeatPreparation.ok,false);assert.match(repeatPreparation.error.message,/Reserva/);
  const semantic=await f.invoke('pulso_work',f.accept(r,{decision:{status:'nonsense'}}));
  assert.equal(semantic.ok,false);assert.equal(semantic.persistence.returnId,bad.persistence.returnId);
  const forged=await f.invoke('pulso_work',f.accept(r,{decision:{status:'completed',summary:'Preserved',acceptedTaskIds:['T-1'],markdown:'Rewritten'}}));
  assert.equal(forged.ok,false);assert.equal(forged.persistence.returnId,bad.persistence.returnId);
  const args=f.accept(r);delete args.reportedReturn;args.returnId=bad.persistence.returnId;
  const accepted=await f.call('pulso_work',args);
  assert.equal(accepted.applied,true);assert.equal(f.work().results.length,1);assert.equal(f.work().evidence.length,0);
  const original=readJSON(f.projectRoot,accepted.report);
  assert.deepEqual(original.delegation,r.delegation);assert.deepEqual(original.acceptanceBasis,r.acceptanceBasis);assert.equal(original.result.workRevision,r.delegation.workRevision);
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'work.set_overview',summary:'After acceptance'}]});
  for(const expectedRevision of [1,999]){
    const retry={...args,expectedRevision};delete retry.reportedTerminal;
    const repeat=await f.call('pulso_work',retry);
    assert.equal(repeat.resultId,accepted.resultId);assert.equal(repeat.duplicate,true);assert.equal(repeat.appliedRevision,accepted.appliedRevision);assert.equal(repeat.currentRevision,f.work().revision);assert.equal(repeat.currentPass,false);
  }
  assert.equal(f.work().results.length,1);
  const conflict=await f.invoke('pulso_work',{...args,decision:{...args.decision,summary:'Different'}});assert.equal(conflict.ok,false);assert.equal(conflict.persistence.returnId,args.returnId);
  assert.equal(readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId}).state,'accepted','accepted derives from Work; registry was never updated after acceptance');
});

test('future/old revision rejected for new decisions; overview reconciles but changed basis stays stale',async t=>{
  const f=await fixture(t),r=await f.prepare();
  for(const expectedRevision of [1,999]){const response=await f.invoke('pulso_work',f.accept(r,{expectedRevision}));assert.equal(response.ok,false);assert.equal(response.persistence.captured,true);}
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'work.set_overview',summary:'Overview only'}]});
  const accepted=await f.call('pulso_work',f.accept(r));assert.equal(accepted.duplicate,false);
  const r2=await f.prepare({requestKey:'prep-2',taskIds:['T-2'],expectedRevision:f.work().revision});
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'criterion.update',criterionId:'AC-1',description:'Different requirement',reason:'Deliberate change'}]});
  const stale=await f.invoke('pulso_work',f.accept(r2,{operationId:'op-2',decision:{status:'completed',summary:'Reported',acceptedTaskIds:['T-2']}}));
  assert.equal(stale.ok,false);assert.equal(stale.persistence.captured,true);assert.equal(f.work().tasks[1].status,'in_progress');
  assert.deepEqual(readDelegation(f.projectRoot,{workId:f.workId,delegationId:r2.delegationId}).acceptanceBasis,r2.acceptanceBasis);
});

test('structural task overlap, ancestor paths, explicit integration claims; independent work proceeds',async t=>{
  const f=await fixture(t);await f.prepare({taskIds:['T-1','T-2'],integrationResources:['repo']});
  const overlap=await f.invoke('pulso_work',{...f.prep,requestKey:'overlap',taskIds:['T-2','T-3']});assert.equal(overlap.ok,false);assert.match(overlap.error.message,/Reserva/);
  const integration=await f.invoke('pulso_work',{...f.prep,requestKey:'integration',taskIds:['T-3'],integrationResources:['repo']});assert.equal(integration.ok,false);
  const independent=await f.prepare({requestKey:'independent',taskIds:['T-3']});assert.ok(independent.delegationId);
});

test('native dispatch exact role/prompt, call correlation, literal return idempotency and late capture',async t=>{
  const f=await fixture(t),r=await f.prepare();
  const dispatch={workId:f.workId,delegationId:r.delegationId,sessionID:'host-session',callID:'host-call',agent:r.delegation.agent,prompt:r.specialistPrompt};
  assert.throws(()=>recordNativeDispatch(f.projectRoot,{...dispatch,prompt:'Modified'}),/Prompt/);
  recordNativeDispatch(f.projectRoot,dispatch);
  assert.deepEqual(recordNativeDispatch(f.projectRoot,dispatch).callID,'host-call');
  assert.throws(()=>recordNativeDispatch(f.projectRoot,{...dispatch,callID:'second-call'}),/redispatch/);
  const contradiction=await f.invoke('pulso_work',f.accept(r));assert.equal(contradiction.ok,false);assert.equal(contradiction.persistence.captured,true);assert.match(contradiction.error.message,/nativo/);
  const unresolved=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});assert.equal(unresolved.returns.length,1);assert.equal(unresolved.reservationResolved,false);assert.equal(unresolved.reconciliations.length,0);assert.equal(unresolved.attempts[0].resolution,'unresolved');
  await f.call('pulso_workspace',{action:'update_intent',continuityId:f.continuity.continuityId,expectedRevision:1,objective:'New prohibition',constraints:['No more execution']});
  assert.throws(()=>recordNativeDispatch(f.projectRoot,dispatch),/obsoleto/);
  const literal={workId:f.workId,delegationId:r.delegationId,sessionID:'host-session',callID:'host-call',markdown:'Literal host bytes\n\n',childSessionID:'child',completeness:'truncated'};
  const returnId=recordNativeReturn(f.projectRoot,literal);assert.equal(recordNativeReturn(f.projectRoot,literal),returnId);
  assert.throws(()=>recordNativeReturn(f.projectRoot,{...literal,markdown:'Changed'}),/Captura/);
  assert.throws(()=>recordNativeReturn(f.projectRoot,{...literal,sessionID:'another'}),/correlacionado/);
  const read=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});assert.equal(read.returns[1].markdown,literal.markdown);assert.equal(read.returns[1].completeness,'truncated');assert.equal(read.attempts[0].resolution,'host_terminal');
});

test('native callID is session-scoped: disjoint continuities dispatch independently without crossed returns',async t=>{
  const f=await fixture(t),sessionA='native-parent-a',sessionB='native-parent-b',callID='shared-host-call';
  const bind=(requestKey,repositories,sessionID)=>f.call('pulso_workspace',{action:'bind_continuity',workId:f.workId,requestKey,objective:requestKey,repositories,constraints:[]},{nativeContext:{sessionID}});
  const a=await bind('session-a',['repo/0','repo/2'],sessionA),b=await bind('session-b',['repo/1'],sessionB);
  const prepare=async(continuity,taskId,requestKey,sessionID)=>{
    const result=await f.call('pulso_work',{...f.prep,continuityId:continuity.continuityId,taskIds:[taskId],requestKey},{nativeContext:{sessionID}});
    return f.call('pulso_work',result.readWith,{nativeContext:{sessionID}});
  };
  const first=await prepare(a,'T-1','dispatch-a',sessionA),second=await prepare(b,'T-2','dispatch-b',sessionB),third=await prepare(a,'T-3','dispatch-a-conflict',sessionA);
  const dispatch=(record,sessionID)=>({workId:f.workId,delegationId:record.delegationId,sessionID,callID,agent:record.delegation.agent,prompt:record.specialistPrompt});
  const read=record=>readDelegation(f.projectRoot,{workId:f.workId,delegationId:record.delegationId});
  recordNativeDispatch(f.projectRoot,dispatch(first,sessionA));
  recordNativeDispatch(f.projectRoot,dispatch(second,sessionB));
  assert.throws(()=>recordNativeDispatch(f.projectRoot,dispatch(third,sessionA)),/Correlación/,'same session/call pair cannot identify another delegation');
  assert.equal(read(third).attempts.length,0);
  for(const [record,wrongSession] of [[first,sessionB],[second,sessionA]]){
    assert.throws(()=>recordNativeReturn(f.projectRoot,{workId:f.workId,delegationId:record.delegationId,sessionID:wrongSession,callID,markdown:'Crossed return must not persist'}),/correlacionado/);
    assert.equal(read(record).returns.length,0);
    assert.equal(read(record).attempts[0].resolution,'unresolved');
  }
  const returned=(record,sessionID,markdown)=>({workId:f.workId,delegationId:record.delegationId,sessionID,callID,markdown,childSessionID:`child-${sessionID}`,completeness:'complete'});
  const returnB=returned(second,sessionB,'Literal B\n'),returnIdB=recordNativeReturn(f.projectRoot,returnB);
  assert.equal(read(first).attempts[0].resolution,'unresolved','terminal B cannot resolve A');
  assert.equal(read(first).returns.length,0);
  const returnA=returned(first,sessionA,'Literal A\n'),returnIdA=recordNativeReturn(f.projectRoot,returnA);
  assert.notEqual(returnIdA,returnIdB);
  for(const [record,args,returnId] of [[first,returnA,returnIdA],[second,returnB,returnIdB]]){
    assert.equal(recordNativeReturn(f.projectRoot,args),returnId);
    const saved=read(record);assert.equal(saved.attempts.length,1);assert.equal(saved.returns.length,1);
    assert.equal(saved.attempts[0].sessionID,args.sessionID);assert.equal(saved.attempts[0].callID,callID);assert.equal(saved.attempts[0].resolution,'host_terminal');
    assert.equal(saved.returns[0].returnId,returnId);assert.equal(saved.returns[0].sessionID,args.sessionID);assert.equal(saved.returns[0].childSessionID,args.childSessionID);assert.equal(saved.returns[0].markdown,args.markdown);assert.equal(saved.returns[0].provenance,'host_capture');
  }
  assert.throws(()=>readDelegation(f.projectRoot,{workId:f.workId,delegationId:'DEL-genuinely-absent'}),error=>error.code==='DELEGATION_NOT_FOUND');
});

test('denial, model-supplied native refs, invalid envelope and corrupt sidecar do not write',async t=>{
  const f=await fixture(t),r=await f.prepare();
  const file=path.join(f.projectRoot,'.pulso/delegations-v2.json'),before=fs.readFileSync(file,'utf8');
  const denied=await f.invoke('pulso_work',f.accept(r),{assertContext(){throw new Error('Permission revoked');}});assert.equal(denied.ok,false);assert.equal(denied.persistence,undefined);
  for(const args of [{...f.accept(r),sessionID:'model'}, {...f.accept(r),returnId:'RET-fake'},{...f.accept(r),reportedReturn:{captureKey:'c',markdown:''}}])assert.equal((await f.invoke('pulso_work',args)).ok,false);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.throws(()=>recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId:r.delegationId,sessionID:'s',callID:'c',agent:r.delegation.agent,prompt:r.specialistPrompt},{assertContext(){throw new Error('denied');}}),/denied/);
  const altered=before.replace('"reservationResolved": false','"reservationResolved": true');assert.notEqual(altered,before);fs.writeFileSync(file,altered);
  assert.throws(()=>readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId}),/corrupto/);
  const corrupted=fs.readFileSync(file,'utf8');assert.equal((await f.invoke('pulso_work',f.accept(r))).ok,false);assert.equal(fs.readFileSync(file,'utf8'),corrupted);
});

test('accept_delivery operationId recovers historical receipt without duplicating manual evidence',async t=>{
  const f=await fixture(t),args={action:'accept_delivery',workId:f.workId,expectedRevision:f.work().revision,operationId:'delivery-1',criterionIds:['AC-1'],summary:'User acceptance reported',source:{text:'Accepted'},limitations:[]};
  const first=await f.call('pulso_work',args);assert.equal(first.closed,false);
  const duplicate=await f.call('pulso_work',{...args,expectedRevision:999});assert.equal(duplicate.evidenceId,first.evidenceId);assert.equal(duplicate.duplicate,true);assert.equal(f.work().evidence.length,1);
  assert.equal((await f.invoke('pulso_work',{...args,source:{text:'Different'}})).ok,false);
});

test('two real processes contend for one durable task reservation without duplicate snapshots',async t=>{
  const f=await fixture(t),moduleURL=new URL('../../core/lib/semantic-tools.mjs',import.meta.url).href;
  const source=`import {executeTool} from ${JSON.stringify(moduleURL)};console.log(JSON.stringify(await executeTool('pulso_work',JSON.parse(process.argv[1]),JSON.parse(process.argv[2]))));`;
  const run=key=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',source,JSON.stringify({...f.prep,requestKey:key}),JSON.stringify(f.context)],{stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',code=>{try{assert.equal(code,0,stderr);resolve(JSON.parse(stdout));}catch(error){reject(error);}});
  });
  const responses=await Promise.all([run('process-a'),run('process-b')]);
  assert.equal(responses.filter(r=>r.ok).length,1,JSON.stringify(responses));
  const rejected=responses.find(r=>!r.ok);assert.match(rejected.error.message,/Reserva|METADATA_BUSY/);
  assert.equal(readJSON(f.projectRoot,'.pulso/delegations-v2.json').records.length,1);
});

test('completed task cannot be prepared again without deliberate acceptance revision',async t=>{
  const f=await fixture(t),r=await f.prepare();await f.call('pulso_work',f.accept(r));
  const next={...f.prep,requestKey:'next',expectedRevision:f.work().revision};
  assert.equal((await f.invoke('pulso_work',next)).ok,false);
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'task.update',taskId:'T-1',patch:{acceptance:['Repair newly observed condition']},reason:'Deliberate repair after acceptance'}]});
  const repairedResponse=await f.call('pulso_work',{...next,expectedRevision:f.work().revision}),repaired=await f.call('pulso_work',repairedResponse.readWith);assert.notEqual(repaired.delegationId,r.delegationId);
  assert.notDeepEqual(repaired.acceptanceBasis,r.acceptanceBasis);
});

test('context revoked after actual capture preserves returnId on rejection',async t=>{
  const f=await fixture(t),r=await f.prepare();
  const args=f.accept(r);
  // The assertion inspects actual persistence, not a fabricated host lifecycle.
  const afterCapture=await f.invoke('pulso_work',args,{assertContext(){if(readJSON(f.projectRoot,'.pulso/delegations-v2.json').records[0].returns.length)throw new Error('Revoked after capture');}});
  assert.equal(afterCapture.ok,false);assert.equal(afterCapture.persistence.captured,true);assert.ok(afterCapture.persistence.returnId);
  assert.equal((f.work().results||[]).length,0);
});

test('retired native attempt retains claims until its correlated terminal; native base staleness blocks dispatch',async t=>{
  const f=await fixture(t),r=await f.prepare();
  const dispatch={workId:f.workId,delegationId:r.delegationId,sessionID:'s',callID:'call',agent:r.delegation.agent,prompt:r.specialistPrompt};
  recordNativeDispatch(f.projectRoot,dispatch);
  const retired=await f.call('pulso_work',{action:'reconcile_delegation',workId:f.workId,delegationId:r.delegationId,continuityId:f.continuity.continuityId,intentRevision:1,reason:'Superseded; no physical cancellation claimed',resolution:'retired'});
  assert.equal(retired.reservationResolved,false);assert.equal(retired.attempts[0].resolution,'unresolved');
  assert.equal((await f.invoke('pulso_work',{...f.prep,requestKey:'repeat'})).ok,false);
  recordNativeReturn(f.projectRoot,{workId:f.workId,delegationId:r.delegationId,sessionID:'s',callID:'call',markdown:'Terminal observed'});
  const replacement=await f.prepare({requestKey:'replacement'});
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'criterion.update',criterionId:'AC-1',description:'Changed before dispatch',reason:'New requirement'}]});
  assert.throws(()=>recordNativeDispatch(f.projectRoot,{...dispatch,delegationId:replacement.delegationId,prompt:replacement.specialistPrompt,callID:'new-call'}),/obsolet|vigente|aceptación/i);
});

test('public close cannot bypass unresolved reservation after canonical acceptance',async t=>{
  const f=await fixture(t),r=await f.prepare();
  await f.call('pulso_work',f.accept(r,{reportedTerminal:false}));
  const response=await f.invoke('pulso_work',{action:'close',workId:f.workId,expectedRevision:f.work().revision,outcome:'cancelled',summary:'Close without reconciling'});
  assert.equal(response.ok,false);assert.match(response.error.message,/Reconciliar encargos/);assert.equal(f.work().closure,null);
});

test('readiness, direct done/cancelled close, public close and accept_delivery agree on pending delegation',async t=>{
  const f=await fixture(t);
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[
    {type:'criterion.update',criterionId:'AC-1',acceptanceMode:'user',reason:'Explicit fixture user lane'},
    ...['T-2','T-3'].map(taskId=>({type:'task.set_status',taskId,status:'cancelled',summary:'Not needed in this fixture'}))
  ]});
  const r=await f.prepare({expectedRevision:f.work().revision});
  await f.call('pulso_work',f.accept(r,{reportedTerminal:false}));
  const args={action:'accept_delivery',workId:f.workId,expectedRevision:f.work().revision,operationId:'delivery-ready',criterionIds:['AC-1'],summary:'Accepted',source:{text:'User accepted fixture'},limitations:[]};
  const delivery=await f.call('pulso_work',args);assert.equal(delivery.closed,false);
  const direct=completionReadiness(f.projectRoot,f.work());
  assert.deepEqual(direct.issues.map(v=>v.code),['DELEGATIONS_PENDING']);assert.deepEqual(delivery.readiness,direct);
  const get=await f.call('pulso_work',{action:'get',workId:f.workId});assert.deepEqual(get.readiness,direct);
  for(const outcome of ['done','cancelled']){
    assert.throws(()=>closeWork(f.projectRoot,f.workId,{outcome,summary:'Close'}),e=>e.code==='CLOSURE_NOT_READY'&&e.issues.some(v=>v.code==='DELEGATIONS_PENDING'));
    const response=await f.invoke('pulso_work',{action:'close',workId:f.workId,expectedRevision:f.work().revision,outcome,summary:'Close'});
    assert.equal(response.ok,false);assert.ok(response.error.issues.some(v=>v.code==='DELEGATIONS_PENDING'));
  }
  await f.call('pulso_work',{action:'reconcile_delegation',workId:f.workId,delegationId:r.delegationId,continuityId:f.continuity.continuityId,intentRevision:1,reason:'Reported work ended',resolution:'reported_terminal'});
  assert.equal(completionReadiness(f.projectRoot,f.work()).ready,true);
  const closed=closeWork(f.projectRoot,f.workId,{summary:'Close'});assert.equal(closed.status,'done');
  assert.equal(f.work().status,'done','readWork of a closed Work does not recurse through delegation lookup');
  const duplicate=await f.call('pulso_work',{...args,expectedRevision:999});assert.equal(duplicate.duplicate,true);assert.equal(duplicate.closed,true);
  assert.throws(()=>assertSchema('work-receipt',{...duplicate,unknownField:true}),/desconocido/);
  assert.throws(()=>assertSchema('work-receipt',{...duplicate,currentPass:'yes'}),/tipo esperado/);
});

test('explicit inspected reconciliation releases a missed native terminal without claiming host_terminal',async t=>{
  const f=await fixture(t),r=await f.prepare();
  recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId:r.delegationId,sessionID:'s',callID:'missed',agent:r.delegation.agent,prompt:r.specialistPrompt});
  assert.throws(()=>closeWork(f.projectRoot,f.workId,{outcome:'cancelled',summary:'Cannot abandon native running'}),e=>e.code==='CLOSURE_NOT_READY'&&e.issues.some(v=>v.code==='DELEGATIONS_PENDING'));
  const args={action:'reconcile_delegation',workId:f.workId,delegationId:r.delegationId,continuityId:f.continuity.continuityId,intentRevision:1,reason:'Inspected host transcript after restart',resolution:'explicitly_reconciled'};
  assert.equal((await f.invoke('pulso_work',args)).ok,false);
  const reconciled=await f.call('pulso_work',{...args,source:{text:'Reviewed retained host transcript; dispatch no longer running',messageRef:'inspection-2026-10-12'}});
  assert.equal(reconciled.reservationResolved,true);assert.equal(reconciled.attempts[0].resolution,'explicitly_reconciled');
  assert.equal(reconciled.reconciliations[0].source.messageRef,'inspection-2026-10-12');assert.equal(reconciled.reconciliations[0].provenance,'orchestrator_reported');assert.ok(reconciled.reconciliations[0].limitations.length);
  const accepted=await f.call('pulso_work',f.accept(r));assert.equal(accepted.applied,true);
  assert.equal(readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId}).attempts[0].resolution,'explicitly_reconciled');
});

test('capture blob survives index failure; stable capture key repairs without another return or dispatch',async t=>{
  const f=await fixture(t),r=await f.prepare();
  recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId:r.delegationId,sessionID:'s',callID:'blob',agent:r.delegation.agent,prompt:r.specialistPrompt});
  const directory=path.join(f.projectRoot,'.pulso/delegations-v2',r.delegationId,'returns');
  const args={workId:f.workId,delegationId:r.delegationId,sessionID:'s',callID:'blob',markdown:'Literal captured before permission revoked',completeness:'complete'};
  let failure;
  try{recordNativeReturn(f.projectRoot,args,{assertContext(){if(fs.existsSync(directory)&&fs.readdirSync(directory).some(p=>p.endsWith('.json')))throw new Error('Revoked after blob write');}});}catch(error){failure=error;}
  assert.equal(failure.persistence.captured,true);const returnId=failure.persistence.returnId;
  const orphan=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});assert.equal(orphan.returns[0].returnId,returnId);assert.equal(orphan.returns[0].markdown,args.markdown);assert.equal(orphan.returns[0].orphan,true);assert.equal(orphan.attempts[0].resolution,'unresolved');
  assert.equal(recordNativeReturn(f.projectRoot,args),returnId);
  const repaired=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});assert.equal(repaired.returns.length,1);assert.equal(repaired.returns[0].orphan,undefined);assert.equal(repaired.attempts.length,1);assert.equal(repaired.attempts[0].resolution,'host_terminal');
  assert.equal(fs.readdirSync(directory).filter(p=>p.endsWith('.json')).length,1);
});

test('preparation orphan recovers same immutable snapshot and generated ID after index failure',async t=>{
  const f=await fixture(t),delegationId=delegationKey(f.prep),snapshot=path.join(f.projectRoot,'.pulso/delegations-v2',delegationId,'snapshot.json');
  const failed=await f.invoke('pulso_work',f.prep,{assertContext(){if(fs.existsSync(snapshot))throw new Error('Revoked after snapshot');}});
  assert.equal(failed.ok,false);assert.equal(failed.persistence.delegationId,delegationId);
  const orphan=await f.call('pulso_work',{action:'get_delegation',workId:f.workId,delegationId});assert.equal(orphan.registered,false);assert.equal(orphan.state,'prepared');
  const bytes=fs.readFileSync(snapshot,'utf8'),recovered=await f.prepare();assert.equal(recovered.delegationId,delegationId);assert.equal(fs.readFileSync(snapshot,'utf8'),bytes);
  assert.equal(readJSON(f.projectRoot,'.pulso/delegations-v2.json').records.length,1);
});

test('missing authority cannot be mistaken for an empty registry or rebuilt partially',async t=>{
  const f=await fixture(t),r=await f.prepare(),file=path.join(f.projectRoot,'.pulso/delegations-v2.json');
  const original=fs.readFileSync(file,'utf8');fs.renameSync(file,`${file}.backup`);
  assert.throws(()=>readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId}),/Índice.*ausente/);
  const failed=await f.invoke('pulso_work',{...f.prep,requestKey:'must-not-rebuild'});assert.equal(failed.ok,false);assert.equal(fs.existsSync(file),false);
  assert.ok(completionReadiness(f.projectRoot,f.work()).issues.some(v=>v.code==='DELEGATIONS_INVALID'));
  assert.throws(()=>closeWork(f.projectRoot,f.workId,{outcome:'cancelled',summary:'Unsafe close'}),/Índice.*ausente/);
  fs.renameSync(`${file}.backup`,file);assert.equal(fs.readFileSync(file,'utf8'),original);assert.equal(readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId}).delegationId,r.delegationId);
});

test('not_dispatched cannot release a task whose reported capture survived only as an orphan blob',async t=>{
  const f=await fixture(t),r=await f.prepare();
  const directory=path.join(f.projectRoot,'.pulso/delegations-v2',r.delegationId,'returns');
  const indexPath=path.join(f.projectRoot,'.pulso/delegations-v2.json'),before=fs.readFileSync(indexPath);
  const failed=await f.invoke('pulso_work',f.accept(r),{assertContext(){
    if(fs.existsSync(directory)&&fs.readdirSync(directory).some(name=>name.endsWith('.json')))throw new Error('Revoked after reported capture blob, before index');
  }});
  assert.equal(failed.ok,false);assert.equal(failed.persistence.captured,true);
  const orphan=await f.call('pulso_work',{action:'get_delegation',workId:f.workId,delegationId:r.delegationId});
  assert.equal(orphan.returns.length,1);assert.equal(orphan.returns[0].orphan,true);assert.equal(orphan.returns[0].returnId,failed.persistence.returnId);
  assert.equal(orphan.reservationResolved,false);assert.equal(orphan.attempts.length,0);assert.deepEqual(fs.readFileSync(indexPath),before);
  const rejected=await f.invoke('pulso_work',{action:'reconcile_delegation',workId:f.workId,delegationId:r.delegationId,continuityId:f.continuity.continuityId,intentRevision:1,reason:'Incorrectly claimed no dispatch',resolution:'not_dispatched'});
  assert.equal(rejected.ok,false);assert.match(rejected.error.message,/contradice intento\/retorno/);
  const replacement=await f.invoke('pulso_work',{...f.prep,requestKey:'must-not-replace-orphan-capture'});
  assert.equal(replacement.ok,false);assert.match(replacement.error.message,/Reserva/);
  assert.deepEqual(fs.readFileSync(indexPath),before,'rejection neither promotes the orphan nor releases claims');
  const preserved=readDelegation(f.projectRoot,{workId:f.workId,delegationId:r.delegationId});
  assert.equal(preserved.returns[0].orphan,true);assert.equal(preserved.reconciliations.length,0);assert.equal((f.work().results||[]).length,0);
});

test('orphan preparation cannot revive completed, cancelled, closed, missing or reassigned tasks',async t=>{
  for(const scenario of ['completed','cancelled','closed','missing','reassigned']){
    const f=await fixture(t),delegationId=delegationKey(f.prep),snapshotPath=path.join(f.projectRoot,'.pulso/delegations-v2',delegationId,'snapshot.json');
    const failed=await f.invoke('pulso_work',f.prep,{assertContext(){if(fs.existsSync(snapshotPath))throw new Error('Revoked after orphan snapshot, before registration');}});
    assert.equal(failed.ok,false,scenario);assert.equal(failed.persistence.delegationId,delegationId);
    const bytes=fs.readFileSync(snapshotPath),original=await f.call('pulso_work',{action:'get_delegation',workId:f.workId,delegationId});
    assert.equal(original.registered,false);
    if(scenario==='completed'){
      const other=await f.prepare({requestKey:'actually-completed'});
      await f.call('pulso_work',f.accept(other));
      assert.equal(f.work().tasks.find(task=>task.id==='T-1').status,'done');assert.equal(f.work().results.length,1);
      assert.deepEqual(f.work().results[0].acceptanceBasis,original.acceptanceBasis,'completion alone did not change the original basis');
    }else if(scenario==='closed'){
      closeWork(f.projectRoot,f.workId,{outcome:'cancelled',summary:'Closed before recovering orphan preparation'});
    }else{
      const action=scenario==='cancelled'?{type:'task.set_status',taskId:'T-1',status:'cancelled',summary:'Cancelled before recovery'}:
        scenario==='missing'?{type:'task.remove',taskId:'T-1'}:
        {type:'task.update',taskId:'T-1',patch:{agent:'pulso-explorer'},reason:'Reassigned before recovery'};
      await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[action]});
    }
    const indexPath=path.join(f.projectRoot,'.pulso/delegations-v2.json'),index=fs.readFileSync(indexPath);
    const retry=await f.invoke('pulso_work',{...f.prep,expectedRevision:f.work().revision});
    assert.equal(retry.ok,false,scenario);assert.match(retry.error.message,/cerrado|cancelada|realizada|inexistente|asignación/,scenario);
    assert.throws(()=>recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId,sessionID:'s',callID:`no-second-dispatch-${scenario}`,agent:original.delegation.agent,prompt:original.specialistPrompt}),/Encargo no encontrado/,scenario);
    assert.deepEqual(fs.readFileSync(indexPath),index);assert.deepEqual(fs.readFileSync(snapshotPath),bytes);
    const preserved=await f.call('pulso_work',{action:'get_delegation',workId:f.workId,delegationId});assert.equal(preserved.registered,false);assert.equal(preserved.attempts.length,0);
    if(scenario==='completed'){
      assert.equal(f.work().results.length,1);
      await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'task.update',taskId:'T-1',patch:{acceptance:['Deliberate repair requires a fresh snapshot']},reason:'New repair after completion'}]});
      assert.equal((await f.invoke('pulso_work',{...f.prep,expectedRevision:f.work().revision})).ok,false,'deliberate repair cannot refresh the old orphan');
      const repaired=await f.prepare({requestKey:'fresh-repair',expectedRevision:f.work().revision});
      assert.notEqual(repaired.delegationId,delegationId);assert.notDeepEqual(repaired.acceptanceBasis,original.acceptanceBasis);
      recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId:repaired.delegationId,sessionID:'s',callID:'fresh-repair-dispatch',agent:repaired.delegation.agent,prompt:repaired.specialistPrompt});
      assert.equal(f.work().results.length,1,'repair preparation/dispatch does not duplicate the accepted result');
    }
  }
});

test('per-ID I/O: large and poisoned unrelated capture/snapshot cannot affect read, claims or compact capsule',async t=>{
  const f=await fixture(t),chosen=await f.prepare(),outside=await f.prepare({requestKey:'outside',taskIds:['T-2']});
  recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId:outside.delegationId,sessionID:'s',callID:'large',agent:outside.delegation.agent,prompt:outside.specialistPrompt});
  const returnId=recordNativeReturn(f.projectRoot,{workId:f.workId,delegationId:outside.delegationId,sessionID:'s',callID:'large',markdown:'x'.repeat(3000000)});
  const indexPath=path.join(f.projectRoot,'.pulso/delegations-v2.json'),indexBytes=fs.statSync(indexPath).size;
  assert.ok(indexBytes<20000,`${indexBytes} index bytes must not scale with 3MB Markdown`);
  const outsideFolder=path.join(f.projectRoot,'.pulso/delegations-v2',outside.delegationId);
  const index=readJSON(f.projectRoot,'.pulso/delegations-v2.json'),entry=index.records.find(v=>v.delegationId===outside.delegationId);
  const state=readJSON(f.projectRoot,entry.recordRef.path);assert.equal(state.record.returns[0].markdown,undefined);assert.ok(fs.statSync(path.join(f.projectRoot,entry.recordRef.path)).size<10000);
  fs.writeFileSync(path.join(outsideFolder,'returns',`${returnId}.json`),'poisoned unrelated body');fs.writeFileSync(path.join(outsideFolder,'snapshot.json'),'poisoned unrelated snapshot');
  const times=[];
  for(let i=0;i<12;i++){const start=performance.now();assert.equal(readDelegation(f.projectRoot,{workId:f.workId,delegationId:chosen.delegationId}).delegationId,chosen.delegationId);times.push(performance.now()-start);}
  assert.equal(listDelegations(f.projectRoot,{continuityId:f.continuity.continuityId}).length,2);
  const capsule=await f.call('pulso_workspace',{action:'get_continuity',continuityId:f.continuity.continuityId});assert.equal(capsule.delegations.length,2);assert.ok(JSON.stringify(capsule).length<12000);
  await f.prepare({requestKey:'third',taskIds:['T-3']});
  assert.throws(()=>readDelegation(f.projectRoot,{workId:f.workId,delegationId:outside.delegationId}),/JSON|corrupt/);
  times.sort((a,b)=>a-b);t.diagnostic(JSON.stringify({node:process.version,platform:process.platform,samples:times.length,selectedReadP50ms:times[5],selectedReadP95ms:times[11],indexBytes,unrelatedMarkdownBytes:3000000}));
});
