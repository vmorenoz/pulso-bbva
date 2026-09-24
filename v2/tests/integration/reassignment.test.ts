import { expect, test } from "bun:test";
import {
  ExecutionService,
  MemoryStore,
  WorkService,
} from "../../packages/working-system/src";

test("reassignment preserves attempts and fences the old owner", async () => {
  const clock = {
    d: new Date("2026-01-01T00:00:00Z"),
    now() {
      return this.d;
    },
  };
  const store = new MemoryStore();
  const work = new WorkService(store, clock);
  const execution = new ExecutionService(store, work, clock, 10);
  const w = await work.create({ workspaceId: "w", title: "t", objective: "o" });
  const item = await work.addItem({
    workId: w.id,
    title: "implement",
    kind: "implementation",
    assigneeId: "assignee-a",
  });
  const old = await execution.start(item.id, "assignee-a");
  clock.d = new Date("2026-01-01T00:00:01Z");
  await execution.recover();
  await work.assign(item.id, "assignee-b", true);
  await work.transition("item", item.id, "prepare_retry");
  const fresh = await execution.start(item.id, "assignee-b");
  await expect(
    execution.complete(old.executionId, old.leaseId),
  ).rejects.toMatchObject({ code: "LEASE_EXPIRED" });
  await execution.complete(fresh.executionId, fresh.leaseId);
  const state = await work.snapshot(w.id);
  expect(state.assignments.map((a) => a.assigneeId)).toEqual([
    "assignee-a",
    "assignee-b",
  ]);
  expect(state.executions.map((e) => e.executorId)).toEqual([
    "assignee-a",
    "assignee-b",
  ]);
});
