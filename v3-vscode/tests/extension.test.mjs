import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {build} from '../scripts/build.mjs';
import {listFiles, parseFrontmatter, sourceRoot, runtimeModules} from '../src/composition.mjs';

const require = createRequire(import.meta.url);
const extensionSource = fileURLToPath(new URL('../', import.meta.url));
const names = ['pulso_workspace', 'pulso_work', 'pulso_history', 'pulso_context'];
const folder = root => ({name: path.basename(root), uri: {scheme: 'file', fsPath: root}});
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function snapshot(root) {
  return fs.readdirSync(root, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name)).map(entry => [
    entry.name, entry.isDirectory() ? snapshot(path.join(root, entry.name)) : fs.readFileSync(path.join(root, entry.name)).toString('hex'),
  ]);
}

// Only public host surfaces. No session internals or proposed APIs are mocked.
function mockHost(roots) {
  const tools = new Map(), commands = new Map(), registrations = [], picks = [], executed = [], messages = [];
  const host = {
    tools, commands, registrations, picks, executed, messages,
    choose: items => items[0],
    vscode: {
      workspace: {isTrusted: true, workspaceFolders: roots.map(folder)},
      lm: {registerTool(name, implementation) {
        assert.ok(!tools.has(name), `duplicate registration: ${name}`);
        tools.set(name, implementation);
        return disposable(tools, name);
      }},
      LanguageModelToolResult: class {constructor(content) {this.content = content;}},
      LanguageModelTextPart: class {constructor(value) {this.value = value;}},
      window: {
        async showQuickPick(items, options, token) {
          picks.push({items, options, token});
          return host.choose(items);
        },
        async showInformationMessage(message) {messages.push(message);},
      },
      commands: {
        registerCommand(name, callback) {
          commands.set(name, callback);
          return disposable(commands, name);
        },
        async executeCommand(...args) {executed.push(args);},
      },
    },
  };
  function disposable(registry, name) {
    const registration = {disposed: false, dispose() {this.disposed = true; registry.delete(name);}};
    registrations.push(registration);
    return registration;
  }
  return host;
}

async function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-vscode-extension-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const extensionPath = path.join(base, 'extension'), homeDir = path.join(base, 'home');
  const roots = ['project-a', 'project-b'].map(name => path.join(base, name));
  for (const directory of [extensionPath, homeDir, ...roots]) fs.mkdirSync(directory);
  fs.mkdirSync(path.join(extensionPath, 'src'));
  fs.copyFileSync(path.join(extensionSource, 'package.json'), path.join(extensionPath, 'package.json'));
  for (const file of ['extension.cjs', 'tools.mjs', 'workspace.mjs']) {
    fs.copyFileSync(path.join(extensionSource, 'src', file), path.join(extensionPath, 'src', file));
  }
  await build({root: extensionPath, sourceRoot});
  for (const directory of [...roots, homeDir]) fs.writeFileSync(path.join(directory, 'keep.txt'), 'fixture sentinel\n');
  const canonicalRoots = roots.map(root => fs.realpathSync(root));
  const host = mockHost([canonicalRoots[0]]);
  const context = {extensionPath, subscriptions: []};
  const {activateWith} = require(path.join(extensionPath, 'src/extension.cjs'));
  const before = () => [...canonicalRoots, homeDir].map(snapshot);
  const initial = before();
  // All user-scope operations must use the injected fixture home.
  t.mock.method(os, 'homedir', () => {throw new Error('Unexpected access to real HOME');});
  await activateWith(host.vscode, context, {homeDir});
  assert.deepEqual(before(), initial, 'activation must not write project or HOME');
  t.after(() => {for (const subscription of context.subscriptions) subscription.dispose();});
  async function invoke(name, input, token = {isCancellationRequested: false}) {
    const count = host.picks.length;
    const result = await host.tools.get(name).invoke({input}, token);
    for (const pick of host.picks.slice(count)) assert.equal(pick.token, token);
    assert.ok(result instanceof host.vscode.LanguageModelToolResult);
    assert.equal(result.content.length, 1);
    assert.ok(result.content[0] instanceof host.vscode.LanguageModelTextPart);
    const receipt = JSON.parse(result.content[0].value);
    assert.deepEqual(Object.keys(receipt).sort(), ['ok', 'output', 'title', 'workspace']);
    assert.equal(typeof receipt.output, 'string');
    assert.match(receipt.title, /^Pulso · /);
    return receipt;
  }
  async function success(name, input) {
    const receipt = await invoke(name, input);
    assert.equal(receipt.ok, true, receipt.output);
    return receipt;
  }
  return {extensionPath, homeDir, roots: canonicalRoots, host, context, activateWith, before, initial, invoke, success};
}

