import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readAgentBody,renderPrompt} from '../../scripts/prompts.mjs';
test('renderer substitutes authored slots only and resolves output-relative resources',()=>{
  const text=renderPrompt('{{ADAPTER_BOUNDARY}} {{RESOURCE_CATALOG}} ordinary prose',{boundary:'native instructions',destination:'resources/agents/pulso.agent.md'});
  assert.equal(text,'native instructions [catálogo](catalog.json) ordinary prose');
});
test('unknown, malformed, and recursively unresolved slots fail closed',()=>{
  for(const text of ['{{UNKNOWN}}','{{RESOURCE_CATALOG','{{{{RESOURCE_CATALOG}}']) assert.throws(()=>renderPrompt(text,{boundary:'native',destination:'agents/a.md'}));
  assert.throws(()=>renderPrompt('{{ADAPTER_BOUNDARY}}',{boundary:'{{FORBIDDEN}}',destination:'agents/a.md'}));
});
test('renderer requires explicit native boundary and safe destination',()=>{
  assert.throws(()=>renderPrompt('body',{destination:'agents/a.md'}));
  assert.throws(()=>renderPrompt('body',{boundary:'native',destination:'../outside'}));
});
test('both adapters deliver CELLS policy once to coordinator and every specialist',async()=>{
  const coreRoot=fileURLToPath(new URL('../../core/',import.meta.url));
  const catalog=JSON.parse(fs.readFileSync(new URL('../../core/agents/catalog.json',import.meta.url)));
  for(const target of ['opencode','vscode']) {
    const {adapterConfig}=await import(`../../adapters/${target}/build.mjs`);
    for(const agent of [catalog.orchestrator,...catalog.specialists]) {
      const destination=target==='opencode'?`agents/${agent.id}.md`:`resources/agents/${agent.id}.agent.md`;
      const body=renderPrompt(readAgentBody(coreRoot,agent.id),{boundary:adapterConfig.boundary,destination});
      const rendered=adapterConfig.renderAgent({agent,catalog,body});
      const policies=[...rendered.matchAll(/<cells_knowledge_policy>([\s\S]*?)<\/cells_knowledge_policy>/g)];
      assert.equal(policies.length,1,`${target}/${agent.id}: inherited policy`);
      assert.match(policies[0][1],/cells_search/);
      assert.match(policies[0][1],/cells-knowledge/);
      assert.ok(!rendered.includes('{{'),`${target}/${agent.id}: expanded slots`);
    }
  }
});
