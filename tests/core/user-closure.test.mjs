import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {executeTool,isMutating} from '../../core/lib/semantic-tools.mjs';
import {readWork,completionReadiness} from '../../core/lib/artifacts.mjs';
import {recordNativeDispatch,readDelegation} from '../../core/lib/delegation-registry.mjs';
import {assertSchema} from '../../core/lib/schema.mjs';
import {temp,atomicWrite,fingerprint,writeJSON} from './helpers.mjs';

async function fixture(t){
  const projectRoot=temp(t),homeDir=temp(t),context={projectRoot,homeDir};
  const invoke=(tool,args,extra={})=>executeTool(tool,args,{...context,...extra});
  const call=async(tool,args)=>{const r=await invoke(tool,args);assert.equal(r.ok,true,JSON.stringify(r));if(r.data?.operation?.startsWith('work.'))assertSchema('work-receipt',r.data);return r.data;};
  await call('pulso_workspace',{action:'prepare'});
  const {workId}=await call('pulso_work',{action:'create',title:'Explicit closure fixture',objective:'Preserve tracking',criterion:'Technical contract',verification:'Fixture assertions'});
  const work=()=>readWork(projectRoot,workId,{files:false});
  const update=actions=>call('pulso_work',{action:'update',workId,expectedRevision:work().revision,actions});
  await update([{type:'task.add',task:{id:'T-1',title:'Fixture task',criterionIds:['AC-1'],agent:'pulso-executor',status:'pending',dependsOn:[],writeScope:['src'],resources:[],acceptance:['Observed result']}}]);
  const request=()=>({action:'close_by_user',workId,expectedRevision:work().revision,operationId:'close-user-1',summary:'User reviewed and approved all work',source:{text:'Cierra todos, ya terminé y desplegué',messageRef:'message-1'},limitations:['Approval authority is the user; no machine execution claimed']});
  const prepare=async()=>{
    const continuity=await call('pulso_workspace',{action:'bind_continuity',workId,requestKey:'bind',objective:'Fixture',repositories:['src'],constraints:[]});
    const record=await call('pulso_work',{action:'prepare_delegation',contractVersion:2,workId,expectedRevision:work().revision,continuityId:continuity.continuityId,intentRevision:1,requestKey:'prepare',taskIds:['T-1'],objective:'Fixture',inputs:[],output:'conversation',constraints:[],templateId:'implementation'});
    return {record,continuity};
  };
  return {projectRoot,invoke,call,workId,work,update,request,prepare};
}

