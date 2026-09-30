import { test } from "bun:test";
import { strict as assert } from "node:assert";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertFixtureAfterTurn,
  assertFixtureBaseline,
  assertFixtureBeforeTurn,
  assertFixtureFinalScope,
  captureFixtureSnapshot,
  compareFixtureSnapshots,
} from "./fixture-scope";

const installerPaths = [
  ".opencode/.pulso-manifest.json",
  ".opencode/opencode.json",
  ".opencode/plugins/pulso-protocol-guard.js",
];
async function fixture<T>(work: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "pulso-oc02-1-scope-"));
  try {
    for (const [path, text] of Object.entries({
      "src/total.ts":
        "export const total = (values: number[]) => values.reduce((a, b) => a + b, 0);\n",
      "tests/total.test.ts": "// original tests\n",
      "src/auth.ts": "// immutable authorization fixture\n",
      "README.md": "fixture\n",
      ".gitignore": "ignored.txt\n",
      ".opencode/.pulso-manifest.json": '{"files":{}}\n',
      ".opencode/opencode.json":
        '{"plugin":["./plugins/pulso-protocol-guard.js"]}\n',
      ".opencode/plugins/pulso-protocol-guard.js": "// installed bridge\n",
    })) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), text, { mode: 0o600 });
    }
    return await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
async function editProduct(root: string) {
  await writeFile(
    join(root, "src/total.ts"),
    "// new implementation NEGATIVE_AMOUNT\n",
  );
  await writeFile(
    join(root, "tests/total.test.ts"),
    "// new negative assertion NEGATIVE_AMOUNT\n",
  );
}

test("installer files are present and immutable baseline is not a permission to modify", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    assertFixtureBaseline(baseline, installerPaths);
    assert(Object.isFrozen(baseline) && Object.isFrozen(baseline.entries));
    assertFixtureBeforeTurn(1, baseline, baseline, baseline);
    const scope = assertFixtureAfterTurn(
      1,
      baseline,
      baseline,
      await captureFixtureSnapshot(root),
    );
    assert.deepEqual(scope.turnDelta, { added: [], removed: [], modified: [] });
  }));

test("eight-turn filesystem sequence accepts turn-5 changes retained through turn 8", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    let last = baseline;
    for (let turn = 1; turn <= 8; turn++) {
      const before = await captureFixtureSnapshot(root);
      assertFixtureBeforeTurn(turn, baseline, last, before);
      if (turn === 5) await editProduct(root);
      const after = await captureFixtureSnapshot(root);
      const scope = assertFixtureAfterTurn(turn, baseline, before, after);
      if (turn >= 6) {
        assert.deepEqual(scope.turnDelta.modified, []);
        assert.deepEqual(scope.cumulativeDelta.modified, [
          "src/total.ts",
          "tests/total.test.ts",
        ]);
      }
      last = after;
    }
    assert.deepEqual(assertFixtureFinalScope(baseline, last).modified, [
      "src/total.ts",
      "tests/total.test.ts",
    ]);
  }));

for (const path of installerPaths)
  test(`rejects mutation of ${path}`, async () =>
    fixture(async (root) => {
      const baseline = await captureFixtureSnapshot(root);
      await writeFile(join(root, path), "changed after installer completed\n");
      const snapshot = await captureFixtureSnapshot(root);
      assert.throws(
        () => assertFixtureAfterTurn(1, baseline, baseline, snapshot),
        /UNAUTHORIZED_CUMULATIVE_SCOPE/,
      );
    }));

// Remaining cases run against real filesystem snapshots, without OpenCode or an LLM.
test("manifest cannot authorize an unrelated file after preflight", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await writeFile(join(root, "foreign.txt"), "out of scope\n");
    await writeFile(
      join(root, ".opencode/.pulso-manifest.json"),
      JSON.stringify({ files: { "foreign.txt": "claimed" } }),
    );
    const after = await captureFixtureSnapshot(root);
    assert.throws(
      () => assertFixtureAfterTurn(1, baseline, baseline, after),
      /UNAUTHORIZED_CUMULATIVE_SCOPE/,
    );
  }));

