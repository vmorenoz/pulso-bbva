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

test('consolidated BBVA guidance requires documentation and change-appropriate engineering', () => {
  verifyBBVA(coreRoot);
  const text = skill('bbva-engineering');
  assert.deepEqual(Object.keys(integrity), ['bbva-engineering/SKILL.md']);
  for (const anchor of ['knowledge_technologies', 'knowledge_read', 'CELLS', 'APX', 'ASO', 'Do not weaken assertions', 'end-to-end', 'bubbling/composition', 'subscriptions', 'accessibility', 'restart after partial failure', 'idempotency', 'partial output', 'synthetic data']) assert.ok(text.includes(anchor), anchor);
  assert.doesNotMatch(text, /bbva-(apx|cells)|SpringJUnit4ClassRunner|JobLauncherTestUtils|1\.22\.0|4\.9\.3|pulso_delivery|PULSO_TASK_ID/);
});

test('BBVA integrity still rejects edited bytes and missing or unexpected files', t => {
  const root = temporary(t);
  fs.cpSync(path.join(coreRoot, 'skills'), path.join(root, 'skills'), {recursive: true});
  verifyBBVA(root);
  const file = path.join(root, 'skills/bbva-engineering/SKILL.md'), original = fs.readFileSync(file);
  fs.appendFileSync(file, '\nUnreviewed change.\n');
  assert.throws(() => verifyBBVA(root), /BBVA bytes changed/);
  fs.writeFileSync(file, original);
  fs.unlinkSync(file);
  assert.throws(() => verifyBBVA(root), /BBVA file inventory changed/);
  fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(root, 'skills/bbva-engineering/unexpected.md'), 'extra');
  assert.throws(() => verifyBBVA(root), /BBVA file inventory changed/);
});

for (const target of ['opencode', 'vscode']) test(`${target}: only consolidated BBVA skill is packaged with canonical bytes`, async t => {
  const output = temporary(t);
  await build(target, {outputRoot: output});
  verifyPackage(target, output);
  const skillsRoot = path.join(output, target === 'vscode' ? 'resources/skills' : 'skills');
  assert.deepEqual(fs.readdirSync(skillsRoot).filter(name => name.startsWith('bbva-')), ['bbva-engineering']);
  if (target === 'opencode') for (const file of fs.readdirSync(path.join(output, 'agents'))) {
    const agent = fs.readFileSync(path.join(output, 'agents', file), 'utf8');
    assert.doesNotMatch(agent, /bbva-(apx|cells)/);
    if (file !== 'pulso.md') assert.match(agent, /"bbva-engineering":"allow"/);
  }
  for (const file of Object.keys(integrity)) {
    const source = fs.readFileSync(path.join(coreRoot, 'skills', file));
    const destination = path.join(output, target === 'vscode' ? 'resources/skills' : 'skills', file);
    assert.deepEqual(fs.readFileSync(destination), source, file);
  }
});
