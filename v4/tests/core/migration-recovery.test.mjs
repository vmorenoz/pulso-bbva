import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepareWorkspace,recoverWorkspaceMigration} from '../../core/lib/workspace.mjs';
import {createWork,readWork,validateProject} from '../../core/lib/artifacts.mjs';
import {readJSON,writeJSON,listFiles,sha256} from '../../core/lib/fs.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-migration-')),homeDir=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-migration-home-'));
  t.after(()=>{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(homeDir,{recursive:true,force:true});});return {root,homeDir};
}
const identity=directory=>{const {dev,ino}=fs.lstatSync(directory);return {dev,ino};};
const snapshot=directory=>({identity:identity(directory),files:listFiles(directory).map(file=>({path:file,sha256:sha256(fs.readFileSync(path.join(directory,file)))}))});
function legacy(root){
  writeJSON(root,'.pulso/tasks/PULSO-A.json',{id:'PULSO-A',title:'Historical task',objective:'Preserve work',status:'in_progress',acceptance_criteria:['Preserve legacy facts'],execution:{summary:'Existing work'}});
  fs.writeFileSync(path.join(root,'.pulso','evidence.txt'),'Historical evidence bytes\n');
}
/** Reconstructed disk boundaries, not a claim of killing the product mid-rename.
 * Real directories, inodes, metadata and byte snapshots; no filesystem mocks/hooks.
 */
function boundary(t,phase){
  const {root,homeDir}=fixture(t),token=randomUUID(),stagePath=`.pulso-migration-${token}`,backupPath=`.pulso-legacy-${token}`;
  legacy(root);const stage=path.join(root,stagePath);fs.mkdirSync(stage);
  const {projectId}=prepareWorkspace(stage,{homeDir});
  createWork(stage,{id:'PULSO-A',title:'Migrated work',objective:'Preserve work',criterion:'Preserved',verification:'Disk fixture'});
  const marker={schemaVersion:1,kind:'legacy-migration',token,root:fs.realpathSync(root),projectId,stagePath,backupPath,migratedWorks:1,stageIdentity:identity(stage),source:snapshot(path.join(root,'.pulso')),prepared:snapshot(path.join(stage,'.pulso'))};
  writeJSON(root,'.pulso-migration.json',marker);
  if(phase!=='before')fs.renameSync(path.join(root,'.pulso'),path.join(root,backupPath));
  if(phase==='published')fs.renameSync(path.join(stage,'.pulso'),path.join(root,'.pulso'));
  return {root,homeDir,marker,stage};
}

test('real legacy migration publishes durable identity and preserves backup evidence',t=>{
  const {root,homeDir}=fixture(t);legacy(root);
  const result=prepareWorkspace(root,{homeDir});assert.equal(result.legacyMigrated,true);
  assert.equal(readJSON(root,'.pulso/project.json').projectId,result.projectId);
  assert.equal(readWork(root,'PULSO-A').summary,'Migrado desde legacy: Existing work');
  assert.equal(fs.readFileSync(path.join(root,result.backupPath,'evidence.txt'),'utf8'),'Historical evidence bytes\n');
  assert.equal(fs.existsSync(path.join(root,'.pulso-migration.json')),false);
  assert.equal(validateProject(root).valid,true);
  assert.deepEqual(readJSON(homeDir,`.pulso/projects/${result.projectId}.json`).locations,[root]);
});

for(const phase of ['before','backup','published'])test(`reconstructed ${phase} boundary recovers in a fresh process with original identity`,t=>{
  const {root,homeDir,marker}=boundary(t,phase);
  const source=JSON.stringify(marker.source);
  const result=spawnSync(process.execPath,['--input-type=module','-e',`
    import {prepareWorkspace} from ${JSON.stringify(new URL('../../core/lib/workspace.mjs',import.meta.url).href)};
    console.log(JSON.stringify(prepareWorkspace(process.argv[1],{homeDir:process.argv[2]})));
  `,root,homeDir],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.projectId,marker.projectId);assert.equal(receipt.migrationRecovered,true);
  assert.equal(readJSON(root,'.pulso/project.json').projectId,marker.projectId);
  assert.equal(JSON.stringify(snapshot(path.join(root,marker.backupPath))),source);
  assert.equal(validateProject(root).valid,true);
  assert.equal(fs.existsSync(path.join(root,'.pulso-migration.json')),false);
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,marker.projectId);
});

