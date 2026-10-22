import {primaryClient} from '../opencode/native-fixture.mjs';
import test from 'node:test';
import {assertRolePermissions} from './role-contract.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sourceRoot} from '../../scripts/build.mjs';
import {verifyPackage} from '../../scripts/check.mjs';
import {listFiles,hash} from '../../scripts/files.mjs';
const snapshot=root=>Object.fromEntries(listFiles(root).map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
for(const target of ['opencode','vscode'])test(`${target}: builds independently, reproducibly, with exact package inventory`,async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-v4-isolated-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const folder of ['core','scripts'])fs.cpSync(path.join(sourceRoot,folder),path.join(root,folder),{recursive:true});
  fs.mkdirSync(path.join(root,'adapters'));fs.cpSync(path.join(sourceRoot,'adapters',target),path.join(root,'adapters',target),{recursive:true});
  fs.copyFileSync(path.join(sourceRoot,'package.json'),path.join(root,'package.json'));
  const sibling=target==='vscode'?'opencode':'vscode';assert.equal(fs.existsSync(path.join(root,'adapters',sibling)),false);
  const run=()=>{const result=spawnSync(process.execPath,['scripts/build.mjs',target],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);};
  run();const output=path.join(root,'dist',target),first=snapshot(output);run();assert.deepEqual(snapshot(output),first);
  verifyPackage(target,output,{coreRoot:path.join(root,'core')});assert.equal(fs.existsSync(path.join(root,'dist',sibling)),false);
  const agentPath = id => path.join(output,target === 'opencode' ? `agents/${id}.md` : `resources/agents/${id}.agent.md`);
  const primary = fs.readFileSync(agentPath('pulso'),'utf8'), explorer = fs.readFileSync(agentPath('pulso-explorer'),'utf8');
  const init = fs.readFileSync(path.join(output,target === 'opencode' ? 'skills/pulso-init/SKILL.md' : 'resources/skills/pulso-init/SKILL.md'),'utf8');
  for (const resource of [primary,explorer,init]) {
    assert.match(resource,/mode: project_initialization/);
    assert.match(resource,/sin (?:prepare_delegation, accept_result, Work ni continuidad|specialistPrompt preparado, Work, tareas ni continuidad)/);
    assert.match(resource,/(?:otras|demás) delegaciones persistentes/);
  }
  assert.match(init,/esqueleto de prepare.*no es un mapa/);
  assert.doesNotMatch(init,/crea uno de mapeo|Registra tarea de Explorer|Cierra el Work exclusivo/);
  assert.match(explorer,/sin Work, tareas, continuidad ni prepare_delegation/);
  // Both native distributions must preserve the coordinator/specialist boundary
  // and the evidence rules; a source-only prompt fix is not a shipped fix.
  assert.match(primary,/también con CodeGraph.*lo segundo se delega/);
  assert.match(primary,/agent canónico del recibo/);
  assert.match(primary,/no elimines inputs necesarios/);
  assert.match(primary,/update_intent no actualiza los criterios del Work/);
  assert.match(primary,/Antes de aceptar completed, coteja cada obligación/);
  assert.match(primary,/close_by_user/);
  assert.match(primary,/No se exige evidencia adicional ni pruebas, CI o informes/);
  assert.match(primary,/source:\{text,messageRef\?\}/);
  const statusSkill=fs.readFileSync(path.join(output,target==='opencode'?'skills/pulso-status/SKILL.md':'resources/skills/pulso-status/SKILL.md'),'utf8');
  assert.match(statusSkill,/close_by_user/);
  assert.match(statusSkill,/La mera invocación de pulso-status sigue siendo solo lectura/);
  for (const id of ['pulso-explorer','pulso-executor','pulso-code-reviewer']) {
    const specialist=fs.readFileSync(agentPath(id),'utf8');
    assert.match(specialist,/no sustituyen las condiciones ejecutables/);
    assert.match(specialist,/No encontrarlo en el índice no demuestra que esté ausente del disco/);
    assert.match(specialist,/git diff --check comprueba el diff, no el comportamiento/);
  }
  const catalog=JSON.parse(fs.readFileSync(path.join(output,'resources/agents/catalog.json')));
  for(const role of [catalog.orchestrator,...catalog.specialists])assertRolePermissions(target,fs.readFileSync(agentPath(role.id),'utf8'),role,catalog);
  if(target==='vscode')assert.ok(!listFiles(output).some(file=>file.endsWith('.prompt.md')),'no prompt tool-list override');
  const core=await import(pathToFileURL(path.join(output,'resources/lib/semantic-tools.mjs')).href);assert.equal(typeof core.executeTool,'function');
  fs.writeFileSync(path.join(output,'unrelated.txt'),'accidental artifact');assert.throws(()=>verifyPackage(target,output,{coreRoot:path.join(root,'core')}),/inventory/);
});
test('neutral core and BBVA inputs have no native adapter code',()=>{
  for(const file of listFiles(path.join(sourceRoot,'core'))) {
    const text=fs.readFileSync(path.join(sourceRoot,'core',file),'utf8');
    assert.doesNotMatch(text,/opencode|copilot|\bvscode\b|delegation-observer|delegation-attempts/i,file);
  }
});