for(const scenario of ['pending','stale','blocked','fail'])test(`user approval supersedes ${scenario} diagnosis and preserves historical observations`,async t=>{
  const f=await fixture(t);
  if(scenario!=='pending'){
    atomicWrite(f.projectRoot,'src/value.txt','original');atomicWrite(f.projectRoot,'report.txt','Fixture observation');
    const {acceptanceBasis}=await f.call('pulso_work',{action:'get',workId:f.workId});
    await f.update([{type:'evidence.add',evidence:{id:'E-1',kind:'static',status:scenario==='fail'?'fail':'pass',checkedAt:new Date().toISOString(),criterionIds:['AC-1'],taskIds:['T-1'],report:'report.txt',command:null,cwd:'.',exitCode:null,basis:'Synthetic fixture',files:[fingerprint(f.projectRoot,'src/value.txt'),fingerprint(f.projectRoot,'report.txt')],summary:'Fixture observation',acceptanceBasis}}]);
    if(scenario==='stale'){
      await f.update([{type:'task.set_status',taskId:'T-1',status:'done',summary:'Fixture task completed'}]);
      atomicWrite(f.projectRoot,'src/value.txt','changed');
    }
    if(scenario==='blocked')await f.update([{type:'work.set_overview',status:'blocked',blockers:['External dependency'],decisionsPending:['Await owner']},{type:'task.set_status',taskId:'T-1',status:'blocked'}]);
  }
  const before=f.work(),diagnosis=completionReadiness(f.projectRoot,before);
  const technical=await f.invoke('pulso_work',{action:'close',workId:f.workId,expectedRevision:before.revision,summary:'Technical close'});
  assert.equal(technical.ok,false);assert.equal(technical.error.code,'CLOSURE_NOT_READY');
  const response=await f.invoke('pulso_work',f.request());assert.equal(response.ok,true,JSON.stringify(response));
  assertSchema('work-receipt',response.data);assert.equal(response.data.closed,true);assert.equal(response.data.verification,'user_approved');assert.equal(response.data.authority,'user');assert.equal(response.data.technicalVerification,undefined);assert.doesNotMatch(response.output,/Cierre pendiente|no acreditada/);
  assert.deepEqual(response.data.readiness,{ready:true,issues:[],revision:before.revision+1,evidenceIds:[],authority:'user',verification:'user_approved'});assert.equal(diagnosis.ready,false);
  assertSchema('closure-readiness',response.data.readiness);
  if(scenario==='stale')assert.ok(diagnosis.issues.some(i=>i.code==='EVIDENCE_STALE'));
  if(scenario==='fail')assert.ok(diagnosis.issues.some(i=>i.code==='EVIDENCE_NOT_POSITIVE'));
  const closed=f.work();assert.equal(closed.status,'done');assert.equal(closed.closure.mode,'user_requested');
  for(const key of ['objective','results','evidence','acceptanceChanges'])assert.deepEqual(closed[key],before[key],key);
  assert.equal(closed.tasks[0].status,'done');assert.deepEqual(closed.completedTaskIds,['T-1']);
  if(before.tasks[0].status!=='done')assert.match(closed.tasks[0].summary,/aprobada por usuario/);
  assert.deepEqual(closed.blockers,[]);assert.deepEqual(closed.decisionsPending,[]);assert.equal(closed.nextAction,null);
  assert.deepEqual(closed.closure.userRequest.readinessBefore,diagnosis);
  assert.deepEqual(closed.closure.userRequest.blockers,before.blockers);assert.deepEqual(closed.closure.userRequest.decisionsPending,before.decisionsPending);
  assert.deepEqual(closed.closure.userRequest.approval,{authority:'user',verification:'user_approved',criterionIds:['AC-1'],taskIds:['T-1'],cancelledTaskIds:[]});
  const history=await f.call('pulso_history',{workId:f.workId});assert.equal(history.items.length,1);
  assert.equal(history.items[0].mode,'user_requested');assert.deepEqual(history.items[0].userRequest,closed.closure.userRequest);
  assert.deepEqual(history.items[0].userRequest.taskStatuses,before.tasks.map(({id,status,summary})=>({id,status,summary})));
  assert.equal((await f.call('pulso_workspace',{action:'status'})).works.items.length,0);
  await f.call('pulso_workspace',{action:'sync',workId:f.workId,expectedRevision:closed.revision});
  await f.call('pulso_workspace',{action:'recover'});
  await f.call('pulso_workspace',{action:'validate',fresh:true});
  const read=await f.call('pulso_work',{action:'get',workId:f.workId,section:'all'});assert.deepEqual(read.readiness,response.data.readiness);assert.deepEqual(read.tasks.items,closed.tasks);assert.equal(read.verification,'user_approved');
  assert.deepEqual(completionReadiness(f.projectRoot,closed,{fresh:true}),read.readiness);
  await f.call('pulso_work',{action:'reopen',workId:f.workId,expectedRevision:closed.revision,reason:'New review cycle'});
  assert.deepEqual(f.work().evidence,before.evidence);assert.equal(completionReadiness(f.projectRoot,f.work()).ready,false);
  const reopenedClose=await f.invoke('pulso_work',{action:'close',workId:f.workId,expectedRevision:f.work().revision,summary:'Technical approval required again'});assert.equal(reopenedClose.ok,false);assert.equal(reopenedClose.error.code,'CLOSURE_NOT_READY');
});

