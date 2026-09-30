import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ExecutionService, PulsoError, WorkService } from "../src/domain";
import { SqliteStore } from "../src/persistence/sqlite-store";

test("persists through restart", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const path = join(dir, "work.db");
  const one = new SqliteStore(path);
  const service = new WorkService(one);
  const w = await service.create({
    workspaceId: "x",
    title: "t",
    objective: "o",
  });
  one.close();
  const two = new SqliteStore(path);
  expect((await new WorkService(two).snapshot(w.id)).work.title).toBe("t");
  two.close();
});

test("persists all work entities and exposes migration diagnostics", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const path = join(dir, "work.db");
  const store = new SqliteStore(path);
  const work = new WorkService(store);
  const execution = new ExecutionService(store, work, undefined, 10000);
  const created = await work.create({
    workspaceId: "workspace",
    title: "work",
    objective: "objective",
  });
  const first = await work.addItem({
    workId: created.id,
    title: "first",
    kind: "research",
    assigneeId: "executor-a",
  });
  const second = await work.addItem({
    workId: created.id,
    title: "second",
    kind: "review",
    dependencies: [first.id],
    assigneeId: "executor-a",
  });
  const attempt = await execution.start(first.id, "executor-a");
  await execution.heartbeat(attempt.executionId, attempt.leaseId);
  await execution.complete(attempt.executionId, attempt.leaseId, "result");
  await work.artifact({
    workId: created.id,
    itemId: first.id,
    type: "report",
    uri: "file:///tmp/report.txt",
  });
  const before = await work.snapshot(created.id);
  expect(before.items.find((item) => item.id === second.id)?.status).toBe(
    "ready",
  );
  expect(store.diagnostics()).toMatchObject({
    schema: true,
    migrations: true,
    foreignKeys: true,
    leaseUniqueness: true,
    eventLog: true,
  });
  store.close();
  const reopened = new SqliteStore(path);
  expect(await new WorkService(reopened).snapshot(created.id)).toEqual(before);
  reopened.close();
});

test("serializes a SQLite lease race", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const path = join(dir, "work.db");
  const initial = new SqliteStore(path);
  const setup = new WorkService(initial);
  const created = await setup.create({
    workspaceId: "workspace",
    title: "work",
    objective: "objective",
  });
  const item = await setup.addItem({
    workId: created.id,
    title: "item",
    kind: "implementation",
    assigneeId: "executor-a",
  });
  initial.close();
  const left = new SqliteStore(path);
  const right = new SqliteStore(path);
  const leftExecution = new ExecutionService(left, new WorkService(left));
  const rightExecution = new ExecutionService(right, new WorkService(right));
  const outcomes = await Promise.allSettled([
    leftExecution.start(item.id, "executor-a"),
    rightExecution.start(item.id, "executor-a"),
  ]);
  expect(
    outcomes.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    outcomes.filter((result) => result.status === "rejected"),
  ).toHaveLength(1);
  expect(
    (
      outcomes.find(
        (result) => result.status === "rejected",
      ) as PromiseRejectedResult
    ).reason,
  ).toBeInstanceOf(PulsoError);
  left.close();
  right.close();
});

test("releases the SQLite transaction queue when BEGIN IMMEDIATE fails", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const path = join(dir, "work.db");
  const store = new SqliteStore(path);
  const holder = new Database(path);
  try {
    holder.exec("PRAGMA busy_timeout = 0; BEGIN IMMEDIATE");
    await expect(store.transaction(() => undefined)).rejects.toMatchObject({
      code: "CONCURRENT_TRANSACTION",
    });
    holder.exec("COMMIT");
    await expect(
      store.transaction(() => "subsequent transaction"),
    ).resolves.toBe("subsequent transaction");
  } finally {
    try {
      holder.exec("ROLLBACK");
    } catch {
      // The holder has already committed in the successful test path.
    }
    holder.close();
    store.close();
  }
});

