import fs from 'node:fs';
import {randomUUID} from 'node:crypto';

function assertHost(vscode, token) {
  if (token?.isCancellationRequested) throw new Error('Workspace selection cancelled.');
  if (vscode.workspace.isTrusted !== true) throw new Error('A trusted workspace is required.');
}

function canonicalDirectory(uri) {
  if (uri?.scheme !== 'file' || typeof uri.fsPath !== 'string') return undefined;
  try {
    const root = fs.realpathSync(uri.fsPath);
    return fs.statSync(root).isDirectory() ? root : undefined;
  } catch {
    return undefined;
  }
}

export function assertWorkspaceRoot(vscode, root, token) {
  assertHost(vscode, token);
  if (typeof root !== 'string' || !(vscode.workspace.workspaceFolders ?? []).some(folder => canonicalDirectory(folder.uri) === root)) {
    throw new Error('The selected workspace root is no longer an open local directory.');
  }
}

export async function selectWorkspaceRoot(vscode, {token, toolName, action} = {}) {
  assertHost(vscode, token);
  const candidates = (vscode.workspace.workspaceFolders ?? []).flatMap(folder => {
    const root = canonicalDirectory(folder.uri);
    if (root === undefined) return [];
    const item = Object.freeze({label: folder.name, description: folder.uri.fsPath, root, uri: folder.uri});
    // Preserve the original binding independently of the picker and mutable URI objects.
    return [{item, root, fsPath: folder.uri.fsPath}];
  });
  if (!candidates.length) throw new Error('No open local workspace directories are available.');

  const invocation = [toolName, action].filter(value => typeof value === 'string' && value.length).join(' / ');
  const selected = await vscode.window.showQuickPick(candidates.map(candidate => candidate.item), {
    title: `${invocation ? `${invocation}: ` : ''}Seleccionar proyecto/worktree para esta ventana`,
    ignoreFocusOut: true,
  }, token);
  assertHost(vscode, token);
  if (selected === undefined) throw new Error('Workspace selection cancelled.');
  const candidate = candidates.find(candidate => candidate.item === selected);
  if (!candidate) throw new Error('Invalid workspace selection: the item was not offered by this picker.');
  assertWorkspaceRoot(vscode, candidate.root, token);
  if (!(vscode.workspace.workspaceFolders ?? []).some(folder => folder.uri?.scheme === 'file'
    && folder.uri.fsPath === candidate.fsPath && canonicalDirectory(folder.uri) === candidate.root)) {
    throw new Error('The selected workspace folder was removed or replaced during selection.');
  }
  return candidate.root;
}

// The public tool API has no session cwd. Bind the project to this extension
// activation/window, never to the active editor or fields supplied by a model.
export function createWorkspaceResolver(vscode) {
  let binding;
  let pending;
  const snapshot = () => JSON.stringify((vscode.workspace.workspaceFolders ?? []).map(folder => [
    folder.uri?.scheme, folder.uri?.fsPath, canonicalDirectory(folder.uri),
  ]));
  function current() {
    const signature = snapshot();
    if (binding && binding.signature !== signature) binding = undefined;
    return signature;
  }
  function assertRoot(root, token) {
    assertHost(vscode, token);
    current();
    assertWorkspaceRoot(vscode, root, token);
    if (!binding || binding.root !== root) throw new Error('The active Pulso project changed; retry using the selected project.');
  }
  function startSelection(options, signature) {
    const selection = {signature};
    selection.promise = selectWorkspaceRoot(vscode, options).then(root => {
      if (snapshot() !== signature) throw new Error('Workspace folders changed during project selection; retry.');
      binding = {root, signature, id: randomUUID()};
      return root;
    }).finally(() => {if (pending === selection) pending = undefined;});
    pending = selection;
    return selection.promise;
  }
  async function resolve(options = {}) {
    assertHost(vscode, options.token);
    const signature = current();
    if (binding) {assertRoot(binding.root, options.token); return binding.root;}
    if (pending) {
      if (pending.signature !== signature) throw new Error('Workspace folders changed during project selection; retry.');
      const root = await pending.promise;
      assertRoot(root, options.token);
      return root;
    }
    const roots = [...new Set((vscode.workspace.workspaceFolders ?? []).map(folder => canonicalDirectory(folder.uri)).filter(Boolean))];
    if (!roots.length) throw new Error('No open local workspace directories are available.');
    if (roots.length === 1) {
      binding = {root: roots[0], signature, id: randomUUID()};
      assertRoot(binding.root, options.token);
      return binding.root;
    }
    const root = await startSelection(options, signature);
    assertRoot(root, options.token);
    return root;
  }
  async function select(options = {}) {
    assertHost(vscode, options.token);
    // A deliberate project switch gets its own picker after any initial choice.
    if (pending) await pending.promise;
    return startSelection(options, current());
  }
  function bindingId(root, token) { assertRoot(root, token); return binding.id; }
  function assertBinding(root, expectedBindingId, token) {
    assertRoot(root, token);
    if (!expectedBindingId || binding.id !== expectedBindingId) throw new Error('Pulso binding changed or missing. Read status, confirm the intended workspace, then retry with its bindingId. No mutation applied.');
  }
  return {resolve, select, assertRoot, bindingId, assertBinding};
}

