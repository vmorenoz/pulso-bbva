import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {executeTool} from '../../core/lib/semantic-tools.mjs';
import {readWork} from '../../core/lib/artifacts.mjs';
import {withWorkspaceLock} from '../../core/lib/fs.mjs';
import {recordNativeDispatch} from '../../core/lib/delegation-registry.mjs';

async function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-continuity-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const projectRoot=path.join(temp,'workspace'),homeDir=path.join(temp,'home');fs.mkdirSync(projectRoot);fs.mkdirSync(homeDir);
  const context={projectRoot,homeDir,resourceRoot:fileURLToPath(new URL('../../core',import.meta.url))};
  const invoke=(tool,args,sessionID)=>executeTool(tool,args,{...context,...(sessionID?{nativeContext:{sessionID}}:{})});
  const call=async(tool,args,sessionID)=>{const r=await invoke(tool,args,sessionID);assert.equal(r.ok,true,JSON.stringify(r));return r.data;};
  await call('pulso_workspace',{action:'prepare'});
  const {workId}=await call('pulso_work',{action:'create',title:'Continuity fixture',objective:'Separate objectives',criterion:'Separate records',verification:'Real core fixtures'});
  const work=()=>readWork(projectRoot,workId,{files:false});
  await call('pulso_work',{action:'update',workId,expectedRevision:work().revision,actions:['a','b','ab'].map((p,i)=>({type:'task.add',task:{id:`T-${i}`,title:p,criterionIds:['AC-1'],agent:'pulso-executor',status:'in_progress',dependsOn:[],writeScope:[p],resources:[],acceptance:['Scoped work']}}))});
  const bind=(key,repositories)=>({action:'bind_continuity',workId,requestKey:key,objective:key,repositories,constraints:[]});
  const prep=(c,task,key)=>({action:'prepare_delegation',contractVersion:2,workId,expectedRevision:work().revision,continuityId:c.continuityId,intentRevision:c.intentRevision,requestKey:key,taskIds:[task],objective:key,inputs:[],output:'conversation',constraints:[],templateId:'implementation'});
  return {context,projectRoot,work,workId,invoke,call,bind,prep};
}

test('continuity mutation receipts stay compact while readWith preserves the full current intention',async t=>{
  const f=await fixture(t);
  const bound=await f.call('pulso_workspace',{...f.bind('Original',['a']),constraints:['Original limit']},'session-a');
  const keys=['contractVersion','continuityId','projectId','workId','cycle','intentId','intentRevision','revision','ownerSessionID','readWith'].sort();
  assert.deepEqual(Object.keys(bound).sort(),keys);
  assert.deepEqual(bound.readWith,{action:'get_continuity',continuityId:bound.continuityId});
  const original=await f.call('pulso_workspace',bound.readWith,'session-a');
  assert.equal(original.objective,'Original');
  assert.deepEqual(original.constraints,['Original limit']);
  assert.deepEqual(original.repositories,['a']);
  const updated=await f.call('pulso_workspace',{action:'update_intent',continuityId:bound.continuityId,expectedRevision:bound.revision,objective:'Changed',constraints:['New limit'],repositories:['b']},'session-a');
  assert.deepEqual(Object.keys(updated).sort(),keys);
  assert.equal(updated.revision,bound.revision+1);
  assert.equal(updated.intentRevision,bound.intentRevision+1);
  assert.equal(updated.ownerSessionID,'session-a');
  const current=await f.call('pulso_workspace',updated.readWith,'session-a');
  assert.equal(current.objective,'Changed');
  assert.deepEqual(current.constraints,['New limit']);
  assert.deepEqual(current.repositories,['b']);
  assert.equal(current.revision,updated.revision);
});

