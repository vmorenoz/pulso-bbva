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
  expect(store.diagnostics()).toMatchObject({ schema: true, schemaVersion: 4 });
  store.close();
});
