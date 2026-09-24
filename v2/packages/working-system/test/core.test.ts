import { describe, expect, test } from "bun:test";
import { ExecutionService, MemoryStore, WorkService } from "../src";

const clock = {
  d: new Date("2026-01-01T00:00:00Z"),
  now() {
    return this.d;
  },
};
describe("work machine", () => {
  test("DAG, recovery and fencing", async () => {
    const store = new MemoryStore();
    const work = new WorkService(store, clock);
    const execution = new ExecutionService(store, work, clock, 1000);
    const w = await work.create({
      workspaceId: "x",
      title: "x",
      objective: "x",
    });
    const a = await work.addItem({
      workId: w.id,
      title: "a",
      kind: "research",
      assigneeId: "assignee-a",
    });
    const b = await work.addItem({
      workId: w.id,
      title: "b",
      kind: "implementation",
      dependencies: [a.id],
      assigneeId: "assignee-b",
    });
    expect(
      (await work.snapshot(w.id)).items.find((i) => i.id === a.id)?.status,
    ).toBe("ready");
    const ea = await execution.start(a.id, "assignee-a");
    await execution.complete(ea.executionId, ea.leaseId);
    expect(
      (await work.snapshot(w.id)).items.find((i) => i.id === b.id)?.status,
    ).toBe("ready");
    const old = await execution.start(b.id, "assignee-b");
    clock.d = new Date("2026-01-01T00:00:02Z");
    expect(await execution.recover()).toBe(1);
    await work.transition("item", b.id, "prepare_retry");
    const fresh = await execution.start(b.id, "assignee-b");
    await expect(
      execution.complete(old.executionId, old.leaseId),
    ).rejects.toMatchObject({ code: "LEASE_EXPIRED" });
    await execution.complete(fresh.executionId, fresh.leaseId, "ok");
  });
  test("rejects cross-work dependency", async () => {
    const s = new MemoryStore();
    const w = new WorkService(s, clock);
    const a = await w.create({ workspaceId: "x", title: "a", objective: "a" });
    const b = await w.create({ workspaceId: "x", title: "b", objective: "b" });
    const i = await w.addItem({ workId: a.id, title: "i", kind: "other" });
    await expect(
      w.addItem({
        workId: b.id,
        title: "j",
        kind: "other",
        dependencies: [i.id],
      }),
    ).rejects.toMatchObject({ code: "CROSS_WORK_DEPENDENCY" });
  });
  test("requires the current fencing token and completed items before work completion", async () => {
    const store = new MemoryStore();
    const work = new WorkService(store, clock);
    const execution = new ExecutionService(store, work, clock, 1000);
    const created = await work.create({
      workspaceId: "x",
      title: "x",
      objective: "x",
    });
    const item = await work.addItem({
      workId: created.id,
      title: "item",
      kind: "other",
      assigneeId: "assignee-a",
    });
    await work.transition("work", created.id, "start");
    await expect(
      work.transition("work", created.id, "complete"),
    ).rejects.toMatchObject({
      code: "WORK_ITEMS_INCOMPLETE",
    });
    const attempt = await execution.start(item.id, "assignee-a");
    await expect(
      execution.complete(
        attempt.executionId,
        attempt.leaseId,
        undefined,
        attempt.fencingToken + 1,
      ),
    ).rejects.toMatchObject({ code: "STALE_FENCING_TOKEN" });
    await expect(work.assign(item.id, "B", true)).rejects.toMatchObject({
      code: "ACTIVE_LEASE_EXISTS",
    });
    await execution.complete(
      attempt.executionId,
      attempt.leaseId,
      undefined,
      attempt.fencingToken,
    );
    await work.transition("work", created.id, "complete");
  });
  test("rejects an in-progress item without execution authority", async () => {
    const store = new MemoryStore();
    const work = new WorkService(store, clock);
    const created = await work.create({
      workspaceId: "x",
      title: "x",
      objective: "x",
    });
    const item = await work.addItem({
      workId: created.id,
      title: "item",
      kind: "other",
    });
    await expect(
      store.transaction((state) => {
        const persisted = state.items.find(
          (candidate) => candidate.id === item.id,
        );
        if (persisted) persisted.status = "in_progress";
      }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  test("revokes authority and records recovery history", async () => {
    const store = new MemoryStore();
    const work = new WorkService(store, clock);
    const execution = new ExecutionService(store, work, clock, 1000);
    const created = await work.create({
      workspaceId: "x",
      title: "x",
      objective: "x",
    });
    const item = await work.addItem({
      workId: created.id,
      title: "item",
      kind: "other",
      assigneeId: "assignee-a",
    });
    const attempt = await execution.start(item.id, "assignee-a");
    await execution.revokeLease({
      leaseId: attempt.leaseId,
      reason: "operator stop",
      actor: "operator",
    });
    await expect(
      execution.heartbeat(attempt.executionId, attempt.leaseId),
    ).rejects.toMatchObject({ code: "LEASE_REVOKED" });
    await expect(
      execution.complete(attempt.executionId, attempt.leaseId),
    ).rejects.toMatchObject({ code: "LEASE_REVOKED" });
    const state = await work.snapshot(created.id);
    expect(state.items[0].status).toBe("recovery_required");
    expect(state.events.map((event) => event.type)).toContain("lease.revoked");
  });
  test("blocks, waits and resumes through new execution authority", async () => {
    const store = new MemoryStore();
    const work = new WorkService(store, clock);
    const execution = new ExecutionService(store, work, clock, 1000);
    const created = await work.create({
      workspaceId: "x",
      title: "x",
      objective: "x",
    });
    const item = await work.addItem({
      workId: created.id,
      title: "item",
      kind: "other",
      assigneeId: "assignee-a",
    });
    const blocked = await execution.start(item.id, "assignee-a");
    await execution.suspend(blocked.executionId, blocked.leaseId, "blocked");
    expect((await work.snapshot(created.id)).items[0].status).toBe("blocked");
    await work.transition("item", item.id, "resume");
    const waiting = await execution.start(item.id, "assignee-a");
    await execution.suspend(waiting.executionId, waiting.leaseId, "waiting");
    expect((await work.snapshot(created.id)).items[0].status).toBe("waiting");
    await work.transition("item", item.id, "resume");
    const resumed = await execution.start(item.id, "assignee-a");
    await execution.complete(resumed.executionId, resumed.leaseId);
    expect((await work.snapshot(created.id)).items[0].status).toBe("completed");
  });
});
