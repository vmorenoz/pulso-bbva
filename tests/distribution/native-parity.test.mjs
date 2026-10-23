import test from 'node:test';
import {field,effect,assertRolePermissions} from './role-contract.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readAgentBody,renderPrompt,renderSkill,agentBoundary} from '../../scripts/prompts.mjs';
import {operationSkills} from '../../scripts/build.mjs';
import {adapterConfig as opencode} from '../../adapters/opencode/build.mjs';

const coreRoot=fileURLToPath(new URL('../../core/',import.meta.url));
const catalog=JSON.parse(fs.readFileSync(new URL('../../core/agents/catalog.json',import.meta.url)));
const installedSkills=fs.readdirSync(new URL('../../core/skills/',import.meta.url)).filter(name=>fs.existsSync(new URL(`../../core/skills/${name}/SKILL.md`,import.meta.url))).sort();

for(const agent of [catalog.orchestrator,...catalog.specialists]) test(`${agent.id}: canonical role with native v2 permissions`,()=>{
  const primary=agent.id===catalog.orchestrator.id;
  const expectedSkills=primary?installedSkills:['bbva-engineering',...(['pulso-executor','pulso-qa-auditor','pulso-code-reviewer'].includes(agent.id)?['pulso-integration-verification']:[])].sort();
  const destination=`agents/${agent.id}.md`;
  const body=renderPrompt(readAgentBody(coreRoot,agent.id),{boundary:agentBoundary(opencode,agent,catalog),destination});
  const text=opencode.renderAgent({agent,catalog,body});
  assert.ok(text.includes(body),'canonical body preserved verbatim');
  assert.equal((text.match(/<technology_knowledge_policy>/g)||[]).length,1);
  if(primary){
    assert.match(text,/specialistPrompt exacto/);
    assert.match(text,/no reconstruyas contratos, bases ni hashes/);
    assert.match(text,/paraleliza.*(?:host lo permita)/);
    assert.match(text,/prepare_delegation → subagent → accept_result/);
    assert.match(text,/Si el host ya ofrece TODO nativo/);
    assert.match(text,/no actives el flag experimental para obtenerlo/);
  } else assert.match(text,/Markdown natural, sin JSON ni envelope/);
  assertRolePermissions('opencode',text,agent,catalog);
  const rules=field(text,'permissions');
  assert.deepEqual(installedSkills.filter(name=>effect(rules,'skill',name)==='allow'),expectedSkills);
});

test('operational commands use native v2 fields and canonical skills',()=>{
  for(const name of operationSkills) {
    const command=opencode.renderCommand({name,description:'Fixture'});
    assert.match(command,/^agent: pulso$/m);
    assert.match(command,/^subagent: false$/m);
    assert.doesNotMatch(command,/^tools:|^subtask:/m);
    const source=fs.readFileSync(new URL(`../../core/skills/${name}/SKILL.md`,import.meta.url),'utf8');
    const skill=renderSkill(source,{boundary:opencode.operationalSkillBoundary,destination:`skills/${name}/SKILL.md`});
    assert.doesNotMatch(skill.split('---')[1],/^tools:|^context: fork/m);
    assert.match(skill,/coordinator_only/);
  }
});

test('package declares one pinned native-v2 entrypoint without runtime dependency on the old SDK',()=>{
  const manifest=opencode.packageManifest();
  assert.equal(manifest.version,'0.1.0');
  assert.equal(manifest.license,'UNLICENSED');
  assert.deepEqual(fs.readFileSync(new URL('../../LICENSE.md',import.meta.url)),fs.readFileSync(new URL('../../adapters/opencode/LICENSE.md',import.meta.url)));
  assert.equal(manifest.exports,'./plugin/index.mjs');
  assert.deepEqual(manifest.pulso,{host:'opencode',apiVersion:2,hostVersion:'2.1.2'});
  assert.equal(manifest.compatibleHosts,undefined);
  assert.ok(!Object.keys(opencode.runtimeFiles).some(file=>/schema-converter|vendor/.test(file)));
});
