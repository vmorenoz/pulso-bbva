import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {install,uninstall} from '../lib/install.mjs';
import {prepareWorkspace} from '../lib/workspace.mjs';
import {readWork} from '../lib/artifacts.mjs';
import {temp} from './helpers.mjs';

const options=homeDir=>({homeDir,env:{}});

test('OpenCode v1 installation includes only global Pulso resources and its plugin entry',t=>{
  const home=temp(t),result=install(options(home));
  assert.deepEqual(result.runtimes,['opencode-v1']);assert.equal(result.opencodeVersion,'NOT_CHECKED');
  for(const file of ['.config/opencode/agents/pulso.md','.config/opencode/plugins/pulso/index.mjs','.config/opencode/commands/pulso-init.md','.config/opencode/skills/pulso-init/SKILL.md','.pulso/lib/artifacts.mjs','.pulso/lib/memory.mjs','.pulso/installation.json'])assert.ok(fs.existsSync(path.join(home,file)),file);
  assert.match(fs.readFileSync(path.join(home,'.config/opencode/opencode.jsonc'),'utf8'),/file:.*plugins\/pulso\/index\.mjs/);
  assert.equal(fs.existsSync(path.join(home,'.pulso/state.json')),false);
});

test('Añade el plugin a una configuración global vacía',t=>{
  const home=temp(t),config=path.join(home,'.config/opencode/opencode.jsonc');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'{}\n');install(options(home));const value=fs.readFileSync(config,'utf8');assert.match(value,/"plugin"/);assert.match(value,/"default_agent": "pulso"/);
});

test('Distribuye la política obligatoria de Jira y formato de commit',t=>{
  const home=temp(t);install(options(home));
  const agent=name=>fs.readFileSync(path.join(home,'.config/opencode/agents',`${name}.md`),'utf8');
  for(const name of ['pulso','pulso-executor']){const content=agent(name);assert.match(content,/\^\[A-Z\]\[A-Z0-9\]\+-\[0-9\]\+\$/);assert.match(content,/<type>\(<scope>\): <mensaje> \[<JIRA-TICKET>\]/);}
  assert.match(agent('pulso-executor'),/git add -A/);assert.match(agent('pulso-executor'),/stage únicamente de rutas explícitas/);
});

test('Distribuye la migración automática de estado legacy en pulso-init',t=>{
  const home=temp(t);install(options(home));
  const agent=fs.readFileSync(path.join(home,'.config/opencode/agents/pulso.md'),'utf8'),skill=fs.readFileSync(path.join(home,'.config/opencode/skills/pulso-init/SKILL.md'),'utf8');
  assert.match(agent,/pulso_workspace/);assert.match(agent,/migra al contrato actual/);assert.match(skill,/migra automáticamente formatos legacy conocidos/);assert.match(skill,/no edites artefactos legacy directamente/);
});

test('La preparación conserva memoria y contexto del proyecto',t=>{
  const project=temp(t);prepareWorkspace(project);fs.writeFileSync(path.join(project,'.pulso/project.md'),'Contexto confirmado');
  assert.equal(prepareWorkspace(project).existingWorkspace,true);assert.equal(fs.readFileSync(path.join(project,'.pulso/project.md'),'utf8'),'Contexto confirmado');assert.ok(fs.existsSync(path.join(project,'.pulso/memory.json')));
});

test('La preparación migra una carpeta legacy vacía sin bloquear',t=>{
  const project=temp(t),legacy=path.join(project,'.pulso/tasks');fs.mkdirSync(legacy,{recursive:true});
  const result=prepareWorkspace(project);assert.equal(result.legacyMigrated,true);assert.equal(result.migratedWorks,0);assert.ok(fs.existsSync(path.join(project,'.pulso/state.json')));assert.equal(fs.existsSync(legacy),false);
});

test('La preparación convierte una tarea legacy en un Work pendiente de revisión',t=>{
  const project=temp(t),tasks=path.join(project,'.pulso/tasks');fs.mkdirSync(tasks,{recursive:true});fs.writeFileSync(path.join(tasks,'PULSO-001.json'),JSON.stringify({id:'PULSO-001',title:'Entrega anterior',objective:'Conservar el alcance',status:'implemented',acceptance_criteria:['El resultado cumple'],execution:{summary:'Implementación anterior',verification_gaps:['Falta validación actual']}}));
  const result=prepareWorkspace(project),work=readWork(project,'PULSO-001',{files:false});assert.equal(result.migratedWorks,1);assert.equal(work.status,'paused');assert.match(work.summary,/Migrado desde legacy/);assert.match(work.blockers.join('\n'),/Falta validación actual/);assert.equal(fs.existsSync(tasks),false);
});

test('Uninstall elimina la integración global y preserva los datos del workspace',t=>{
  const home=temp(t),project=temp(t),config=path.join(home,'.config/opencode/opencode.jsonc');fs.mkdirSync(path.dirname(config),{recursive:true});fs.writeFileSync(config,'{"default_agent":"build"}\n');install(options(home));prepareWorkspace(project);const state=fs.readFileSync(path.join(project,'.pulso/state.json'));
  const result=uninstall({homeDir:home,env:{}});assert.equal(result.uninstalled,true);assert.equal(fs.existsSync(path.join(home,'.config/opencode/plugins/pulso/index.mjs')),false);assert.match(fs.readFileSync(config,'utf8'),/"default_agent":"build"/);assert.equal(fs.existsSync(path.join(home,'.pulso/installation.json')),false);
  assert.deepEqual(fs.readFileSync(path.join(project,'.pulso/state.json')),state);
});
