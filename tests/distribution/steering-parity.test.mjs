import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sourceRoot} from '../../scripts/build.mjs';
import {readAgentBody,renderPrompt,renderSkill,agentBoundary} from '../../scripts/prompts.mjs';
import {toolContracts,validateToolInput} from '../../core/lib/tool-contracts.mjs';

const coreRoot=path.join(sourceRoot,'core');
const catalog=JSON.parse(fs.readFileSync(path.join(coreRoot,'agents/catalog.json')));
const primary=readAgentBody(coreRoot,'pulso');
const resume=fs.readFileSync(path.join(coreRoot,'skills/pulso-resume/SKILL.md'),'utf8');
// Structural prompt checks only; actual compatibility/omission behavior lives
// in core/continuity.test.mjs (two-delegation acceptance and capture flow).
function assertSteeringInstructions(text){
  const authored=[...text.matchAll(/update_intent\(([^)]+)\)/g)];
  assert.ok(authored.length,'authored update_intent signature');
  const expected=Object.keys(toolContracts.pulso_workspace.actionSchemas.update_intent.properties).filter(name=>name!=='action').sort();
  // Check every occurrence: a current signature must not mask a stale copy.
  for(const [,signature] of authored) {
    const fields=signature.split(',').map(name=>name.trim().replace(/\?$/,'')).sort();
    assert.deepEqual(fields,expected);
  }
  assert.match(text,/compatibleDelegationIds[^.\n]*get_continuity\/get_delegation/);
  assert.match(text,/conserva solo[^.\n]*compatibles/);
  assert.match(text,/envía \[\] cuando ninguno sea compatible/);
  assert.match(text,/Omitir compatibleDelegationIds[^.\n]*\[\][^.\n]*invalida todos/);
  assert.match(text,/compatibilidad no acredita actividad ni cese físico/);
}

for(const target of ['opencode']) test(`${target}: primary and resume render explicit steering compatibility`,async()=>{
  const {adapterConfig}=await import(`../../adapters/${target}/build.mjs`);
  const destination='agents/pulso.md';
  const body=renderPrompt(primary,{boundary:agentBoundary(adapterConfig,catalog.orchestrator,catalog),destination});
  const renderedPrimary=adapterConfig.renderAgent({agent:catalog.orchestrator,catalog,body});
  const renderedResume=renderSkill(resume,{boundary:adapterConfig.operationalSkillBoundary,destination:'skills/pulso-resume/SKILL.md'});
  for(const text of [renderedPrimary,renderedResume]) {
    assertSteeringInstructions(text);
  }
});

test('canonical steering sources match the shared schema and retain omission semantics',()=>{
  // Authored sources are identical across adapters; check them once. Each native
  // rendering above remains a separate boundary where substitution can regress.
  for(const text of [primary,resume]) assertSteeringInstructions(text);
  const schema=toolContracts.pulso_workspace.actionSchemas.update_intent;
  assert.equal(schema.properties.compatibleDelegationIds.type,'array');
  assert.equal(schema.properties.compatibleDelegationIds.items.type,'string');
  assert.ok(!schema.required.includes('compatibleDelegationIds'));
  const input={action:'update_intent',continuityId:'CONT-schema',expectedRevision:1,objective:'Steered objective',constraints:[]};
  for(const selection of [{},{compatibleDelegationIds:[]},{compatibleDelegationIds:['DEL-schema']}]) {
    assert.doesNotThrow(()=>validateToolInput('pulso_workspace',{...input,...selection}));
  }
  assert.throws(()=>validateToolInput('pulso_workspace',{...input,compatibleDelegationIds:'DEL-schema'}),{code:'SCHEMA_INVALID'});
  // The two-delegation acceptance/capture flow is exercised in core/continuity.test.mjs.
});
