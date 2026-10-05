import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from '../scripts/build.mjs';
import {createPulsoTools} from '../src/tools.mjs';
import * as sourceArtifacts from '../../v3-opencode-v1/lib/artifacts.mjs';
import * as sourceMutations from '../../v3-opencode-v1/lib/work-mutations.mjs';
import {prepareWorkspace} from '../../v3-opencode-v1/lib/workspace.mjs';

const sourceRoot = fileURLToPath(new URL('../../v3-opencode-v1/',import.meta.url));
const input = {title:'Continuidad entre hosts',objective:'Conservar el trabajo al cambiar de host',criterion:'Identidad y cierres estables',verification:'Releer con ambos cores'};
const json = file => JSON.parse(fs.readFileSync(file,'utf8'));
function snapshot(directory) {
  return fs.readdirSync(directory,{withFileTypes:true}).sort((a,b) => a.name.localeCompare(b.name)).map(entry => [entry.name,entry.isDirectory() ? snapshot(path.join(directory,entry.name)) : fs.readFileSync(path.join(directory,entry.name),'utf8')]);
}
async function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'pulso-continuity-'));
  t.after(() => fs.rmSync(temp,{recursive:true,force:true}));
  const root = path.join(temp,'workspace'), homeDir = path.join(temp,'home'), extensionRoot = path.join(temp,'extension');
  fs.mkdirSync(root); fs.mkdirSync(homeDir);
  t.mock.method(os,'homedir',() => {throw new Error('Continuity fixtures must use the injected home');});
  fs.mkdirSync(path.join(extensionRoot,'src'),{recursive:true});
  fs.copyFileSync(fileURLToPath(new URL('../src/tools.mjs',import.meta.url)),path.join(extensionRoot,'src/tools.mjs'));
  fs.writeFileSync(path.join(extensionRoot,'package.json'),JSON.stringify({name:'pulso-continuity-fixture'}));
  await build({root:extensionRoot,sourceRoot});
  for (const name of ['state.schema.json']) {
    assert.deepEqual(fs.readFileSync(path.join(extensionRoot,'resources','schemas',name)),fs.readFileSync(path.join(sourceRoot,'schemas',name)),`${name} must be copied intact`);
  }
  const coreDir = path.join(extensionRoot,'resources','lib');
  const artifacts = await import(pathToFileURL(path.join(coreDir,'artifacts.mjs')).href);
  const mutations = await import(pathToFileURL(path.join(coreDir,'work-mutations.mjs')).href);
  const tools = await createPulsoTools({coreDir,homeDir});
  const run = (name,args) => tools[name].execute(args,root);
  const success = async (name,args) => {
    const result = await run(name,args);
    assert.equal(result.ok,true,result.output);
    return result.output;
  };
  return {root,homeDir,artifacts,mutations,run,success};
}
function assertWork(root,artifacts,workId,revision,cycle,priority) {
  const work = sourceArtifacts.readWork(root,workId);
  assert.deepEqual(artifacts.readWork(root,workId),work);
  assert.equal(work.id,workId);
  assert.equal(work.revision,revision);
  assert.equal(work.cycle,cycle);
  assert.equal(work.priority,priority);
  const state = sourceMutations.readStatus(root);
  assert.deepEqual(artifacts.status(root),state);
  const entry = state.works.find(value => value.id === workId);
  if (work.closure) assert.equal(entry,undefined);
  else {
    assert.equal(entry.path,`.pulso/work/${workId}/work.json`);
    assert.equal(entry.workRevision,revision);
    assert.equal(entry.cycle,cycle);
    assert.equal(entry.priority,priority);
  }
  return work;
}