test('operation IDs are stable, reject changed contents and cannot close a reopened cycle',async t=>{
  const f=await fixture(t),args=f.request();assert.equal(isMutating('pulso_work',args),true);
  await f.call('pulso_work',args);const bytes=fs.readFileSync(path.join(f.projectRoot,'.pulso/history.jsonl'),'utf8');
  const duplicate=await f.call('pulso_work',{...args,expectedRevision:999,source:{messageRef:args.source.messageRef,text:args.source.text}});
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.revision,args.expectedRevision+1);
  assert.equal(fs.readFileSync(path.join(f.projectRoot,'.pulso/history.jsonl'),'utf8'),bytes);
  for(const change of [{summary:'different'},{source:{text:'Other declaration'}},{limitations:[]}]){
    const conflict=await f.invoke('pulso_work',{...args,...change});assert.equal(conflict.ok,false);assert.match(conflict.error.message,/contenido diferente/);
  }
  await f.call('pulso_work',{action:'reopen',workId:f.workId,expectedRevision:f.work().revision,reason:'New cycle'});
  const reopened=await f.call('pulso_work',{action:'get',workId:f.workId,section:'all'});
  assert.equal(reopened.verification,undefined);assert.equal(reopened.readiness.ready,false);assert.equal(reopened.readiness.authority,undefined);assert.equal(reopened.tasks.items[0].status,'pending');assert.deepEqual(f.work().completedTaskIds,[]);
  const strict=await f.invoke('pulso_work',{action:'close',workId:f.workId,expectedRevision:f.work().revision,summary:'Must satisfy new cycle'});assert.equal(strict.ok,false);assert.equal(strict.error.code,'CLOSURE_NOT_READY');
  for(const expectedRevision of [args.expectedRevision,f.work().revision]){
    const replay=await f.invoke('pulso_work',{...args,expectedRevision});assert.equal(replay.ok,false);assert.match(replay.error.message,/ciclo cerrado/);assert.equal(f.work().closure,null);
  }
  await f.call('pulso_work',{...f.request(),operationId:'close-user-2'});assert.equal((await f.call('pulso_history',{})).items.length,2);
});

test('accept_delivery remains pending; explicit closure preserves acceptance modes and manual observation',async t=>{
  const f=await fixture(t);
  await f.update([{type:'criterion.update',criterionId:'AC-1',acceptanceMode:'both',reason:'Requires technical and user acceptance'}]);
  const delivery=await f.call('pulso_work',{action:'accept_delivery',workId:f.workId,expectedRevision:f.work().revision,operationId:'delivery',summary:'User reports deployment',criterionIds:['AC-1'],source:{text:'Ya desplegué'},limitations:[]});
  assert.equal(delivery.closed,false);assert.equal(delivery.readiness.ready,false);
  const before=f.work();await f.call('pulso_work',f.request());
  assert.deepEqual(f.work().objective,before.objective);assert.deepEqual(f.work().evidence,before.evidence);assert.equal(f.work().tasks[0].status,'done');assert.equal(completionReadiness(f.projectRoot,f.work()).ready,true);
});

test('required declaration, revision and context checks fail before mutation',async t=>{
  const f=await fixture(t),before=f.work(),args=f.request();
  for(const change of [{source:undefined},{source:{text:'  '}},{source:{}},{operationId:undefined},{expectedRevision:1},{criterionIds:['AC-1']},{workId:'../escape'}]){
    const input={...args,...change};for(const key of Object.keys(input))if(input[key]===undefined)delete input[key];
    assert.equal((await f.invoke('pulso_work',input)).ok,false);assert.deepEqual(f.work(),before);
  }
  let checks=0;const revoked=await f.invoke('pulso_work',args,{assertContext(){if(++checks===2)throw new Error('Host permission revoked');}});
  assert.equal(revoked.ok,false);assert.deepEqual(f.work(),before);
  // Contract accepts caller-declared explicit requests in any language, no prose classifier.
  await f.call('pulso_work',{...args,source:{text:'追跡を終了してください'}});
});

test('completed footprint and accepted result survive pending status in administrative and cancelled closes',async t=>{
  for(const action of ['close_by_user','close']){
    const f=await fixture(t),{record,continuity}=await f.prepare();
    await f.call('pulso_work',{action:'accept_result',contractVersion:2,workId:f.workId,expectedRevision:f.work().revision,continuityId:continuity.continuityId,intentRevision:1,delegationId:record.delegationId,operationId:'result-1',reportedReturn:{captureKey:'capture-1',markdown:'Original fixture report'},decision:{status:'completed',summary:'Reported implementation',acceptedTaskIds:['T-1']},reportedTerminal:true});
    await f.update([{type:'task.update',taskId:'T-1',patch:{acceptance:['New acceptance']},reason:'Changed contract'}]);
    const before=f.work();assert.equal(before.tasks[0].status,'pending');assert.deepEqual(before.completedTaskIds,['T-1']);
    const rejected=await f.invoke('pulso_work',{action:'update',workId:f.workId,expectedRevision:before.revision,actions:[{type:'task.set_status',taskId:'T-1',status:'cancelled',summary:'Cannot discard performed task'}]});
    assert.equal(rejected.error.code,'TASK_ALREADY_COMPLETED');
    const result=await f.invoke('pulso_work',action==='close_by_user'?f.request():{action,workId:f.workId,expectedRevision:before.revision,outcome:'cancelled',summary:'Stop tracking'});
    assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.data.closed,true);assert.doesNotMatch(result.output,/Cierre pendiente/);
    const after=f.work();for(const key of ['completedTaskIds','results','evidence'])assert.deepEqual(after[key],before[key]);
    if(action==='close')assert.deepEqual(after.tasks,before.tasks);
    else {assert.equal(after.tasks[0].status,'done');assert.match(after.tasks[0].summary,/aprobada por usuario/);assert.equal(result.data.readiness.ready,true);}
  }
});