test('explicit recovery uses same safe boundary protocol and abandoned lock is never stolen',t=>{
  const {root,homeDir,marker}=boundary(t,'backup');
  fs.mkdirSync(path.join(root,'.pulso-write.lock'));
  writeJSON(root,'.pulso-write.lock/owner.json',{token:'abandoned',pid:1,hostname:'unknown',createdAt:'1970-01-01T00:00:00Z'});
  assert.throws(()=>recoverWorkspaceMigration(root,{homeDir}),e=>e.code==='METADATA_BUSY');
  assert.equal(fs.existsSync(path.join(root,'.pulso')),false);
  // Explicit manual recovery in fixture, after simulated operator verification.
  fs.rmSync(path.join(root,'.pulso-write.lock'),{recursive:true});
  assert.equal(recoverWorkspaceMigration(root,{homeDir}).projectId,marker.projectId);
  assert.equal(recoverWorkspaceMigration(root,{homeDir}),null);
});

test('foreign destination, altered stage and invalid intent preserve all evidence',t=>{
  for(const alteration of ['destination','stage','path']){
    const {root,homeDir,marker,stage}=boundary(t,'backup');
    if(alteration==='destination'){fs.mkdirSync(path.join(root,'.pulso'));fs.writeFileSync(path.join(root,'.pulso','foreign'),'do not overwrite');}
    if(alteration==='stage')fs.writeFileSync(path.join(stage,'.pulso','foreign'),'do not publish');
    if(alteration==='path'){marker.backupPath='../foreign';writeJSON(root,'.pulso-migration.json',marker);}
    const before=snapshot(root);
    assert.throws(()=>prepareWorkspace(root,{homeDir}),/migración|Migración|ambigua/);
    assert.deepEqual(snapshot(root),before);
  }
});

test('a foreign backup prevents moving the original legacy tree',t=>{
  const {root,homeDir,marker}=boundary(t,'before');
  fs.mkdirSync(path.join(root,marker.backupPath));
  const before=snapshot(root);
  assert.throws(()=>prepareWorkspace(root,{homeDir}),/ambigua/);
  assert.deepEqual(snapshot(root),before);
});

test('registry contention after real migration publication retains recoverable intent and identity',t=>{
  const {root,homeDir}=fixture(t),projectId=randomUUID();legacy(root);
  writeJSON(root,'.pulso/project.json',{schemaVersion:1,projectId});
  const registryLock=`.pulso/locks/projects/${projectId}/.pulso-write.lock`;
  writeJSON(homeDir,`${registryLock}/owner.json`,{token:'other-publisher',hostname:os.hostname(),pid:1});
  assert.throws(()=>prepareWorkspace(root,{homeDir}),e=>e.code==='METADATA_BUSY');
  const marker=readJSON(root,'.pulso-migration.json');assert.equal(marker.projectId,projectId);
  assert.equal(readJSON(root,'.pulso/project.json').projectId,projectId);
  assert.equal(readWork(root,'PULSO-A').title,'Historical task');
  assert.deepEqual(snapshot(path.join(root,marker.backupPath)),marker.source);
  // Explicit fixture release of the foreign publisher; no automatic TTL recovery.
  fs.rmSync(path.join(homeDir,registryLock),{recursive:true});
  const recovered=prepareWorkspace(root,{homeDir});assert.equal(recovered.projectId,projectId);
  assert.equal(recovered.migrationRecovered,true);
  assert.deepEqual(readJSON(homeDir,`.pulso/projects/${projectId}.json`).locations,[root]);
  assert.equal(fs.existsSync(path.join(root,'.pulso-migration.json')),false);
});
