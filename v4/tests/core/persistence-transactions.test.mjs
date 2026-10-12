import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {withWorkspaceLock,readJSON,writeJSON} from '../../core/lib/fs.mjs';
import {prepareWorkspace} from '../../core/lib/workspace.mjs';
import {createWork,readWork,saveWork,status,history,closeWork,reopenWork,repair,validateProject,initArtifacts,syncWork} from '../../core/lib/artifacts.mjs';
import {readMemory,updateMemory,withUserLock} from '../../core/lib/memory.mjs';
import {randomUUID} from 'node:crypto';
import {applyWorkMutation,closeWorkOperation,reopenWorkOperation,syncWorkOperation,recoverWorkspaceOperation,createWorkOperation} from '../../core/lib/work-mutations.mjs';

const moduleURL=name=>new URL(`../../core/lib/${name}.mjs`,import.meta.url).href;
const input=id=>({id,title:id,objective:'Preserve metadata',criterion:'No lost updates',verification:'Real processes'});
function fixture(t,{prepare=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-transactions-'));
  const homeDir=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-home-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(homeDir,{recursive:true,force:true});});
  if(prepare)prepareWorkspace(root,{homeDir});
  return {root,homeDir};
}
const lockPath=root=>path.join(root,'.pulso-write.lock');
function foreignLock(root){
  fs.mkdirSync(lockPath(root));
  const owner={token:'foreign',pid:1,createdAt:'1970-01-01T00:00:00.000Z'};
  writeJSON(root,'.pulso-write.lock/owner.json',owner);return owner;
}
function worker(t,root,id,mode){
  const code=`
    import {readWork,saveWork,createWork,closeWork,reopenWork} from ${JSON.stringify(moduleURL('artifacts'))};
    const [root,id,mode]=process.argv.slice(1);
    const candidate=mode==='same'?readWork(root,id):null;
    process.send({ready:true});
    process.once('message',async()=>{
      async function attempt(fn){for(let n=0;n<500;n++){try{return fn();}catch(e){if(e.code!=='METADATA_BUSY')throw e;await new Promise(r=>setTimeout(r,5));}}throw new Error('bounded retry exhausted');}
      try{
        if(candidate){candidate.summary='writer '+process.pid;await attempt(()=>saveWork(root,candidate,1));}
        else {
          await attempt(()=>createWork(root,{id,title:id,objective:'Independent work',criterion:'Preserve history',verification:'Processes'}));
          await attempt(()=>closeWork(root,id,{outcome:'cancelled',summary:'First cycle'}));
          await attempt(()=>reopenWork(root,id,'Second cycle'));
          await attempt(()=>closeWork(root,id,{outcome:'cancelled',summary:'Second cycle'}));
          await attempt(()=>reopenWork(root,id,'Continue'));
        }
        process.send({ok:true});
      }catch(e){process.send({ok:false,code:e.code,message:e.message});}
      process.disconnect();
    });`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,root,id,mode],{stdio:['ignore','pipe','pipe','ipc']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const ready=once(child,'message');
  const exited=once(child,'exit').then(([code])=>assert.equal(code,0,stderr));
  return {child,ready,exited};
}

test('reads are inert; first prepare and nested writes share one owned lock',t=>{
  const {root,homeDir}=fixture(t,{prepare:false});
  assert.equal(readMemory(root,'project').revision,1);
  assert.throws(()=>status(root));assert.deepEqual(fs.readdirSync(root),[]);
  withWorkspaceLock(root,()=>{
    const owner=readJSON(root,'.pulso-write.lock/owner.json');assert.equal(owner.pid,process.pid);
    withWorkspaceLock(path.join(root,'.'),()=>assert.equal(readJSON(root,'.pulso-write.lock/owner.json').token,owner.token));
    prepareWorkspace(root,{homeDir});
    const w=createWork(root,input('PULSO-A'));w.summary='nested';saveWork(root,w,1);
    updateMemory(root,{action:'set_context',scope:'project',expectedRevision:1,context:'Nested memory'});
    assert.equal(readJSON(root,'.pulso-write.lock/owner.json').token,owner.token);
  });
  assert.equal(fs.existsSync(lockPath(root)),false);assert.equal(readWork(root,'PULSO-A').revision,2);
  const error=new Error('original');assert.throws(()=>withWorkspaceLock(root,()=>{throw error;}),e=>e===error);
  assert.equal(fs.existsSync(lockPath(root)),false);
  assert.throws(()=>withWorkspaceLock(root,async()=>{}),/síncrono/);
  assert.throws(()=>withWorkspaceLock(root,()=>Promise.resolve()),/Promise/);
  assert.equal(fs.existsSync(lockPath(root)),false);
});

