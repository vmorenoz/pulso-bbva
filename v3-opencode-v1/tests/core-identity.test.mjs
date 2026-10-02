import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {prepareWorkspace} from '../lib/workspace.mjs';
import {ensureProjectIdentity,isUUID} from '../lib/identity.mjs';
import {createWork,readWork} from '../lib/artifacts.mjs';
import {createWorkOperation} from '../lib/work-mutations.mjs';
import {temp,atomicWrite} from './helpers.mjs';

const input={title:'Identidad',objective:'Mantener identidad',criterion:'ID estable',verification:'Releer ID'};
test('prepare crea UUID local y registro global idempotentes en home inyectado',t=>{
  const root=temp(t),homeDir=temp(t),first=prepareWorkspace(root,{homeDir});
  assert.ok(isUUID(first.projectId));
  const local=fs.readFileSync(path.join(root,'.pulso/project.json'),'utf8');
  const registry=path.join(homeDir,`.pulso/projects/${first.projectId}.json`),global=fs.readFileSync(registry,'utf8');
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,first.projectId);
  assert.equal(fs.readFileSync(path.join(root,'.pulso/project.json'),'utf8'),local);
  assert.equal(fs.readFileSync(registry,'utf8'),global);
  assert.deepEqual(JSON.parse(global).locations,[root]);
});
test('identidad local prevalece al mover proyecto y conserva todas las locations',t=>{
  const root=temp(t),moved=temp(t),homeDir=temp(t),first=prepareWorkspace(root,{homeDir});
  fs.cpSync(path.join(root,'.pulso'),path.join(moved,'.pulso'),{recursive:true});
  assert.equal(prepareWorkspace(moved,{homeDir}).projectId,first.projectId);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(homeDir,`.pulso/projects/${first.projectId}.json`))).locations,[root,moved]);
  const otherHome=temp(t);assert.equal(prepareWorkspace(moved,{homeDir:otherHome}).projectId,first.projectId);
});
test('proyectos nuevos tienen identidades independientes',t=>{
  const homeDir=temp(t);assert.notEqual(prepareWorkspace(temp(t),{homeDir}).projectId,prepareWorkspace(temp(t),{homeDir}).projectId);
});
test('identidad local corrupta nunca se sobrescribe ni se registra',t=>{
  for(const content of ['{broken','null','{}','{"schemaVersion":1,"projectId":"bad"}']){
    const root=temp(t),homeDir=temp(t);atomicWrite(root,'.pulso/project.json',content);
    assert.throws(()=>prepareWorkspace(root,{homeDir}));
    assert.equal(fs.readFileSync(path.join(root,'.pulso/project.json'),'utf8'),content);
    assert.deepEqual(fs.readdirSync(homeDir),[]);
    assert.equal(fs.existsSync(path.join(root,'.pulso/state.json')),false);
  }
});
test('registro corrupto o discordante se conserva y bloquea preparación',t=>{
  const root=temp(t),homeDir=temp(t),identity=ensureProjectIdentity(root,{homeDir});
  for(const content of ['{broken','null',JSON.stringify({schemaVersion:1,projectId:identity.projectId,locations:['relative']})]){
    atomicWrite(homeDir,`.pulso/projects/${identity.projectId}.json`,content);
    assert.throws(()=>prepareWorkspace(root,{homeDir}));
    assert.equal(fs.readFileSync(path.join(homeDir,`.pulso/projects/${identity.projectId}.json`),'utf8'),content);
    assert.equal(fs.existsSync(path.join(root,'.pulso/state.json')),false);
  }
});
test('identidad rechaza symlinks del registro sin escribir al destino',t=>{
  const root=temp(t),homeDir=temp(t),outside=temp(t);
  fs.mkdirSync(path.join(homeDir,'.pulso'));fs.symlinkSync(outside,path.join(homeDir,'.pulso/projects'));
  assert.throws(()=>prepareWorkspace(root,{homeDir}),/Symlink/);assert.deepEqual(fs.readdirSync(outside),[]);
});
test('fallo al registrar conserva UUID local para reintento estable',t=>{
  const root=temp(t),homeDir=temp(t),rename=fs.renameSync;
  fs.renameSync=(source,dest)=>{if(String(dest).startsWith(homeDir+path.sep))throw new Error('Registro no disponible');return rename(source,dest);};
  try{assert.throws(()=>prepareWorkspace(root,{homeDir}),/no disponible/);}finally{fs.renameSync=rename;}
  const local=JSON.parse(fs.readFileSync(path.join(root,'.pulso/project.json')));
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,local.projectId);
  assert.deepEqual(fs.readdirSync(path.join(homeDir,'.pulso/projects')),[`${local.projectId}.json`]);
});
test('create core y operación generan PULSO-UUID, conservando IDs explícitos',t=>{
  const root=temp(t),homeDir=temp(t);prepareWorkspace(root,{homeDir});
  const a=createWork(root,input),b=createWorkOperation(root,input);
  assert.ok(isUUID(a.id.slice(6)));assert.match(a.id,/^PULSO-/);
  // Receipts expose workId, while the canonical Work uses id.
  assert.ok(isUUID(b.workId.slice(6)));assert.notEqual(a.id,b.workId);assert.equal(readWork(root,b.workId).id,b.workId);
  assert.equal(createWorkOperation(root,{...input,workId:'PULSO-001'}).workId,'PULSO-001');
  assert.throws(()=>createWorkOperation(root,{...input,workId:null}));
  assert.throws(()=>createWork(root,{...input,id:null}));
});
