import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {repo,create,readWork,atomicWrite,fingerprint,writeJSON} from './helpers.mjs';
import {acceptanceBasis,closeWork,completionReadiness,reopenWork,saveWork} from '../../core/lib/artifacts.mjs';
import {acceptDelivery} from '../../core/lib/acceptance.mjs';
import {applyWorkMutation,readStatus} from '../../core/lib/work-mutations.mjs';
import {now} from '../../core/lib/fs.mjs';
import {prepareEvidenceSupersession,supersedeEvidence,validateEvidenceSupersessions} from '../../core/lib/evidence-supersession.mjs';
import {executeTool} from '../../core/lib/semantic-tools.mjs';
import {toolContracts,validateToolInput,isMutating} from '../../core/lib/tool-contracts.mjs';
import {validateSchema} from '../../core/lib/schema.mjs';

const issue=(code,entity,topCode='EVIDENCE_SUPERSESSION_INVALID')=>error=>error.code===topCode&&error.issues?.some(value=>value.code===code&&value.entity===entity);

function fixture(t,{validationTasks=false}={}){
  const root=repo(t),workId='SUPER-1';create(root,workId);
  const work=()=>readWork(root,workId,{files:false});
  const update=actions=>applyWorkMutation(root,{workId,expectedRevision:work().revision,actions});
  atomicWrite(root,'src/change.txt','Synthetic changed implementation; no remote CI run is executed by this fixture.');
  update([
    {type:'criterion.update',criterionId:'AC-1',description:'Regression A is covered',verification:'Relevant checks locally or in CI, including a scoped user report',reason:'Fixture agreement before observations'},
    {type:'criterion.add',criterion:{id:'AC-2',description:'Regression B is covered',verification:'Independent relevant checks locally or in CI'}},
    ...['AC-1','AC-2'].map((criterionId,index)=>({type:'task.add',task:{id:`T-${index+1}`,title:`Prepare change ${index+1}`,criterionIds:[criterionId],agent:'pulso-executor',status:'pending',dependsOn:[],writeScope:['src/change.txt'],resources:[],acceptance:['Scoped implementation prepared']}})),
    ...(validationTasks?['AC-1','AC-2'].map((criterionId,index)=>({type:'task.add',task:{id:`TV-${index+1}`,title:`Validate regression ${index+1}`,criterionIds:[criterionId],agent:'pulso-qa-auditor',status:'blocked',dependsOn:[`T-${index+1}`],writeScope:[],resources:[],acceptance:['Relevant checks pass for this change, locally or in CI'],summary:'Local environment unavailable.'}})):[])
  ]);
  function observe(id,{criterionIds=[],taskIds=[],kind='manual',status='pass',text='Synthetic manual observation; no test execution claimed.',basis=text}={}){
    const current=work(),observedBasis=acceptanceBasis(current,{criterionIds,taskIds});
    const report=`.pulso/work/${workId}/evidence/${id}.md`;
    atomicWrite(root,report,text);
    update([{type:'evidence.add',evidence:{id,kind,status,checkedAt:now(),criterionIds,taskIds,report,command:null,cwd:'.',exitCode:null,basis,
      files:[fingerprint(root,'src/change.txt'),fingerprint(root,report)],acceptanceBasis:observedBasis,summary:text}}]);
    return work().evidence.find(e=>e.id===id);
  }
  observe('E-TASKS',{kind:'static',taskIds:['T-1','T-2'],text:'Synthetic inspection supports only preparation tasks.'});
  update(['T-1','T-2'].map(taskId=>({type:'task.set_status',taskId,status:'done',summary:'Prepared in fixture; not a test run.'})));
  observe('E-LOCAL',{criterionIds:['AC-1','AC-2'],taskIds:validationTasks?['T-1','TV-1','TV-2']:['T-1'],kind:'not_run',status:'blocked',text:'Local validation did not run: environment unavailable.'});
  observe('E-CI-A',{criterionIds:['AC-1'],taskIds:validationTasks?['TV-1']:[],text:'User report for this change: regression A passed in CI. No independent CI access.',basis:'user_reported/manual; only regression A in the current Work; no remote command, run ID or exit code observed.'});
  const request=(overrides={})=>({workId,expectedRevision:work().revision,operationId:'SUP-A',evidenceId:'E-LOCAL',replacementEvidenceId:'E-CI-A',criterionIds:['AC-1'],reason:'CI reported by the user covers regression A; local execution was unavailable, not a separate requirement.',...overrides});
  const snapshot=()=>JSON.stringify({work:work(),state:readStatus(root)});
  return {root,workId,work,update,observe,request,snapshot};
}

