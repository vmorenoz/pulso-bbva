import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build,operationSkills,sourceRoot} from '../../scripts/build.mjs';
import {renderSkill} from '../../scripts/prompts.mjs';

for(const target of ['opencode','vscode']) test(`${target}: coordinator boundary is restricted to operational skills`,async t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-skill-boundaries-'));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  await build(target,{outputRoot:temp});
  const {adapterConfig}=await import(`../../adapters/${target}/build.mjs`);
  const catalog=JSON.parse(fs.readFileSync(path.join(sourceRoot,'core/agents/catalog.json')));
  if(target==='opencode') for(const agent of [catalog.orchestrator,...catalog.specialists]) {
    const text=fs.readFileSync(path.join(temp,`agents/${agent.id}.md`),'utf8');
    const primary=agent.id===catalog.orchestrator.id;
    assert.equal(text.includes('<coordinator_only>'),primary,`${agent.id}: built role boundary`);
    assert.equal(text.includes('<specialist_tools>'),!primary,`${agent.id}: built specialist boundary`);
    assert.ok(text.includes(adapterConfig.boundaryForAgent({agent,catalog})),`${agent.id}: build selects authored role contract`);
  }
  assert.deepEqual(operationSkills,['pulso-init','pulso-status','pulso-recap','pulso-resume']);
  for(const name of [...operationSkills,'pulso-integration-verification']) {
    const file=`${name}/SKILL.md`;
    const destination=target==='vscode'?`resources/skills/${file}`:`skills/${file}`;
    const source=fs.readFileSync(path.join(sourceRoot,'core/skills',file),'utf8');
    const actual=fs.readFileSync(path.join(temp,destination),'utf8');
    if(operationSkills.includes(name)) {
      assert.equal(actual,renderSkill(source,{boundary:adapterConfig.operationalSkillBoundary,resourceBase:'resources',destination}));
      assert.ok(actual.includes(adapterConfig.operationalSkillBoundary));
      assert.equal(actual.includes('<selected_agent>'),target==='vscode');
    } else {
      assert.equal(actual,source.replaceAll('{{ADAPTER_BOUNDARY}}',''));
      assert.doesNotMatch(actual,/<selected_agent>|<native_boundary>|solo con Pulso seleccionado|prepare_delegation/);
      assert.match(actual,/Checklist auxiliar de QA y Code Reviewer/);
      assert.match(actual,/No edites metadatos ni delegues ni certifiques cumplimiento/);
    }
    assert.doesNotMatch(actual,/\{\{/);
  }
});