test('two native sessions keep separate continuities; explicit resumption required',async t=>{
  const f=await fixture(t),a=await f.call('pulso_workspace',f.bind('A',['a']),'session-a'),b=await f.call('pulso_workspace',f.bind('B',['b']),'session-b');
  const ar=await f.call('pulso_work',f.prep(a,'T-0','pa'),'session-a');await f.call('pulso_work',f.prep(b,'T-1','pb'),'session-b');
  await f.call('pulso_workspace',{action:'update_intent',continuityId:b.continuityId,expectedRevision:1,objective:'New B',constraints:['No tests']},'session-b');
  const capsule=await f.call('pulso_workspace',{action:'get_continuity',continuityId:a.continuityId},'session-a');assert.equal(capsule.intentRevision,1);assert.equal(capsule.objective,'A');assert.equal(capsule.pending[0].delegationId,ar.delegationId);
  assert.equal((await f.invoke('pulso_workspace',{action:'get_continuity',continuityId:a.continuityId},'session-b')).ok,false);
  assert.equal((await f.invoke('pulso_workspace',f.bind('A',['a']),'session-b')).ok,false);
  await f.call('pulso_workspace',{...f.bind('A',['a']),continuityId:a.continuityId},'session-new');
  assert.equal((await f.invoke('pulso_workspace',{action:'get_continuity',continuityId:a.continuityId},'session-a')).ok,false);
  const resumed=await f.call('pulso_work',{action:'get_delegation',workId:f.workId,delegationId:ar.delegationId},'session-new');assert.equal(resumed.specialistPrompt,ar.specialistPrompt);
  const status=await f.call('pulso_workspace',{action:'status',continuityId:a.continuityId},'session-new');assert.equal(status.continuity.objective,'A');assert.equal(status.continuity.nextAction,null);
  const inventory=await f.call('pulso_workspace',{action:'status'});assert.equal(inventory.focusWorkId,null);assert.equal(inventory.continuity,undefined);
});

test('incomplete preparation preserves paginated works and validates explicit continuity',async t=>{
  const f=await fixture(t),bound=await f.call('pulso_workspace',f.bind('Status',['a']),'session-a');
  await f.call('pulso_work',{action:'create',title:'Second work',objective:'Pagination',criterion:'Visible',verification:'Read status'});
  const args={action:'status',continuityId:bound.continuityId,limit:1};
  const complete=await f.call('pulso_workspace',args,'session-a');
  const denied=await f.invoke('pulso_workspace',args,'session-b');
  assert.equal(denied.ok,false);
  fs.unlinkSync(path.join(f.projectRoot,'.pulso/decisions.md'));
  const partial=await f.call('pulso_workspace',args,'session-a');
  assert.equal(partial.prepared,false);assert.equal(partial.incomplete,true);
  assert.deepEqual(partial.missing,['.pulso/decisions.md']);
  assert.deepEqual(partial.works,complete.works);assert.equal(partial.works.total,2);assert.equal(partial.works.hasMore,true);
  assert.deepEqual(partial.continuity,complete.continuity);assert.equal(partial.focusWorkId,f.workId);
  assert.equal(partial.navigationFocusWorkId,complete.navigationFocusWorkId);
  const next=await f.call('pulso_workspace',{...args,cursor:partial.works.nextCursor},'session-a');
  assert.equal(next.works.items.length,1);assert.notEqual(next.works.items[0].id,partial.works.items[0].id);
  assert.equal(next.prepared,false);
  const rejected=await f.invoke('pulso_workspace',args,'session-b');
  assert.equal(rejected.ok,false);assert.deepEqual(rejected.error,denied.error);
  assert.equal((await f.invoke('pulso_workspace',{...args,continuityId:'missing-continuity'},'session-a')).ok,false);
  const inventory=await f.call('pulso_workspace',{action:'status'});
  assert.equal(inventory.works.total,2);assert.equal(inventory.focusWorkId,null);
});