test('pending native dispatch and captures are not silently reconciled by user closure',async t=>{
  const f=await fixture(t),{record,continuity}=await f.prepare();
  recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId:record.delegationId,sessionID:'session',callID:'call',agent:record.agent,prompt:record.specialistPrompt});
  const invalid=await f.invoke('pulso_work',{action:'accept_result',contractVersion:2,workId:f.workId,expectedRevision:f.work().revision,continuityId:continuity.continuityId,intentRevision:1,delegationId:record.delegationId,operationId:'capture-only',reportedReturn:{captureKey:'capture',markdown:'Retained partial report'},decision:{status:'invalid'},reportedTerminal:false});
  assert.equal(invalid.ok,false);assert.equal(invalid.persistence.captured,true);
  const before=readDelegation(f.projectRoot,{workId:f.workId,delegationId:record.delegationId});
  const close=await f.invoke('pulso_work',f.request());assert.equal(close.ok,false);assert.ok(close.error.issues.some(i=>i.code==='DELEGATIONS_PENDING'));
  assert.deepEqual(readDelegation(f.projectRoot,{workId:f.workId,delegationId:record.delegationId}),before);assert.equal(f.work().closure,null);
  await f.call('pulso_work',{action:'reconcile_delegation',workId:f.workId,delegationId:record.delegationId,continuityId:continuity.continuityId,intentRevision:1,resolution:'explicitly_reconciled',reason:'Host transcript inspected',source:{text:'Operator reports no remaining work'}});
  assert.equal((await f.invoke('pulso_work',f.request())).ok,false,'captured result still requires a decision');
  await f.call('pulso_work',{action:'accept_result',contractVersion:2,workId:f.workId,expectedRevision:f.work().revision,continuityId:continuity.continuityId,intentRevision:1,delegationId:record.delegationId,operationId:'decide-failed',returnId:invalid.persistence.returnId,decision:{status:'failed',summary:'Retained unsuccessful result'}});
  await f.call('pulso_work',f.request());
  const after=readDelegation(f.projectRoot,{workId:f.workId,delegationId:record.delegationId});assert.equal(after.attempts[0].resolution,'explicitly_reconciled');assert.deepEqual(after.returns,before.returns);
});

for(const target of ['history.jsonl','state.json'])test(`interrupted ${target} projection reports committed closure and duplicate repairs once`,async t=>{
  const f=await fixture(t),args=f.request(),rename=fs.renameSync;
  const mock=t.mock.method(fs,'renameSync',(from,to)=>{if(String(to).endsWith(`/.pulso/${target}`))throw new Error('Injected projection failure');return rename(from,to);});
  const failed=await f.invoke('pulso_work',args);assert.equal(failed.ok,false);assert.equal(failed.persistence.applied,true);assert.equal(failed.persistence.revision,args.expectedRevision+1);
  assert.equal(f.work().closure.mode,'user_requested');mock.mock.restore();
  const retry=await f.call('pulso_work',args);assert.equal(retry.duplicate,true);assert.equal(retry.closed,true);
  await f.call('pulso_workspace',{action:'recover'});assert.equal((await f.call('pulso_history',{})).items.length,1);
});

