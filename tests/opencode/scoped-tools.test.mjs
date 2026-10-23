import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {adapterConfig} from '../../harness/build.mjs';
import {setupPlugin} from './native-fixture.mjs';
const source=fileURLToPath(new URL('../../',import.meta.url));
const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).sort().filter(p=>fs.statSync(path.join(root,p)).isFile()).map(p=>[p,fs.readFileSync(path.join(root,p),'utf8')]));
async function fixture(t,{editedPrompt=false}={}){
  // Match canonical runtime roots when the OS temporary directory is a symlink (macOS).
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pulso-scoped-tools-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const project=path.join(base,'project'),runtime=path.join(base,'runtime'),home=path.join(base,'home');for(const p of [project,runtime,home])fs.mkdirSync(p);
  fs.cpSync(path.join(source,'core'),path.join(runtime,'resources'),{recursive:true});
  for(const [from,to] of Object.entries(adapterConfig.runtimeFiles)){fs.mkdirSync(path.dirname(path.join(runtime,to)),{recursive:true});fs.copyFileSync(path.join(source,'harness',from),path.join(runtime,to));}
  fs.cpSync(path.join(source,'harness/vendor'),path.join(runtime,'plugin/vendor'),{recursive:true});fs.writeFileSync(path.join(runtime,'package.json'),JSON.stringify(adapterConfig.packageManifest()));
  const load=p=>import(pathToFileURL(path.join(runtime,p)).href),module=await load('plugin/index.mjs');
  const sessions=new Map(),messages=new Map(),messageSessions=new Map(),reads=[];
  const context=(sessionID,agent='pulso',parentID)=>{
    sessions.set(sessionID,{id:sessionID,projectID:'native-project',location:{directory:project},agent,...(parentID?{parentID}:{})});
    const messageID=`msg_${sessionID}`;messages.set(messageID,{id:messageID,type:'assistant',agent,content:[]});messageSessions.set(messageID,sessionID);
    return {sessionID,messageID,agent,id:`tool_${sessionID}`,signal:new AbortController().signal};
  };
  const parent=context('ses_parent'),reader={
    async getSession(sessionID){reads.push(['getSession',sessionID]);const value=sessions.get(sessionID);if(!value)throw new Error('missing');return structuredClone(value);},
    async getMessage(sessionID,messageID){reads.push(['getMessage',{sessionID,messageID}]);const value=messages.get(messageID);if(!value||messageSessions.get(messageID)!==sessionID)throw new Error('missing');return structuredClone(value);},
    async history(sessionID){reads.push(['history',sessionID]);return structuredClone([...messages.values()].filter(m=>messageSessions.get(m.id)===sessionID));},
    async status(){return {};},
  };
  const plugin=await setupPlugin(module,{directory:project,homeDir:home,reader});t.after(()=>plugin.dispose());
  const {host,hooks,requests}=plugin;
  const invoke=async(name,args,ctx=parent)=>(await plugin.tools[name].execute(name==='pulso_history'?args:{request:args},ctx)).output;
  const call=async(name,args,ctx)=>{const r=await invoke(name,args,ctx);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
  await call('pulso_workspace',{action:'prepare'});
  for(const workId of ['WORK','OTHER'])await call('pulso_work',{action:'create',workId,title:workId,objective:'Inspect behavior',criterion:'Report',verification:'Review'});
  await call('pulso_work',{action:'update',workId:'WORK',expectedRevision:1,actions:['T1','T2'].map((id,i)=>({type:'task.add',task:{id,title:id,criterionIds:['AC-1'],agent:i?'pulso-qa-auditor':'pulso-explorer',status:'pending',dependsOn:[],writeScope:[`.pulso/work/WORK/${id}.md`],resources:[],acceptance:['Report']}}))});
  const continuity=await call('pulso_workspace',{action:'bind_continuity',workId:'WORK',requestKey:'current',objective:'Inspect behavior',repositories:['.'],constraints:[]});
  const prepare=async(taskId='T1')=>call('pulso_work',{action:'prepare_delegation',contractVersion:2,workId:'WORK',expectedRevision:(await call('pulso_work',{action:'get',workId:'WORK'})).revision,continuityId:continuity.continuityId,intentRevision:1,requestKey:taskId,taskIds:[taskId],objective:'Inspect',inputs:[],output:`.pulso/work/WORK/${taskId}.md`,constraints:[],templateId:'exploration'});
  const dispatch=async(p,{publish=true,editedPrompt=false}={})=>{
    const id=`call_${p.delegationId}`,args={agent:p.agent,description:'Inspect assignment',prompt:editedPrompt?p.specialistPrompt+'\n':p.specialistPrompt};
    // Native V2 persists the original input before invoking before-hooks.
    const part={type:'tool',name:'subagent',id,executed:false,state:{status:'running',input:structuredClone(args),metadata:{}}};
    messages.get(parent.messageID).content.push(part);
    await hooks['execute.before']({...parent,tool:'subagent',id,input:args});
    const child=context(`ses_${p.agent}`,p.agent,parent.sessionID);
    // This fixture's read view models authenticated live progress; real transport
    // overlay and its absence from durable history are tested in native-service.
    if(publish)part.state.metadata={sessionID:child.sessionID,status:'running'};
    return {child,part,prepared:p};
  };
  const first=await dispatch(await prepare(),{editedPrompt});
  const update=(operationId='progress',actions=[{type:'task.progress',taskId:'T1',status:'in_progress',summary:'Investigating'}],expectedRevision=2)=>({action:'update_assignment',workId:'WORK',delegationId:first.prepared.delegationId,operationId,expectedRevision,actions});
  return {base,project,home,runtime,load,plugin,host,hooks,parent,reader,sessions,messages,messageSessions,requests,reads,context,invoke,call,continuity,prepare,dispatch,...first,update};
}

test('native child tools prove the actual parent ToolPart and expose only assignment capabilities',async t=>{
  const f=await fixture(t),before=snapshot(f.project);
  const assigned=await f.call('pulso_workspace',{action:'get_assignment'},f.child);
  const permission=f.requests.at(-1);assert.equal(permission.action,'pulso_workspace');assert.equal(permission.sessionID,f.child.sessionID);assert.equal(permission.agent,f.child.agent);assert.deepEqual(permission.source,{type:'tool',messageID:f.child.messageID,id:f.child.id});
  assert.deepEqual(assigned.taskIds,['T1']);assert.equal(assigned.capabilities.pulso_workspace[0],'get_assignment');
  const work=await f.call('pulso_work',{action:'get',workId:'WORK',section:'all'},f.child);
  assert.equal(work.projection,'assignment');assert.equal(work.completeWork,false);assert.deepEqual(work.tasks.items.map(t=>t.id),['T1']);assert.equal(work.readiness.assessed,false);
  await f.call('pulso_work',{action:'get_delegation',workId:'WORK',delegationId:f.prepared.delegationId,continuityId:f.continuity.continuityId},f.child);
  await f.call('pulso_history',{workId:'WORK'},f.child);await f.call('pulso_context',{action:'read',scope:'project'},f.child);await f.call('pulso_context',{action:'summary',scope:'project'},f.child);
  assert.deepEqual(snapshot(f.project),before);assert.ok(f.reads.some(([m,q])=>m==='history'&&q==='ses_parent'));
});

test('all four tools deny global, cross-work, cross-task, self-acceptance and owner-stealing operations',async t=>{
  const f=await fixture(t),before=snapshot(f.project);
  const denied=[['pulso_workspace',{action:'status'}],['pulso_workspace',{action:'get_continuity',continuityId:f.continuity.continuityId}],['pulso_workspace',{action:'prepare'}],['pulso_workspace',{action:'resume_continuity',workId:'WORK',continuityId:f.continuity.continuityId,expectedResumeBasis:'a'.repeat(64)}],['pulso_workspace',{action:'inspect_continuities',workId:'WORK'}],['pulso_workspace',{action:'attempts'}],['pulso_work',{action:'get',workId:'OTHER'}],['pulso_work',{action:'close',workId:'WORK',expectedRevision:2,summary:'Self approved'}],['pulso_work',{action:'update',workId:'WORK',expectedRevision:2,actions:[{type:'work.set_overview',summary:'Hijack'}]}],['pulso_history',{}],['pulso_history',{workId:'OTHER'}],['pulso_context',{action:'summary',scope:'all'}],['pulso_context',{action:'read',scope:'user'}],['pulso_context',{action:'set_context',scope:'project',expectedRevision:1,context:'Hijack'}],['pulso_work',f.update('sibling',[{type:'task.progress',taskId:'T2',status:'in_progress'}])],['pulso_work',f.update('terminal',[{type:'task.progress',taskId:'T1',status:'done'}])]];
  for(const [name,args] of denied){const r=await f.invoke(name,args,f.child);assert.equal(r.ok,false,`${name}:${args.action}`);assert.deepEqual(snapshot(f.project),before);}
  const forged=await f.invoke('pulso_work',{...f.update(),authorization:{kind:'primary'},sessionID:'ses_parent'},f.child);assert.equal(forged.ok,false);assert.deepEqual(snapshot(f.project),before);
});

test('evidence supersession is a native-approved coordinator mutation and its audit is absent from child views',async t=>{
  const f=await fixture(t),{readWork,acceptanceBasis}=await f.load('resources/lib/artifacts.mjs'),{atomicWrite,fingerprint,now}=await f.load('resources/lib/fs.mjs');
  for(const [id,kind,status] of [['E-LOCAL','not_run','blocked'],['E-REPORTED','manual','pass']]){
    const work=readWork(f.project,'WORK'),report=`.pulso/work/WORK/${id}.md`,basis=acceptanceBasis(work,{criterionIds:['AC-1'],taskIds:[]});
    atomicWrite(f.project,report,id==='E-LOCAL'?'Local environment unavailable.':'User reports the current check passed remotely; no independent CI access.');
    await f.call('pulso_work',{action:'update',workId:'WORK',expectedRevision:work.revision,actions:[{type:'evidence.add',evidence:{id,kind,status,checkedAt:now(),criterionIds:['AC-1'],taskIds:[],report,command:null,cwd:'.',exitCode:null,basis:'Scoped fixture report; not a local execution',files:[fingerprint(f.project,report)],acceptanceBasis:basis,summary:id}}]});
  }
  const args={action:'supersede_evidence',workId:'WORK',expectedRevision:readWork(f.project,'WORK').revision,operationId:'SUPERSEDE-1',evidenceId:'E-LOCAL',replacementEvidenceId:'E-REPORTED',criterionIds:['AC-1'],reason:'PRIVATE-COORDINATOR-DECISION: equivalent reported check replaces unavailable local method.'};
  const before=snapshot(f.project),denied=await f.invoke('pulso_work',args,f.child);
  assert.equal(denied.error.code,'ASSIGNMENT_SCOPE_DENIED');assert.deepEqual(snapshot(f.project),before);
  assert.equal(f.requests.at(-1).metadata.mutating,true);assert.equal(f.requests.at(-1).metadata.action,'supersede_evidence');
  const applied=await f.call('pulso_work',args);assert.equal(applied.applied,true);assert.equal(applied.duplicate,false);
  const root=await f.call('pulso_work',{action:'get',workId:'WORK',section:'evidenceSupersessions'});
  assert.equal(root.evidenceSupersessions.items[0].reason,args.reason);
  for(const section of ['all','evidenceSupersessions','overview']){
    const child=await f.call('pulso_work',{action:'get',workId:'WORK',section},f.child);
    assert.equal(child.evidenceSupersessions.total,0);assert.equal(JSON.stringify(child).includes('PRIVATE-COORDINATOR-DECISION'),false);
  }
});

test('supersede_evidence cannot bypass a native permission denial or cancellation after approval',async t=>{
  const f=await fixture(t),before=snapshot(f.project),args={action:'supersede_evidence',workId:'WORK',expectedRevision:2,operationId:'DENIED-SUPERSESSION',evidenceId:'E-LOCAL',replacementEvidenceId:'E-REPORTED',criterionIds:['AC-1'],reason:'Scoped replacement'};
  const denial=new Error('Permission denied by host');
  f.host.permission.assert=async request=>{assert.equal(request.metadata.mutating,true);throw denial;};
  await assert.rejects(f.invoke('pulso_work',args),error=>error===denial);assert.deepEqual(snapshot(f.project),before);
  const controller=new AbortController();f.parent.signal=controller.signal;f.host.permission.assert=async()=>{controller.abort();};
  await assert.rejects(f.invoke('pulso_work',args));assert.equal(controller.signal.aborted,true);assert.deepEqual(snapshot(f.project),before);
});

test('operation receipt and task progress commit together, replay ignores expectedRevision but changed payload conflicts',async t=>{
  const f=await fixture(t),before=await f.call('pulso_work',{action:'get_delegation',workId:'WORK',delegationId:f.prepared.delegationId});
  const applied=await f.call('pulso_work',f.update(),f.child);assert.equal(applied.appliedRevision,3);assert.equal(applied.duplicate,false);assert.equal(applied.sessionID,f.child.sessionID);
  const bytes=snapshot(f.project),replayed=await f.call('pulso_work',{...f.update(),expectedRevision:999},f.child);assert.equal(replayed.duplicate,true);assert.equal(replayed.appliedRevision,3);assert.deepEqual(snapshot(f.project),bytes);
  const changed=await f.invoke('pulso_work',f.update('progress',[{type:'task.progress',taskId:'T1',summary:'Other'}],3),f.child);assert.equal(changed.error.code,'OPERATION_CONFLICT');assert.deepEqual(snapshot(f.project),bytes);
  const receipts=await f.call('pulso_work',{action:'get_assignment_receipts',workId:'WORK',delegationId:f.prepared.delegationId,operationId:'progress'});assert.equal(receipts.items[0].requestHash,applied.requestHash);assert.equal(receipts.items[0].appliedRevision,3);
  const after=await f.call('pulso_work',{action:'get_delegation',workId:'WORK',delegationId:f.prepared.delegationId});assert.deepEqual(after.acceptanceBasis,before.acceptanceBasis);assert.equal(after.currentIntent,true);
});

test('specialist registers only exact assigned output without creating evidence or changing acceptance basis',async t=>{
  const f=await fixture(t),output='.pulso/work/WORK/T1.md';fs.writeFileSync(path.join(f.project,output),'Observed report');
  const doc={kind:'review',path:output,templateVersion:'test'},applied=await f.call('pulso_work',f.update('document',[{type:'document.register',document:doc}]),f.child);
  assert.match(applied.changes[0].sha256,/^[a-f0-9]{64}$/);assert.equal(applied.appliedRevision,3);
  const work=await f.call('pulso_work',{action:'get',workId:'WORK',section:'all'});assert.equal(work.evidence.total,0);assert.equal(work.results.total,0);assert.deepEqual(work.documents.items,[doc]);assert.deepEqual(work.objective.criteria.items[0].evidenceIds,[]);
  const before=snapshot(f.project);for(const path of ['.pulso/work/WORK/T2.md','.pulso/state.json','../outside.md'])assert.equal((await f.invoke('pulso_work',f.update('foreign-'+path.length,[{type:'document.register',document:{...doc,path}}],3),f.child)).ok,false);assert.deepEqual(snapshot(f.project),before);
});

test('siblings share Work CAS without clobbering, scoped receipt pagination and semantic changes still invalidate',async t=>{
  const f=await fixture(t),second=await f.dispatch(await f.prepare('T2'));
  await f.call('pulso_work',f.update(),f.child);
  const sibling={action:'update_assignment',workId:'WORK',delegationId:second.prepared.delegationId,operationId:'progress',expectedRevision:2,actions:[{type:'task.progress',taskId:'T2',status:'in_progress'}]};
  assert.equal((await f.invoke('pulso_work',sibling,second.child)).error.code,'REVISION_STALE');
  await f.call('pulso_work',{...sibling,expectedRevision:3},second.child);
  await f.call('pulso_work',f.update('second',[{type:'task.progress',taskId:'T1',summary:'Ready to report'}],4),f.child);
  const args={action:'get_assignment_receipts',workId:'WORK',delegationId:f.prepared.delegationId,limit:1},page=await f.call('pulso_work',args,f.child);assert.equal(page.total,2);assert.equal(page.hasMore,true);
  const next=await f.call('pulso_work',{...args,cursor:page.nextCursor},f.child);assert.equal(next.items[0].operationId,'second');assert.equal(next.hasMore,false);
  assert.equal((await f.invoke('pulso_work',{...args,delegationId:second.prepared.delegationId},f.child)).ok,false);
  await f.call('pulso_work',{action:'update',workId:'WORK',expectedRevision:5,actions:[{type:'task.update',taskId:'T1',patch:{acceptance:['Different scope']},reason:'New requirement'}]});
  assert.equal((await f.invoke('pulso_work',f.update('stale',undefined,6),f.child)).ok,false);
});

test('owner transfer immediately revokes old child tools but its native terminal remains capturable',async t=>{
  const f=await fixture(t),next=f.context('ses_next'),selected=await f.call('pulso_workspace',{action:'inspect_continuities',workId:'WORK',continuityId:f.continuity.continuityId},next);
  await f.call('pulso_workspace',{action:'resume_continuity',workId:'WORK',continuityId:f.continuity.continuityId,expectedResumeBasis:selected.items[0].resumeBasis},next);
  const before=snapshot(f.project),denied=await f.invoke('pulso_work',f.update(),f.child);assert.equal(denied.error.code,'ASSIGNMENT_REVOKED');assert.deepEqual(snapshot(f.project),before);
  const result={output:{sessionID:f.child.sessionID,status:'completed',output:'Observed report'},content:`<subagent sessionID="${f.child.sessionID}" state="completed">\nObserved report\n</subagent>`,metadata:{sessionID:f.child.sessionID,status:'completed',truncated:false}};
  await f.hooks['execute.after']({...f.parent,tool:'subagent',id:f.part.id,input:f.part.state.input,status:'completed',result});assert.equal(result.metadata.pulsoDurable.capture,'stored');
  assert.equal((await f.call('pulso_work',{action:'get_delegation',workId:'WORK',delegationId:f.prepared.delegationId},next)).returns.length,1);
});

for(const variant of ['no metadata','provider executed','wrong child','terminal call','error call','wrong directory','wrong parent','wrong call','wrong prompt','wrong role','ambiguous','other-role collision','recursive','missing project','cross project','api failure','root specialist'])test(`native proof fails closed: ${variant}`,async t=>{
  const f=await fixture(t),before=snapshot(f.project);
  if(variant==='no metadata')delete f.part.state.metadata;
  if(variant==='provider executed')f.part.executed=true;
  if(variant==='wrong child')f.part.state.metadata.sessionID='ses_foreign';
  if(variant==='terminal call'){f.part.state.status='completed';f.part.state.metadata.status='completed';}
  if(variant==='error call')f.part.state.status='error';
  if(variant==='wrong directory')f.sessions.get(f.child.sessionID).location.directory=f.home;
  if(variant==='wrong parent')f.sessions.get(f.child.sessionID).parentID='ses_forged';
  if(variant==='wrong call')f.part.id='unrecorded';
  if(variant==='wrong prompt')f.part.state.input.prompt+='\nsteering';
  if(variant==='wrong role')f.part.state.input.agent='pulso-executor';
  if(variant==='ambiguous')f.messages.get(f.parent.messageID).content.push(structuredClone(f.part));
  if(variant==='other-role collision'){const message=structuredClone(f.messages.get(f.parent.messageID));message.id='msg_other_role';message.agent='build';f.messages.set(message.id,message);f.messageSessions.set(message.id,f.parent.sessionID);}
  if(variant==='recursive')f.sessions.get(f.parent.sessionID).parentID='ses_other';
  if(variant==='missing project'){delete f.sessions.get(f.child.sessionID).projectID;delete f.sessions.get(f.parent.sessionID).projectID;}
  if(variant==='cross project')f.sessions.get(f.child.sessionID).projectID='foreign';
  if(variant==='api failure')f.reader.history=async()=>{throw new Error('network failure');};
  if(variant==='root specialist')delete f.sessions.get(f.child.sessionID).parentID;
  const denied=await f.invoke('pulso_work',f.update(),f.child);assert.equal(denied.ok,false);assert.deepEqual(snapshot(f.project),before);
});

test('native permission denial, changed identity and stale data after approval cannot mutate',async t=>{
  const f=await fixture(t),before=snapshot(f.project),ask=f.host.permission.assert;
  f.host.permission.assert=async()=>{throw new Error('permission denied');};await assert.rejects(f.invoke('pulso_work',f.update(),f.child),/permission denied/);assert.deepEqual(snapshot(f.project),before);
  f.host.permission.assert=async()=>{f.child.sessionID=f.parent.sessionID;};await assert.rejects(f.invoke('pulso_work',f.update(),f.child),/identity changed/);assert.deepEqual(snapshot(f.project),before);
  f.child.sessionID=f.part.state.metadata.sessionID;f.host.permission.assert=ask;
  const get=f.reader.history;let changed=false;f.reader.history=async(...args)=>{const result=await get(...args);if(!changed){changed=true;await f.call('pulso_workspace',{action:'update_intent',continuityId:f.continuity.continuityId,expectedRevision:1,objective:'New task',constraints:[]});}return result;};
  assert.equal((await f.invoke('pulso_work',f.update(),f.child)).error.code,'ASSIGNMENT_REVOKED');
});


test('native ordering preserves canonical input and requires authenticated progress before child tools',async t=>{
  const f=await fixture(t);assert.equal(f.part.state.input.prompt,f.prepared.specialistPrompt);
  const metadata=f.part.state.metadata;delete f.part.state.metadata;
  assert.equal((await f.invoke('pulso_workspace',{action:'get_assignment'},f.child)).ok,false);
  f.part.state.metadata=metadata;assert.equal((await f.call('pulso_workspace',{action:'get_assignment'},f.child)).delegationId,f.prepared.delegationId);
  f.part.state.status='completed';f.part.state.input.background=true;f.part.state.content=[{type:'text',text:'The subagent is working in the background.'}];
  await f.call('pulso_work',f.update(),f.child);
  f.part.state.metadata.status='completed';f.part.state.content=[{type:'text',text:`<subagent sessionID="${f.child.sessionID}" state="completed">\nReport\n</subagent>`}];
  assert.equal((await f.invoke('pulso_work',f.update('late',undefined,3),f.child)).ok,false);
});

test('partial projection failure preserves atomic operation receipt; coordinator repairs without repeating child effects',async t=>{
  const f=await fixture(t),rename=fs.renameSync;
  fs.renameSync=(from,to)=>{if(to===path.join(f.project,'.pulso/state.json'))throw Object.assign(new Error('projection I/O failure'),{code:'EIO'});return rename(from,to);};
  let partial;try{partial=await f.invoke('pulso_work',f.update(),f.child);}finally{fs.renameSync=rename;}
  assert.equal(partial.ok,false);assert.equal(partial.persistence.applied,true);assert.equal(partial.persistence.receipt.operationId,'progress');assert.equal(partial.persistence.receipt.appliedRevision,3);
  const saved=JSON.parse(fs.readFileSync(path.join(f.project,'.pulso/work/WORK/work.json'),'utf8'));assert.equal(saved.tasks[0].status,'in_progress');assert.equal(saved.assignmentOperations.length,1);
  const receipts=await f.call('pulso_work',{action:'get_assignment_receipts',workId:'WORK',delegationId:f.prepared.delegationId},f.child);assert.equal(receipts.items.length,1);
  assert.equal((await f.call('pulso_work',f.update(),f.child)).duplicate,true);
  await f.call('pulso_workspace',{action:'sync',workId:'WORK',expectedRevision:3});
  assert.equal((await f.call('pulso_workspace',{action:'validate'})).valid,true);
});

test('missing output and symlink paths never register metadata; saved operation history cannot be rewritten',async t=>{
  const f=await fixture(t),output='.pulso/work/WORK/T1.md',doc={kind:'review',path:output,templateVersion:'test'},args=f.update('doc',[{type:'document.register',document:doc}]),before=snapshot(f.project);
  assert.equal((await f.invoke('pulso_work',args,f.child)).ok,false);assert.deepEqual(snapshot(f.project),before);
  const outside=path.join(f.base,'outside.md');fs.writeFileSync(outside,'outside');fs.symlinkSync(outside,path.join(f.project,output));
  assert.equal((await f.invoke('pulso_work',args,f.child)).ok,false);assert.equal(fs.readFileSync(outside,'utf8'),'outside');fs.unlinkSync(path.join(f.project,output));
  await f.call('pulso_work',f.update(),f.child);
  const {readWork,saveWork}=await f.load('resources/lib/artifacts.mjs'),w=readWork(f.project,'WORK',{files:false});w.assignmentOperations[0].changes[0].summary='Rewritten';
  assert.throws(()=>saveWork(f.project,w,w.revision),/Recibos de asignación inmutables/);
});

test('missing native identity reader never falls back to role strings or prompt identifiers for a primary or specialist',async t=>{
  const f=await fixture(t),before=snapshot(f.project);delete f.reader.getSession;
  for(const ctx of [f.parent,f.child]){const r=await f.invoke('pulso_workspace',{action:'status'},ctx);assert.equal(r.error.code,'NATIVE_AUTHORITY_UNAVAILABLE');}
  assert.deepEqual(snapshot(f.project),before);
});


test('explicit compatible intent retains assignment capabilities without changing its prepared acceptance basis',async t=>{
  const f=await fixture(t),before=await f.call('pulso_work',{action:'get_delegation',workId:'WORK',delegationId:f.prepared.delegationId});
  await f.call('pulso_workspace',{action:'update_intent',continuityId:f.continuity.continuityId,expectedRevision:1,objective:'Same assignment with clarified context',constraints:['Preserve scope'],compatibleDelegationIds:[f.prepared.delegationId]});
  const current=await f.call('pulso_workspace',{action:'get_assignment'},f.child);assert.equal(current.intentRevision,2);assert.deepEqual(current.currentIntent.constraints,['Preserve scope']);
  const applied=await f.call('pulso_work',f.update(),f.child);assert.equal(applied.intentRevision,2);
  const after=await f.call('pulso_work',{action:'get_delegation',workId:'WORK',delegationId:f.prepared.delegationId});assert.deepEqual(after.acceptanceBasis,before.acceptanceBasis);
});
