import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {install,uninstall,prepareWorkspace} from '../lib/install.mjs';
import {doctor} from '../lib/doctor.mjs';
import {sha256} from '../lib/fs.mjs';
import {temp} from './helpers.mjs';

const distribution=new URL('../',import.meta.url);
const options=(home,runtime='both')=>({homeDir:home,env:{},runtime});

for(const runtime of ['opencode','vscode','both'])test(`Instalación global ${runtime}`,t=>{
  const home=temp(t),result=install(options(home,runtime));
  assert.equal(result.scope,'global');
  assert.equal(fs.existsSync(path.join(home,'.config/opencode/agents/pulso.md')),runtime!=='vscode');
  assert.equal(fs.existsSync(path.join(home,'.copilot/agents/pulso.agent.md')),runtime!=='opencode');
  assert.equal(fs.existsSync(path.join(home,'.pulso/state.json')),false);
  if(runtime!=='vscode'){
    const prompt=fs.readFileSync(path.join(home,'.config/opencode/agents/pulso.md'),'utf8');
    assert.match(prompt,/<global_installation>/);assert.match(prompt,/No busques bin\/templates\/schemas\/agentes\/skills dentro del proyecto/);
    assert.match(prompt,/"prepare":/);assert.match(prompt,/CLI global con --root/);
  }
  assert.equal(doctor(home,{probeVersions:false}).installation,'PASS');
});

test('Instalación global idempotente',t=>{
  const home=temp(t);install(options(home));
  const manifest=fs.readFileSync(path.join(home,'.pulso/installation.json'),'utf8');
  const result=install(options(home));
  assert.equal(result.created,0);assert.equal(result.updated,0);
  assert.equal(fs.readFileSync(path.join(home,'.pulso/installation.json'),'utf8'),manifest);
});

test('Dry-run global no crea HOME',t=>{
  const home=path.join(temp(t),'home'),result=install({...options(home),dryRun:true});
  assert.equal(result.dryRun,true);assert.equal(fs.existsSync(home),false);
});

test('Rechaza instalación por proyecto y harness Local',t=>{
  const home=temp(t);
  assert.throws(()=>install({...options(home),scope:'project'}),/solo admite instalación global/);
  assert.throws(()=>install({...options(home),vscodeHarness:'local'}),/no reconocida|global/i);
});

test('Conserva configuración, credenciales y archivos ajenos del HOME',t=>{
  const home=temp(t),files=['.config/opencode/opencode.jsonc','.vscode/settings.json','.mcp.json','.env'];
  for(const file of files){fs.mkdirSync(path.dirname(path.join(home,file)),{recursive:true});fs.writeFileSync(path.join(home,file),'ORIGINAL');}
  install(options(home));
  for(const file of files)assert.equal(fs.readFileSync(path.join(home,file),'utf8'),'ORIGINAL');
});

test('Preflight global no pisa un agente ajeno ni instala parcialmente',t=>{
  const home=temp(t),agent=path.join(home,'.config/opencode/agents/pulso.md');
  fs.mkdirSync(path.dirname(agent),{recursive:true});fs.writeFileSync(agent,'AJENO');
  assert.throws(()=>install(options(home,'opencode')),/anterior no registrada|antes de escribir/);
  assert.equal(fs.existsSync(path.join(home,'.pulso')),false);assert.equal(fs.readFileSync(agent,'utf8'),'AJENO');
});

test('No pisa un archivo global gestionado que fue editado',t=>{
  const home=temp(t);install(options(home,'opencode'));
  const agent=path.join(home,'.config/opencode/agents/pulso.md');fs.appendFileSync(agent,'\nCambio local');
  assert.throws(()=>install(options(home,'both')),/modificado|antes de escribir/);
  assert.equal(fs.existsSync(path.join(home,'.copilot/agents')),false);
});

test('Prepara solo datos del workspace desde recursos globales',t=>{
  const home=temp(t),project=temp(t);install(options(home));
  const helper=path.join(home,'.pulso/bin/prepare.mjs');
  const run=spawnSync(process.execPath,[helper,'--root',project],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  for(const file of ['state.json','history.jsonl','project.md','decisions.md'])assert.ok(fs.existsSync(path.join(project,'.pulso',file)));
  assert.ok(fs.existsSync(path.join(project,'.pulso/work')));
  for(const file of ['installation.json','bin','lib','templates','schemas','docs'])assert.equal(fs.existsSync(path.join(project,'.pulso',file)),false);
  assert.equal(fs.existsSync(path.join(project,'.agents')),false);
  assert.equal(fs.existsSync(path.join(project,'.opencode')),false);
  assert.equal(fs.existsSync(path.join(project,'.github')),false);
  assert.equal(doctor(project,{probeVersions:false}).installation,'PASS');
});

test('Preparación es idempotente y conserva contexto',t=>{
  const project=temp(t);prepareWorkspace(project);
  fs.writeFileSync(path.join(project,'.pulso/project.md'),'Contexto confirmado');
  const state=fs.readFileSync(path.join(project,'.pulso/state.json'));
  const result=prepareWorkspace(project);
  assert.equal(result.existingWorkspace,true);
  assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),'Contexto confirmado');
  assert.deepEqual(fs.readFileSync(path.join(project,'.pulso/state.json')),state);
});

