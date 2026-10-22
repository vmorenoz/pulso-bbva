import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {sourceRoot} from '../../scripts/build.mjs';
import {readAgentBody,renderPrompt,renderSkill} from '../../scripts/prompts.mjs';
import {toolContracts,validateToolInput} from '../../core/lib/tool-contracts.mjs';

const signature='update_intent(continuityId, expectedRevision, objective, constraints, repositories?, compatibleDelegationIds)';
const selection='Selecciona explícitamente compatibleDelegationIds con IDs reales confirmados mediante get_continuity/get_delegation: conserva solo los encargos evaluados como compatibles con el steering vigente y envía [] cuando ninguno sea compatible.';
const defaultPolicy='Omitir compatibleDelegationIds equivale a [] e invalida todos los encargos de la intención anterior; la compatibilidad no acredita actividad ni cese físico.';

for(const target of ['opencode','vscode']) test(`${target}: primary and resume render explicit steering compatibility`,async()=>{
  const {adapterConfig}=await import(`../../adapters/${target}/build.mjs`);
  const coreRoot=path.join(sourceRoot,'core');
  const catalog=JSON.parse(fs.readFileSync(path.join(coreRoot,'agents/catalog.json')));
  const primary=readAgentBody(coreRoot,'pulso');
  const resume=fs.readFileSync(path.join(coreRoot,'skills/pulso-resume/SKILL.md'),'utf8');
  const destination=target==='vscode'?'resources/agents/pulso.agent.md':'agents/pulso.md';
  const body=renderPrompt(primary,{boundary:adapterConfig.boundary,destination});
  const renderedPrimary=adapterConfig.renderAgent({agent:catalog.orchestrator,catalog,body});
  const renderedResume=renderSkill(resume,{boundary:adapterConfig.operationalSkillBoundary,destination:target==='vscode'?'resources/skills/pulso-resume/SKILL.md':'skills/pulso-resume/SKILL.md'});
  for(const text of [primary,resume,renderedPrimary,renderedResume]) {
    for(const exact of [signature,selection,defaultPolicy]) assert.ok(text.includes(exact),`${target}: missing ${exact}`);
    assert.doesNotMatch(text,/update_intent\(continuityId, expectedRevision, objective, constraints, repositories\?\)/);
  }
});

test('authored steering signature matches the shared schema without changing omission semantics',()=>{
  const schema=toolContracts.pulso_workspace.actionSchemas.update_intent;
  const fields=signature.slice(signature.indexOf('(')+1,-1).split(', ').map(name=>name.replace(/\?$/,''));
  assert.deepEqual(fields.sort(),Object.keys(schema.properties).filter(name=>name!=='action').sort());
  assert.equal(schema.properties.compatibleDelegationIds.type,'array');
  assert.equal(schema.properties.compatibleDelegationIds.items.type,'string');
  assert.ok(!schema.required.includes('compatibleDelegationIds'));
  const input={action:'update_intent',continuityId:'CONT-schema',expectedRevision:1,objective:'Steered objective',constraints:[]};
  for(const selection of [{},{compatibleDelegationIds:[]},{compatibleDelegationIds:['DEL-schema']}]) {
    assert.doesNotThrow(()=>validateToolInput('pulso_workspace',{...input,...selection}));
  }
  assert.throws(()=>validateToolInput('pulso_workspace',{...input,compatibleDelegationIds:'DEL-schema'}));
  // The two-delegation acceptance/capture flow is exercised in core/continuity.test.mjs.
});
