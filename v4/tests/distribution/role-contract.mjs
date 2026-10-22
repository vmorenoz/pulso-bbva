import assert from 'node:assert/strict';

export const field=(text,name)=>JSON.parse(text.match(new RegExp(`^${name}: (.+)$`,'m'))[1]);
export const knowledge=['search','read','outline','related','status','sources','technologies'].map(name=>`pulso-knowledge/knowledge_${name}`);
const management=['pulso_workspace','pulso_work','pulso_history','pulso_context'];

// The same policy oracle is applied to source rendering AND independently built
// packages. Do not infer permissions from instructions in the prompt body.
export function assertRolePermissions(target,text,agent,catalog) {
  const primary=agent.id===catalog.orchestrator.id;
  const execution=['pulso-executor','pulso-qa-auditor'].includes(agent.id);
  if(target==='vscode') {
    const expectedTools=role=>[
      ...(role.id===catalog.orchestrator.id
        ? ['agent','read','search','web','vscode/askQuestions',...management]
        : ['read','search','web','edit',...(['pulso-executor','pulso-qa-auditor'].includes(role.id)?['execute']:[])]),
      ...knowledge
    ];
    assert.deepEqual(field(text,'tools'),expectedTools(agent),agent.id);
    const capabilities=/<declared_capabilities>([\s\S]*?)<\/declared_capabilities>/.exec(text)?.[1];
    assert.ok(capabilities,`${agent.id}: missing declared capabilities`);
    const declared=[...capabilities.matchAll(/^([a-z-]+): tools=(.+)\.$/gm)].map(([,id,tools])=>[id,tools.split(', ')]);
    const roles=primary?[catalog.orchestrator,...catalog.specialists]:[agent];
    assert.deepEqual(declared,roles.map(role=>[role.id,expectedTools(role)]),'body declarations must agree with the independent permission oracle');
    assert.deepEqual(field(text,'agents'),primary?catalog.specialists.map(role=>role.id):[]);
    assert.equal(field(text,'user-invocable'),primary);
    assert.equal(field(text,'disable-model-invocation'),false);
  } else {
    const permissions=field(text,'permission');
    assert.doesNotMatch(text,/^tools:|pulso-knowledge\/knowledge_/m);
    assert.equal(field(text,'mode'),primary?'primary':'subagent');
    assert.equal(permissions.bash['*'],execution?'ask':'deny');
    assert.deepEqual(permissions.task,primary?{'*':'deny',...Object.fromEntries(catalog.specialists.map(role=>[role.id,'allow']))}:{'*':'deny'});
    for(const tool of management)assert.equal(permissions[tool],primary?undefined:'deny');
    assert.ok(!Object.keys(permissions).some(name=>name.startsWith('pulso-knowledge')));
    if(primary)assert.equal(permissions.edit['*'],'deny');
    else {
      assert.equal(permissions.edit['*'],execution?undefined:'deny');
      for(const key of ['.pulso/state.json','.pulso/history.jsonl','.pulso/work/**/work.json'])assert.equal(permissions.edit[key],'deny');
      assert.equal(permissions.edit['.pulso/project.md'],agent.id==='pulso-explorer'?'allow':'deny');
    }
  }
}
