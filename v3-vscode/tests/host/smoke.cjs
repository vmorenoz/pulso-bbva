const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

// Public extension-host API: read-only tools, no model chat or delegation.
exports.run = async function run() {
  const workspace = process.env.PULSO_HOST_WORKSPACE;
  const resultPath = process.env.PULSO_HOST_RESULT;
  assert.ok(workspace && resultPath, 'Run through scripts/test-host.mjs');
  assert.equal(vscode.workspace.workspaceFolders?.length, 1);
  assert.equal(vscode.workspace.workspaceFolders[0].uri.fsPath, workspace);
  assert.equal(vscode.workspace.isTrusted, true, 'Only the dedicated fixture is trusted');
  const assertNoPulso = () => assert.equal(fs.existsSync(path.join(workspace, '.pulso')), false,
    'Activation must not initialize .pulso in the fixture');
  assertNoPulso();

  const extension = vscode.extensions.getExtension('pulso-local.pulso');
  assert.ok(extension, 'Pulso must be discovered by the real VS Code host');
  await extension.activate();
  assert.equal(extension.isActive, true);
  assertNoPulso();

  const expectedTools = ['pulso_context', 'pulso_history', 'pulso_work', 'pulso_workspace'];
  assert.ok(vscode.lm && Array.isArray(vscode.lm.tools), 'Public vscode.lm.tools API is required');
  const registeredTools = vscode.lm.tools.map(tool => tool.name).filter(name => name.startsWith('pulso_')).sort();
  assert.deepEqual(registeredTools, expectedTools);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('pulso.openChat'), 'pulso.openChat must be registered (not executed)');
  assert.ok(commands.includes('pulso.selectProject'), 'pulso.selectProject must be registered (not executed)');

  const manifest = JSON.parse(fs.readFileSync(path.join(extension.extensionPath, 'package.json'), 'utf8'));
  assert.equal(manifest.name, 'pulso');
  assert.equal(manifest.publisher, 'pulso-local');
  assert.equal(manifest.displayName, 'Pulso');
  assert.equal(extension.packageJSON.displayName, 'Pulso');
  assert.deepEqual(manifest.contributes.languageModelTools.map(tool => tool.name).sort(), expectedTools);
  const command = manifest.contributes.commands.find(item => item.command === 'pulso.openChat');
  assert.equal(command?.category, 'Pulso');
  for (const [kind, suffix] of [['chatAgents', '.agent.md'], ['chatSkills', '/SKILL.md']]) {
    const contributions = manifest.contributes[kind];
    assert.equal(contributions.length, 10, `${kind}: exactly ten contributions`);
    assert.equal(new Set(contributions.map(item => item.path)).size, 10);
    for (const contribution of contributions) {
      assert.deepEqual(Object.keys(contribution), ['path']);
      assert.ok(contribution.path.startsWith('resources/'));
      assert.ok(contribution.path.endsWith(suffix));
      const resource = path.resolve(extension.extensionPath, contribution.path);
      assert.ok(resource.startsWith(`${path.resolve(extension.extensionPath)}${path.sep}`));
      assert.ok(fs.statSync(resource).isFile(), `${contribution.path} must exist`);
      assert.ok(fs.readFileSync(resource, 'utf8').trim(), `${contribution.path} must not be empty`);
    }
  }
  const agent = fs.readFileSync(path.join(extension.extensionPath, 'resources/agents/pulso.agent.md'), 'utf8');
  assert.match(agent, /^name:\s*["']?Pulso["']?\s*$/m, 'Main agent public branding');
  for (const [name, input] of [['pulso_workspace', {action: 'status'}], ['pulso_history', {}], ['pulso_context', {action: 'summary', scope: 'project'}]]) {
    const toolResult = await vscode.lm.invokeTool(name, {input, toolInvocationToken: undefined});
    const part = toolResult.content.find(item => item instanceof vscode.LanguageModelTextPart);
    assert.ok(part, `${name} must return a text receipt`);
    const receipt = JSON.parse(part.value);
    assert.equal(receipt.ok, true, receipt.output);
    assert.equal(receipt.workspace, fs.realpathSync(workspace));
    assertNoPulso();
  }
  assertNoPulso();
  const result = {status: 'PASS', vscodeVersion: vscode.version, extensionId: extension.id,
    tools: registeredTools, commands: ['pulso.openChat', 'pulso.selectProject'], agents: 10, skills: 10,
    workspaceUninitialized: true, liveChat: false, delegation: false, toolInvocations: 3};
  fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, {flag: 'wx'});
  console.log(`Pulso real host smoke: ${JSON.stringify(result)}`);
};