test("deleting an installer output fails", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await rm(join(root, ".opencode/opencode.json"));
    const after = await captureFixtureSnapshot(root);
    assert.throws(
      () => assertFixtureAfterTurn(1, baseline, baseline, after),
      /UNAUTHORIZED_CUMULATIVE_SCOPE/,
    );
  }));

test("gitignored new files are still changes", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await writeFile(join(root, "ignored.txt"), "new file\n");
    const after = await captureFixtureSnapshot(root);
    assert(
      compareFixtureSnapshots(baseline, after).added.includes("ignored.txt"),
    );
    assert.throws(
      () => assertFixtureAfterTurn(1, baseline, baseline, after),
      /UNAUTHORIZED_CUMULATIVE_SCOPE/,
    );
  }));

for (const turn of [6, 7, 8])
  test(`new total.ts edit in read-only turn ${turn} fails`, async () =>
    fixture(async (root) => {
      const baseline = await captureFixtureSnapshot(root);
      await editProduct(root);
      const before = await captureFixtureSnapshot(root);
      await writeFile(
        join(root, "src/total.ts"),
        "// unauthorized later edit\n",
      );
      const after = await captureFixtureSnapshot(root);
      assert.throws(
        () => assertFixtureAfterTurn(turn, baseline, before, after),
        /READ_ONLY_SCOPE_CHANGED/,
      );
    }));

test("auth.ts change is never allowed", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await editProduct(root);
    const before = await captureFixtureSnapshot(root);
    await writeFile(join(root, "src/auth.ts"), "// changed policy\n");
    const after = await captureFixtureSnapshot(root);
    assert.throws(
      () => assertFixtureAfterTurn(8, baseline, before, after),
      /UNAUTHORIZED_CUMULATIVE_SCOPE/,
    );
  }));

test("out-of-band drift between turns is rejected before dispatch", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await editProduct(root);
    const lastVerified = await captureFixtureSnapshot(root);
    await writeFile(
      join(root, "src/total.ts"),
      "// changed outside the turn\n",
    );
    const before = await captureFixtureSnapshot(root);
    assert.throws(
      () => assertFixtureBeforeTurn(6, baseline, lastVerified, before),
      /FIXTURE_CHANGED_BETWEEN_TURNS/,
    );
  }));

test("turn 5 must change both existing product files", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await writeFile(
      join(root, "src/total.ts"),
      "// changed only implementation\n",
    );
    const after = await captureFixtureSnapshot(root);
    assert.throws(
      () => assertFixtureAfterTurn(5, baseline, baseline, after),
      /REQUIRED_PRODUCT_EDIT_NOT_OBSERVED/,
    );
  }));

test("symlink replacement is rejected and not traversed", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await rm(join(root, "src/total.ts"));
    await symlink("auth.ts", join(root, "src/total.ts"));
    const after = await captureFixtureSnapshot(root);
    assert.equal(after.entries["src/total.ts"]?.kind, "symlink");
    assert.throws(
      () => assertFixtureAfterTurn(5, baseline, baseline, after),
      /UNAUTHORIZED_CUMULATIVE_SCOPE/,
    );
  }));

test("turn 5 cannot change product file permissions", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await editProduct(root);
    await chmod(join(root, "src/total.ts"), 0o700);
    const after = await captureFixtureSnapshot(root);
    assert.throws(
      () => assertFixtureAfterTurn(5, baseline, baseline, after),
      /UNAUTHORIZED_CUMULATIVE_SCOPE/,
    );
  }));

test("only root .git internals are excluded", async () =>
  fixture(async (root) => {
    const baseline = await captureFixtureSnapshot(root);
    await mkdir(join(root, ".git"));
    await writeFile(join(root, ".git/index"), "synthetic index\n");
    const after = await captureFixtureSnapshot(root);
    assert.deepEqual(compareFixtureSnapshots(baseline, after), {
      added: [],
      removed: [],
      modified: [],
    });
  }));