test('built manifest, four registrations and prepareInvocation integrate without project/HOME writes', async t => {
  const {extensionPath, host, context, before, initial} = await fixture(t);
  const manifest = json(path.join(extensionPath, 'package.json'));
  assert.equal(manifest.main, './src/extension.cjs');
  assert.equal(manifest.displayName, 'Pulso');
  assert.deepEqual([...host.tools.keys()], names);
  assert.deepEqual(manifest.contributes.languageModelTools.map(tool => tool.name), names);
  assert.deepEqual([...host.commands.keys()].sort(), ['pulso.openChat', 'pulso.selectProject']);
  assert.equal(context.subscriptions.length, 6);
  const selectCommand = manifest.contributes.commands.find(command => command.command === 'pulso.selectProject');
  assert.equal(selectCommand?.title, 'Seleccionar proyecto');
  assert.equal(selectCommand?.category, 'Pulso');
  assert.deepEqual(context.subscriptions, host.registrations);
  const agents = manifest.contributes.chatAgents;
  assert.equal(agents.length, 10);
  assert.equal(new Set(agents.map(agent => agent.path)).size, 10);
  const catalog = json(path.join(sourceRoot, 'agents/catalog.json'));
  assert.deepEqual(agents.map(agent => agent.path), [catalog.orchestrator, ...catalog.specialists].map(agent => `resources/agents/${agent.id}.agent.md`));
  const expectedSkills = listFiles(path.join(sourceRoot, 'skills')).filter(file => file.endsWith('/SKILL.md')).map(file => `resources/skills/${file}`);
  assert.ok(expectedSkills.length > 0);
  assert.deepEqual(manifest.contributes.chatSkills.map(skill => skill.path), expectedSkills);
  for (const contribution of [...agents, ...manifest.contributes.chatSkills]) {
    assert.deepEqual(Object.keys(contribution), ['path']);
    const {metadata} = parseFrontmatter(fs.readFileSync(path.join(extensionPath, contribution.path), 'utf8'));
    assert.ok(metadata.name && metadata.description);
  }
  const primary = parseFrontmatter(fs.readFileSync(path.join(extensionPath, agents[0].path), 'utf8')).metadata;
  assert.deepEqual(primary.tools.filter(tool => names.includes(tool)), names);
  const provenance = json(path.join(extensionPath, 'resources/provenance.json'));
  assert.equal(provenance.source, 'v3-opencode-v1');
  assert.ok(provenance.files.every(file => file.sources.every(source => source.path.startsWith('v3-opencode-v1/'))));
  for (const module of runtimeModules) {
    assert.deepEqual(fs.readFileSync(path.join(extensionPath, `resources/lib/${module}.mjs`)), fs.readFileSync(path.join(sourceRoot, `lib/${module}.mjs`)));
  }
  for (const [name, tool] of host.tools) {
    const inputs = {pulso_history: {}, pulso_workspace: {action: 'prepare'}, pulso_work: {action: 'get', workId: 'WORK-EXT'}, pulso_context: {action: 'summary'}};
    const prepared = await tool.prepareInvocation({input: inputs[name]});
    assert.match(prepared.invocationMessage, /Pulso · /);
  }
  assert.equal(host.picks.length, 0);
  assert.deepEqual(before(), initial, 'preparing host invocations is read-only');
  for (const [name, tool] of host.tools) {
    for (const input of [null, undefined, {action: 'unknown'}]) {
      assert.throws(() => tool.prepareInvocation({input}), /input[.:]/);
      await assert.rejects(tool.invoke({input}, {isCancellationRequested: false}), /input[.:]/);
    }
  }
  assert.equal(host.picks.length, 0, 'malformed inputs are rejected before project selection');
  assert.deepEqual(before(), initial);
});

