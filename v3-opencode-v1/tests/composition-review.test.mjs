import test from 'node:test';
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

test('external review inherits host directory rules and preserves existing edit/task/tool permissions',()=>{
  for(const [name,body] of agents){
    const primary=name.endsWith('/pulso.md');
    const permission=body.match(/^---\n[\s\S]*?\npermission:\n([\s\S]*?)\n---/)[1];
    const expected=['  skill:',`    "*": ${primary?'allow':'deny'}`,'  edit:'];
    if(primary)expected.push('    "**/.pulso/**": deny');
    else expected.push('    "**/.pulso/work/**": allow',`    "**/.pulso/project.md": ${name.endsWith('/pulso-explorer.md')?'allow':'deny'}`);
    for(const tool of pulsoToolNames)expected.push(`  ${tool}: ${primary?'allow':'deny'}`);
    expected.push('  task:',`    "*": ${primary?'allow':'deny'}`);
    assert.equal(permission,expected.join('\n'),name);
    assert.doesNotMatch(permission,/external_directory|  read:|  bash:/,name);
  }
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
