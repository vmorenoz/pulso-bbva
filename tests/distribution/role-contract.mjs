import assert from 'node:assert/strict';

export const field=(text,name)=>JSON.parse(text.match(new RegExp(`^${name}: (.+)$`,'m'))[1]);
const management=['pulso_workspace','pulso_work','pulso_history','pulso_context'];
export function effect(rules, action, resource) {
  return rules.filter(rule=>rule.action===action&&(rule.resource==='*'||rule.resource===resource)).at(-1)?.effect;
}

// Independent native-v2 oracle: ordered permissions, not promises in prompt prose.
export function assertRolePermissions(target,text,agent,catalog) {
  assert.equal(target,'opencode');
  const primary=agent.id===catalog.orchestrator.id;
  const execution=['pulso-executor','pulso-qa-auditor'].includes(agent.id);
  const rules=field(text,'permissions');
  assert.ok(Array.isArray(rules));
  for(const rule of rules) {
    assert.deepEqual(Object.keys(rule).sort(),['action','effect','resource']);
    assert.ok(['allow','ask','deny'].includes(rule.effect));
    assert.ok(!['task','bash','write','patch'].includes(rule.action));
  }
  assert.doesNotMatch(text,/^tools:|^permission:|pulso-knowledge\/knowledge_/m);
  assert.equal(field(text,'mode'),primary?'primary':'subagent');
  assert.equal(effect(rules,'shell','any command'),execution?'ask':'deny');
  assert.equal(effect(rules,'external_directory','/outside/project'),'ask');
  assert.deepEqual(rules.filter(rule=>rule.action==='subagent'),[
    {action:'subagent',resource:'*',effect:'deny'},
    ...(primary?catalog.specialists.map(role=>({action:'subagent',resource:role.id,effect:'allow'})):[]),
  ]);
  for(const tool of management) assert.equal(effect(rules,tool,'*'),'ask');
  assert.ok(!rules.some(rule=>rule.action.startsWith('pulso-knowledge')));
  assert.equal(effect(rules,'edit','*'),primary||!execution?'deny':undefined);
  const edit=rules.filter(rule=>rule.action==='edit');
  const exact=resource=>edit.filter(rule=>rule.resource===resource).at(-1)?.effect;
  if(!primary) for(const prefix of ['.pulso/','**/.pulso/']) {
    for(const extension of ['json','zip']) assert.equal(exact(`${prefix}work/*/trace-evidence/*.${extension}`),execution?'allow':undefined);
    for(const file of ['**','state.json','history.jsonl','memory.json','project.json','work/**/work.json','preparation.json','recovery/**','delegation-attempts/**']) assert.equal(exact(`${prefix}${file}`),'deny');
    assert.equal(exact(`${prefix}work/**/*.md`),'allow');
    assert.equal(exact(`${prefix}project.md`),agent.id==='pulso-explorer'?'allow':'deny');
    const generic=edit.findIndex(rule=>rule.resource===`${prefix}**`);
    for(const rule of edit.filter(rule=>rule.resource.startsWith(prefix)&&rule.effect==='allow')) assert.ok(edit.indexOf(rule)>generic,'specific allow follows broad deny');
  }
  const capabilities=/<declared_capabilities>([\s\S]*?)<\/declared_capabilities>/.exec(text)?.[1];
  assert.ok(capabilities);
  const declared=[...capabilities.matchAll(/^([a-z-]+): shell=(ask|deny); subagent=(.+)\.$/gm)].map(([,id,shell,subagent])=>[id,shell,subagent]);
  const roles=primary?[catalog.orchestrator,...catalog.specialists]:[agent];
  assert.deepEqual(declared,roles.map(role=>[role.id,['pulso-executor','pulso-qa-auditor'].includes(role.id)?'ask':'deny',role.id===catalog.orchestrator.id?'especialistas del catálogo':'deny']));
}
