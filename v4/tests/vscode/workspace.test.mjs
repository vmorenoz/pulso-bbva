import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {assertWorkspaceRoot, selectWorkspaceRoot, createWorkspaceResolver} from '../../adapters/vscode/src/workspace.mjs';

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-workspace-'));
  t.after(() => fs.rmSync(base, {recursive: true, force: true}));
  const root = path.join(base, 'root'), second = path.join(base, 'second'), home = path.join(base, 'home');
  for (const directory of [root, second, home]) fs.mkdirSync(directory);
  const folder = (fsPath, name = path.basename(fsPath), scheme = 'file') => ({name, uri: {scheme, fsPath}});
  const calls = [];
  const vscode = {
    workspace: {isTrusted: true, workspaceFolders: [folder(root)]},
    window: {async showQuickPick(items, options, token) {
      calls.push({items, options, token});
      return items[0];
    }},
  };
  return {base, root: fs.realpathSync(root), second: fs.realpathSync(second), home, folder, calls, vscode};
}

test('explicit selection asks even with one folder and only consults the public cancellation token', async t => {
  const {vscode, root, calls} = fixture(t);
  const token = new Proxy({isCancellationRequested: false}, {get(target, key) {
    assert.equal(key, 'isCancellationRequested');
    return target[key];
  }});
  for (let i = 0; i < 2; i++) assert.equal(await selectWorkspaceRoot(vscode, {token, toolName: 'pulso_work', action: 'create'}), root);
  assert.equal(calls.length, 2);
  const {items, options, token: received} = calls[0];
  assert.equal(received, token);
  assert.equal(options.ignoreFocusOut, true);
  assert.match(options.title, /pulso_work.*create.*proyecto\/worktree.*ventana/);
  assert.deepEqual(items[0], {label: 'root', description: vscode.workspace.workspaceFolders[0].uri.fsPath, root, uri: vscode.workspace.workspaceFolders[0].uri});
  assert.equal(items[0].uri, vscode.workspace.workspaceFolders[0].uri);
});

test('cached project still checks cancellation and trust on every invocation', async t => {
  const {vscode, root, calls} = fixture(t);
  const resolver = createWorkspaceResolver(vscode);
  assert.equal(await resolver.resolve(), root);
  assert.equal(calls.length, 0);
  const token = {isCancellationRequested: true};
  await assert.rejects(resolver.resolve({token}), /cancelled/);
  assert.throws(() => resolver.assertRoot(root, token), /cancelled/);
  vscode.workspace.isTrusted = false;
  await assert.rejects(resolver.resolve(), /trusted workspace/);
  assert.throws(() => resolver.assertRoot(root), /trusted workspace/);
});

test('changing the selected project invalidates the context of in-flight operations', async t => {
  const {vscode, root, second, folder} = fixture(t);
  vscode.workspace.workspaceFolders = [folder(root), folder(second)];
  const resolver = createWorkspaceResolver(vscode);
  assert.equal(await resolver.resolve(), root);
  vscode.window.showQuickPick = async items => items[1];
  assert.equal(await resolver.select(), second);
  assert.throws(() => resolver.assertRoot(root), /active Pulso project changed/);
  assert.doesNotThrow(() => resolver.assertRoot(second));
});

test('workspace changes invalidate in-flight context even if the previous root is still open', async t => {
  const {vscode, root, second, folder} = fixture(t);
  const resolver = createWorkspaceResolver(vscode);
  await resolver.resolve();
  vscode.workspace.workspaceFolders = [folder(root), folder(second)];
  assert.throws(() => resolver.assertRoot(root), /active Pulso project changed/);
  vscode.window.showQuickPick = async items => items[1];
  assert.equal(await resolver.resolve(), second);
});

test('followers check their own cancellation after sharing a pending project picker', async t => {
  const {vscode, root, second, folder} = fixture(t);
  vscode.workspace.workspaceFolders = [folder(root), folder(second)];
  let release;
  vscode.window.showQuickPick = items => new Promise(resolve => {release = () => resolve(items[1]);});
  const resolver = createWorkspaceResolver(vscode);
  const leader = resolver.resolve();
  const token = {isCancellationRequested: false};
  const follower = resolver.resolve({token});
  const rejected = assert.rejects(follower, /cancelled/);
  token.isCancellationRequested = true;
  release();
  assert.equal(await leader, second);
  await rejected;
  assert.equal(await resolver.resolve(), second);
});

test('multi-root selection uses the second folder and excludes absent, virtual and non-directory roots', async t => {
  const {vscode, root, second, base, folder} = fixture(t);
  const file = path.join(base, 'file');
  fs.writeFileSync(file, 'fixture');
  vscode.workspace.workspaceFolders = [folder(root), folder(second), folder(path.join(base, 'missing')), folder(root, 'virtual', 'vscode-remote'), folder(file)];
  vscode.window.activeTextEditor = new Proxy({}, {get() {throw new Error('active editor must not be consulted');}});
  vscode.window.showQuickPick = async items => {
    assert.deepEqual(items.map(item => item.root), [root, second]);
    return items[1];
  };
  assert.equal(await selectWorkspaceRoot(vscode), second);
});

test('trust must be exactly true before picking and at caller revalidation', async t => {
  const {vscode, root, calls} = fixture(t);
  for (const trust of [false, undefined, 'true']) {
    vscode.workspace.isTrusted = trust;
    await assert.rejects(selectWorkspaceRoot(vscode), /trusted workspace/);
    assert.throws(() => assertWorkspaceRoot(vscode, root), /trusted workspace/);
  }
  assert.equal(calls.length, 0);
});