test('explicit compatibility preserves original base; default new intention rejects old result after capture',async t=>{
  const f=await fixture(t),a=await f.call('pulso_workspace',f.bind('A',['a','b']));
  const p1=await f.call('pulso_work',f.prep(a,'T-0','p1')),r1=await f.call('pulso_work',p1.readWith),r2=await f.call('pulso_work',f.prep(a,'T-1','p2'));
  await f.call('pulso_workspace',{action:'update_intent',continuityId:a.continuityId,expectedRevision:1,objective:'A narrowed',constraints:['New limit only affects T-1'],compatibleDelegationIds:[r1.delegationId]});
  const accept=(r,task,operationId)=>({action:'accept_result',contractVersion:2,workId:f.workId,delegationId:r.delegationId,continuityId:a.continuityId,intentRevision:2,expectedRevision:f.work().revision,operationId,reportedReturn:{captureKey:'capture',markdown:'Finished report'},decision:{status:'completed',summary:'Accepted',acceptedTaskIds:[task]},reportedTerminal:true});
  const accepted=await f.call('pulso_work',accept(r1,'T-0','op-1'));assert.equal(accepted.applied,true);
  const read=await f.call('pulso_work',{action:'get_delegation',workId:f.workId,delegationId:r1.delegationId});assert.deepEqual(read.acceptanceBasis,r1.acceptanceBasis);assert.equal(read.state,'accepted');
  const stale=await f.invoke('pulso_work',accept(r2,'T-1','op-2'));assert.equal(stale.ok,false);assert.equal(stale.persistence.captured,true);assert.match(stale.error.message,/obsoleto/);
  const capsule=await f.call('pulso_workspace',{action:'get_continuity',continuityId:a.continuityId});assert.equal(capsule.accepted.length,1);assert.equal(capsule.pending[0].current,false);
});

test('safe scopes compare segments and ancestors, stable reads conflict with writes, no Git inference',async t=>{
  const f=await fixture(t),c=await f.call('pulso_workspace',f.bind('paths',['.']));
  await f.call('pulso_work',f.prep(c,'T-0','a'));
  await f.call('pulso_work',f.prep(c,'T-2','ab'));
  const blocked=await f.invoke('pulso_work',{...f.prep(c,'T-1','b'),stableReadScope:['a/child']});assert.equal(blocked.ok,false);assert.match(blocked.error.message,/Reserva/);
  const escape=await f.invoke('pulso_workspace',f.bind('bad', ['../outside']));assert.equal(escape.ok,false);
  fs.symlinkSync(os.tmpdir(),path.join(f.projectRoot,'link'));
  assert.equal((await f.invoke('pulso_workspace',f.bind('symlink',['link']))).ok,false);
});

test('reported reconciliation allows new preparation, retirement never asserts native cancellation',async t=>{
  const f=await fixture(t),c=await f.call('pulso_workspace',f.bind('C',['a'])),r=await f.call('pulso_work',f.prep(c,'T-0','p'));
  const action={action:'reconcile_delegation',workId:f.workId,delegationId:r.delegationId,continuityId:c.continuityId,intentRevision:1,reason:'Coordinator did not invoke specialist',resolution:'not_dispatched'};
  const resolved=await f.call('pulso_work',action);assert.equal(resolved.reservationResolved,true);assert.equal(resolved.reconciliations[0].provenance,'orchestrator_reported');assert.equal(resolved.attempts.length,0);
  assert.equal((await f.call('pulso_workspace',{action:'get_continuity',continuityId:c.continuityId})).pending.length,0);
  const newer=await f.call('pulso_work',{...f.prep(c,'T-0','new')});assert.notEqual(newer.delegationId,r.delegationId);
  await f.call('pulso_work',{...action,resolution:'retired'});
  assert.equal((await f.call('pulso_work',{action:'get_delegation',workId:f.workId,delegationId:r.delegationId})).state,'retired');
});

test('dot aliases in repository/integration/stable read paths are rejected, including aliases of claimed paths',async t=>{
  const f=await fixture(t),c=await f.call('pulso_workspace',f.bind('scope',['.']));
  await f.call('pulso_work',{action:'update',workId:f.workId,expectedRevision:f.work().revision,actions:[{type:'task.update',taskId:'T-0',patch:{writeScope:['repo/a']},reason:'Exact aliased path regression fixture'}]});
  await f.call('pulso_work',{...f.prep(c,'T-0','a'),integrationResources:['repo']});
  for(const input of [
    {...f.prep(c,'T-1','bad-integration'),integrationResources:['./repo']},
    {...f.prep(c,'T-1','bad-stable'),stableReadScope:['./repo/a']},
    {...f.prep(c,'T-1','bad-segment'),stableReadScope:['repo/./a']},
    {...f.prep(c,'T-1','bad-ending'),integrationResources:['repo/.']}
  ]){const r=await f.invoke('pulso_work',input);assert.equal(r.ok,false);assert.match(r.error.message,/normalizada|relativa/);}
  for(const p of ['./repo','repo/.','repo/./b'])assert.equal((await f.invoke('pulso_workspace',f.bind(`path-${p.length}`,[p]))).ok,false);
  const overlap=await f.invoke('pulso_work',{...f.prep(c,'T-1','legitimate-overlap'),integrationResources:['repo']});assert.equal(overlap.ok,false);assert.match(overlap.error.message,/Reserva/);
});

