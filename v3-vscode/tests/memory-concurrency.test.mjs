import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

// Compose the override with its unchanged dependency, or exercise the actual
// generated bundle when the build runner supplies PULSO_TEST_CORE_DIR.
let coreDir=process.env.PULSO_TEST_CORE_DIR;
if(!coreDir){
  coreDir=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-memory-core-'));
  after(()=>fs.rmSync(coreDir,{recursive:true,force:true}));
  fs.copyFileSync(new URL('../core/memory.mjs',import.meta.url),path.join(coreDir,'memory.mjs'));
  fs.copyFileSync(new URL('../../v3-opencode-v1/lib/fs.mjs',import.meta.url),path.join(coreDir,'fs.mjs'));
}
const memoryURL=pathToFileURL(path.join(coreDir,'memory.mjs'));
const {readMemory,updateMemory}=await import(memoryURL.href);
function fixture(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-memory-concurrent-'));
  const root=path.join(temp,'project-a'),otherRoot=path.join(temp,'project-b'),homeDir=path.join(temp,'home');
  for(const directory of [root,otherRoot,homeDir])fs.mkdirSync(directory);
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  return {temp,root,otherRoot,homeDir,options:{homeDir},file:path.join(homeDir,'.pulso/preferences.json'),lock:path.join(homeDir,'.pulso/preferences.json.lock')};
}
const preference=(key,value=key)=>({action:'set_preference',scope:'user',key,value});
async function waitForFile(file){
  const deadline=performance.now()+5000;
  while(!fs.existsSync(file)){
    assert.ok(performance.now()<deadline,`Timed out waiting for ${path.basename(file)}`);
    await new Promise(resolve=>setTimeout(resolve,5));
  }
}
// Pause writer A after its read. Writer B must reach the lock contention path
// before A is released. Without the lock, B reads the same revision instead,
// so the final keys/revision assertions deterministically expose lost updates.
const worker=`
  import fs from 'node:fs';
  import path from 'node:path';
  const {updateMemory}=await import(process.env.MEMORY_URL);
  const {BARRIER,ROLE,HOME_DIR,PROJECT_ROOT}=process.env;
  const wait=new Int32Array(new SharedArrayBuffer(4));
  const marker=name=>path.join(BARRIER,name);
  function until(name){
    const deadline=performance.now()+5000;
    while(!fs.existsSync(marker(name))){
      if(performance.now()>deadline)throw new Error('Worker barrier timed out: '+name);
      Atomics.wait(wait,0,0,5);
    }
  }
  const read=fs.readFileSync,open=fs.openSync;
  fs.readFileSync=function(file,...args){
    const value=read.call(this,file,...args);
    if(String(file)===path.join(HOME_DIR,'.pulso/preferences.json')){
      const entered=marker(ROLE==='a'?'first-read':'second-entered');
      if(!fs.existsSync(entered))fs.writeFileSync(entered,'read');
      if(ROLE==='a')until('release-first');
    }
    return value;
  };
  fs.openSync=function(file,...args){
    try{return open.call(this,file,...args);}
    catch(error){
      if(ROLE==='b'&&error.code==='EEXIST'&&String(file)===path.join(HOME_DIR,'.pulso/preferences.json.lock')){
        fs.writeFileSync(marker('second-entered'),'contended');
      }
      throw error;
    }
  };
  fs.writeFileSync(marker(ROLE+'-ready'),'');
  until(ROLE+'-start');
  updateMemory(PROJECT_ROOT,{action:'set_preference',scope:'user',key:ROLE,value:ROLE},{homeDir:HOME_DIR});
`;
function startWriter(t,setup,role){
  const child=spawn(process.execPath,['--input-type=module','-e',worker],{
    env:{...process.env,MEMORY_URL:memoryURL.href,BARRIER:setup.temp,ROLE:role,HOME_DIR:setup.homeDir,PROJECT_ROOT:role==='a'?setup.root:setup.otherRoot},
    stdio:['ignore','ignore','pipe']
  });
  let stderr='';
  child.stderr.on('data',data=>{stderr+=data;});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  // Resolve first and assert after awaiting: a failure cannot become an
  // unhandled rejection while the parent is waiting at a barrier.
  return new Promise(resolve=>{
    child.once('error',error=>resolve({error}));
    child.once('close',(code,signal)=>resolve({code,signal,stderr}));
  });
}