test('single root is automatic and multi-root binding is reused across tools until explicit selection', async t => {
  const {roots: [first, second], homeDir, host, before, initial, invoke, success} = await fixture(t);
  for (let index = 0; index < 2; index++) {
    const receipt = await success('pulso_workspace', {action: 'status'});
    assert.equal(receipt.workspace, first);
    assert.match(receipt.output, /Sin estado/);
    assert.equal(host.picks.length, 0, 'single-folder invocations must not show a picker');
  }
  const unpreparedHistory = await invoke('pulso_history', {});
  assert.equal(unpreparedHistory.ok, true);
  assert.match(unpreparedHistory.output, /Sin cierres/);
  await success('pulso_context', {action: 'summary'});
  assert.equal(host.picks.length, 0);
  assert.deepEqual(before(), initial);
  host.vscode.workspace.workspaceFolders = [folder(first), folder(second)];
  host.choose = items => items[1];
  assert.equal((await success('pulso_workspace', {action: 'prepare'})).workspace, second);
  assert.equal(host.picks.length, 1);
  assert.equal(host.picks[0].items.length, 2);
  assert.match((await success('pulso_workspace', {action: 'prepare'})).output, /Ya estaba/);
  const create = {action: 'create', workId: 'WORK-EXT', title: 'Integración', objective: 'Verificar core empaquetado', criterion: 'Contrato público correcto', verification: 'Fixture temporal', priority: 'urgent'};
  await success('pulso_work', create);
  // Read canonical artifacts, never manufacture metadata in the fixture.
  const workFiles = listFiles(path.join(second, '.pulso')).filter(file => file.endsWith('/work.json'));
  assert.equal(workFiles.length, 1);
  const canonicalWorkPath = path.join(second, '.pulso', workFiles[0]);
  assert.equal(json(canonicalWorkPath).priority, 'urgent');
  assert.equal(json(canonicalWorkPath).revision, 1);
  await success('pulso_work', {action: 'update', workId: 'WORK-EXT', expectedRevision: 1, actions: [{type: 'work.set_overview', summary: 'Avance verificado', nextAction: 'Cerrar'}]});
  assert.equal(json(canonicalWorkPath).revision, 2);
  assert.equal(json(canonicalWorkPath).summary, 'Avance verificado');
  const saved = before();
  const stale = await invoke('pulso_work', {action: 'update', workId: 'WORK-EXT', expectedRevision: 1, actions: [{type: 'work.set_overview', summary: 'Obsoleto'}]});
  assert.equal(stale.ok, false);
  assert.match(stale.output, /Revisión obsoleta/);
  assert.deepEqual(before(), saved);
  assert.match((await success('pulso_work', {action: 'get', workId: 'WORK-EXT'})).output, /rev\. 2/);
  await success('pulso_work', {action: 'close', workId: 'WORK-EXT', expectedRevision: 2, outcome: 'cancelled', summary: 'Cierre de integración'});
  const closed = before();
  assert.match((await success('pulso_history', {workId: 'WORK-EXT', limit: 1})).output, /WORK-EXT · cancelled · Cierre de integración/);
  await success('pulso_workspace', {action: 'status'});
  assert.deepEqual(before(), closed, 'history and status must not write');
  assert.equal(host.picks.length, 1, 'all tools share the window binding');
  host.choose = items => items[0];
  assert.equal((await success('pulso_workspace', {action: 'status'})).workspace, second, 'changing picker choice alone does not change the binding');
  await host.commands.get('pulso.selectProject')();
  assert.equal(host.picks.length, 2);
  const emptyHistory = await invoke('pulso_history', {});
  assert.equal(emptyHistory.workspace, first);
  assert.equal(emptyHistory.ok, true);
  assert.match(emptyHistory.output, /Sin cierres/);
  assert.deepEqual(snapshot(first), initial[0]);
  assert.deepEqual(snapshot(homeDir), closed[2]);
  assert.equal(host.picks.at(-1).items.length, 2);
  assert.equal(host.picks.length, 2, 'tools retain the explicitly selected root');
});

