import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeReceiptHash } from "../../packages/capabilities-mcp/src/opencode/native-journal";
import {
  consolidateNativeCalls,
  sanitizeEvidence,
  validateAttemptAuthority,
  validateNativeDispatchIdentity,
} from "./native-evidence";
import { readNativeState } from "./read-native-state";
import { SmokeArtifactArchive } from "./smoke-artifacts";

const root = () => mkdtempSync(join(tmpdir(), "pulso-evidence-readonly-"));

test("joins persisted authority by exact binding execution and lease IDs, read-only", () => {
  const directory = root();
  const workPath = join(directory, "work.db");
  const runtimePath = join(directory, "runtime.db");
  const work = new Database(workPath);
  const runtime = new Database(runtimePath);
  try {
    work.exec(`
      CREATE TABLE works(id TEXT PRIMARY KEY, workspace_id TEXT, status TEXT);
      CREATE TABLE work_items(id TEXT PRIMARY KEY, work_id TEXT, status TEXT);
      CREATE TABLE work_executions(id TEXT PRIMARY KEY, work_item_id TEXT, external_execution_ref TEXT, status TEXT);
      CREATE TABLE work_leases(id TEXT PRIMARY KEY, execution_id TEXT, fencing_token INTEGER, status TEXT);
      INSERT INTO works VALUES ('work-a','workspace','active');
      INSERT INTO work_items VALUES ('item-a','work-a','completed');
      INSERT INTO work_executions VALUES ('historical','item-a','{"provider":"opencode","id":"old-delegation"}','failed');
      INSERT INTO work_executions VALUES ('execution-a','item-a','{"provider":"opencode","id":"delegation-a"}','completed');
      INSERT INTO work_leases VALUES ('lease-a','execution-a',17,'released');
    `);
    const result = {
      protocol: "pulso-result/2",
      delegationId: "delegation-a",
      specialist: "explorer",
      workId: "work-a",
      workItemId: "item-a",
      status: "completed",
      summary: "Observed fixture result.",
      specialistResult: { kind: "explorer", findings: [] },
    };
    const resultHash = nativeReceiptHash(result);
    const receipt = {
      protocol: "pulso-receipt/1",
      accepted: true,
      delegationId: "delegation-a",
      resultHash,
      receiptHash: resultHash,
      result,
      state: {
        delegation: { sideEffectsMayContinue: false },
        authority: {
          workspaceId: "workspace",
          parentSessionId: "parent",
          parentCallId: "call-a",
          childSessionId: "child-a",
          workId: "work-a",
          workItemId: "item-a",
          workItemStatus: "completed",
          bindingId: "binding-a",
          bindingStatus: "completed",
          executionId: "execution-a",
          executionStatus: "completed",
          leaseId: "lease-a",
          leaseStatus: "released",
          fencingToken: 17,
        },
      },
    };
    runtime.exec(`
      CREATE TABLE native_delegations(
        delegation_id TEXT, workspace_id TEXT, parent_session_id TEXT, parent_call_id TEXT,
        work_id TEXT, work_item_id TEXT, specialist TEXT, transport_phase TEXT,
        receipt_phase TEXT, receipt_hash TEXT, binding_id TEXT, child_session_id TEXT, receipt_json TEXT, error_json TEXT
      );
      CREATE TABLE runtime_bindings(
        binding_id TEXT, runtime_execution_id TEXT, runtime_provider TEXT, runtime_session_id TEXT,
        work_id TEXT, work_item_id TEXT, managed_by TEXT, execution_id TEXT, lease_id TEXT, fencing_token INTEGER, status TEXT
      );
      CREATE TABLE native_current_work(workspace_id TEXT, parent_session_id TEXT, work_id TEXT);
      CREATE TABLE native_session_works(workspace_id TEXT, parent_session_id TEXT, work_id TEXT, associated_at TEXT);
    `);
    runtime
      .query(`INSERT INTO native_delegations VALUES
      ('delegation-a','workspace','parent','call-a','work-a','item-a','explorer','closed','applied',?,'binding-a','child-a',?,NULL)`)
      .run(resultHash, JSON.stringify(receipt));
    runtime.exec(`
      INSERT INTO runtime_bindings VALUES
        ('binding-a','delegation-a','opencode','parent','work-a','item-a','opencode-native','execution-a','lease-a',17,'completed');
      INSERT INTO native_current_work VALUES ('workspace','parent','work-a');
      INSERT INTO native_session_works VALUES ('workspace','parent','work-a','now');
    `);
    work.close();
    runtime.close();
    const before = [workPath, runtimePath].map((path) => {
      const db = new Database(path, { readonly: true });
      const count = db
        .query("SELECT COUNT(*) AS count FROM sqlite_master")
        .get() as { count: number };
      db.close();
      return count.count;
    });
    const snapshot = readNativeState({
      workDbPath: workPath,
      runtimeDbPath: runtimePath,
      workspaceId: "workspace",
      parentSessionId: "parent",
      parentCallId: "call-a",
    });
    expect(snapshot.calls[0]?.attempt?.authority).toEqual({
      executionId: "execution-a",
      executionStatus: "completed",
      leaseId: "lease-a",
      leaseStatus: "released",
      fencingToken: 17,
    });
    expect(snapshot.calls[0]?.attempt?.accepted).toBe(true);
    expect(snapshot.sessionWorkIds).toEqual(["work-a"]);
    const after = [workPath, runtimePath].map((path) => {
      const db = new Database(path, { readonly: true });
      const count = db
        .query("SELECT COUNT(*) AS count FROM sqlite_master")
        .get() as { count: number };
      db.close();
      return count.count;
    });
    expect(after).toEqual(before);
  } finally {
    try {
      work.close();
    } catch {}
    try {
      runtime.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

test("reports exact authority join mismatches rather than choosing another Execution", () => {
  const directory = root();
  const workPath = join(directory, "work.db");
  const runtimePath = join(directory, "runtime.db");
  const work = new Database(workPath);
  const runtime = new Database(runtimePath);
  try {
    work.exec(`CREATE TABLE works(id TEXT, workspace_id TEXT, status TEXT);
      CREATE TABLE work_items(id TEXT, work_id TEXT, status TEXT);
      CREATE TABLE work_executions(id TEXT, work_item_id TEXT, external_execution_ref TEXT, status TEXT);
      CREATE TABLE work_leases(id TEXT, execution_id TEXT, fencing_token INTEGER, status TEXT);
      INSERT INTO works VALUES('w','ws','active'); INSERT INTO work_items VALUES('i','w','active');
      INSERT INTO work_executions VALUES('e-wrong','i','{"provider":"opencode","id":"other"}','completed');
      INSERT INTO work_leases VALUES('l','e-wrong',1,'released');`);
    runtime.exec(`CREATE TABLE native_delegations(delegation_id TEXT,workspace_id TEXT,parent_session_id TEXT,parent_call_id TEXT,work_id TEXT,work_item_id TEXT,specialist TEXT,transport_phase TEXT,receipt_phase TEXT,binding_id TEXT,child_session_id TEXT,receipt_json TEXT,error_json TEXT);
      CREATE TABLE runtime_bindings(binding_id TEXT,runtime_execution_id TEXT,runtime_provider TEXT,runtime_session_id TEXT,work_id TEXT,work_item_id TEXT,managed_by TEXT,execution_id TEXT,lease_id TEXT,fencing_token INTEGER,status TEXT);
      CREATE TABLE native_current_work(workspace_id TEXT,parent_session_id TEXT,work_id TEXT);
      CREATE TABLE native_session_works(workspace_id TEXT,parent_session_id TEXT,work_id TEXT,associated_at TEXT);
      INSERT INTO native_delegations VALUES('d','ws','p','c','w','i','explorer','closed','applied','b','child','{}',NULL);
      INSERT INTO runtime_bindings VALUES('b','d','opencode','p','w','i','opencode-native','e-missing','l',1,'completed');`);
    work.close();
    runtime.close();
    expect(() =>
      readNativeState({
        workDbPath: workPath,
        runtimeDbPath: runtimePath,
        workspaceId: "ws",
        parentSessionId: "p",
        parentCallId: "c",
      }),
    ).toThrow("execution:e-missing:observed=0");
  } finally {
    try {
      work.close();
    } catch {}
    try {
      runtime.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});

test("merges repeated status observations by callID without losing later full evidence", () => {
  const calls = consolidateNativeCalls([
    {
      turn: 1,
      parentSessionId: "p",
      parentCallId: "c",
      stage: "dispatched",
      attempts: [],
    },
    {
      turn: 1,
      parentSessionId: "p",
      parentCallId: "c",
      stage: "dispatched",
      delegationId: "d",
      attempts: [],
    },
  ]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ delegationId: "d", parentCallId: "c" });
});

test("allows six authorized calls and rejects reuse of one delegation under another callID", () => {
  const calls = [
    "explorer",
    "explorer",
    "planner",
    "executor",
    "verifier",
    "security-auditor",
  ].map((specialist, index) => ({
    turn: index + 1,
    parentSessionId: "parent",
    parentCallId: `call-${index}`,
    stage: "dispatched" as const,
    delegationId: `delegation-${index}`,
    attempts: [],
    specialist,
  }));
  expect(() => validateNativeDispatchIdentity(calls)).not.toThrow();
  expect(() =>
    validateNativeDispatchIdentity([
      ...calls,
      { ...calls[0], parentCallId: "different-call" },
    ]),
  ).toThrow("NATIVE_DELEGATION_REDISPATCHED:delegation-0");
});

test("positive acceptance requires applied receipt and terminal persisted authority", () => {
  const base = {
    workspaceId: "ws",
    parentSessionId: "p",
    parentCallId: "c",
    delegationId: "d",
    workId: "w",
    workItemId: "i",
    specialist: "explorer",
    childSessionId: "child",
    bindingId: "b",
    receiptPhase: "applied",
    accepted: true,
    authority: {
      executionId: "e",
      executionStatus: "completed",
      leaseId: "l",
      leaseStatus: "released",
      fencingToken: 9,
    },
  };
  expect(validateAttemptAuthority(base).accepted).toBe(true);
  expect(validateAttemptAuthority({ ...base, accepted: false }).reason).toBe(
    "receipt_not_applied_and_accepted",
  );
  expect(
    validateAttemptAuthority({
      ...base,
      authority: { ...base.authority, leaseStatus: "active" },
    }).reason,
  ).toBe("authority_not_terminal");
});

test("sanitizer redacts JSON-embedded secrets but retains typed authority fencing", () => {
  const sanitized = sanitizeEvidence({
    output: JSON.stringify({
      api_key: "secret",
      state: { authority: { fencingToken: 42 } },
    }),
    state: { authority: { fencingToken: 42 }, token: "oauth-secret" },
  }) as Record<string, unknown>;
  expect(JSON.stringify(sanitized)).not.toContain("oauth-secret");
  expect(JSON.stringify(sanitized)).not.toContain('"secret"');
  const state = sanitized.state as { authority: { fencingToken: number } };
  expect(state.authority.fencingToken).toBe(42);
});

test("sanitizer preserves fencing only in the typed authority projection", () => {
  const result = sanitizeEvidence({
    fencingToken: 11,
    authority: { fencingToken: 12 },
  }) as Record<string, unknown>;
  expect(result.fencingToken).toBe("[REDACTED]");
  expect((result.authority as Record<string, unknown>).fencingToken).toBe(12);
});

test("artifact archive persists sanitized data outside fixture cleanup and hashes it", async () => {
  const directory = root();
  try {
    const archive = await SmokeArtifactArchive.create(directory, "run-test");
    const path = await archive.write("turn-1/events.json", {
      authorization: "secret",
      event: "ok",
    });
    const finished = await archive.finalize({ lastVerifiedTurn: 0 });
    expect(path).toContain("run-test");
    expect(finished.archiveComplete).toBe(true);
    expect(finished.manifest.artifacts).toHaveLength(1);
    expect(JSON.stringify(finished.manifest)).not.toContain("secret");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("archive completeness is false after a capture failure", async () => {
  const directory = root();
  try {
    const archive = await SmokeArtifactArchive.create(directory, "incomplete");
    archive.markIncomplete();
    const finalized = await archive.finalize({ failedTurn: 1 });
    expect(finalized.archiveComplete).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
