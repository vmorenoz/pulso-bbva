import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPrompt} from '../../scripts/prompts.mjs';
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