test('pure: selected replacement keeps observations, tasks, requirements and unrelated acceptance byte-for-byte',t=>{
  const f=fixture(t),before=f.work(),snapshot=f.snapshot();
  const {work:after,record,duplicate}=prepareEvidenceSupersession(f.root,before,f.request());
  assert.equal(duplicate,false);assert.equal(f.snapshot(),snapshot,'preparation does not persist');
  assert.deepEqual(after.evidence,before.evidence);assert.deepEqual(after.tasks,before.tasks);
  assert.deepEqual(after.acceptanceChanges,before.acceptanceChanges);assert.deepEqual(acceptanceBasis(after),acceptanceBasis(before));
  assert.deepEqual(after.objective.criteria[0].evidenceIds,['E-CI-A']);
  assert.deepEqual(after.objective.criteria[1],before.objective.criteria[1]);
  assert.deepEqual(after.blockers,before.blockers);assert.deepEqual(after.decisionsPending,before.decisionsPending);
  assert.equal(after.nextAction,before.nextAction);assert.equal(after.status,before.status);
  assert.equal(record.reason,f.request().reason);assert.equal(record.workId,before.id);assert.equal(record.cycle,before.cycle);
  assert.equal(record.appliedRevision,before.revision+1);assert.deepEqual(record.criterionIds,['AC-1']);
  const readiness=completionReadiness(f.root,after);
  assert.equal(readiness.ready,false);assert.ok(readiness.issues.some(issue=>issue.entity==='AC-2'&&issue.code==='EVIDENCE_NOT_POSITIVE'));
  assert.equal(readiness.issues.some(issue=>issue.entity==='AC-1'),false);
  assert.equal(after.evidence.find(e=>e.id==='E-CI-A').command,null);assert.equal(after.evidence.find(e=>e.id==='E-CI-A').exitCode,null);
});

test('pure: exact replay is a historical receipt, changed content and reopened cycles reject',t=>{
  const f=fixture(t),request=f.request(),prepared=prepareEvidenceSupersession(f.root,f.work(),request);
  const saved={...prepared.work,revision:prepared.record.appliedRevision,updatedAt:prepared.record.at};
  assert.equal(prepareEvidenceSupersession(f.root,saved,request).duplicate,true);
  assert.throws(()=>prepareEvidenceSupersession(f.root,saved,{...request,reason:'Other claim'}),issue('OPERATION_CONFLICT','SUP-A'));
  assert.throws(()=>prepareEvidenceSupersession(f.root,{...saved,cycle:saved.cycle+1},request),issue('CYCLE_MISMATCH','SUP-A'));
});

