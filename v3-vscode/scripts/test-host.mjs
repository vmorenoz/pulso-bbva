import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import os from 'node:os';

const temporaryParent = process.env.PULSO_TEST_TMPDIR || os.tmpdir();
const extensionRoot = fileURLToPath(new URL('../', import.meta.url));
const macCandidates = [path.join(os.homedir(), 'Applications'), '/Applications'].flatMap(parent =>
  ['Code', 'Electron'].map(name => path.join(parent, 'Visual Studio Code.app', 'Contents', 'MacOS', name)));
const executable = process.argv[2] || process.env.VSCODE_EXECUTABLE || (process.platform === 'darwin'
  ? macCandidates.find(candidate => fs.existsSync(candidate)) : undefined);
const timeoutMs = 120_000;

async function main() {
  if (!executable || process.argv.length > 3) throw new Error('Usage: node scripts/test-host.mjs [VS Code executable]; Windows/Linux require an explicit executable or VSCODE_EXECUTABLE');
  try {
    fs.accessSync(executable, fs.constants.X_OK);
  } catch (error) {
    throw new Error(`BLOCKED: VS Code executable unavailable: ${executable} (${error.code})`);
  }
  // Verify the pre-approved parent before creating any fixture directories.
  if (!fs.statSync(temporaryParent).isDirectory()) throw new Error('Temporary parent is not a directory');
  console.log(`Temporary parent verified: ${temporaryParent} (${fs.readdirSync(temporaryParent).length} entries)`);
  const fixture = fs.mkdtempSync(path.join(temporaryParent, 'pulso-host-'));
  const workspace = path.join(fixture, 'workspace');
  const userData = path.join(fixture, 'user-data');
  const extensions = path.join(fixture, 'extensions');
  const resultPath = path.join(fixture, 'result.json');
  let child;
  let timedOut = false;
  let interrupted = false;
  let timer;
  let forceTimer;
  const signalChild = signal => {
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') {
        // Restrict tree cleanup to this spawned host PID, never image names.
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', ...(signal === 'SIGKILL' ? ['/F'] : [])], {stdio: 'inherit'});
        killer.on('error', error => console.error(`Host cleanup: ${error.message}`));
      } else {
        process.kill(-child.pid, signal); // Own detached process group only.
      }
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(`Host cleanup: ${error.message}`);
    }
  };
  const stop = () => {
    signalChild('SIGTERM');
    forceTimer ??= setTimeout(() => signalChild('SIGKILL'), 5_000);
  };
  const onInterrupt = () => { interrupted = true; stop(); };
  try {
    for (const directory of [workspace, userData, extensions]) fs.mkdirSync(directory);
    const env = {...process.env, PULSO_HOST_WORKSPACE: workspace, PULSO_HOST_RESULT: resultPath};
    delete env.ELECTRON_RUN_AS_NODE;
    const args = [
      `--extensionDevelopmentPath=${extensionRoot}`,
      `--extensionTestsPath=${path.join(extensionRoot, 'tests/host/smoke.cjs')}`,
      `--user-data-dir=${userData}`,
      `--extensions-dir=${extensions}`,
      '--skip-welcome', '--skip-release-notes', '--disable-telemetry',
      // Applies exclusively to this disposable host/fixture; no settings edits.
      '--disable-workspace-trust',
      workspace,
    ];
    console.log(`Real host launch: ${JSON.stringify({executable, args, timeoutMs})}`);
    console.log('Scope: activation, registration and three read-only tool invocations; no model chat, delegation, or login.');
    child = spawn(executable, args, {env, stdio: 'inherit', detached: process.platform !== 'win32'});
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);
    timer = setTimeout(() => { timedOut = true; console.error('BLOCKED: real VS Code host exceeded 120 seconds'); stop(); }, timeoutMs);
    const outcome = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({code, signal}));
    });
    console.log(`Real host exit: ${JSON.stringify({...outcome, timedOut, interrupted})}`);
    if (timedOut || interrupted) throw new Error('BLOCKED: host execution did not complete');
    if (!fs.existsSync(resultPath)) throw new Error(`BLOCKED: host produced no smoke completion receipt (exit ${outcome.code}, signal ${outcome.signal})`);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    console.log(`Real host receipt: ${JSON.stringify(result)}`);
    if (outcome.code !== 0 || result.status !== 'PASS') throw new Error('Real host smoke failed');
    if (fs.existsSync(path.join(workspace, '.pulso'))) throw new Error('Activation initialized fixture .pulso');
    console.log(`PASS: real VS Code ${result.vscodeVersion} host smoke (no live chat/delegation).`);
  } finally {
    clearTimeout(timer);
    clearTimeout(forceTimer);
    process.removeListener('SIGINT', onInterrupt);
    process.removeListener('SIGTERM', onInterrupt);
    // Terminate any remaining children from this host before deleting its fixture.
    signalChild('SIGTERM');
    if (child?.pid && process.platform !== 'win32') {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        try { process.kill(-child.pid, 0); } catch (error) {
          if (error.code === 'ESRCH') break;
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      signalChild('SIGKILL');
    }
    fs.rmSync(fixture, {recursive: true, force: true});
    console.log(`Fixture cleaned: ${fixture}`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