test('context is project-local and user preferences share injected HOME across roots and activations', async t => {
  const {extensionPath, roots: [first, second], homeDir, host, activateWith, before, initial, success} = await fixture(t);
  await success('pulso_context', {action: 'set_context', context: 'Notas del primer proyecto'});
  await success('pulso_context', {action: 'set_preference', scope: 'project', key: 'formato', value: 'breve'});
  const projectSaved = snapshot(first);
  await success('pulso_context', {action: 'set_preference', scope: 'user', key: 'idioma', value: 'es'});
  assert.deepEqual(snapshot(first), projectSaved);
  const preferences = json(path.join(homeDir, '.pulso/preferences.json'));
  assert.equal(preferences.preferences.find(item => item.key === 'idioma').value, 'es');
  host.vscode.workspace.workspaceFolders = [folder(first), folder(second)];
  host.choose = items => items[1];
  const saved = before();
  const receipt = await success('pulso_context', {action: 'summary'});
  assert.equal(receipt.workspace, second);
  assert.match(receipt.output, /sin notas · preferencias: 0 del proyecto, 1 del usuario/);
  assert.deepEqual(before(), saved);
  assert.deepEqual(snapshot(second), initial[1]);
  const another = mockHost([second]);
  const context = {extensionPath, subscriptions: []};
  t.after(() => {for (const subscription of context.subscriptions) subscription.dispose();});
  await activateWith(another.vscode, context, {homeDir});
  const result = await another.tools.get('pulso_context').invoke({input: {action: 'summary'}}, {isCancellationRequested: false});
  assert.match(JSON.parse(result.content[0].value).output, /0 del proyecto, 1 del usuario/);
  assert.equal(another.picks.length, 0);
  assert.deepEqual(before(), saved);
  host.choose = items => items[0];
  await host.commands.get('pulso.selectProject')();
  assert.match((await success('pulso_context', {action: 'summary'})).output, /Notas del primer proyecto.*1 del proyecto, 1 del usuario/);
});

test('concurrent tools share one picker and explicit selection can change or preserve the window binding', async t => {
  const {roots: [first, second], host, before, initial, success} = await fixture(t);
  host.vscode.workspace.workspaceFolders = [folder(first), folder(second)];
  let release;
  host.choose = items => new Promise(resolve => {release = () => resolve(items[1]);});
  const pending = [success('pulso_workspace', {action: 'status'}), success('pulso_history', {}), success('pulso_context', {action: 'summary'})];
  // Let all invokes enter the resolver while the host picker remains pending.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.picks.length, 1, 'concurrent resolve calls must share the pending picker');
  release();
  assert.ok((await Promise.all(pending)).every(receipt => receipt.workspace === second));
  assert.deepEqual(before(), initial);

  host.choose = () => undefined;
  // The command may surface cancellation as a rejection or a handled dismissal.
  try {await host.commands.get('pulso.selectProject')();}
  catch (error) {assert.match(error.message, /cancelled/);}
  assert.equal(host.picks.length, 2, 'explicit selection always opens a picker');
  assert.equal((await success('pulso_context', {action: 'summary'})).workspace, second);
  assert.equal(host.picks.length, 2, 'cancelled selection keeps the prior binding');
  host.choose = items => items[0];
  await host.commands.get('pulso.selectProject')();
  for (const [name, input] of [['pulso_workspace', {action: 'status'}], ['pulso_history', {}], ['pulso_context', {action: 'summary'}]]) {
    assert.equal((await success(name, input)).workspace, first);
  }
  assert.equal(host.picks.length, 3);
  assert.deepEqual(before(), initial, 'selection and queries must not write');
});

test('explicit command forces a picker even for a sole folder, without writing project or HOME', async t => {
  const {roots: [first], host, before, initial, success} = await fixture(t);
  assert.equal((await success('pulso_history', {})).workspace, first);
  assert.equal(host.picks.length, 0);
  await host.commands.get('pulso.selectProject')();
  assert.equal(host.picks.length, 1);
  assert.equal(host.picks[0].items.length, 1);
  assert.equal((await success('pulso_context', {action: 'summary'})).workspace, first);
  assert.equal(host.picks.length, 1);
  assert.deepEqual(before(), initial);
});