test('corrupt metadata, foreign ownership and guarded paths are never bypassed',async t=>{
  for(const scenario of ['history','registry','lock','path']){
    const f=await fixture(t);
    if(scenario==='registry')await f.prepare();
    const before=f.work(),args=f.request();
    if(scenario==='history')atomicWrite(f.projectRoot,'.pulso/history.jsonl','invalid json');
    if(scenario==='registry')atomicWrite(f.projectRoot,'.pulso/delegations-v2.json','invalid json');
    if(scenario==='lock'){fs.mkdirSync(path.join(f.projectRoot,'.pulso-write.lock'));writeJSON(f.projectRoot,'.pulso-write.lock/owner.json',{token:'foreign',pid:1});}
    if(scenario==='path'){const corrupt=structuredClone(before);corrupt.tasks[0].writeScope=['../outside'];writeJSON(f.projectRoot,`.pulso/work/${f.workId}/work.json`,corrupt);}
    const bytes=fs.readFileSync(path.join(f.projectRoot,`.pulso/work/${f.workId}/work.json`));
    assert.equal((await f.invoke('pulso_work',args)).ok,false);assert.deepEqual(fs.readFileSync(path.join(f.projectRoot,`.pulso/work/${f.workId}/work.json`)),bytes);
  }
});

test('terminal Work requires a complete consistent user closure and cannot masquerade as technical completion',async t=>{
  const f=await fixture(t);await f.call('pulso_work',f.request());const good=f.work();
  for(const mutate of [w=>delete w.closure.userRequest,w=>delete w.closure.mode,w=>w.closure.userRequest.source.text=' ',w=>w.closure.userRequest.readinessBefore={},w=>w.closure.userRequest.taskStatuses=[],w=>{delete w.closure.mode;delete w.closure.userRequest;},
    w=>delete w.closure.userRequest.approval,w=>w.closure.userRequest.approval.authority='machine',w=>w.closure.userRequest.approval.criterionIds=[],w=>w.closure.userRequest.approval.taskIds=[],w=>w.closure.userRequest.approval.taskIds.push('T-1'),w=>w.closure.userRequest.approval.taskIds.push('T-unknown'),w=>w.closure.userRequest.approval.cancelledTaskIds=['T-1'],
    w=>w.tasks[0].status='pending',w=>w.tasks[0].summary='Completed by CI',w=>w.completedTaskIds=[],w=>w.blockers=['Still blocked'],w=>w.decisionsPending=['Still waiting'],w=>w.nextAction='Continue',w=>w.objective.criteria[0].description='Changed after approval',w=>w.tasks[0].acceptance=['Different contract']]){
    const corrupt=structuredClone(good);mutate(corrupt);writeJSON(f.projectRoot,`.pulso/work/${f.workId}/work.json`,corrupt);
    assert.equal((await f.invoke('pulso_work',{action:'get',workId:f.workId})).ok,false);
    if(corrupt.closure.mode==='user_requested')assert.throws(()=>completionReadiness(f.projectRoot,corrupt));
  }
  writeJSON(f.projectRoot,`.pulso/work/${f.workId}/work.json`,good);
  const technical=await f.invoke('pulso_work',{action:'close',workId:f.workId,expectedRevision:good.revision,summary:good.closure.summary,limitations:good.closure.limitations});assert.equal(technical.ok,false);
});

test('approval exactly covers all criteria and non-cancelled tasks; legitimate cancellations remain terminal',async t=>{
  const f=await fixture(t);
  await f.update([
    {type:'criterion.add',criterion:{id:'AC-2',description:'Second criterion',verification:'Second verification',acceptanceMode:'user'}},
    {type:'criterion.add',criterion:{id:'AC-3',description:'Third criterion',verification:'Third verification',acceptanceMode:'both'}},
    ...['in_progress','blocked','paused','cancelled'].map((status,i)=>({type:'task.add',task:{...f.work().tasks[0],id:`T-${i+2}`,status,summary:status==='cancelled'?'Legitimate cancelled scope':'Previous summary'}})),
    {type:'work.set_overview',blockers:['Pending review'],decisionsPending:['Pending approval']}
  ]);
  const before=f.work(),receipt=await f.call('pulso_work',f.request()),closed=f.work();
  assert.deepEqual(receipt.approval,{authority:'user',verification:'user_approved',criterionIds:['AC-1','AC-2','AC-3'],taskIds:['T-1','T-2','T-3','T-4'],cancelledTaskIds:['T-5']});
  assert.deepEqual(closed.tasks.map(t=>t.status),['done','done','done','done','cancelled']);assert.deepEqual(closed.tasks[4],before.tasks[4]);assert.deepEqual(closed.completedTaskIds,['T-1','T-2','T-3','T-4']);
  assert.deepEqual(closed.evidence,[]);assert.deepEqual(closed.results,before.results);
  const history=await f.call('pulso_history',{});assert.deepEqual(history.items[0].userRequest.approval,receipt.approval);
  for(const field of ['source','readinessBefore','approval','acceptanceBasis']){
    const incomplete=structuredClone(closed.closure.userRequest);delete incomplete[field];assert.throws(()=>assertSchema('user-requested-closure',incomplete));
  }
  for(const change of [a=>a.criterionIds.pop(),a=>a.taskIds.pop(),a=>a.cancelledTaskIds=[]]){
    const corrupt=structuredClone(closed);change(corrupt.closure.userRequest.approval);assert.throws(()=>completionReadiness(f.projectRoot,corrupt),/exactamente/);
  }
  const changed=await f.invoke('pulso_work',{action:'update',workId:f.workId,expectedRevision:closed.revision,actions:[{type:'work.set_overview',summary:'Mutate terminal'}]});assert.equal(changed.ok,false);assert.deepEqual(f.work(),closed);
  const synced=await f.call('pulso_workspace',{action:'sync',workId:f.workId,expectedRevision:closed.revision});assert.equal(synced.verification,'user_approved');
});