test('urgent work continues from packaged VS Code tools to OpenCode source and back on the same root',async t => {
  const {root,homeDir,artifacts,mutations,run,success} = await fixture(t);
  await success('pulso_workspace',{action:'prepare'});
  const localPath = path.join(root,'.pulso/project.json');
  const identity = json(localPath), local = fs.readFileSync(localPath,'utf8');
  const registryPath = path.join(homeDir,'.pulso/projects',`${identity.projectId}.json`);
  const registry = fs.readFileSync(registryPath,'utf8');
  assert.deepEqual(json(registryPath).locations,[root]);
  assert.equal(prepareWorkspace(root,{homeDir}).projectId,identity.projectId);
  const workId = 'CONTINUITY-URGENT';
  await success('pulso_work',{action:'create',workId,...input,priority:'urgent'});
  const initial = assertWork(root,artifacts,workId,1,1,'urgent');
  assert.equal(sourceMutations.applyWorkMutation(root,{workId,expectedRevision:1,actions:[{type:'work.set_overview',summary:'Continúa en OpenCode'}]}).revision,2);
  assertWork(root,artifacts,workId,2,1,'urgent');
  const beforeStale = snapshot(root);
  assert.throws(() => sourceMutations.applyWorkMutation(root,{workId,expectedRevision:1,actions:[{type:'work.set_overview',summary:'Obsoleto'}]}),/Revisión obsoleta; actual=2/);
  const stale = await run('pulso_work',{action:'update',workId,expectedRevision:1,actions:[{type:'work.set_overview',summary:'Obsoleto'}]});
  assert.equal(stale.ok,false);
  assert.match(stale.output,/Revisión obsoleta; actual=2/);
  assert.deepEqual(snapshot(root),beforeStale);
  assert.equal(sourceMutations.closeWorkOperation(root,{workId,expectedRevision:2,outcome:'cancelled',summary:'Cierre en OpenCode'}).revision,3);
  const closed = assertWork(root,artifacts,workId,3,1,'urgent');
  const history = sourceMutations.readHistory(root,{workId});
  assert.equal(history.length,1);
  assert.equal(history[0].closureId,`${workId}:c1`);
  assert.equal(history[0].cycle,1);
  assert.equal(history[0].outcome,'cancelled');
  assert.equal(history[0].workPath,`.pulso/work/${workId}/work.json`);
  assert.equal(history[0].closureId,closed.closure.id);
  assert.deepEqual(mutations.readHistory(root,{workId}),history);
  const closedSnapshot = snapshot(root), homeSnapshot = snapshot(homeDir);
  assert.match(await success('pulso_work',{action:'get',workId}),/rev\. 3 · cancelled/);
  assert.match(await success('pulso_history',{workId}),/CONTINUITY-URGENT · cancelled · Cierre en OpenCode/);
  const staleReopen = await run('pulso_work',{action:'reopen',workId,expectedRevision:2,reason:'Obsoleto'});
  assert.equal(staleReopen.ok,false);
  assert.match(staleReopen.output,/Revisión obsoleta; actual=3/);
  assert.throws(() => sourceMutations.reopenWorkOperation(root,{workId,expectedRevision:2,reason:'Obsoleto'}),/Revisión obsoleta; actual=3/);
  assert.deepEqual(snapshot(root),closedSnapshot);
  assert.deepEqual(snapshot(homeDir),homeSnapshot);
  await success('pulso_work',{action:'reopen',workId,expectedRevision:3,reason:'Retomar desde VS Code'});
  const reopened = assertWork(root,artifacts,workId,4,2,'urgent');
  assert.equal(reopened.createdAt,initial.createdAt);
  assert.deepEqual(reopened.objective,initial.objective);
  assert.equal(reopened.closure,null);
  assert.deepEqual(sourceMutations.readHistory(root,{workId}),history);
  await success('pulso_work',{action:'close',workId,expectedRevision:4,outcome:'cancelled',summary:'Segundo ciclo en VS Code'});
  assertWork(root,artifacts,workId,5,2,'urgent');
  const cycles = sourceMutations.readHistory(root,{workId});
  assert.deepEqual(cycles.map(entry => entry.closureId),[`${workId}:c2`,`${workId}:c1`]);
  assert.deepEqual(cycles[1],history[0]);
  assert.deepEqual(mutations.readHistory(root,{workId}),cycles);
  const finalSnapshot = snapshot(root);
  await success('pulso_history',{workId});
  await success('pulso_work',{action:'get',workId});
  assert.deepEqual(sourceMutations.readHistory(root,{workId}),cycles);
  assert.deepEqual(snapshot(root),finalSnapshot);
  await success('pulso_workspace',{action:'validate',fresh:true});
  assert.equal(fs.readFileSync(localPath,'utf8'),local);
  assert.equal(fs.readFileSync(registryPath,'utf8'),registry);
  assert.deepEqual(fs.readdirSync(path.join(root,'.pulso/work')),[workId]);
});

test('legacy critical created through the source Work API is preserved by packaged reads and reopen',async t => {
  const {root,homeDir,artifacts,mutations,success} = await fixture(t);
  prepareWorkspace(root,{homeDir});
  // The low-level Work API takes id, unlike createWorkOperation's workId,
  // and accepts recognized legacy priorities without the new-input enum.
  const workId = 'CONTINUITY-CRITICAL';
  const initial = sourceArtifacts.createWork(root,{id:workId,...input,priority:'critical'});
  assertWork(root,artifacts,workId,1,1,'critical');
  const before = snapshot(root);
  assert.match(await success('pulso_work',{action:'get',workId}),/rev\. 1 · pending/);
  await success('pulso_workspace',{action:'status'});
  await success('pulso_workspace',{action:'validate',fresh:true});
  assertWork(root,artifacts,workId,1,1,'critical');
  assert.deepEqual(snapshot(root),before);
  sourceMutations.closeWorkOperation(root,{workId,expectedRevision:1,outcome:'cancelled',summary:'Cierre legacy'});
  const history = sourceMutations.readHistory(root,{workId});
  assert.deepEqual(mutations.readHistory(root,{workId}),history);
  assert.match(await success('pulso_history',{workId}),/CONTINUITY-CRITICAL · cancelled/);
  await success('pulso_work',{action:'reopen',workId,expectedRevision:2,reason:'Continuar legacy'});
  const reopened = assertWork(root,artifacts,workId,3,2,'critical');
  assert.equal(reopened.createdAt,initial.createdAt);
  assert.deepEqual(sourceMutations.readHistory(root,{workId}),history);
  await success('pulso_workspace',{action:'validate',fresh:true});
});