test('all public writers reject a foreign lock without stealing even an ancient owner',t=>{
  const {root,homeDir}=fixture(t);const w=createWork(root,input('PULSO-A'));
  const owner=foreignLock(root);
  const calls=[()=>initArtifacts(root),()=>prepareWorkspace(root,{homeDir}),()=>createWork(root,input('PULSO-B')),
    ()=>saveWork(root,w,1),()=>closeWork(root,w.id,{outcome:'cancelled',summary:'close'}),()=>reopenWork(root,w.id,'reason'),
    ()=>syncWork(root,w.id),()=>repair(root),()=>updateMemory(root,{action:'set_context',scope:'project',expectedRevision:1,context:'x'}),
    ()=>applyWorkMutation(root,{}),()=>closeWorkOperation(root,{}),()=>reopenWorkOperation(root,{}),()=>syncWorkOperation(root,{}),()=>recoverWorkspaceOperation(root),()=>createWorkOperation(root,{})];
  for(const call of calls)assert.throws(call,e=>e.code==='METADATA_BUSY'&&e.recovery.ownerPath==='.pulso-write.lock/owner.json');
  assert.deepEqual(readJSON(root,'.pulso-write.lock/owner.json'),owner);
  assert.equal(readWork(root,w.id).revision,1);assert.equal(readMemory(root,'project').revision,1);
});

test('foreign ownership and symlinks are preserved, never released by this invocation',t=>{
  const {root}=fixture(t,{prepare:false});
  withWorkspaceLock(root,()=>{
    writeJSON(root,'.pulso-write.lock/owner.json',{token:'replacement'});
    assert.throws(()=>withWorkspaceLock(root,()=>{}),e=>e.code==='METADATA_LOCK_LOST');
  });
  assert.equal(readJSON(root,'.pulso-write.lock/owner.json').token,'replacement');
  fs.rmSync(lockPath(root),{recursive:true});
  const target=path.join(root,'target');fs.mkdirSync(target);fs.symlinkSync(target,lockPath(root));
  assert.throws(()=>withWorkspaceLock(root,()=>assert.fail('not invoked')),/Symlink/);
  assert.deepEqual(fs.readdirSync(target),[]);
});

test('real competing process receives recoverable conflict before first prepare',t=>{
  const {root,homeDir}=fixture(t,{prepare:false});
  withWorkspaceLock(root,()=>{
    const child=spawnSync(process.execPath,['--input-type=module','-e',`
      import {prepareWorkspace} from ${JSON.stringify(moduleURL('workspace'))};
      try{prepareWorkspace(process.argv[1],{homeDir:process.argv[2]});process.exitCode=1;}
      catch(e){console.log(JSON.stringify({code:e.code,recovery:e.recovery}));}
    `,root,homeDir],{encoding:'utf8',timeout:10000});
    assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout);
    assert.equal(result.code,'METADATA_BUSY');assert.equal(result.recovery.root,fs.realpathSync(root));
    assert.equal(fs.existsSync(path.join(root,'.pulso')),false);
  });
  prepareWorkspace(root,{homeDir});assert.equal(validateProject(root).valid,true);
});

test('two processes with the same Work revision produce one commit and one stale conflict',{timeout:15000},async t=>{
  const {root}=fixture(t);createWork(root,input('PULSO-A'));
  const workers=[worker(t,root,'PULSO-A','same'),worker(t,root,'PULSO-A','same')];
  await Promise.all(workers.map(w=>w.ready));
  const results=workers.map(w=>once(w.child,'message').then(([value])=>value));workers.forEach(w=>w.child.send('go'));
  const values=await Promise.all(results);await Promise.all(workers.map(w=>w.exited));
  assert.equal(values.filter(v=>v.ok).length,1);assert.match(values.find(v=>!v.ok).message,/Revisión obsoleta/);
  assert.equal(readWork(root,'PULSO-A').revision,2);assert.equal(status(root).works[0].workRevision,2);
  assert.equal(validateProject(root).valid,true);
});