test('separate processes preserve both updates in a shared HOME and reload within the lock',async t=>{
  const setup=fixture(t),{root,otherRoot,options,temp,lock}=setup;
  updateMemory(root,preference('seed'),options);
  const writers=[startWriter(t,setup,'a'),startWriter(t,setup,'b')];
  await Promise.all(['a-ready','b-ready'].map(name=>waitForFile(path.join(temp,name))));
  fs.writeFileSync(path.join(temp,'a-start'),'');
  await waitForFile(path.join(temp,'first-read'));
  fs.writeFileSync(path.join(temp,'b-start'),'');
  await waitForFile(path.join(temp,'second-entered'));
  fs.writeFileSync(path.join(temp,'release-first'),'');
  for(const result of await Promise.all(writers))assert.equal(result.code,0,JSON.stringify(result));
  const memory=readMemory(otherRoot,'user',options);
  assert.deepEqual(Object.fromEntries(memory.preferences.map(({key,value})=>[key,value])),{seed:'seed',a:'a',b:'b'});
  assert.equal(memory.revision,4);
  assert.equal(fs.readFileSync(path.join(temp,'second-entered'),'utf8'),'contended');
  assert.equal(fs.existsSync(lock),false);
  assert.deepEqual(fs.readdirSync(root),[]);
  assert.deepEqual(fs.readdirSync(otherRoot),[]);
});

test('an occupied or abandoned lock times out without stealing it or changing preferences',{timeout:6000},t=>{
  const {root,options,file,lock}=fixture(t);
  updateMemory(root,preference('seed'),options);
  const before=fs.readFileSync(file,'utf8');
  fs.writeFileSync(lock,'another writer');
  // Old timestamps must not be treated as proof that a writer has stopped.
  fs.utimesSync(lock,new Date(0),new Date(0));
  const started=performance.now();
  assert.throws(()=>updateMemory(root,preference('blocked'),options),{code:'PULSO_MEMORY_LOCKED'});
  assert.ok(performance.now()-started<5000,'lock wait must be bounded');
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.equal(fs.readFileSync(lock,'utf8'),'another writer');
  // The shared user lock does not block independent project memory.
  const project=updateMemory(root,{action:'set_context',context:'project context'},options);
  assert.equal(project.context,'project context');
});

test('read and commit failures release the acquired lock and retain existing bytes',t=>{
  const {root,options,file,lock}=fixture(t);
  updateMemory(root,preference('seed'),options);
  const before=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,'not JSON');
  assert.throws(()=>updateMemory(root,preference('invalid'),options),/JSON/);
  assert.equal(fs.existsSync(lock),false);
  assert.equal(fs.readFileSync(file,'utf8'),'not JSON');
  fs.writeFileSync(file,before);
  const rename=fs.renameSync;
  const mocked=t.mock.method(fs,'renameSync',function(source,destination){
    if(destination===file)throw Object.assign(new Error('Injected commit failure'),{code:'EIO'});
    return rename.call(this,source,destination);
  });
  assert.throws(()=>updateMemory(root,preference('failed'),options),/Injected commit failure/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)),['preferences.json']);
  mocked.mock.restore();
  const saved=updateMemory(root,preference('recovered'),options);
  assert.equal(saved.revision,3);
  assert.equal(saved.preferences.at(-1).key,'recovered');
  assert.equal(fs.existsSync(lock),false);
});

test('invalid input is rejected before creating the lock directory',t=>{
  const {root,homeDir,options}=fixture(t);
  assert.throws(()=>updateMemory(root,{action:'set_preference',scope:'user'},options),/key/);
  assert.deepEqual(fs.readdirSync(homeDir),[]);
  assert.deepEqual(readMemory(root,'user',options).preferences,[]);
  assert.deepEqual(fs.readdirSync(homeDir),[]);
});
