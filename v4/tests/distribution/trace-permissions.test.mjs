import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderAgent} from '../../adapters/opencode/build.mjs';

test('rendered trace-evidence permissions allow JSON/ZIP only for Executor and QA and retain metadata denies',()=>{
  const catalog=JSON.parse(fs.readFileSync(new URL('../../core/agents/catalog.json',import.meta.url)));
  for(const agent of [catalog.orchestrator,...catalog.specialists]){
    const rendered=renderAgent({agent,catalog,body:'Fixture'});
    const permission=JSON.parse(rendered.split('\n').find(line=>line.startsWith('permission: ')).slice('permission: '.length));
    const allowed=['pulso-executor','pulso-qa-auditor'].includes(agent.id);
    for(const prefix of ['.pulso/','**/.pulso/']){
      for(const extension of ['json','zip']){
        assert.equal(permission.edit[`${prefix}work/*/trace-evidence/*.${extension}`],allowed?'allow':undefined,agent.id);
      }
      if(agent.id===catalog.orchestrator.id)assert.equal(permission.edit['*'],'deny');
      else for(const file of ['**','state.json','history.jsonl','memory.json','project.json','work/**/work.json','preparation.json','recovery/**','delegation-attempts/**']){
        assert.equal(permission.edit[`${prefix}${file}`],'deny',`${agent.id}/${file}`);
      }
    }
  }
});