for(const removedAt of ['before-close','after-close'])test(`missing non-evidence document ${removedAt} is historical until reopen, with path guards intact`,async t=>{
  const f=await fixture(t),document='historical/plan.md';
  atomicWrite(f.projectRoot,document,'Historical fixture plan');
  await f.update([{type:'document.register',document:{kind:'plan',path:document,templateVersion:'1'}}]);
  if(removedAt==='before-close')fs.unlinkSync(path.join(f.projectRoot,document));
  const receipt=await f.call('pulso_work',f.request()),closed=f.work();
  if(removedAt==='after-close')fs.unlinkSync(path.join(f.projectRoot,document));
  assert.deepEqual(readWork(f.projectRoot,f.workId),closed);
  assert.deepEqual(readWork(f.projectRoot,f.workId,{files:true,fresh:true}),closed);
  const get=await f.call('pulso_work',{action:'get',workId:f.workId,section:'all'});assert.equal(get.readiness.ready,true);
  assert.equal((await f.call('pulso_history',{workId:f.workId})).items.length,1);
  assert.equal((await f.call('pulso_workspace',{action:'status'})).works.items.length,0);
  await f.call('pulso_workspace',{action:'sync',workId:f.workId,expectedRevision:receipt.revision});
  await f.call('pulso_workspace',{action:'validate',fresh:true});
  await f.call('pulso_workspace',{action:'recover'});assert.deepEqual(f.work(),closed);

  const workPath=`.pulso/work/${f.workId}/work.json`;
  for(const mutate of [w=>w.documents[0].path='../outside.md',w=>delete w.closure.userRequest.approval]){
    const corrupt=structuredClone(closed);mutate(corrupt);writeJSON(f.projectRoot,workPath,corrupt);
    assert.throws(()=>readWork(f.projectRoot,f.workId));
    assert.equal((await f.invoke('pulso_workspace',{action:'recover'})).ok,false);
  }
  writeJSON(f.projectRoot,workPath,closed);
  fs.symlinkSync(path.join(temp(t),'outside.md'),path.join(f.projectRoot,document));
  assert.throws(()=>readWork(f.projectRoot,f.workId),/Symlink/);
  assert.equal((await f.invoke('pulso_workspace',{action:'recover'})).ok,false);
  fs.unlinkSync(path.join(f.projectRoot,document));

  await f.call('pulso_work',{action:'reopen',workId:f.workId,expectedRevision:closed.revision,reason:'New cycle requires current documents'});
  assert.throws(()=>readWork(f.projectRoot,f.workId),/Documento no existe/);
  for(const action of ['validate','recover']){
    const rejected=await f.invoke('pulso_workspace',{action,...(action==='validate'?{fresh:true}:{})});assert.equal(rejected.ok,false);assert.match(rejected.error.message,/Documento no existe/);
  }
  const open=await f.call('pulso_work',{action:'get',workId:f.workId});assert.ok(open.readiness.issues.some(i=>i.code==='DOCUMENT_MISSING'));
  const technical=await f.invoke('pulso_work',{action:'close',workId:f.workId,expectedRevision:open.revision,summary:'Requires current document'});assert.equal(technical.ok,false);assert.ok(technical.error.issues.some(i=>i.code==='DOCUMENT_MISSING'));
  atomicWrite(f.projectRoot,document,'Restored current plan');
  await f.call('pulso_workspace',{action:'validate',fresh:true});await f.call('pulso_workspace',{action:'recover'});
});