test('workspace snapshots invalidate bindings and a new activation selects multi-root again', async t => {
  const {extensionPath, roots: [first, second], homeDir, host, activateWith, before, initial, success} = await fixture(t);
  host.vscode.workspace.workspaceFolders = [folder(first), folder(second)];
  assert.equal((await success('pulso_history', {})).workspace, first);
  assert.equal(host.picks.length, 1);
  host.vscode.workspace.workspaceFolders = [folder(second), folder(first)];
  host.choose = items => items[0];
  assert.equal((await success('pulso_history', {})).workspace, second);
  assert.equal(host.picks.length, 2, 'changing the folder list invalidates the binding');
  host.vscode.workspace.workspaceFolders = [folder(first)];
  assert.equal((await success('pulso_history', {})).workspace, first);
  assert.equal(host.picks.length, 2, 'after invalidation a sole folder is automatic');
  host.vscode.workspace.workspaceFolders = [folder(first), folder(second)];
  assert.equal((await success('pulso_history', {})).workspace, first);
  assert.equal(host.picks.length, 3);
  const reloaded = mockHost([first, second]);
  reloaded.choose = items => items[1];
  const context = {extensionPath, subscriptions: []};
  t.after(() => {for (const subscription of context.subscriptions) subscription.dispose();});
  await activateWith(reloaded.vscode, context, {homeDir});
  const result = await reloaded.tools.get('pulso_history').invoke({input: {}}, {isCancellationRequested: false});
  assert.equal(JSON.parse(result.content[0].value).workspace, second);
  assert.equal(reloaded.picks.length, 1, 'activation does not inherit another window binding');
  assert.deepEqual(before(), initial);
});

test('root errors, cancellation and trust rejection prevent project and HOME writes', async t => {
  const {roots: [first, second], homeDir, host, before, initial} = await fixture(t);
  const inputs = [
    ['pulso_workspace', {action: 'prepare'}],
    ['pulso_work', {action: 'create', workId: 'REJECTED', title: 'Rechazado', objective: 'No escribir'}],
    ['pulso_context', {action: 'set_preference', scope: 'user', key: 'idioma', value: 'es'}],
  ];
  const scenarios = [
    {error: /No open local/, setup() {host.vscode.workspace.workspaceFolders = [];}},
    {error: /No open local/, setup() {host.vscode.workspace.workspaceFolders = [{name: 'remote', uri: {scheme: 'vscode-remote', fsPath: first}}];}},
    {error: /trusted workspace/, setup() {host.vscode.workspace.isTrusted = false;}},
    {error: /cancelled/, token: {isCancellationRequested: true}, setup() {}},
    {error: /cancelled/, setup() {host.choose = () => undefined;}},
    {error: /Invalid workspace selection/, setup() {host.choose = items => ({...items[0], root: homeDir});}},
    {error: /no longer|removed or replaced|changed/, setup() {host.choose = items => {host.vscode.workspace.workspaceFolders = [folder(second)]; return items[0];};}},
    {error: /trusted workspace/, setup() {host.choose = items => {host.vscode.workspace.isTrusted = false; return items[0];};}},
    {error: /cancelled/, setup(token) {host.choose = items => {token.isCancellationRequested = true; return items[0];};}},
  ];
  for (const scenario of scenarios) {
    for (const [name, input] of inputs) {
      host.vscode.workspace.isTrusted = true;
      // Picker dismissal and in-picker drift need multi-root; single-folder resolve bypasses the picker.
      // Alternate order to invalidate any binding retained by a prior scenario.
      host.vscode.workspace.workspaceFolders = host.vscode.workspace.workspaceFolders?.[0]?.uri.fsPath === first
        ? [folder(second), folder(first)] : [folder(first), folder(second)];
      host.choose = items => items[0];
      const token = scenario.token || {isCancellationRequested: false};
      scenario.setup(token);
      await assert.rejects(host.tools.get(name).invoke({input}, token), scenario.error);
      assert.deepEqual(before(), initial, `${name}: rejected invocation must not write`);
    }
  }
});

test('openChat fallback uses the same public mock; registrations are disposable (not live validation)', async t => {
  const {host, context, before, initial} = await fixture(t);
  await host.commands.get('pulso.openChat')();
  assert.deepEqual(host.executed, [['workbench.action.chat.open']]);
  assert.equal(host.messages.length, 1);
  assert.match(host.messages[0], /Selecciona Pulso.*Local o Copilot/);
  assert.equal(host.picks.length, 0);
  assert.deepEqual(before(), initial);
  for (const subscription of context.subscriptions) {
    assert.equal(typeof subscription.dispose, 'function');
    subscription.dispose();
  }
  assert.ok(host.registrations.every(registration => registration.disposed));
  assert.equal(host.tools.size, 0);
  assert.equal(host.commands.size, 0);
  t.diagnostic('Fallback comprobado con el mismo mock de APIs públicas. No es una prueba live de VS Code/Copilot ni confirma disponibilidad de destinos o ejecución de agentes/skills en el host.');
});