for(const [label,change,rejection] of [
  ['stale revision',f=>({expectedRevision:f.work().revision-1}),issue('REVISION_STALE','expectedRevision','REVISION_CONFLICT')],
  ['wrong Work',()=>({workId:'OTHER-1'}),issue('WORK_MISMATCH','workId')],
  ['wrong criterion',()=>({criterionIds:['AC-9']}),issue('SOURCE_NOT_LINKED','AC-9')],
  ['partly uncovered criteria',()=>({criterionIds:['AC-1','AC-2']}),issue('REPLACEMENT_NOT_LINKED','AC-2')],
  ['duplicate criteria',()=>({criterionIds:['AC-1','AC-1']}),issue('CRITERIA_DUPLICATE','criterionIds')],
  ['missing replacement',()=>({replacementEvidenceId:'FOREIGN-EVIDENCE'}),issue('REPLACEMENT_NOT_POSITIVE','FOREIGN-EVIDENCE')],
  ['same observation',()=>({replacementEvidenceId:'E-LOCAL'}),issue('SAME_EVIDENCE','E-LOCAL')],
  ['empty reason',()=>({reason:' '}),issue('SCHEMA_INVALID','$.reason','SCHEMA_INVALID')],
  ['extra untrusted field',()=>({root:'/different'}),issue('SCHEMA_INVALID','$.root','SCHEMA_INVALID')]
])test(`pure: ${label} rejects without mutation`,t=>{
  const f=fixture(t),before=f.snapshot();
  assert.throws(()=>prepareEvidenceSupersession(f.root,f.work(),f.request(change(f))),rejection);
  assert.equal(f.snapshot(),before);
});

test('pure: user acceptance is not ordinary technical replacement evidence',t=>{
  const f=fixture(t),accepted=acceptDelivery(f.root,{workId:f.workId,expectedRevision:f.work().revision,operationId:'USER-A',criterionIds:['AC-1'],summary:'User declared acceptance',source:{text:'I accept A'},limitations:[]});
  const before=f.snapshot();
  assert.throws(()=>prepareEvidenceSupersession(f.root,f.work(),f.request({replacementEvidenceId:accepted.evidenceId})),issue('REPLACEMENT_NOT_POSITIVE',accepted.evidenceId));
  assert.equal(f.snapshot(),before);assert.equal(f.work().objective.criteria[0].acceptanceMode??'evidence','evidence');
});

test('pure: a real failure cannot be silently superseded by a generic CI report',t=>{
  const f=fixture(t);f.observe('E-FAIL',{criterionIds:['AC-1'],status:'fail',text:'Independent regression failure still unresolved.'});
  f.observe('E-LATER',{criterionIds:['AC-1'],text:'User: workflow passed; no resolution of the independent failure declared.'});
  const before=f.snapshot();
  assert.throws(()=>prepareEvidenceSupersession(f.root,f.work(),f.request({evidenceId:'E-FAIL',replacementEvidenceId:'E-LATER'})),issue('SOURCE_NOT_UNPERFORMED','E-FAIL'));
  assert.equal(f.snapshot(),before);
});

test('pure: stale replacement files and changed criterion basis reject without fingerprint refresh',t=>{
  const f=fixture(t),original=f.work(),request=f.request();
  atomicWrite(f.root,'src/change.txt','Later, different implementation');
  const before=f.snapshot();
  assert.throws(()=>prepareEvidenceSupersession(f.root,original,request),issue('REPLACEMENT_STALE','E-CI-A'));assert.equal(f.snapshot(),before);
  atomicWrite(f.root,'src/change.txt','Synthetic changed implementation; no remote CI run is executed by this fixture.');
  const changed=structuredClone(original);changed.objective.criteria[0].verification='Explicit local verification only';
  assert.throws(()=>prepareEvidenceSupersession(f.root,changed,request),issue('REPLACEMENT_STALE','E-CI-A'));
  assert.equal(changed.objective.criteria[0].verification,'Explicit local verification only');
});

test('pure: evidence from another Work cannot substitute even with matching local IDs and readable files',t=>{
  const f=fixture(t),foreign=create(f.root,'OTHER-1'),current=f.work(),before=f.snapshot();
  current.evidence.find(e=>e.id==='E-CI-A').acceptanceBasis=acceptanceBasis(foreign,{criterionIds:['AC-1'],taskIds:[]});
  assert.throws(()=>prepareEvidenceSupersession(f.root,current,f.request()),issue('REPLACEMENT_STALE','E-CI-A'));
  assert.equal(f.snapshot(),before);
});

