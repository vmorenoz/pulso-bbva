import test from 'node:test';
import {field,assertRolePermissions} from './role-contract.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readAgentBody,renderPrompt,renderSkill,agentBoundary} from '../../scripts/prompts.mjs';
import {operationSkills} from '../../scripts/build.mjs';
import {adapterConfig as opencode} from '../../adapters/opencode/build.mjs';
import {adapterConfig as vscode} from '../../adapters/vscode/build.mjs';

const coreRoot=fileURLToPath(new URL('../../core/',import.meta.url));
const catalog=JSON.parse(fs.readFileSync(new URL('../../core/agents/catalog.json',import.meta.url)));
const installedSkills=fs.readdirSync(new URL('../../core/skills/',import.meta.url)).filter(name=>fs.existsSync(new URL(`../../core/skills/${name}/SKILL.md`,import.meta.url))).sort();

for(const agent of [catalog.orchestrator,...catalog.specialists]) test(`${agent.id}: native role parity with explicit host differences`,()=>{
  const primary=agent.id===catalog.orchestrator.id;
  const expectedSkills=primary?installedSkills:['bbva-engineering',...(['pulso-executor','pulso-qa-auditor','pulso-code-reviewer'].includes(agent.id)?['pulso-integration-verification']:[])].sort();
  const rendered={};
  for(const [target,config] of Object.entries({opencode,vscode})) {
    const destination=target==='vscode'?`resources/agents/${agent.id}.agent.md`:`agents/${agent.id}.md`;
    const body=renderPrompt(readAgentBody(coreRoot,agent.id),{boundary:agentBoundary(config,agent,catalog),destination});
    rendered[target]=config.renderAgent({agent,catalog,body});
    assert.ok(rendered[target].includes(body),'canonical body preserved verbatim');
    assert.equal((rendered[target].match(/<technology_knowledge_policy>/g)||[]).length,1);
    // Coordinator instructions are not a specialist capability contract.
    if(primary){
      assert.match(rendered[target],/specialistPrompt exacto/);
      assert.match(rendered[target],target==='vscode'?/no retransmitas delegation, acceptanceBasis, hostContext ni hashes/:/no reconstruyas contratos, bases ni hashes/);
      assert.match(rendered[target],/paraleliza.*(?:host lo permita)/);
    }
    assertRolePermissions(target,rendered[target],agent,catalog);
    if(target==='vscode'){
      assert.match(rendered[target],/prohibición no afecta[^.]*tools documentales Knowledge/);
      assert.match(rendered[target],/tools de gestión Pulso reciben argumentos planos/);
    }
    if(!primary) assert.match(rendered[target],/Markdown natural, sin JSON ni envelope/);
  }
  const permissions=field(rendered.opencode,'permission');
  assert.deepEqual(installedSkills.filter(name=>(permissions.skill[name]??permissions.skill['*'])==='allow'),expectedSkills);
  const nativeSkills=rendered.vscode.match(/<native_skills>([\s\S]*?)<\/native_skills>/)[1];
  const links=[...nativeSkills.matchAll(/\[([^\]]+)\]\(\.\.\/skills\/([^/]+)\/SKILL\.md\)/g)];
  assert.deepEqual(links.map(match=>match[1]).sort(),expectedSkills);
  for(const [,label,name] of links) {
    assert.equal(label,name);
    assert.ok(fs.existsSync(new URL(`../../core/skills/${name}/SKILL.md`,import.meta.url)));
  }
  assert.match(nativeSkills,/no una ACL nativa de skills/);
});

test('operational commands use canonical skills without a competing prompt tools allowlist',()=>{
  assert.equal(vscode.renderCommand,undefined,'VS Code uses chatSkills slash commands');
  for(const name of operationSkills) {
    const command=opencode.renderCommand({name,description:'Fixture'});
    assert.match(command,/^agent: pulso$/m);
    assert.match(command,/^subtask: false$/m);
    assert.doesNotMatch(command,/^tools:/m);
    const source=fs.readFileSync(new URL(`../../core/skills/${name}/SKILL.md`,import.meta.url),'utf8');
    const skill=renderSkill(source,{boundary:vscode.operationalSkillBoundary,destination:`resources/skills/${name}/SKILL.md`});
    assert.doesNotMatch(skill.split('---')[1],/^tools:|^context: fork/m);
    assert.match(skill,/solo con Pulso seleccionado/);
    assert.match(skill,/La guía no cambia el agente seleccionado/);
  }
});