test("rolls back partial state and event changes", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const store = new SqliteStore(join(dir, "work.db"));
  const work = new WorkService(store);
  const created = await work.create({
    workspaceId: "workspace",
    title: "work",
    objective: "objective",
  });
  const before = await work.snapshot(created.id);
  await expect(
    store.transaction((state) => {
      state.items.push({
        id: crypto.randomUUID(),
        workId: created.id,
        title: "partial",
        kind: "other",
        status: "pending",
        dependencies: [],
        createdAt: new Date().toISOString(),
        version: 1,
      });
      throw new Error("induced rollback");
    }),
  ).rejects.toThrow("induced rollback");
  expect(await work.snapshot(created.id)).toEqual(before);
  await expect(
    store.transaction((state) => {
      state.events[0].type = "tampered";
    }),
  ).rejects.toMatchObject({ code: "EVENT_LOG_APPEND_ONLY" });
  store.close();
});

test("upgrades a schema migration record from the previous shape", () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const path = join(dir, "work.db");
  const legacy = new Database(path);
  legacy.exec(
    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES (1);",
  );
  legacy.close();
  const store = new SqliteStore(path);
  expect(store.diagnostics()).toMatchObject({ schema: true, schemaVersion: 6 });
  store.close();
});

test("upgrades a v4 database in place without losing existing Work rows", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const path = join(dir, "work.db");
  const legacy = new Database(path);
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations VALUES (4, '2026-01-01T00:00:00.000Z');
    CREATE TABLE works (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      objective TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      version INTEGER NOT NULL
    );
    INSERT INTO works VALUES (
      'legacy-work', 'workspace', 'legacy title', 'legacy objective',
      'pending', '2026-01-01T00:00:00.000Z', NULL, NULL, 1
    );
  `);
  legacy.close();
  const store = new SqliteStore(path);
  const snapshot = await new WorkService(store).snapshot("legacy-work");
  expect(snapshot.work).toMatchObject({
    id: "legacy-work",
    title: "legacy title",
    objective: "legacy objective",
  });
  expect(store.diagnostics()).toMatchObject({ schemaVersion: 6 });
  expect(await store.read()).toMatchObject({
    workGraphs: [],
    workBranches: [],
    workItemPolicies: [],
    preparationIntents: [],
  });
  store.close();
});

test("persists idempotent creation receipts atomically", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const store = new SqliteStore(join(dir, "work.db"));
  const work = new WorkService(store);
  const operation = { operationKey: "work:create:1", inputHash: "input-a" };
  const first = await work.create(
    { workspaceId: "workspace", title: "work", objective: "objective" },
    operation,
  );
  const replay = await work.create(
    { workspaceId: "workspace", title: "work", objective: "objective" },
    operation,
  );
  expect(replay.id).toBe(first.id);
  await expect(
    work.create(
      { workspaceId: "workspace", title: "different", objective: "objective" },
      { ...operation, inputHash: "input-b" },
    ),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  await expect(
    store.transaction((state) => {
      state.operationReceipts.push({
        operationKey: "rolled-back",
        inputHash: "x",
        entityKind: "work",
        entityId: first.id,
      });
      throw new Error("receipt rollback");
    }),
  ).rejects.toThrow("receipt rollback");
  expect((await store.read()).operationReceipts).toHaveLength(1);
  store.close();
});

test("rolls back a failed idempotent Work creation with its receipt", async () => {
  const dir = join(tmpdir(), `pulso-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const store = new SqliteStore(join(dir, "work.db"));
  const work = new WorkService(store);
  await expect(
    work.create(
      {
        workspaceId: "workspace",
        title: "invalid work",
        objective: "objective",
        items: [
          {
            title: "invalid item",
            kind: "task",
            dependencies: ["missing-item"],
          },
        ],
      },
      { operationKey: "work:invalid", inputHash: "input" },
    ),
  ).rejects.toMatchObject({ code: "ITEM_NOT_FOUND" });
  expect(await store.read()).toMatchObject({
    works: [],
    items: [],
    operationReceipts: [],
    workGraphs: [],
    workBranches: [],
    workItemPolicies: [],
    preparationIntents: [],
  });
  store.close();
});