test('pure: blocked, failed and unexecuted replacements never count as positive evidence',t=>{
  const f=fixture(t),before=f.snapshot();
  for(const status of ['blocked','fail','not_run']){
    const current=f.work();current.evidence.find(e=>e.id==='E-CI-A').status=status;
    assert.throws(()=>prepareEvidenceSupersession(f.root,current,f.request()),issue('REPLACEMENT_NOT_POSITIVE','E-CI-A'));
  }
  const current=f.work();current.evidence.find(e=>e.id==='E-CI-A').kind='not_run';
  assert.throws(()=>prepareEvidenceSupersession(f.root,current,f.request()),issue('REPLACEMENT_NOT_POSITIVE','E-CI-A'));
  assert.equal(f.snapshot(),before);
});

test('pure: replacement must have a real report, active link and later observation',t=>{
  const f=fixture(t),request=f.request();
  for(const [change,rejection] of [
    [work=>{work.evidence.find(e=>e.id==='E-CI-A').files=[];},issue('REPLACEMENT_REPORT_MISSING','E-CI-A')],
    [work=>{work.objective.criteria[0].evidenceIds=['E-LOCAL'];},issue('REPLACEMENT_NOT_LINKED','AC-1')],
    [work=>{work.evidence.find(e=>e.id==='E-CI-A').checkedAt='2000-01-01T00:00:00.000Z';},issue('REPLACEMENT_NOT_LATER','E-CI-A')]
  ]){const work=f.work();change(work);assert.throws(()=>prepareEvidenceSupersession(f.root,work,request),rejection);}
});

test('pure: append-only audit validates immutable evidence bases without changing acceptance epochs',t=>{
  const f=fixture(t),before=f.work(),prepared=prepareEvidenceSupersession(f.root,before,f.request());
  const saved={...prepared.work,revision:prepared.record.appliedRevision,updatedAt:prepared.record.at};
  assert.doesNotThrow(()=>validateEvidenceSupersessions(saved,before));
  assert.deepEqual(acceptanceBasis(saved),acceptanceBasis(before));
  for(const change of [
    work=>{work.evidenceSupersessions=[];},
    work=>{work.evidenceSupersessions[0].reason='Rewritten reason';},
    work=>{work.evidenceSupersessions[0].workId='OTHER-1';},
    work=>{work.evidenceSupersessions[0].acceptanceBasis.criteria[0].sha256='0'.repeat(64);}
  ]){const changed=structuredClone(saved);change(changed);assert.throws(()=>validateEvidenceSupersessions(changed,saved),issue('AUDIT_IMMUTABLE','evidenceSupersessions'));}
});

test('two-criterion lifecycle persists selective audit, keeps local history and reaches real readiness only after both reports',t=>{
  const f=fixture(t),before=f.work(),firstRequest=f.request();
  const first=supersedeEvidence(f.root,firstRequest);
  assert.equal(first.duplicate,false);assert.equal(first.readiness.ready,false);
  let current=f.work();assert.equal(current.evidenceSupersessions.length,1);
  assert.deepEqual(current.evidence,before.evidence);assert.deepEqual(current.tasks,before.tasks);
  assert.deepEqual(current.objective.criteria[1],before.objective.criteria[1]);
  assert.throws(()=>closeWork(f.root,f.workId,{summary:'Not finished yet'}),error=>error.code==='CLOSURE_NOT_READY'&&error.issues.some(issue=>issue.entity==='AC-2'));
  const preserved=structuredClone(current.evidenceSupersessions[0]);
  f.observe('E-CI-B',{criterionIds:['AC-2'],text:'User now reports regression B passed in the previous environment for this change.'});
  const second=supersedeEvidence(f.root,f.request({operationId:'SUP-B',replacementEvidenceId:'E-CI-B',criterionIds:['AC-2'],reason:'Separate user report now covers regression B; same intended outcome, no independent local requirement.'}));
  current=f.work();assert.equal(second.readiness.ready,true);assert.equal(current.evidenceSupersessions.length,2);
  assert.deepEqual(current.evidenceSupersessions[0],preserved);assert.deepEqual(current.tasks,before.tasks);
  assert.deepEqual(current.evidence.find(e=>e.id==='E-LOCAL'),before.evidence.find(e=>e.id==='E-LOCAL'));
  assert.deepEqual(current.tasks[0].evidenceIds,['E-TASKS','E-LOCAL'],'task evidence is not silently removed or reopened');
  assert.equal(closeWork(f.root,f.workId,{summary:'Both scoped checks reported; local environment limitation retained.'}).status,'done');
});

