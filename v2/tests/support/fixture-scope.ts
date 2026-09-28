import { createHash } from "node:crypto";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { isAbsolute, join, posix, resolve } from "node:path";

/** Test-harness snapshots. This is not a runtime permission system. */
export type FixtureEntry = Readonly<
  | { kind: "file"; mode: number; sha256: string; bytes: number }
  | { kind: "directory"; mode: number }
  | { kind: "symlink"; target: string }
>;
export type FixtureSnapshot = Readonly<{
  digest: string;
  entries: Readonly<Record<string, FixtureEntry>>;
}>;
export type FixtureDelta = Readonly<{
  added: readonly string[];
  removed: readonly string[];
  modified: readonly string[];
}>;
export type FixtureTurnScope = Readonly<{
  turn: number;
  baselineDigest: string;
  beforeDigest: string;
  afterDigest: string;
  turnDelta: FixtureDelta;
  cumulativeDelta: FixtureDelta;
}>;

const productPaths = ["src/total.ts", "tests/total.test.ts"] as const;
const writableProductPaths: ReadonlySet<string> = new Set(productPaths);
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const fail = (code: string, paths: readonly string[] = []): never => {
  throw new Error(
    `SMOKE_ASSERTION_FAILED:${code}${paths.length ? `:${paths.join(",")}` : ""}`,
  );
};
const validateTurn = (turn: number) => {
  if (!Number.isInteger(turn) || turn < 1 || turn > 8)
    fail("FIXTURE_SCOPE_INVALID_TURN");
};
const allChanged = (delta: FixtureDelta) =>
  [...delta.added, ...delta.removed, ...delta.modified].sort();

/** Hashes include ignored/untracked files, not only what git diff reports.
 * Only top-level .git is excluded. Symlinks are recorded, never traversed.
 * mtime is deliberately not an invariant: reading files may change access times.
 */
export async function captureFixtureSnapshot(
  workspace: string,
): Promise<FixtureSnapshot> {
  if (!isAbsolute(workspace)) fail("FIXTURE_SCOPE_WORKSPACE_NOT_ABSOLUTE");
  const root = resolve(workspace);
  if (!(await lstat(root)).isDirectory())
    fail("FIXTURE_SCOPE_WORKSPACE_NOT_DIRECTORY");
  const entries: Record<string, FixtureEntry> = Object.create(null);
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      if (prefix === "" && name === ".git") continue;
      const relativePath = prefix ? posix.join(prefix, name) : name;
      const fullPath = join(directory, name);
      const info = await lstat(fullPath);
      if (info.isSymbolicLink()) {
        entries[relativePath] = Object.freeze({
          kind: "symlink",
          target: await readlink(fullPath),
        });
      } else if (info.isDirectory()) {
        entries[relativePath] = Object.freeze({
          kind: "directory",
          mode: info.mode & 0o777,
        });
        await walk(fullPath, relativePath);
      } else if (info.isFile()) {
        const bytes = await readFile(fullPath);
        entries[relativePath] = Object.freeze({
          kind: "file",
          mode: info.mode & 0o777,
          sha256: hash(bytes),
          bytes: bytes.byteLength,
        });
      } else {
        fail("FIXTURE_SCOPE_UNSUPPORTED_ENTRY", [relativePath]);
      }
    }
  };
  await walk(root, "");
  return Object.freeze({
    digest: hash(JSON.stringify(entries)),
    entries: Object.freeze(entries),
  });
}

export function compareFixtureSnapshots(
  before: FixtureSnapshot,
  after: FixtureSnapshot,
): FixtureDelta {
  const added: string[] = [],
    removed: string[] = [],
    modified: string[] = [];
  const paths = [
    ...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)]),
  ].sort();
  for (const path of paths) {
    const left = before.entries[path],
      right = after.entries[path];
    if (!left) added.push(path);
    else if (!right) removed.push(path);
    else if (JSON.stringify(left) !== JSON.stringify(right))
      modified.push(path);
  }
  return Object.freeze({
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    modified: Object.freeze(modified),
  });
}

/** Confirms existence before freezing; caller verifies installer manifest hashes
 * against raw files before this point. No later manifest may grant new paths.
 */
