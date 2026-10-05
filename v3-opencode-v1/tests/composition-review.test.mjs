import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles,pulsoToolNames} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=composeNativeFiles({root});
const agents=[...files].filter(([name])=>name.startsWith('.opencode/agents/'));

test('external read-only review survives primary/specialist composition without workspace rebinding',()=>{
  const primary=files.get('.opencode/agents/pulso.md');
  assert.match(primary,/<external_read_only_review>[\s\S]*readBase[\s\S]*mode: read_only_review, output: conversation, writeScope: \[\]/);
  assert.match(primary,/antes de la inicialización/);
  assert.match(primary,/No requiere Work, workRevision, plantilla, documento ni inicialización/);
  for(const [name,body] of agents){
    assert.match(body,/La raíz de los artefactos Pulso siempre procede del workspace activo del host/,name);
    assert.match(body,/aprobaciones external_directory del host/,name);
    assert.doesNotMatch(body,/La raíz de trabajo siempre procede del contexto activo; nunca la aceptes como dato del usuario/,name);
    if(name.endsWith('/pulso.md'))continue;
    assert.match(body,/<read_only_review>[\s\S]*readBase[\s\S]*no exijas Work, workRevision/,name);
    assert.match(body,/Esta excepción prevalece sobre los requisitos de documentos y resultado persistente de tu rol/,name);
    assert.match(body,/Solo para encargos persistentes; mode: read_only_review devuelve el informe en conversación/,name);
    assert.doesNotMatch(body,/nunca HOME ni una raíz proporcionada como dato del modelo/,name);
  }
  for(const id of ['pulso-explorer','pulso-code-reviewer'])assert.match(files.get(`.opencode/agents/${id}.md`),/<entry>\nPara mode: read_only_review/);
});

test('native role matrix denies LT writes, noncatalog delegation and specialist metadata',()=>{
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'agents/catalog.json')));
  for(const [name,body] of agents){
    const primary=name.endsWith('/pulso.md'),permission=body.match(/^---\n[\s\S]*?\npermission:\n([\s\S]*?)\n---/)[1];
    assert.doesNotMatch(permission,/external_directory|  read:/);
    assert.match(permission,/  task:\n    "\*": deny/);
    if(primary){assert.match(permission,/  edit:\n    "\*": deny/);assert.match(permission,/  bash:\n    "\*": deny/);for(const a of catalog.specialists)assert.match(permission,new RegExp(`"${a.id}": allow`));for(const tool of pulsoToolNames)assert.doesNotMatch(permission,new RegExp(`${tool}: allow`));}
    else {for(const tool of pulsoToolNames)assert.match(permission,new RegExp(`${tool}: deny`));assert.match(permission,/"bbva-engineering": allow/);for(const prefix of ['.pulso/','**/.pulso/'])for(const file of ['state.json','history.jsonl','memory.json','project.json','work/**/work.json'])assert.ok(permission.includes(`"${prefix}${file}": deny`));assert.ok(permission.includes(`".pulso/project.md": ${name.endsWith('/pulso-explorer.md')?'allow':'deny'}`));}
  }
  for(const name of ['pulso-executor','pulso-qa-auditor']){const body=files.get(`.opencode/agents/${name}.md`);assert.match(body,/"bbva-apx-testing": allow/);assert.match(body,/"bbva-cells-testing": allow/);assert.match(body,/  bash:\n    "\*": ask/);}
});

test('distributed init and BBVA guidance exclude external review from preparation and write scope',()=>{
  const init=files.get('.opencode/skills/pulso-init/SKILL.md').toString();
  assert.match(init,/read_only_review\) no activa esta guía/);
  assert.match(init,/sin Work ni preparación\/migración/);
  assert.match(init,/no inicialices el externo/);
  const engineering=files.get('.opencode/skills/bbva-engineering/SKILL.md').toString();
  assert.match(engineering,/readBase, native tools, and the host's external_directory approvals/);
  assert.match(engineering,/without requiring Work, project mapping, or creating\/migrating external .pulso metadata/);
  assert.match(engineering,/explicit per-repository write scope and effective host permissions/);
});