test('public CAS rejects another decision after first commit and exact retry does not replay changed acceptance',t=>{
  const f=fixture(t),request=f.request();supersedeEvidence(f.root,request);
  const snapshot=f.snapshot(),duplicate=supersedeEvidence(f.root,request);
  assert.equal(duplicate.duplicate,true);assert.equal(Object.hasOwn(duplicate,'currentPass'),false);assert.equal(f.snapshot(),snapshot);
  assert.throws(()=>supersedeEvidence(f.root,{...request,operationId:'CONCURRENT-A'}),error=>error.code==='REVISION_CONFLICT');
  f.update([{type:'criterion.update',criterionId:'AC-1',acceptanceMode:'both',reason:'User changed the current acceptance contract'}]);
  const changed=f.snapshot(),historical=supersedeEvidence(f.root,request);
  assert.equal(historical.duplicate,true);assert.equal(Object.hasOwn(historical,'currentPass'),false);assert.equal(f.snapshot(),changed);
  assert.equal(f.work().objective.criteria[0].acceptanceMode,'both');assert.deepEqual(f.work().objective.criteria[0].evidenceIds,[]);
});

test('closed Work allows only exact historical receipt; reopen never reapplies a previous-cycle decision',t=>{
  const f=fixture(t),request=f.request();supersedeEvidence(f.root,request);
  closeWork(f.root,f.workId,{outcome:'cancelled',summary:'User stopped remaining work'});
  const closed=f.snapshot();assert.equal(supersedeEvidence(f.root,request).duplicate,true);assert.equal(f.snapshot(),closed);
  assert.throws(()=>supersedeEvidence(f.root,{...request,expectedRevision:f.work().revision,operationId:'AFTER-CLOSE'}),issue('WORK_CLOSED',f.workId));
  reopenWork(f.root,f.workId,'New authorized cycle');const reopened=f.snapshot();
  assert.throws(()=>supersedeEvidence(f.root,request),issue('CYCLE_MISMATCH','SUP-A'));assert.equal(f.snapshot(),reopened);
});

test('native context change and an existing mutex prevent supersession without writes',t=>{
  const f=fixture(t),before=f.snapshot(),revoked=new Error('Native scope revoked');let checks=0;
  assert.throws(()=>supersedeEvidence(f.root,f.request(),{assertContext(){if(++checks===2)throw revoked;}}),error=>error===revoked);
  assert.equal(f.snapshot(),before);assert.equal(fs.existsSync(path.join(f.root,'.pulso-write.lock')),false);
  fs.mkdirSync(path.join(f.root,'.pulso-write.lock'));
  try{assert.throws(()=>supersedeEvidence(f.root,f.request()),error=>error.code==='METADATA_BUSY');assert.equal(f.snapshot(),before);}
  finally{fs.rmdirSync(path.join(f.root,'.pulso-write.lock'));}
});

test('lost projection preserves one canonical audit and exact replay repairs without another revision',t=>{
  const f=fixture(t),request=f.request(),rename=fs.renameSync;let failed=false;
  const mock=t.mock.method(fs,'renameSync',(from,to)=>{
    if(!failed&&to===path.join(f.root,'.pulso/state.json')){failed=true;throw new Error('Injected state projection failure');}
    return rename(from,to);
  });
  try{assert.throws(()=>supersedeEvidence(f.root,request),error=>error.persistence?.applied===true);}
  finally{mock.mock.restore();}
  const canonical=f.work();assert.equal(canonical.evidenceSupersessions.length,1);
  assert.equal(canonical.revision,request.expectedRevision+1);
  assert.notEqual(readStatus(f.root).works[0].workRevision,canonical.revision);
  const duplicate=supersedeEvidence(f.root,request);
  assert.equal(duplicate.duplicate,true);assert.deepEqual(f.work(),canonical);
  assert.equal(readStatus(f.root).works[0].workRevision,canonical.revision);
});

