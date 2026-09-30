import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {install,uninstall} from '../lib/install.mjs';
import {prepareWorkspace} from '../lib/workspace.mjs';
import {sha256} from '../lib/fs.mjs';
import {temp} from './helpers.mjs';

const v2=()=> 'opencode v2.0.20';
const options=homeDir=>({homeDir,env:{},probeVersion:v2});

test('OpenCode v2 installation includes core, plugin, agent, commands and native skills',t=>{
  const home=temp(t),result=install(options(home));
  assert.deepEqual(result.runtimes,['opencode-v2']);assert.equal(result.opencodeVersion,v2());
  for(const file of ['.config/opencode/agents/pulso.md','.config/opencode/plugins/pulso/index.ts','.config/opencode/plugins/pulso/package.json','.config/opencode/commands/pulso-init.md','.config/opencode/skills/pulso-init/SKILL.md','.pulso/lib/artifacts.mjs'])assert.ok(fs.existsSync(path.join(home,file)),file);
  for(const file of ['.pulso/bin/pulso.mjs','.pulso/bin/prepare.mjs','.pulso/lib/install.mjs','.pulso/lib/composition.mjs','.copilot/agents/pulso.agent.md','.agents/skills/pulso-init/SKILL.md'])assert.equal(fs.existsSync(path.join(home,file)),false,file);
  assert.equal(fs.existsSync(path.join(home,'.pulso/state.json')),false);
});

test('Rechaza OpenCode v1 y versión no detectable antes de escribir',t=>{
  const home=temp(t);assert.throws(()=>install({...options(home),probeVersion:()=> 'opencode 1.18.33'}),/requiere OpenCode v2/);assert.equal(fs.existsSync(home),true);assert.equal(fs.existsSync(path.join(home,'.pulso')),false);
  assert.throws(()=>install({...options(home),probeVersion:()=> ''}),/No se pudo detectar OpenCode/);assert.equal(fs.existsSync(path.join(home,'.pulso')),false);
});

test('Instalación idempotente y dry-run no modifica HOME',t=>{
  const home=temp(t);install(options(home));const manifest=fs.readFileSync(path.join(home,'.pulso/installation.json'),'utf8');
  const result=install(options(home));assert.equal(result.created,0);assert.equal(result.updated,0);assert.equal(fs.readFileSync(path.join(home,'.pulso/installation.json'),'utf8'),manifest);
  const preview=path.join(temp(t),'new-home');install({...options(preview),dryRun:true});assert.equal(fs.existsSync(preview),false);
});

test('No modifica configuración ajena ni pisa una integración no registrada',t=>{
  const home=temp(t),config=path.join(home,'.config/opencode/opencode.jsonc'),agent=path.join(home,'.config/opencode/agents/pulso.md');
  fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'ORIGINAL');fs.mkdirSync(path.dirname(agent),{recursive:true});fs.writeFileSync(agent,'AJENO');
  assert.throws(()=>install(options(home)),/archivo ajeno|Integración anterior/);assert.equal(fs.readFileSync(config,'utf8'),'ORIGINAL');assert.equal(fs.readFileSync(agent,'utf8'),'AJENO');assert.equal(fs.existsSync(path.join(home,'.pulso')),false);
});

test('No sobreescribe recursos administrados editados',t=>{
  const home=temp(t);install(options(home));const agent=path.join(home,'.config/opencode/agents/pulso.md');fs.appendFileSync(agent,'\nEdición local');
  assert.throws(()=>install(options(home)),/archivo ajeno o modificado/);assert.match(fs.readFileSync(agent,'utf8'),/Edición local/);
});

test('Preparación core idempotente conserva contexto del proyecto',t=>{
  const project=temp(t);assert.equal(prepareWorkspace(project).existingWorkspace,false);fs.writeFileSync(path.join(project,'.pulso/project.md'),'Contexto confirmado');
  assert.equal(prepareWorkspace(project).existingWorkspace,true);assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),'Contexto confirmado');
  for(const file of ['installation.json','lib','templates','schemas','bin'])assert.equal(fs.existsSync(path.join(project,'.pulso',file)),false);
});

test('Actualización migra solo archivos propios registrados de instalaciones previas',t=>{
  const home=temp(t);install(options(home));const manifestPath=path.join(home,'.pulso/installation.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
  const legacy={'.copilot/agents/pulso.agent.md':'old-vscode','.pulso/bin/pulso.mjs':'old-cli','.agents/skills/pulso-init/SKILL.md':'old-skill'};
  for(const [file,content] of Object.entries(legacy)){const target=path.join(home,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);manifest.files[file]=sha256(content);}
  manifest.runtimes=['both'];manifest.version='3.0.3';fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  install(options(home));for(const file of Object.keys(legacy))assert.equal(fs.existsSync(path.join(home,file)),false,file);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath)).runtimes,['opencode-v2']);
});

test('Uninstall elimina solo integración global y conserva datos del workspace',t=>{
  const home=temp(t),project=temp(t);install(options(home));prepareWorkspace(project);const state=fs.readFileSync(path.join(project,'.pulso/state.json'));
  const result=uninstall({homeDir:home,env:{}});assert.equal(result.uninstalled,true);assert.equal(fs.existsSync(path.join(home,'.config/opencode/plugins/pulso/index.ts')),false);assert.equal(fs.existsSync(path.join(home,'.pulso/installation.json')),false);
  assert.deepEqual(fs.readFileSync(path.join(project,'.pulso/state.json')),state);
});
