import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readAgentBody,renderPrompt,renderSkill} from '../../scripts/prompts.mjs';
import {operationSkills} from '../../scripts/build.mjs';
import {adapterConfig as opencode} from '../../adapters/opencode/build.mjs';
import {adapterConfig as vscode} from '../../adapters/vscode/build.mjs';

const coreRoot=fileURLToPath(new URL('../../core/',import.meta.url));
const catalog=JSON.parse(fs.readFileSync(new URL('../../core/agents/catalog.json',import.meta.url)));
const field=(text,name)=>JSON.parse(text.match(new RegExp(`^${name}: (.+)$`,'m'))[1]);
const management=['pulso_workspace','pulso_work','pulso_history','pulso_context'];
const knowledge=['search','read','outline','related','status','sources','technologies'].map(name=>`pulso-knowledge/knowledge_${name}`);
const installedSkills=fs.readdirSync(new URL('../../core/skills/',import.meta.url)).filter(name=>fs.existsSync(new URL(`../../core/skills/${name}/SKILL.md`,import.meta.url))).sort();

for(const agent of [catalog.orchestrator,...catalog.specialists]) test(`${agent.id}: native role parity with explicit host differences`,()=>{
  const primary=agent.id===catalog.orchestrator.id;
  const execution=['pulso-executor','pulso-qa-auditor'].includes(agent.id);
  const expectedSkills=primary?installedSkills:['bbva-engineering',...(['pulso-executor','pulso-qa-auditor','pulso-code-reviewer'].includes(agent.id)?['pulso-integration-verification']:[])].sort();
  const rendered={};
  for(const [target,config] of Object.entries({opencode,vscode})) {
    const destination=target==='vscode'?`resources/agents/${agent.id}.agent.md`:`agents/${agent.id}.md`;
    const body=renderPrompt(readAgentBody(coreRoot,agent.id),{boundary:config.boundary,destination});
    rendered[target]=config.renderAgent({agent,catalog,body});
    assert.ok(rendered[target].includes(body),'canonical body preserved verbatim');
    assert.equal((rendered[target].match(/<technology_knowledge_policy>/g)||[]).length,1);
    assert.match(rendered[target],/specialistPrompt exacto/);
    assert.match(rendered[target],target==='vscode'?/no retransmitas delegation, acceptanceBasis, hostContext ni hashes/:/no reconstruyas contratos, bases ni hashes/);
    assert.match(rendered[target],/paraleliza.*(?:host lo permita)/);
    if(!primary) assert.match(rendered[target],/Markdown natural, sin JSON ni envelope/);
  }
  const permissions=field(rendered.opencode,'permission');
  const tools=field(rendered.vscode,'tools');
  assert.deepEqual(tools.filter(tool=>tool.startsWith('pulso-knowledge/')),knowledge);
  assert.ok(!tools.some(tool=>tool.includes('*')));
  for(const tool of management) {
    assert.equal(tools.includes(tool),primary);
    assert.equal(permissions[tool],primary?undefined:'deny');
  }
  assert.equal(tools.includes('execute'),execution);
  assert.equal(permissions.bash['*'],execution?'ask':'deny');
  assert.equal(tools.includes('edit'),!primary);
  assert.equal(tools.includes('agent'),primary);
  assert.deepEqual(field(rendered.vscode,'agents'),primary?catalog.specialists.map(role=>role.id):[]);
  assert.deepEqual(permissions.task,primary?{'*':'deny',...Object.fromEntries(catalog.specialists.map(role=>[role.id,'allow']))}:{'*':'deny'});
  assert.equal(field(rendered.vscode,'user-invocable'),primary);
  assert.equal(field(rendered.vscode,'disable-model-invocation'),false);
  assert.equal(field(rendered.opencode,'mode'),primary?'primary':'subagent');
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