test('canonical save rejects rewritten or removed supersession audit and retains history after unrelated edits',t=>{
  const f=fixture(t);supersedeEvidence(f.root,f.request());const saved=f.work();
  f.update([{type:'work.set_overview',summary:'Unrelated editorial update'}]);
  assert.deepEqual(f.work().evidenceSupersessions,saved.evidenceSupersessions);
  const before=f.snapshot();
  for(const change of [work=>{work.evidenceSupersessions=[];},work=>{work.evidenceSupersessions[0].reason='Rewritten';}]){
    const candidate=f.work();change(candidate);assert.throws(()=>saveWork(f.root,candidate,candidate.revision),issue('AUDIT_IMMUTABLE','evidenceSupersessions'));assert.equal(f.snapshot(),before);
  }
  const corrupt=f.work();corrupt.evidenceSupersessions[0].workId='OTHER-1';
  writeJSON(f.root,`.pulso/work/${f.workId}/work.json`,corrupt);
  assert.throws(()=>readWork(f.root,f.workId),issue('AUDIT_IDENTITY_INVALID','SUP-A'));
});

test('public supersede_evidence contract advertises guarded fields and rejects missing or injected authority',async t=>{
  const f=fixture(t),request={action:'supersede_evidence',...f.request()},shape=toolContracts.pulso_work.actionSchemas.supersede_evidence;
  assert.equal(isMutating('pulso_work',request),true);
  assert.deepEqual(validateSchema(toolContracts.pulso_work.inputSchema,request),[]);
  assert.doesNotThrow(()=>validateToolInput('pulso_work',request));
  const snapshot=f.snapshot();
  for(const key of shape.required){
    const missing={...request};delete missing[key];assert.throws(()=>validateToolInput('pulso_work',missing),error=>error.code==='SCHEMA_INVALID');
    assert.equal((await executeTool('pulso_work',missing,{projectRoot:f.root,homeDir:f.root})).ok,false);
  }
  for(const patch of [{expectedRevision:0},{criterionIds:[]},{reason:' '},{authorization:{kind:'primary'}},{root:'/other'},{command:'remote tests'},{exitCode:0}]){
    assert.throws(()=>validateToolInput('pulso_work',{...request,...patch}),error=>error.code==='SCHEMA_INVALID');
    assert.equal((await executeTool('pulso_work',{...request,...patch},{projectRoot:f.root,homeDir:f.root})).ok,false);
  }
  assert.equal(f.snapshot(),snapshot);
});

test('semantic handler returns actual readiness and paginates complete coordinator audit without renewing criteria',async t=>{
  const f=fixture(t),context={projectRoot:f.root,homeDir:f.root};
  const call=async input=>{const receipt=await executeTool('pulso_work',input,context);assert.equal(receipt.ok,true,JSON.stringify(receipt));return receipt.data;};
  const first=await call({action:'supersede_evidence',...f.request()});assert.equal(first.applied,true);assert.equal(first.readiness.ready,false);
  f.observe('E-CI-B',{criterionIds:['AC-2'],text:'User reports B passed; scoped report, no independently observed remote execution.'});
  const second=await call({action:'supersede_evidence',...f.request({operationId:'SUP-B',replacementEvidenceId:'E-CI-B',criterionIds:['AC-2'],reason:'Later user report separately covers B'})});
  assert.equal(second.readiness.ready,true);assert.equal(f.work().closure,null,'the operation does not itself close Work');
  const overview=await call({action:'get',workId:f.workId});assert.equal(overview.evidenceSupersessions.total,2);assert.equal(overview.evidenceSupersessions.readWith.section,'evidenceSupersessions');
  const args={action:'get',workId:f.workId,section:'evidenceSupersessions',limit:1},page=await call(args);
  assert.equal(page.evidenceSupersessions.items.length,1);assert.equal(page.hasMore,true);
  const next=await call({...args,cursor:page.nextCursor});assert.equal(next.hasMore,false);
  assert.deepEqual([...page.evidenceSupersessions.items,...next.evidenceSupersessions.items],f.work().evidenceSupersessions);
  assert.deepEqual((await call({action:'get',workId:f.workId,section:'all'})).evidenceSupersessions.items,f.work().evidenceSupersessions);
});