test('independent processes preserve both Works, shared index and all closure cycles',{timeout:15000},async t=>{
  const {root}=fixture(t);
  const workers=[worker(t,root,'PULSO-A','different'),worker(t,root,'PULSO-B','different')];
  await Promise.all(workers.map(w=>w.ready));
  const results=workers.map(w=>once(w.child,'message').then(([value])=>value));workers.forEach(w=>w.child.send('go'));
  for(const result of await Promise.all(results))assert.equal(result.ok,true,result.message);
  await Promise.all(workers.map(w=>w.exited));
  assert.deepEqual(status(root).works.map(w=>w.id).sort(),['PULSO-A','PULSO-B']);
  assert.equal(history(root).length,4);assert.equal(new Set(history(root).map(h=>h.closureId)).size,4);
  for(const id of ['PULSO-A','PULSO-B']){const w=readWork(root,id);assert.equal(w.revision,5);assert.equal(w.cycle,3);}
  assert.equal(validateProject(root).valid,true);assert.equal(fs.existsSync(lockPath(root)),false);
});

test('reopening repairs a missing closure projection before clearing canonical closure',t=>{
  const {root}=fixture(t);createWork(root,input('PULSO-A'));
  closeWork(root,'PULSO-A',{outcome:'cancelled',summary:'Committed closure'});
  // Real on-disk interrupted projection fixture: canonical close survived, history did not.
  fs.writeFileSync(path.join(root,'.pulso/history.jsonl'),'');
  reopenWork(root,'PULSO-A','Resume after interrupted projection');
  assert.equal(history(root)[0].summary,'Committed closure');assert.equal(history(root)[0].cycle,1);
  repair(root);assert.equal(history(root).length,1);assert.equal(validateProject(root).valid,true);
});