for(const target of ['opencode','vscode'])test(`${target}: actual extracted archive has exact inventory and activates packaged code`,async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-v4-archive-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  for(const folder of ['core','scripts'])fs.cpSync(path.join(sourceRoot,folder),path.join(root,folder),{recursive:true});
  fs.mkdirSync(path.join(root,'adapters'));fs.cpSync(path.join(sourceRoot,'adapters',target),path.join(root,'adapters',target),{recursive:true});
  fs.copyFileSync(path.join(sourceRoot,'package.json'),path.join(root,'package.json'));
  const {packageTarget}=await import('../../scripts/package.mjs');
  const result=await packageTarget(target,{root,vscePath:process.env.PULSO_VSCE_PATH||path.join(sourceRoot,'node_modules/@vscode/vsce/vsce')});
  assert.equal(fs.readFileSync(`${result.file}.sha256`,'utf8').split(' ')[0],hash(fs.readFileSync(result.file)));
  const extraction=path.join(root,'unpacked');fs.mkdirSync(extraction);
  const unpack=target==='opencode'?spawnSync('tar',['-xzf',result.file,'-C',extraction],{encoding:'utf8'}):spawnSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',result.file,extraction],{encoding:'utf8'});
  assert.equal(unpack.status,0,unpack.stderr);
  const payload=target==='vscode'?path.join(extraction,'extension'):extraction;
  verifyPackage(target,payload,{coreRoot:path.join(root,'core')});
  if(target==='opencode') {
    const {PulsoPlugin}=await import(pathToFileURL(path.join(payload,'plugin/index.mjs')).href);
    const workspace=path.join(root,'workspace'),home=path.join(root,'home');fs.mkdirSync(workspace);fs.mkdirSync(home);
    const plugin=await PulsoPlugin({directory:workspace,homeDir:home,client:primaryClient(workspace)});
    assert.deepEqual(Object.keys(plugin.tool).sort(),['pulso_context','pulso_history','pulso_work','pulso_workspace']);
    const receipt=await plugin.tool.pulso_workspace.execute({request:{action:'status'}},{directory:workspace,sessionID:'ses_primary',messageID:'msg_primary',agent:'pulso',ask:async()=>{},abort:new AbortController().signal});
    assert.equal(JSON.parse(receipt.output).ok,true);
    assert.equal(fs.existsSync(path.join(workspace,'.pulso')),false);
  } else {
    const module=await import(pathToFileURL(path.join(payload,'src/extension.cjs')).href);
    assert.equal(typeof module.default.activate,'function');
  }
});
