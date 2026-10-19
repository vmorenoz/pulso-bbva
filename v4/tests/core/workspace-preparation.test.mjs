import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {prepareWorkspace} from '../../core/lib/workspace.mjs';
import {executeTool} from '../../core/lib/semantic-tools.mjs';
import {temp,repo,create,atomicWrite} from './helpers.mjs';

const snapshot=root=>fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).map(e=>[e.name,e.isDirectory()?snapshot(path.join(root,e.name)):fs.readFileSync(path.join(root,e.name),'utf8')]);
const status=(root,homeDir)=>executeTool('pulso_workspace',{action:'status'},{projectRoot:root,homeDir});
test('empty workspace with archive preserves identity, memory and context; complete prepare is idempotent',async t=>{
  const root=temp(t),homeDir=temp(t),first=prepareWorkspace(root,{homeDir});
  atomicWrite(root,'.pulso/project.md','Contexto real');
  atomicWrite(root,'.pulso/archive/backup/state.json','{"works":["never import"]}');
  const archive=snapshot(path.join(root,'.pulso/archive'));
  const preserved=['state.json','project.json','project.md','memory.json'].map(f=>[f,fs.readFileSync(path.join(root,'.pulso',f),'utf8')]);
  fs.unlinkSync(path.join(root,'.pulso/history.jsonl'));fs.rmdirSync(path.join(root,'.pulso/work'));
  const before=snapshot(root),result=await status(root,homeDir);
  assert.equal(result.data.prepared,false);assert.equal(result.data.incomplete,true);assert.deepEqual(snapshot(root),before);
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,first.projectId);
  for(const [f,bytes] of preserved)assert.equal(fs.readFileSync(path.join(root,'.pulso',f),'utf8'),bytes);
  assert.deepEqual(snapshot(path.join(root,'.pulso/archive')),archive);
  assert.equal(fs.readFileSync(path.join(root,'.pulso/history.jsonl'),'utf8'),'');
  const complete=snapshot(root);assert.equal(prepareWorkspace(root,{homeDir}).existingWorkspace,true);assert.deepEqual(snapshot(root),complete);
  assert.equal((await status(root,homeDir)).data.prepared,true);
});
test('missing mandatory artifacts never report prepared',async t=>{
  for(const file of ['state.json','history.jsonl','project.md','decisions.md','memory.json','project.json','work']){
    const root=temp(t),homeDir=temp(t);prepareWorkspace(root,{homeDir});fs.rmSync(path.join(root,'.pulso',file),{recursive:true});
    const result=await status(root,homeDir);assert.equal(result.data.prepared,false,file);assert.ok(result.data.missing.includes(`.pulso/${file}`));
  }
});
test('nonempty, orphaned, inconsistent and active metadata reject before creating history',t=>{
  for(const setup of [root=>create(root),...['work/orphan/work.json','delegations/a.json','continuities/a.json','leases/a.json','transactions/a.json'].map(file=>root=>atomicWrite(root,`.pulso/${file}`,'{}')),root=>atomicWrite(root,'.pulso/state.json','{"schemaVersion":1}')]){
    const root=repo(t),homeDir=temp(t);setup(root);fs.unlinkSync(path.join(root,'.pulso/history.jsonl'));const before=snapshot(root);
    assert.throws(()=>prepareWorkspace(root,{homeDir}),{code:'WORKSPACE_INCOMPLETE'});assert.deepEqual(snapshot(root),before);assert.deepEqual(snapshot(homeDir),[]);
  }
});
test('missing state retains the empty paginated fallback without hiding explicit continuity errors',async t=>{
  const root=temp(t),homeDir=temp(t);prepareWorkspace(root,{homeDir});fs.unlinkSync(path.join(root,'.pulso/state.json'));
  const result=await status(root,homeDir);
  assert.equal(result.ok,true);assert.equal(result.data.prepared,false);assert.equal(result.data.incomplete,true);
  assert.deepEqual(result.data.works.items,[]);assert.equal(result.data.works.total,0);assert.equal(result.data.works.hasMore,false);
  const explicit=await executeTool('pulso_workspace',{action:'status',continuityId:'missing-continuity'},{projectRoot:root,homeDir});
  assert.equal(explicit.ok,false);
});
test('repair recovers each publication interruption and retains its original identity',async t=>{
  for(const file of ['preparation.json','history.jsonl','project.md','decisions.md','memory.json','project.json']){
    const root=repo(t),homeDir=temp(t);fs.unlinkSync(path.join(root,'.pulso/history.jsonl'));
    atomicWrite(root,'.pulso/archive/keep','backup');
    const rename=fs.renameSync;let hit=false;
    fs.renameSync=(source,dest)=>{const result=rename(source,dest);if(dest===path.join(root,'.pulso',file)&&!hit){hit=true;throw new Error('interrupted');}return result;};
    try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/interrupted/);}finally{fs.renameSync=rename;}
    assert.equal(hit,true);const marker=JSON.parse(fs.readFileSync(path.join(root,'.pulso/preparation.json')));
    assert.equal((await status(root,homeDir)).data.prepared,false);
    assert.equal(prepareWorkspace(root,{homeDir}).projectId,marker.projectId);
    const before=snapshot(root);prepareWorkspace(root,{homeDir});assert.deepEqual(snapshot(root),before);
  }
});
test('interrupted repair refuses changed preserved files and new active metadata',t=>{
  for(const file of ['state.json','work/orphan/work.json','continuities/new.json']){
    const root=repo(t),homeDir=temp(t);fs.unlinkSync(path.join(root,'.pulso/history.jsonl'));
    const rename=fs.renameSync;fs.renameSync=(source,dest)=>{if(dest.endsWith('/history.jsonl'))throw new Error('interrupted');return rename(source,dest);};
    try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/interrupted/);}finally{fs.renameSync=rename;}
    atomicWrite(root,`.pulso/${file}`,'{}');const before=snapshot(root);
    assert.throws(()=>prepareWorkspace(root,{homeDir}),{code:'WORKSPACE_INCOMPLETE'});assert.deepEqual(snapshot(root),before);
  }
});
test('repair survives directory and registry failures and obeys the workspace lock',t=>{
  const root=repo(t),homeDir=temp(t);fs.rmdirSync(path.join(root,'.pulso/work'));
  fs.mkdirSync(path.join(root,'.pulso-write.lock'));
  const before=snapshot(root);assert.throws(()=>prepareWorkspace(root,{homeDir}),{code:'METADATA_BUSY'});assert.deepEqual(snapshot(root),before);
  fs.rmdirSync(path.join(root,'.pulso-write.lock'));
  const mkdir=fs.mkdirSync;
  fs.mkdirSync=(target,...args)=>{if(target===path.join(root,'.pulso/work'))throw new Error('directory interrupted');return mkdir(target,...args);};
  try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/directory interrupted/);}finally{fs.mkdirSync=mkdir;}
  const rename=fs.renameSync;
  fs.renameSync=(source,dest)=>{if(dest.startsWith(homeDir+path.sep))throw new Error('registry interrupted');return rename(source,dest);};
  try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/registry interrupted/);}finally{fs.renameSync=rename;}
  const identity=JSON.parse(fs.readFileSync(path.join(root,'.pulso/project.json')));
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,identity.projectId);
});