test('a killed owner leaves a lock requiring explicit manual recovery',{timeout:10000},async t=>{
  const {root}=fixture(t,{prepare:false});
  const code=`import {withWorkspaceLock} from ${JSON.stringify(moduleURL('fs'))};
    withWorkspaceLock(process.argv[1],()=>{process.stdout.write('owned\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});`;
  const child=spawn(process.execPath,['--input-type=module','-e',code,root],{stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  await once(child.stdout,'data');const exited=once(child,'exit');child.kill('SIGKILL');await exited;
  assert.throws(()=>withWorkspaceLock(root,()=>{}),e=>e.code==='METADATA_BUSY');
  assert.equal(readJSON(root,'.pulso-write.lock/owner.json').pid,child.pid);
  // Explicit operator recovery in an isolated fixture after confirming process exit.
  fs.rmSync(lockPath(root),{recursive:true});withWorkspaceLock(root,()=>{});
  assert.equal(fs.existsSync(lockPath(root)),false);
});

test('rejected Promise from a regular callback is consumed without unhandled rejection',t=>{
  const {root}=fixture(t,{prepare:false});
  const result=spawnSync(process.execPath,['--unhandled-rejections=strict','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {withWorkspaceLock} from ${JSON.stringify(moduleURL('fs'))};
    let scheduled=false;
    assert.throws(()=>withWorkspaceLock(process.argv[1],function(){
      queueMicrotask(()=>{scheduled=true;});
      return Promise.reject(new Error('rejected callback'));
    }),/no admite Promise/);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(scheduled,true); // Contract rejection cannot cancel scheduled work.
  `,root],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(fs.existsSync(lockPath(root)),false);
});

test('user-memory cleanup preserves original failures and reports committed receipts',t=>{
  const {root,homeDir}=fixture(t,{prepare:false});
  const lock=path.join(homeDir,'.pulso/preferences.lock');
  const original=new Error('original callback failure');original.persistence={applied:true,partial:true};
  assert.throws(()=>withUserLock(homeDir,()=>{
    const owner=readJSON(homeDir,'.pulso/preferences.lock/owner.json');
    assert.equal(owner.hostname,os.hostname());assert.equal(owner.pid,process.pid);assert.ok(owner.token);
    fs.writeFileSync(path.join(lock,'unexpected'),'preserve');throw original;
  }),error=>error===original&&error.persistence.partial);
  assert.equal(fs.readFileSync(path.join(lock,'unexpected'),'utf8'),'preserve');
  fs.rmSync(lock,{recursive:true}); // Explicit fixture recovery, never product cleanup.
  const value=readMemory(root,'user',{homeDir});value.context='Applied';value.revision++;
  const receipt={revision:value.revision,scope:'user'};
  assert.throws(()=>withUserLock(homeDir,()=>{
    writeJSON(homeDir,'.pulso/preferences.json',value);
    fs.writeFileSync(path.join(lock,'unexpected'),'preserve');return receipt;
  }),error=>error.code==='METADATA_CLEANUP_PENDING'&&error.persistence.applied===true&&error.persistence.cleanupPending===true&&error.persistence.lockPath===lock&&error.persistence.receipt===receipt);
  assert.equal(readMemory(root,'user',{homeDir}).revision,2);
  assert.equal(readMemory(root,'user',{homeDir}).context,'Applied');
  assert.ok(readJSON(homeDir,'.pulso/preferences.lock/owner.json').token);
});

test('user-memory writes return revisions and release their own lock normally',t=>{
  const {root,homeDir}=fixture(t,{prepare:false});
  const request={action:'set_context',scope:'user',expectedRevision:1,context:'User context'};
  assert.equal(updateMemory(root,request,{homeDir}).revision,2);
  assert.equal(readMemory(root,'user',{homeDir}).context,request.context);
  assert.equal(fs.existsSync(path.join(homeDir,'.pulso/preferences.lock')),false);
  assert.throws(()=>updateMemory(root,request,{homeDir}),/CONFLICTO/);
  assert.equal(readMemory(root,'user',{homeDir}).revision,2);
});

test('user-memory cleanup never removes replaced ownership or directory',t=>{
  const {homeDir}=fixture(t,{prepare:false});
  const lock=path.join(homeDir,'.pulso/preferences.lock');
  assert.throws(()=>withUserLock(homeDir,()=>{
    writeJSON(homeDir,'.pulso/preferences.lock/owner.json',{token:'foreign'});return {revision:2};
  }),e=>e.persistence.applied&&e.persistence.cleanupPending);
  assert.equal(readJSON(homeDir,'.pulso/preferences.lock/owner.json').token,'foreign');
  fs.rmSync(lock,{recursive:true});
  assert.throws(()=>withUserLock(homeDir,()=>{
    fs.renameSync(lock,lock+'-preserved');fs.mkdirSync(lock);
    writeJSON(homeDir,'.pulso/preferences.lock/owner.json',{token:'replacement'});return {revision:3};
  }),e=>e.persistence.cleanupPending);
  assert.equal(readJSON(homeDir,'.pulso/preferences.lock/owner.json').token,'replacement');
  assert.ok(readJSON(homeDir,'.pulso/preferences.lock-preserved/owner.json').token);
});

test('two processes publishing stale plans for one projectId preserve both roots',{timeout:15000},async t=>{
  const {root,homeDir}=fixture(t,{prepare:false}),second=fixture(t,{prepare:false}).root,projectId=randomUUID();
  for(const directory of [root,second])writeJSON(directory,'.pulso/project.json',{schemaVersion:1,projectId});
  const code=`
    import {planProjectIdentity} from ${JSON.stringify(moduleURL('identity'))};
    const [root,homeDir]=process.argv.slice(1);
    const plan=planProjectIdentity(root,{homeDir});process.send({ready:true});
    process.once('message',async()=>{
      try{
        let committed=false;
        for(let n=0;n<500;n++){
          try{plan.commit();committed=true;break;}
          catch(error){if(error.code!=='METADATA_BUSY')throw error;await new Promise(resolve=>setTimeout(resolve,5));}
        }
        if(!committed)throw new Error('bounded retries exhausted');
        process.send({ok:true});
      }catch(error){process.send({ok:false,message:error.message});}
      process.disconnect();
    });`;
  const workers=[root,second].map(directory=>{
    const child=spawn(process.execPath,['--input-type=module','-e',code,directory,homeDir],{stdio:['ignore','pipe','pipe','ipc']});
    t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
    return {child,ready:once(child,'message'),exited:once(child,'exit')};
  });
  await Promise.all(workers.map(w=>w.ready));
  const results=workers.map(w=>once(w.child,'message'));workers.forEach(w=>w.child.send('go'));
  for(const [result] of await Promise.all(results))assert.equal(result.ok,true,result.message);
  for(const [code] of await Promise.all(workers.map(w=>w.exited)))assert.equal(code,0);
  assert.deepEqual(readJSON(homeDir,`.pulso/projects/${projectId}.json`).locations.sort(),[root,second].sort());
});