test('compatible intent cannot narrow repositories around existing writes, stable reads or integration',async t=>{
  for(const extra of [{},{stableReadScope:['outside/read']},{integrationResources:['outside']}]){
    const f=await fixture(t),c=await f.call('pulso_workspace',f.bind('scope',['.']));
    const prepared=await f.call('pulso_work',{...f.prep(c,'T-0','a'),...extra}),r=await f.call('pulso_work',prepared.readWith);
    const repositories=Object.keys(extra).length?['a']:['b'];
    const denied=await f.invoke('pulso_workspace',{action:'update_intent',continuityId:c.continuityId,expectedRevision:1,objective:'Narrowed',constraints:[],repositories,compatibleDelegationIds:[r.delegationId]});
    assert.equal(denied.ok,false);assert.match(denied.error.message,/fuera de repositorios/);
    const current=await f.call('pulso_workspace',{action:'get_continuity',continuityId:c.continuityId});assert.equal(current.intentRevision,1);assert.deepEqual(current.repositories,['.']);
    // A genuinely narrowed intention is permitted only without that compatibility.
    await f.call('pulso_workspace',{action:'update_intent',continuityId:c.continuityId,expectedRevision:1,objective:'Narrowed',constraints:[],repositories});
    assert.throws(()=>recordNativeDispatch(f.projectRoot,{workId:f.workId,delegationId:r.delegationId,sessionID:'s',callID:'c',agent:r.delegation.agent,prompt:r.specialistPrompt}),/obsoleto|fuera de repositorios/);
  }
});

test('get_continuity and anchored status remain read-only under another process writer mutex',async t=>{
  const f=await fixture(t),c=await f.call('pulso_workspace',f.bind('read',['.']));
  await f.call('pulso_work',f.prep(c,'T-0','p'));
  const urls=new URL('../../core/lib/semantic-tools.mjs',import.meta.url).href;
  const script=`import {executeTool} from ${JSON.stringify(urls)}; const ctx=JSON.parse(process.argv[1]); const continuityId=process.argv[2]; console.log(JSON.stringify(await Promise.all(['get_continuity','status'].map(action=>executeTool('pulso_workspace',{action,continuityId},ctx)))));`;
  const files=['.pulso/continuities-v2.json','.pulso/delegations-v2.json','.pulso/state.json'];
  const before=files.map(p=>fs.readFileSync(path.join(f.projectRoot,p),'utf8'));
  const result=withWorkspaceLock(f.projectRoot,()=>spawnSync(process.execPath,['--input-type=module','-e',script,JSON.stringify(f.context),c.continuityId],{encoding:'utf8'}));
  assert.equal(result.status,0,result.stderr);for(const r of JSON.parse(result.stdout))assert.equal(r.ok,true,JSON.stringify(r));
  assert.deepEqual(files.map(p=>fs.readFileSync(path.join(f.projectRoot,p),'utf8')),before);assert.equal(fs.existsSync(path.join(f.projectRoot,'.pulso-write.lock')),false);
});

test('continuity capsule caps historical payload without returning obsolete restrictions',async t=>{
  const f=await fixture(t),c=await f.call('pulso_workspace',f.bind('history',['.']));
  for(let revision=1;revision<=24;revision++)await f.call('pulso_workspace',{action:'update_intent',continuityId:c.continuityId,expectedRevision:revision,objective:`Intent ${revision}`,constraints:[`Restriction ${revision}`]});
  const capsule=await f.call('pulso_workspace',{action:'get_continuity',continuityId:c.continuityId});
  assert.equal(capsule.intentRevision,25);assert.deepEqual(capsule.constraints,['Restriction 24']);assert.equal(capsule.historyTotal,24);assert.equal(capsule.history.length,20);assert.equal(capsule.truncated,true);
  assert.ok(capsule.history.every(v=>!Object.hasOwn(v,'constraints')));assert.ok(JSON.stringify(capsule).length<7000);
});