export function assertFixtureBaseline(
  snapshot: FixtureSnapshot,
  requiredInstallerPaths: readonly string[],
): void {
  if (requiredInstallerPaths.length === 0)
    fail("FIXTURE_SCOPE_INSTALLER_PATHS_EMPTY");
  for (const path of requiredInstallerPaths) {
    if (path !== ".opencode" && !path.startsWith(".opencode/"))
      fail("FIXTURE_SCOPE_INSTALLER_PATH_OUTSIDE_OPENCODE", [path]);
    if (
      path.includes("\\") ||
      posix.normalize(path) !== path ||
      path.endsWith("/")
    )
      fail("FIXTURE_SCOPE_INSTALLER_PATH_NOT_CANONICAL", [path]);
    if (snapshot.entries[path]?.kind !== "file")
      fail("FIXTURE_SCOPE_INSTALLER_FILE_MISSING_OR_NOT_REGULAR", [path]);
  }
  for (const path of productPaths)
    if (snapshot.entries[path]?.kind !== "file")
      fail("FIXTURE_SCOPE_PRODUCT_FILE_MISSING", [path]);
}

function assertAllowedCumulative(
  baseline: FixtureSnapshot,
  current: FixtureSnapshot,
  allowProductChanges: boolean,
  code: string,
): FixtureDelta {
  const delta = compareFixtureSnapshots(baseline, current);
  const invalid = [...delta.added, ...delta.removed];
  for (const path of delta.modified) {
    const initial = baseline.entries[path],
      actual = current.entries[path];
    if (
      !allowProductChanges ||
      !writableProductPaths.has(path) ||
      initial?.kind !== "file" ||
      actual?.kind !== "file" ||
      initial.mode !== actual.mode
    )
      invalid.push(path);
  }
  if (invalid.length) fail(code, invalid.sort());
  return delta;
}

/** Call before dispatch: changes between turns must not get a free pass. */
export function assertFixtureBeforeTurn(
  turn: number,
  baseline: FixtureSnapshot,
  lastVerified: FixtureSnapshot,
  before: FixtureSnapshot,
): void {
  validateTurn(turn);
  const drift = allChanged(compareFixtureSnapshots(lastVerified, before));
  if (drift.length) fail(`TURN_${turn}_FIXTURE_CHANGED_BETWEEN_TURNS`, drift);
  assertAllowedCumulative(
    baseline,
    before,
    turn > 5,
    `TURN_${turn}_INVALID_PRE_DISPATCH_SCOPE`,
  );
}

/** Only turn 5 can edit the two existing product files. Installation artifacts
 * and every other entry are immutable. Historical edits are not new edits.
 */
export function assertFixtureAfterTurn(
  turn: number,
  baseline: FixtureSnapshot,
  before: FixtureSnapshot,
  after: FixtureSnapshot,
): FixtureTurnScope {
  validateTurn(turn);
  const cumulativeDelta = assertAllowedCumulative(
    baseline,
    after,
    turn >= 5,
    `TURN_${turn}_UNAUTHORIZED_CUMULATIVE_SCOPE`,
  );
  const turnDelta = compareFixtureSnapshots(before, after);
  if (turn !== 5) {
    const changes = allChanged(turnDelta);
    if (changes.length) fail(`TURN_${turn}_READ_ONLY_SCOPE_CHANGED`, changes);
  } else {
    assertAllowedCumulative(
      before,
      after,
      true,
      "TURN_5_UNAUTHORIZED_INCREMENTAL_SCOPE",
    );
    for (const path of productPaths) {
      const old = before.entries[path],
        current = after.entries[path];
      if (
        old?.kind !== "file" ||
        current?.kind !== "file" ||
        old.sha256 === current.sha256
      )
        fail("TURN_5_REQUIRED_PRODUCT_EDIT_NOT_OBSERVED", [path]);
    }
  }
  return Object.freeze({
    turn,
    baselineDigest: baseline.digest,
    beforeDigest: before.digest,
    afterDigest: after.digest,
    turnDelta,
    cumulativeDelta,
  });
}

export function assertFixtureFinalScope(
  baseline: FixtureSnapshot,
  current: FixtureSnapshot,
): FixtureDelta {
  const delta = assertAllowedCumulative(
    baseline,
    current,
    true,
    "LIVE_FIXTURE_FINAL_SCOPE_CHANGED",
  );
  for (const path of productPaths) {
    const old = baseline.entries[path],
      actual = current.entries[path];
    if (
      old?.kind !== "file" ||
      actual?.kind !== "file" ||
      old.sha256 === actual.sha256
    )
      fail("LIVE_FIXTURE_REQUIRED_PRODUCT_CHANGE_MISSING", [path]);
  }
  return delta;
}