test('Preparación bloquea legacy sin migrar ni borrar',t=>{
  const project=temp(t);fs.mkdirSync(path.join(project,'.pulso'));
  fs.writeFileSync(path.join(project,'.pulso/state.json'),JSON.stringify({schema_version:1,status:'verified'}));
  assert.throws(()=>prepareWorkspace(project),/schemaVersion|requerido|Propiedad/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project,'.pulso/state.json'))).schema_version,1);
});

test('Procedencia BBVA coincide con bytes globales',t=>{
  const home=temp(t);install(options(home));
  const provenance=JSON.parse(fs.readFileSync(new URL('../docs/bbva-provenance.json',import.meta.url)));
  for(const file of provenance.files){const bytes=fs.readFileSync(path.join(home,'.agents',file.file));assert.equal(sha256(bytes),file.sha256);assert.equal(bytes.length,file.bytes);}
});

test('Actualiza instalación global registrada y elimina obsoletos propios',t=>{
  const home=temp(t);install(options(home,'opencode'));
  const manifestPath=path.join(home,'.pulso/installation.json'),manifest=JSON.parse(fs.readFileSync(manifestPath));
  manifest.version='3.0.3';const stale='.pulso/lib/retired.mjs';fs.writeFileSync(path.join(home,stale),'old');manifest.files[stale]=sha256('old');fs.writeFileSync(manifestPath,JSON.stringify(manifest));
  const result=install(options(home,'opencode'));
  assert.equal(result.replacedVersion,'3.0.3');assert.equal(fs.existsSync(path.join(home,stale)),false);
});

test('Desinstala solo el runtime global y nunca recorre el proyecto',t=>{
  const home=temp(t),project=temp(t);install(options(home));prepareWorkspace(project);
  const legacy=path.join(project,'.opencode/agents/pulso.md');fs.mkdirSync(path.dirname(legacy),{recursive:true});fs.writeFileSync(legacy,'INSTALACIÓN LOCAL ANTERIOR');
  const state=fs.readFileSync(path.join(project,'.pulso/state.json'));
  const result=uninstall({runtime:'opencode',homeDir:home,env:{}});
  assert.equal(result.targets.length,1);assert.equal(result.targets[0].scope,'global');
  assert.equal(fs.existsSync(path.join(home,'.config/opencode/agents/pulso.md')),false);
  assert.ok(fs.existsSync(path.join(home,'.copilot/agents/pulso.agent.md')));
  assert.equal(fs.readFileSync(legacy,'utf8'),'INSTALACIÓN LOCAL ANTERIOR');
  assert.deepEqual(fs.readFileSync(path.join(project,'.pulso/state.json')),state);
});

test('Desinstalación cancela ante archivo global modificado',t=>{
  const home=temp(t);install(options(home,'opencode'));
  const agent=path.join(home,'.config/opencode/agents/pulso.md');fs.appendFileSync(agent,'\nCambio');
  assert.throws(()=>uninstall({runtime:'opencode',homeDir:home,env:{}}),/modificado/);
  assert.ok(fs.existsSync(agent));
});

test('CLI no interactivo instala y desinstala global sin depender del cwd',t=>{
  const cwd=temp(t),home=path.join(temp(t),'home'),script=new URL('../install.mjs',import.meta.url).pathname;
  const env={...process.env,HOME:home,USERPROFILE:home};delete env.OPENCODE_CONFIG_DIR;delete env.XDG_CONFIG_HOME;
  const preview=spawnSync(process.execPath,[script,'--runtime','vscode','--dry-run'],{cwd,env,encoding:'utf8'});
  assert.equal(preview.status,0,preview.stderr);assert.equal(fs.existsSync(home),false);
  const run=spawnSync(process.execPath,[script,'--runtime','opencode'],{cwd,env,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/Pulso · Instalación/);assert.doesNotMatch(run.stdout,/Pulso v3|Pulso 3\.0\.4|Versión:/i);assert.match(run.stdout,/Ámbito: Global/);assert.equal(fs.existsSync(path.join(cwd,'.pulso')),false);
  const remove=spawnSync(process.execPath,[script,'uninstall','--runtime','opencode'],{cwd,env,encoding:'utf8'});
  assert.equal(remove.status,0,remove.stderr);assert.match(remove.stdout,/Desinstalación exitosa/);
});

test('CLI rechaza opciones locales retiradas',()=>{
  const script=new URL('../install.mjs',import.meta.url).pathname;
  for(const args of [['--runtime','opencode','--scope','project'],['--runtime','vscode','--target','/tmp/x'],['--runtime','vscode','--vscode-harness','local']]){
    const result=spawnSync(process.execPath,[script,...args],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/Opción desconocida/);
  }
});

test('No interactivo sin runtime no queda esperando',()=>{
  const result=spawnSync(process.execPath,['install.mjs'],{cwd:distribution,encoding:'utf8',timeout:5000,input:''});
  assert.equal(result.status,1);assert.match(result.stderr,/no interactivo/);
});
