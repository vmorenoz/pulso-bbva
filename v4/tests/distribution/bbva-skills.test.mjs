import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {build, sourceRoot, verifyBBVA} from '../../scripts/build.mjs';
import {verifyPackage} from '../../scripts/check.mjs';

const coreRoot = path.join(sourceRoot, 'core');
const integrity = JSON.parse(fs.readFileSync(new URL('../../scripts/bbva-integrity.json', import.meta.url)));
const skill = name => fs.readFileSync(path.join(coreRoot, 'skills', name, 'SKILL.md'), 'utf8');
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-bbva-skills-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}

test('reviewed BBVA corpus retains conditional APX/CELLS recipes without fixed environment assumptions', () => {
  verifyBBVA(coreRoot);
  const apx = skill('bbva-apx-testing'), cells = skill('bbva-cells-testing');
  for (const anchor of ['SpringJUnit4ClassRunner', 'elara-test.xml', 'DummyBundleContext', 'initialize and start', 'JobLauncherTestUtils', 'JobParameters', 'named step', 'feature-flag/decider']) assert.ok(apx.includes(anchor), anchor);
  for (const anchor of ['fixtureCleanup', 'subscribe', 'unsubscribe', 'publish', 'navigate', 'global/context/flow/session', 'beforeEach', 'window.location', 'locale requests', 'timers', 'storage']) assert.ok(cells.includes(anchor), anchor);
  assert.match(apx, /patterns to confirm in the repository/);
  assert.match(cells, /diagnostic checklist, not a list of patches to add by default/);
  assert.match(skill('bbva-apx'), /do not assume a CLI version/);
  assert.match(skill('bbva-cells'), /do not assume a fixed CLI version/);
  for (const name of ['bbva-apx', 'bbva-apx-testing', 'bbva-cells', 'bbva-cells-testing']) assert.doesNotMatch(skill(name), /1\.22\.0|4\.9\.3|0\.80|pulso_delivery|PULSO_TASK_ID/);
});

test('BBVA integrity still rejects edited bytes and missing or unexpected files', t => {
  const root = temporary(t);
  fs.cpSync(path.join(coreRoot, 'skills'), path.join(root, 'skills'), {recursive: true});
  verifyBBVA(root);
  const file = path.join(root, 'skills/bbva-apx/SKILL.md'), original = fs.readFileSync(file);
  fs.appendFileSync(file, '\nUnreviewed change.\n');
  assert.throws(() => verifyBBVA(root), /BBVA bytes changed/);
  fs.writeFileSync(file, original);
  fs.unlinkSync(file);
  assert.throws(() => verifyBBVA(root), /BBVA file inventory changed/);
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(root, 'skills/bbva-apx/unexpected.md'), 'extra');
  assert.throws(() => verifyBBVA(root), /BBVA file inventory changed/);
});

for (const target of ['opencode', 'vscode']) test(`${target}: all five packaged BBVA skills equal the enriched canonical bytes`, async t => {
  const output = temporary(t);
  await build(target, {outputRoot: output});
  verifyPackage(target, output);
  for (const file of Object.keys(integrity)) {
    const source = fs.readFileSync(path.join(coreRoot, 'skills', file));
    const destination = path.join(output, target === 'vscode' ? 'resources/skills' : 'skills', file);
    assert.deepEqual(fs.readFileSync(destination), source, file);
  }
});
