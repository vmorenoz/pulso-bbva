import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootstrapWorkingSystem as bootstrap } from "../../packages/working-system/src";

test("complete workflow survives restart and rejects zombie", async () => {
  const dir = mkdtempSync(`${tmpdir()}/pulso-`);
  const clock = {
    d: new Date("2026-01-01T00:00:00Z"),
    now() {
      return this.d;
    },
  };
  const r = bootstrap(process.cwd(), { dataDir: dir, clock, leaseTtlMs: 1000 });
  const w = await r.work.create({
    workspaceId: r.workspaceId,
    title: "milestone",
    objective: "test",
  });
  const discovery = await r.work.addItem({
    workId: w.id,
    title: "discovery",
    kind: "research",
    assigneeId: "assignee-a",
  });
  const delivery = await r.work.addItem({
    workId: w.id,
    title: "delivery",
    kind: "implementation",
    dependencies: [discovery.id],
    assigneeId: "assignee-b",
  });
  const verification = await r.work.addItem({
    workId: w.id,
    title: "verification",
    kind: "validation",
    dependencies: [delivery.id],
    assigneeId: "assignee-c",
  });
  const a = await r.execution.start(discovery.id, "assignee-a");
  expect((await r.work.snapshot(w.id)).work.status).toBe("active");
  await r.execution.heartbeat(a.executionId, a.leaseId);
  await r.execution.complete(a.executionId, a.leaseId, "discovery complete");
  const old = await r.execution.start(delivery.id, "assignee-b");
  clock.d = new Date("2026-01-01T00:00:02Z");
  await r.execution.recover();
  await r.work.transition("item", delivery.id, "prepare_retry");
  const b = await r.execution.start(delivery.id, "assignee-b");
  await expect(
    r.execution.complete(old.executionId, old.leaseId),
  ).rejects.toMatchObject({ code: "LEASE_EXPIRED" });
  await r.execution.complete(b.executionId, b.leaseId, "delivery complete");
  const c = await r.execution.start(verification.id, "assignee-c");
  await r.execution.complete(c.executionId, c.leaseId, "verification complete");
  await r.work.transition("work", w.id, "complete");
  const artifact = await r.work.artifact({
    workId: w.id,
    itemId: verification.id,
    type: "report",
    uri: "file:///tmp/verification.txt",
  });
  r.close();
  const next = bootstrap(process.cwd(), { dataDir: dir, clock });
  const state = await next.work.snapshot(w.id);
  expect(state.work.status).toBe("completed");
  expect(state.items.map((i) => i.status)).toEqual([
    "completed",
    "completed",
    "completed",
  ]);
  expect(state.items.map((i) => i.dependencies)).toEqual([
    [],
    [discovery.id],
    [delivery.id],
  ]);
  expect(
    state.assignments.map((a) => [a.workItemId, a.assigneeId, a.status]),
  ).toEqual([
    [discovery.id, "assignee-a", "active"],
    [delivery.id, "assignee-b", "active"],
    [verification.id, "assignee-c", "active"],
  ]);
  expect(state.executions).toHaveLength(4);
  expect(state.executions.map((e) => e.status)).toEqual([
    "completed",
    "abandoned",
    "completed",
    "completed",
  ]);
  expect(state.leases.map((l) => l.status)).toEqual([
    "released",
    "expired",
    "released",
    "released",
  ]);
  expect(state.artifacts).toHaveLength(1);
  expect(state.artifacts[0]).toMatchObject(artifact);
  expect(state.events.length).toBeGreaterThan(10);
  expect(state.events.map((event) => event.sequence)).toEqual(
    [...state.events.keys()].map((index) => index + 1),
  );
  next.close();
});