test('deducible snapshot issues cannot contradict either Work or history, even when both copies match',async t=>{
  const f=await fixture(t);
  await f.update([{type:'work.set_overview',blockers:['Historical blocker'],decisionsPending:['Historical decision']}]);
  await f.call('pulso_work',f.request());
  const closed=f.work(),entry=(await f.call('pulso_history',{workId:f.workId})).items[0],workPath=`.pulso/work/${f.workId}/work.json`;
  const corruptions=[
    r=>{r.readinessBefore.ready=true;r.readinessBefore.issues=[];},
    ...['TASK_OPEN','BLOCKER','DECISION_PENDING'].map(code=>r=>{r.readinessBefore.issues=r.readinessBefore.issues.filter(i=>i.code!==code);}),
    r=>{r.readinessBefore.issues.find(i=>i.code==='TASK_OPEN').entity='T-unknown';},
    r=>{r.readinessBefore.issues.find(i=>i.code==='TASK_OPEN').message='Tarea T-1: paused';},
    r=>{r.readinessBefore.issues.find(i=>i.code==='BLOCKER').message='Different blocker';},
    r=>{r.readinessBefore.issues.find(i=>i.code==='DECISION_PENDING').entity='decisionsPending[1]';},
    r=>r.readinessBefore.issues.push({...r.readinessBefore.issues.find(i=>i.code==='TASK_OPEN')}),
    r=>{r.taskStatuses[0].status='done';},
    r=>{r.blockers=[];},
    r=>{r.decisionsPending=[];}
  ];
  for(const destination of ['work','history','both'])for(const mutate of corruptions){
    const w=structuredClone(closed),h=structuredClone(entry);
    if(destination!=='history')mutate(w.closure.userRequest);
    if(destination!=='work')mutate(h.userRequest);
    writeJSON(f.projectRoot,workPath,w);atomicWrite(f.projectRoot,'.pulso/history.jsonl',JSON.stringify(h)+'\n');
    if(destination!=='history'){
      const get=await f.invoke('pulso_work',{action:'get',workId:f.workId});assert.equal(get.ok,false,destination);assert.match(get.error.message,/Snapshot de cierre contradictorio/);
    }
    if(destination!=='work'){
      const history=await f.invoke('pulso_history',{workId:f.workId});assert.equal(history.ok,false,destination);assert.match(history.error.message,/Snapshot de cierre contradictorio/);
    }
    for(const action of ['validate','recover']){
      const result=await f.invoke('pulso_workspace',{action});assert.equal(result.ok,false,destination);assert.match(result.error.message,/Snapshot de cierre contradictorio/);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.projectRoot,workPath),'utf8')),w);
    assert.equal(fs.readFileSync(path.join(f.projectRoot,'.pulso/history.jsonl'),'utf8'),JSON.stringify(h)+'\n');
  }
  writeJSON(f.projectRoot,workPath,closed);atomicWrite(f.projectRoot,'.pulso/history.jsonl',JSON.stringify(entry)+'\n');
  await f.call('pulso_workspace',{action:'validate',fresh:true});
});

test('close, duplicate and sync receipts preserve identical user approval provenance',async t=>{
  for(const messageRef of [undefined,'native-message-1']){
    const f=await fixture(t),args={...f.request(),source:{text:'Explicit user approval',...(messageRef?{messageRef}:{})}};
    const closed=await f.call('pulso_work',args);
    const duplicate=await f.call('pulso_work',{...args,expectedRevision:999});assert.equal(duplicate.duplicate,true);
    const synced=await f.call('pulso_workspace',{action:'sync',workId:f.workId,expectedRevision:closed.revision});
    for(const receipt of [closed,duplicate,synced]){
      assert.deepEqual(receipt.source,args.source);assert.equal(receipt.operationId,args.operationId);
      for(const key of ['closed','mode','authority','verification','approval','revision','status'])assert.deepEqual(receipt[key],closed[key],key);
      assertSchema('work-receipt',receipt);
    }
    assert.equal((await f.call('pulso_history',{workId:f.workId})).items.length,1);
  }
});