test('coordinator resolves initially blocked validation tasks using scoped reports and existing updates before natural close',async t=>{
  const f=fixture(t,{validationTasks:true}),context={projectRoot:f.root,homeDir:f.root};
  const call=async input=>{const receipt=await executeTool('pulso_work',input,context);assert.equal(receipt.ok,true,JSON.stringify(receipt));return receipt.data;};
  const update=actions=>call({action:'update',workId:f.workId,expectedRevision:f.work().revision,actions});
  await update([{type:'work.set_overview',status:'blocked',blockers:['Local environment unavailable for A','Local environment unavailable for B']}]);
  const before=f.work(),uncovered=structuredClone(before.tasks.find(task=>task.id==='TV-2')),local=structuredClone(before.evidence.find(e=>e.id==='E-LOCAL'));
  const first=await call({action:'supersede_evidence',...f.request()});
  assert.equal(first.readiness.ready,false);assert.ok(first.readiness.issues.some(value=>value.code==='TASK_OPEN'&&value.entity==='TV-1'));
  assert.deepEqual(f.work().tasks,before.tasks);assert.deepEqual(f.work().blockers,before.blockers);
  await update([{type:'task.set_status',taskId:'TV-1',status:'done',summary:'The user reports this scoped check passed in CI; no local execution claimed.'},{type:'work.set_overview',blockers:['Local environment unavailable for B']}]);
  assert.deepEqual(f.work().tasks.find(task=>task.id==='TV-2'),uncovered);
  assert.deepEqual(f.work().objective.criteria[1],before.objective.criteria[1]);
  assert.equal(f.work().tasks.find(task=>task.id==='TV-1').status,'done');
  f.observe('E-CI-B',{criterionIds:['AC-2'],taskIds:['TV-2'],text:'User now reports B passed for the current change in a previous environment; no independent access.'});
  const second=await call({action:'supersede_evidence',...f.request({operationId:'SUP-B',replacementEvidenceId:'E-CI-B',criterionIds:['AC-2'],reason:'This later scoped report now resolves verification B; no separate local requirement.'})});
  assert.equal(second.readiness.ready,false);assert.ok(second.readiness.issues.some(value=>value.code==='TASK_OPEN'&&value.entity==='TV-2'));
  const premature=await executeTool('pulso_work',{action:'close',workId:f.workId,expectedRevision:f.work().revision,summary:'Cannot close before task reconciliation.'},context);
  assert.equal(premature.ok,false);assert.equal(premature.error.code,'CLOSURE_NOT_READY');
  assert.ok(premature.error.issues.some(value=>value.code==='TASK_OPEN'&&value.entity==='TV-2'));
  await update([{type:'task.set_status',taskId:'TV-2',status:'done',summary:'The subsequent scoped user report covers validation B.'},{type:'work.set_overview',status:'in_progress',blockers:[],nextAction:null}]);
  const ready=await call({action:'get',workId:f.workId});assert.equal(ready.readiness.ready,true);
  assert.deepEqual(f.work().evidence.find(e=>e.id==='E-LOCAL'),local);
  assert.deepEqual(f.work().tasks.filter(task=>task.id.startsWith('T-')),before.tasks.filter(task=>task.id.startsWith('T-')));
  await call({action:'close',workId:f.workId,expectedRevision:f.work().revision,summary:'Both reported verifications reconciled; unavailable local attempt preserved.',limitations:['CI was reported by the user; Pulso did not access or execute the remote workflow.']});
  assert.equal(f.work().status,'done');assert.equal(f.work().evidenceSupersessions.length,2);
});