test('cancellation before picking and later caller revalidation throws clearly', async t => {
  const {vscode, root, calls} = fixture(t);
  const token = {isCancellationRequested: true};
  await assert.rejects(selectWorkspaceRoot(vscode, {token}), /cancelled/);
  assert.throws(() => assertWorkspaceRoot(vscode, root, token), /cancelled/);
  assert.equal(calls.length, 0);
});

test('dismissal cancels without writes to root or fixture home', async t => {
  const {vscode, root, home} = fixture(t);
  vscode.window.showQuickPick = async () => undefined;
  await assert.rejects(selectWorkspaceRoot(vscode), /cancelled/);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.deepEqual(fs.readdirSync(home), []);
});

test('cancellation and trust changes during the picker are rechecked', async t => {
  const {vscode} = fixture(t);
  const token = {isCancellationRequested: false};
  vscode.window.showQuickPick = async items => {token.isCancellationRequested = true; return items[0];};
  await assert.rejects(selectWorkspaceRoot(vscode, {token}), /cancelled/);
  token.isCancellationRequested = false;
  vscode.window.showQuickPick = async items => {vscode.workspace.isTrusted = false; return items[0];};
  await assert.rejects(selectWorkspaceRoot(vscode, {token}), /trusted workspace/);
});

test('absent and virtual-only workspaces cannot select or validate roots', async t => {
  const {vscode, root, folder, calls} = fixture(t);
  for (const folders of [undefined, [], [folder(root, 'virtual', 'untitled')]]) {
    vscode.workspace.workspaceFolders = folders;
    await assert.rejects(selectWorkspaceRoot(vscode), /No open local/);
    assert.throws(() => assertWorkspaceRoot(vscode, root), /no longer/);
  }
  assert.equal(calls.length, 0);
});

test('caller assertion rejects unopened home and noncanonical paths', t => {
  const {vscode, root, home} = fixture(t);
  assert.doesNotThrow(() => assertWorkspaceRoot(vscode, root));
  for (const invalid of [home, `${root}/.`, undefined]) assert.throws(() => assertWorkspaceRoot(vscode, invalid), /no longer/);
});

test('folder removed or replaced while picking is rejected', async t => {
  const {vscode, root, second, folder} = fixture(t);
  for (const replacement of [[], [folder(second)]]) {
    vscode.workspace.workspaceFolders = [folder(root)];
    vscode.window.showQuickPick = async items => {vscode.workspace.workspaceFolders = replacement; return items[0];};
    await assert.rejects(selectWorkspaceRoot(vscode), /no longer|removed or replaced/);
  }
});

test('deleted directory is rejected at picker return and later caller assertion', async t => {
  const {vscode, root} = fixture(t);
  vscode.window.showQuickPick = async items => {fs.rmdirSync(root); return items[0];};
  await assert.rejects(selectWorkspaceRoot(vscode), /no longer/);
  assert.throws(() => assertWorkspaceRoot(vscode, root), /no longer/);
});

test('symlink aliases remain distinct items but return canonical roots', async t => {
  const {vscode, base, root, folder} = fixture(t);
  const alias = path.join(base, 'alias');
  fs.symlinkSync(root, alias, 'dir');
  vscode.workspace.workspaceFolders = [folder(root), folder(alias)];
  vscode.window.showQuickPick = async items => {
    assert.equal(items.length, 2);
    assert.equal(items[1].description, alias);
    assert.equal(items[1].root, root);
    return items[1];
  };
  assert.equal(await selectWorkspaceRoot(vscode), root);
  assert.doesNotThrow(() => assertWorkspaceRoot(vscode, root));
  assert.throws(() => assertWorkspaceRoot(vscode, alias), /no longer/);
});

test('removal of selected alias is rejected even when another alias keeps the root open', async t => {
  const {vscode, base, root, folder} = fixture(t);
  const alias = path.join(base, 'alias');
  fs.symlinkSync(root, alias, 'dir');
  vscode.workspace.workspaceFolders = [folder(root), folder(alias)];
  vscode.window.showQuickPick = async items => {vscode.workspace.workspaceFolders = [folder(root)]; return items[1];};
  await assert.rejects(selectWorkspaceRoot(vscode), /removed or replaced/);
});

test('retargeting the original symlink cannot silently change the selected root', async t => {
  const {vscode, base, root, second, folder} = fixture(t);
  const alias = path.join(base, 'alias');
  fs.symlinkSync(root, alias, 'dir');
  vscode.workspace.workspaceFolders = [folder(root), folder(alias)];
  vscode.window.showQuickPick = async items => {
    fs.unlinkSync(alias);
    fs.symlinkSync(second, alias, 'dir');
    return items[1];
  };
  await assert.rejects(selectWorkspaceRoot(vscode), /removed or replaced/);
});

test('foreign picker objects are rejected even with matching fields or an injected root', async t => {
  const {vscode, home} = fixture(t);
  for (const foreign of [item => ({...item}), item => ({...item, root: home}), () => null]) {
    vscode.window.showQuickPick = async items => foreign(items[0]);
    await assert.rejects(selectWorkspaceRoot(vscode), /Invalid workspace selection/);
  }
});

test('caller revalidation detects folder removal after selection returns', async t => {
  const {vscode} = fixture(t);
  const root = await selectWorkspaceRoot(vscode);
  vscode.workspace.workspaceFolders = [];
  assert.throws(() => assertWorkspaceRoot(vscode, root), /no longer/);
});
