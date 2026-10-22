import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {executeTool} from '../../core/lib/semantic-tools.mjs';
import {readContinuity,bindContinuity} from '../../core/lib/continuity.mjs';
import {readDelegation,recordNativeDispatch} from '../../core/lib/delegation-registry.mjs';
import {validateToolInput,isMutating} from '../../core/lib/tool-contracts.mjs';
import {assertSchema} from '../../core/lib/schema.mjs';

const snapshot=root=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).sort().filter(p=>fs.statSync(path.join(root,p)).isFile()).map(p=>[p,fs.readFileSync(path.join(root,p),'utf8')]));
async function fixture(t){
  // Match canonical runtime roots when the OS temporary directory is a symlink (macOS).
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'pulso-session-recovery-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const projectRoot=path.join(base,'project'),homeDir=path.join(base,'home');fs.mkdirSync(projectRoot);fs.mkdirSync(homeDir);
  const context={projectRoot,homeDir,resourceRoot:fileURLToPath(new URL('../../core',import.meta.url))};
  const invoke=(name,args,sessionID='old-session',extra={})=>executeTool(name,args,{...context,...extra,...(sessionID?{nativeContext:{sessionID}}:{})});
  const call=async(name,args,sessionID,extra)=>{const r=await invoke(name,args,sessionID,extra);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
  await call('pulso_workspace',{action:'prepare'});
  for(const workId of ['WORK','OTHER'])await call('pulso_work',{action:'create',workId,title:workId,objective:'Recover',criterion:'Preserve work',verification:'Observe stored state'});
  await call('pulso_work',{action:'update',workId:'WORK',expectedRevision:1,actions:[{type:'task.add',task:{id:'T1',title:'Report',criterionIds:['AC-1'],agent:'pulso-explorer',status:'pending',dependsOn:[],writeScope:[],resources:[],acceptance:['Report findings']}}]});
  const bind={action:'bind_continuity',workId:'WORK',requestKey:'original',objective:'Original goal',repositories:['.'],constraints:['Original constraint']};
  const continuity=await call('pulso_workspace',bind);
  const inspect={action:'inspect_continuities',workId:'WORK',continuityId:continuity.continuityId};
  const resume=item=>({action:'resume_continuity',workId:item.workId,continuityId:item.continuityId,expectedResumeBasis:item.resumeBasis});
  const read=()=>readContinuity(projectRoot,continuity.continuityId,{skipOwner:true});
  return {base,projectRoot,context,invoke,call,bind,continuity,inspect,resume,read};
}

test('new session recovers the selected current capsule without lost bind fields, new Work, focus or reservation release',async t=>{
  const f=await fixture(t),c=f.continuity;
  await f.call('pulso_workspace',{action:'update_intent',continuityId:c.continuityId,expectedRevision:1,objective:'Current goal',repositories:['.'],constraints:['Do not run tests']});
  const prepare={action:'prepare_delegation',contractVersion:2,workId:'WORK',expectedRevision:2,continuityId:c.continuityId,intentRevision:2,requestKey:'task',taskIds:['T1'],objective:'Inspect only',inputs:[],output:'conversation',constraints:[],templateId:'exploration'};
  const prepared=await f.call('pulso_work',prepare);
  recordNativeDispatch(f.projectRoot,{workId:'WORK',delegationId:prepared.delegationId,sessionID:'old-session',callID:'native-call',agent:prepared.agent,prompt:prepared.specialistPrompt});
  const before=snapshot(f.projectRoot),original=f.read();
  const denied=await f.invoke('pulso_workspace',{action:'get_continuity',continuityId:c.continuityId},'new-session');
  assert.equal(denied.error.code,'CONTINUITY_OWNER_MISMATCH');assertSchema('tool-error',denied.error);
  assert.equal(denied.error.recovery.readWith.action,'inspect_continuities');
  const inspection=await f.call('pulso_workspace',f.inspect,'new-session');
  assert.equal(inspection.adopted,false);assert.equal(inspection.focusWorkId,null);assert.equal(inspection.items.length,1);
  const selected=inspection.items[0];assert.equal(selected.objective,'Current goal');assert.deepEqual(selected.constraints,['Do not run tests']);
  assert.deepEqual(snapshot(f.projectRoot),before);
  const resumed=await f.call('pulso_workspace',f.resume(selected),'new-session');
  assert.equal(resumed.ownerSessionID,'new-session');assert.equal(resumed.intentRevision,2);assert.equal(resumed.duplicate,false);
  const after=f.read();assert.deepEqual({...after,ownerSessionID:original.ownerSessionID,history:original.history},original);
  const afterFiles=snapshot(f.projectRoot);delete before['.pulso/continuities-v2.json'];delete afterFiles['.pulso/continuities-v2.json'];assert.deepEqual(afterFiles,before);
  const capsule=await f.call('pulso_workspace',resumed.readWith,'new-session');assert.equal(capsule.pending.length,1);
  const delegation=await f.call('pulso_work',{action:'get_delegation',workId:'WORK',delegationId:prepared.delegationId},'new-session');
  assert.equal(delegation.reservationResolved,false);assert.equal(delegation.attempts[0].resolution,'unresolved');assert.equal(delegation.specialistPrompt,prepared.specialistPrompt);
  const duplicate=await f.invoke('pulso_work',{...prepare,requestKey:'replacement'},'new-session');
  assert.equal(duplicate.error.code,'DELEGATION_NATIVE_UNRESOLVED');assert.equal(duplicate.error.recovery.nativeCessation,'unknown');assertSchema('tool-error',duplicate.error);
  assert.equal((await f.invoke('pulso_workspace',resumed.readWith,'old-session')).error.code,'CONTINUITY_OWNER_MISMATCH');
});

test('lost resume response replays exactly once; same-owner read is idempotent but old hashes cannot bypass newer intent or ownership',async t=>{
  const f=await fixture(t),selected=(await f.call('pulso_workspace',f.inspect,'new-session')).items[0],args=f.resume(selected);
  await f.call('pulso_workspace',args,'new-session');
  const after=snapshot(f.projectRoot);
  assert.equal((await f.call('pulso_workspace',args,'new-session')).duplicate,true);assert.deepEqual(snapshot(f.projectRoot),after);
  const copied=path.join(f.base,'copied-after-resume');fs.cpSync(f.projectRoot,copied,{recursive:true});
  assert.equal((await f.invoke('pulso_workspace',args,'new-session',{projectRoot:copied})).error.code,'CONTINUITY_RESUME_STALE');
  const current=(await f.call('pulso_workspace',f.inspect,'new-session')).items[0];
  assert.equal((await f.call('pulso_workspace',f.resume(current),'new-session')).duplicate,true);assert.deepEqual(snapshot(f.projectRoot),after);
  await f.call('pulso_workspace',{action:'update_intent',continuityId:current.continuityId,expectedRevision:1,objective:'Changed',constraints:[]},'new-session');
  const changed=snapshot(f.projectRoot),stale=await f.invoke('pulso_workspace',args,'new-session');
  assert.equal(stale.error.code,'CONTINUITY_RESUME_STALE');assert.deepEqual(snapshot(f.projectRoot),changed);
  const latest=(await f.call('pulso_workspace',f.inspect,'third-session')).items[0];await f.call('pulso_workspace',f.resume(latest),'third-session');
  const moved=snapshot(f.projectRoot);assert.equal((await f.invoke('pulso_workspace',f.resume(latest),'fourth-session')).error.code,'CONTINUITY_RESUME_STALE');assert.deepEqual(snapshot(f.projectRoot),moved);
  for(const owner of ['new-session','third-session'])await f.call('pulso_workspace',f.resume((await f.call('pulso_workspace',f.inspect)).items[0]),owner);
  assert.equal((await f.invoke('pulso_workspace',f.resume(latest),'third-session')).error.code,'CONTINUITY_RESUME_STALE','ABA ownership cannot replay the first transition');
});

test('inspection is selected-Work only, complete and paginated; cursors never choose or adopt a continuity',async t=>{
  const f=await fixture(t);
  const second=await f.call('pulso_workspace',{...f.bind,requestKey:'second',objective:'Second goal',constraints:Array.from({length:50},(_,i)=>`Constraint ${i}`)});
  await f.call('pulso_workspace',{...f.bind,workId:'OTHER',requestKey:'other',objective:'Unrelated'});
  const before=snapshot(f.projectRoot),args={action:'inspect_continuities',workId:'WORK',limit:1};
  const first=await f.call('pulso_workspace',args,'new-session');assert.equal(first.total,2);assert.equal(first.hasMore,true);
  const next=await f.call('pulso_workspace',{...args,cursor:first.nextCursor},'new-session');assert.equal(next.items[0].continuityId,second.continuityId);assert.equal(next.items[0].constraints.length,50);assert.equal(next.hasMore,false);
  assert.deepEqual(snapshot(f.projectRoot),before);assert.equal(f.read().ownerSessionID,'old-session');
  const wrong=await f.invoke('pulso_workspace',{...f.inspect,workId:'OTHER'},'new-session');assert.equal(wrong.ok,false);assert.match(wrong.error.message,/Work seleccionado/);
  assert.equal((await f.invoke('pulso_workspace',{...args,workId:'OTHER',cursor:first.nextCursor},'new-session')).ok,false);
  await f.call('pulso_workspace',f.resume(first.items[0]),'new-session');
  assert.match((await f.invoke('pulso_workspace',{...args,cursor:first.nextCursor},'new-session')).error.message,/CURSOR_OBSOLETO/);
  const fresh=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-recovery-fresh-'));t.after(()=>fs.rmSync(fresh,{recursive:true,force:true}));
  const absent=await executeTool('pulso_workspace',f.inspect,{projectRoot:fresh,homeDir:f.homeDir,nativeContext:{sessionID:'new-session'}});
  assert.equal(absent.ok,false);assert.deepEqual(fs.readdirSync(fresh),[],'inspection must not initialize absent metadata');
});

test('missing native identity, another root/Work, closed or changed cycle and cancelled context cannot transfer ownership',async t=>{
  const f=await fixture(t),selected=(await f.call('pulso_workspace',f.inspect)).items[0],args=f.resume(selected),before=snapshot(f.projectRoot);
  const absent=await f.invoke('pulso_workspace',args,null);assert.equal(absent.error.code,'NATIVE_SESSION_IDENTITY_UNAVAILABLE');assertSchema('tool-error',absent.error);assert.deepEqual(snapshot(f.projectRoot),before);
  for(const sessionID of ['', '   ']){
    const invalid=await f.invoke('pulso_workspace',args,null,{nativeContext:{sessionID}});assert.equal(invalid.ok,false);assert.match(invalid.error.message,/nativeContext/);assert.deepEqual(snapshot(f.projectRoot),before);
  }
  for(const sessionID of ['', '   ', true, {}, 42]){
    assert.throws(()=>bindContinuity(f.projectRoot,{...f.bind,continuityId:f.continuity.continuityId},{nativeContext:{sessionID}}),error=>error.code==='NATIVE_SESSION_IDENTITY_UNAVAILABLE');assert.deepEqual(snapshot(f.projectRoot),before);
  }
  const legacyDowngrade=await f.invoke('pulso_workspace',{...f.bind,continuityId:f.continuity.continuityId},null);
  assert.equal(legacyDowngrade.error.code,'NATIVE_SESSION_IDENTITY_UNAVAILABLE');assert.deepEqual(snapshot(f.projectRoot),before);
  assert.equal((await f.invoke('pulso_workspace',{...args,workId:'OTHER'},'new-session')).ok,false);
  assert.equal((await f.invoke('pulso_workspace',args,'new-session',{assertContext(){throw new Error('Native invocation cancelled');}})).ok,false);
  assert.deepEqual(snapshot(f.projectRoot),before);
  const copy=path.join(f.base,'copied-project');fs.cpSync(f.projectRoot,copy,{recursive:true});
  const copiedBefore=snapshot(copy),foreign=await f.invoke('pulso_workspace',args,'new-session',{projectRoot:copy});
  assert.equal(foreign.error.code,'CONTINUITY_RESUME_STALE');assert.deepEqual(snapshot(copy),copiedBefore);
  await f.call('pulso_work',{action:'close',workId:'WORK',expectedRevision:2,outcome:'cancelled',summary:'User cancelled',limitations:[]});
  const closed=snapshot(f.projectRoot);assert.equal((await f.invoke('pulso_workspace',args,'new-session')).error.code,'CONTINUITY_RESUME_STALE');assert.deepEqual(snapshot(f.projectRoot),closed);
  await f.call('pulso_work',{action:'reopen',workId:'WORK',expectedRevision:3,reason:'New cycle authorized'});
  const reopened=snapshot(f.projectRoot);assert.equal((await f.invoke('pulso_workspace',args,'new-session')).error.code,'CONTINUITY_RESUME_STALE');assert.deepEqual(snapshot(f.projectRoot),reopened);
  const old=(await f.call('pulso_workspace',f.inspect,'new-session')).items[0];assert.equal(old.resumable,false);
});

test('administratively resolved reservation still explains pending incorporation without inventing native cessation',async t=>{
  const f=await fixture(t),c=f.continuity;
  const prepare={action:'prepare_delegation',contractVersion:2,workId:'WORK',expectedRevision:2,continuityId:c.continuityId,intentRevision:1,requestKey:'task',taskIds:['T1'],objective:'Inspect',inputs:[],output:'conversation',constraints:[],templateId:'exploration'};
  const p=await f.call('pulso_work',prepare);
  recordNativeDispatch(f.projectRoot,{workId:'WORK',delegationId:p.delegationId,sessionID:'old-session',callID:'call',agent:p.agent,prompt:p.specialistPrompt});
  const reconcile={action:'reconcile_delegation',workId:'WORK',delegationId:p.delegationId,continuityId:c.continuityId,intentRevision:1,reason:'Explicitly inspected missed terminal; administrative report only',source:{text:'Owner inspected execution and reported it ended; no native terminal available'},resolution:'explicitly_reconciled'};
  await f.call('pulso_work',reconcile);
  const blocked=await f.invoke('pulso_work',{...prepare,requestKey:'replacement'});assert.equal(blocked.error.code,'DELEGATION_AWAITING_INCORPORATION');assert.equal(blocked.error.recovery.reservationResolved,true);assertSchema('tool-error',blocked.error);
  const record=readDelegation(f.projectRoot,{workId:'WORK',delegationId:p.delegationId});assert.equal(record.retired,false);assert.equal(record.attempts[0].resolution,'explicitly_reconciled');assert.equal(record.returns.length,0);
});

test('recovery descriptors require explicit selection, reject model-supplied identity and classify permission accurately',()=>{
  const inspect={action:'inspect_continuities',workId:'WORK'},resume={action:'resume_continuity',workId:'WORK',continuityId:'CONT-id',expectedResumeBasis:'a'.repeat(64)};
  for(const value of [inspect,resume]){validateToolInput('pulso_workspace',value);for(const key of ['sessionID','ownerSessionID','projectRoot','nativeContext'])assert.throws(()=>validateToolInput('pulso_workspace',{...value,[key]:'fake'}));}
  for(const key of ['workId','continuityId','expectedResumeBasis']){const value={...resume};delete value[key];assert.throws(()=>validateToolInput('pulso_workspace',value));}
  assert.throws(()=>validateToolInput('pulso_workspace',{action:'inspect_continuities'}));
  assert.throws(()=>validateToolInput('pulso_workspace',{...resume,expectedResumeBasis:'wrong'}));
  assert.equal(isMutating('pulso_workspace',inspect),false);assert.equal(isMutating('pulso_workspace',resume),true);
});


test('legacy unowned continuity keeps compatible bind/get behavior without fabricated session identity',async t=>{
  const f=await fixture(t),args={...f.bind,workId:'OTHER',requestKey:'unowned'};
  const bound=await f.call('pulso_workspace',args,null);assert.equal(bound.ownerSessionID,null);
  const before=snapshot(f.projectRoot);
  const rebound=await f.call('pulso_workspace',{...args,continuityId:bound.continuityId},null);assert.equal(rebound.ownerSessionID,null);
  assert.equal((await f.call('pulso_workspace',bound.readWith,null)).objective,args.objective);assert.deepEqual(snapshot(f.projectRoot),before);
});


test('structured recovery preserves real metadata-lock diagnostics and rejects arbitrary error payloads',async t=>{
  const f=await fixture(t),selected=(await f.call('pulso_workspace',f.inspect)).items[0],args=f.resume(selected);
  const lock=path.join(f.projectRoot,'.pulso-write.lock');fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({token:'foreign',pid:1}));
  const before=snapshot(f.projectRoot),busy=await f.invoke('pulso_workspace',args,'new-session');
  assert.equal(busy.error.code,'METADATA_BUSY');assertSchema('tool-error',busy.error);
  assert.deepEqual(busy.error.recovery,{root:f.projectRoot,lockPath:'.pulso-write.lock',ownerPath:'.pulso-write.lock/owner.json',manualOnly:true});
  assert.deepEqual(snapshot(f.projectRoot),before);
  const inspected=await f.call('pulso_workspace',f.inspect,'new-session');assert.equal(inspected.items.length,1);assert.deepEqual(snapshot(f.projectRoot),before);
  fs.rmSync(lock,{recursive:true});
  const unknown=await f.invoke('pulso_workspace',args,'new-session',{assertContext(){throw Object.assign(new Error('Native context rejected'),{recovery:{secret:'must not be forwarded'}});}});
  assert.equal(unknown.ok,false);assert.equal(unknown.error.recovery,undefined);assertSchema('tool-error',unknown.error);
  const store=path.join(f.projectRoot,'.pulso/continuities-v2.json'),value=JSON.parse(fs.readFileSync(store,'utf8'));value.checksum='0'.repeat(64);fs.writeFileSync(store,JSON.stringify(value));
  const corruptBefore=snapshot(f.projectRoot),corrupt=await f.invoke('pulso_workspace',args,'new-session');assert.equal(corrupt.ok,false);assert.equal(corrupt.error.recovery,undefined);assert.match(corrupt.error.message,/corrupto/);assertSchema('tool-error',corrupt.error);assert.deepEqual(snapshot(f.projectRoot),corruptBefore);
});
