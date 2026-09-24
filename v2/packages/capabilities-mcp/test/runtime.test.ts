import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecutionService,
  MemoryStore,
  RecoveryService,
  WorkService,
} from "../../working-system/src/domain";
import {
  type BindingRepository,
  ExecutionCoordinator,
  FakeRuntime,
  type RuntimeExecutionBinding,
  RuntimeWorkAdapter,
} from "../src/runtime";
import { SqliteBindingStore } from "../src/runtime/bindings/sqlite-binding-store";

const makeSystem = (ttlMs = 1_000) => {
  const store = new MemoryStore();
  const clock = {
    date: new Date("2026-01-01T00:00:00Z"),
    now() {
      return this.date;
    },
  };
  const work = new WorkService(store, clock);
  const execution = new ExecutionService(store, work, clock, ttlMs);
  const recovery = new RecoveryService(store, clock);
  return { store, clock, work, execution, recovery };
};

const makeAdapter = (system: ReturnType<typeof makeSystem>, path?: string) => {
  const bindings: BindingRepository = path
    ? new SqliteBindingStore(path)
    : new MemoryBindings();
  const gateway = new ExecutionCoordinator(
    system.store,
    system.work,
    system.execution,
    system.recovery,
  );
  return {
    adapter: new RuntimeWorkAdapter(bindings, gateway, system.clock),
    bindings,
  };
};

class MemoryBindings {
  private rows: RuntimeExecutionBinding[] = [];
  async reserve(input: {
    bindingId: string;
    runtime: RuntimeExecutionBinding["runtime"];
    workItemId: string;
    createdAt: string;
  }) {
    const existing = this.rows.find(
      (row) =>
        row.runtime.provider === input.runtime.provider &&
        row.runtime.executionId === input.runtime.executionId,
    );
    if (existing) return existing;
    this.rows.push({
      bindingId: input.bindingId,
      runtime: input.runtime,
      workId: "",
      workItemId: input.workItemId,
      executionId: "",
      leaseId: "",
      fencingToken: 0,
      createdAt: input.createdAt,
      expiresAt: "",
      status: "creating",
    });
    return undefined;
  }
  async finalize(binding: RuntimeExecutionBinding) {
    this.rows[
      this.rows.findIndex((row) => row.bindingId === binding.bindingId)
    ] = structuredClone(binding);
  }
  async get(id: string) {
    return this.rows.find((row) => row.bindingId === id);
  }
  async getByRuntime(runtime: RuntimeExecutionBinding["runtime"]) {
    return this.rows.find(
      (row) =>
        row.runtime.provider === runtime.provider &&
        row.runtime.executionId === runtime.executionId,
    );
  }
  async list() {
    return structuredClone(this.rows);
  }
  async updateStatus(id: string, status: RuntimeExecutionBinding["status"]) {
    const row = this.rows.find((candidate) => candidate.bindingId === id);
    if (!row) throw new Error("missing");
    row.status = status;
    return structuredClone(row);
  }
  async removePending(id: string) {
    this.rows = this.rows.filter(
      (row) => row.bindingId !== id || row.status !== "creating",
    );
  }
}

describe("runtime-work adapter", () => {
  test("bind is durable and duplicate starts are idempotent", async () => {
    const system = makeSystem();
    const created = await system.work.create({
      workspaceId: "test",
      title: "work",
      objective: "objective",
    });
    const item = await system.work.addItem({
      workId: created.id,
      title: "item",
      kind: "task",
      assigneeId: "runtime-a",
    });
    const { adapter } = makeAdapter(system);
    const reference = {
      provider: "test-runtime",
      executionId: "execution-a",
      sessionId: "session-a",
    };
    const first = await adapter.bind({
      workItemId: item.id,
      executorId: "runtime-a",
      runtimeReference: reference,
    });
    const second = await adapter.bind({
      workItemId: item.id,
      executorId: "runtime-a",
      runtimeReference: reference,
    });
    expect(second).toEqual(first);
    expect((await system.work.snapshot(created.id)).executions).toHaveLength(1);
    expect((await system.work.snapshot(created.id)).leases).toHaveLength(1);
  });

  test("concurrent starts yield one valid authority", async () => {
    const system = makeSystem();
    const work = await system.work.create({
      workspaceId: "test",
      title: "work",
      objective: "objective",
    });
    const item = await system.work.addItem({
      workId: work.id,
      title: "item",
      kind: "task",
      assigneeId: "runtime",
    });
    const shared = new MemoryBindings();
    const gateway = new ExecutionCoordinator(
      system.store,
      system.work,
      system.execution,
      system.recovery,
    );
    const left = new RuntimeWorkAdapter(shared, gateway, system.clock);
    const right = new RuntimeWorkAdapter(shared, gateway, system.clock);
    const results = await Promise.allSettled([
      left.bind({
        workItemId: item.id,
        executorId: "runtime",
        runtimeReference: {
          provider: "test-runtime",
          executionId: "concurrent",
        },
      }),
      right.bind({
        workItemId: item.id,
        executorId: "runtime",
        runtimeReference: {
          provider: "test-runtime",
          executionId: "concurrent",
        },
      }),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await system.work.snapshot(work.id)).executions).toHaveLength(1);
  });

  test("rejects a conflicting runtime execution and protects authority after disappearance", async () => {
    const system = makeSystem();
    const firstWork = await system.work.create({
      workspaceId: "test",
      title: "one",
      objective: "one",
    });
    const firstItem = await system.work.addItem({
      workId: firstWork.id,
      title: "one",
      kind: "task",
      assigneeId: "runtime-a",
    });
    const secondWork = await system.work.create({
      workspaceId: "test",
      title: "two",
      objective: "two",
    });
    const secondItem = await system.work.addItem({
      workId: secondWork.id,
      title: "two",
      kind: "task",
      assigneeId: "runtime-a",
    });
    const { adapter } = makeAdapter(system);
    const reference = { provider: "test-runtime", executionId: "shared" };
    const binding = await adapter.bind({
      workItemId: firstItem.id,
      executorId: "runtime-a",
      runtimeReference: reference,
    });
    await expect(
      adapter.bind({
        workItemId: secondItem.id,
        executorId: "runtime-a",
        runtimeReference: reference,
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_EXECUTION_CONFLICT" });
    system.clock.date = new Date("2026-01-01T00:00:02Z");
    const changed = await adapter.reconcile();
    expect(changed[0].status).toBe("lost");
    expect((await system.work.snapshot(firstWork.id)).items[0].status).toBe(
      "recovery_required",
    );
    await expect(adapter.complete(binding.bindingId)).rejects.toMatchObject({
      code: "BINDING_NOT_ACTIVE",
    });
    await system.work.transition("item", firstItem.id, "prepare_retry");
    const retry = await adapter.bind({
      workItemId: firstItem.id,
      executorId: "runtime-a",
      runtimeReference: { provider: "test-runtime", executionId: "retry" },
    });
    await adapter.complete(retry.bindingId, "ok");
    expect((await system.work.snapshot(firstWork.id)).items[0].status).toBe(
      "completed",
    );
  });

  test("heartbeats renew leases and terminal lifecycle operations are idempotent", async () => {
    const system = makeSystem();
    const work = await system.work.create({
      workspaceId: "test",
      title: "work",
      objective: "objective",
    });
    const item = await system.work.addItem({
      workId: work.id,
      title: "item",
      kind: "task",
      assigneeId: "runtime",
    });
    const { adapter } = makeAdapter(system);
    const binding = await adapter.bind({
      workItemId: item.id,
      executorId: "runtime",
      runtimeReference: { provider: "test-runtime", executionId: "complete" },
    });
    const before = binding.expiresAt;
    system.clock.date = new Date("2026-01-01T00:00:00.500Z");
    const renewed = await adapter.heartbeat(binding.bindingId);
    expect(renewed.expiresAt).not.toBe(before);
    const completed = await adapter.complete(binding.bindingId, "done");
    expect(await adapter.complete(binding.bindingId, "done")).toEqual(
      completed,
    );
    expect((await system.work.snapshot(work.id)).leases[0].status).toBe(
      "released",
    );
  });

  test("fail and explicit cancel are distinct Work outcomes", async () => {
    const system = makeSystem();
    const work = await system.work.create({
      workspaceId: "test",
      title: "work",
      objective: "objective",
    });
    const failedItem = await system.work.addItem({
      workId: work.id,
      title: "failed",
      kind: "task",
      assigneeId: "runtime",
    });
    const cancelledItem = await system.work.addItem({
      workId: work.id,
      title: "cancelled",
      kind: "task",
      assigneeId: "runtime",
    });
    const { adapter } = makeAdapter(system);
    const failed = await adapter.bind({
      workItemId: failedItem.id,
      executorId: "runtime",
      runtimeReference: { provider: "test-runtime", executionId: "failed" },
    });
    await adapter.fail(failed.bindingId, "external failure");
    const cancelled = await adapter.bind({
      workItemId: cancelledItem.id,
      executorId: "runtime",
      runtimeReference: { provider: "test-runtime", executionId: "cancelled" },
    });
    await adapter.cancel(cancelled.bindingId, "user requested");
    const snapshot = await system.work.snapshot(work.id);
    expect(
      snapshot.items.find((item) => item.id === failedItem.id)?.status,
    ).toBe("failed");
    expect(
      snapshot.items.find((item) => item.id === cancelledItem.id)?.status,
    ).toBe("cancelled");
  });

  test("binding survives adapter restart and reconciliation is repeatable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pulso-runtime-"));
    try {
      const system = makeSystem();
      const work = await system.work.create({
        workspaceId: "test",
        title: "work",
        objective: "objective",
      });
      const item = await system.work.addItem({
        workId: work.id,
        title: "item",
        kind: "task",
        assigneeId: "runtime",
      });
      const first = makeAdapter(system, join(dir, "bindings.db"));
      const binding = await first.adapter.bind({
        workItemId: item.id,
        executorId: "runtime",
        runtimeReference: { provider: "test-runtime", executionId: "restart" },
      });
      if (first.bindings instanceof SqliteBindingStore) first.bindings.close();
      const second = makeAdapter(system, join(dir, "bindings.db"));
      expect(await second.adapter.get(binding.bindingId)).toEqual(binding);
      expect(await second.adapter.reconcile()).toEqual([]);
      expect(await second.adapter.reconcile()).toEqual([]);
      if (second.bindings instanceof SqliteBindingStore)
        second.bindings.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fake runtime exposes explicit lifecycle without host APIs", () => {
    const runtime = new FakeRuntime();
    const seen: string[] = [];
    runtime.onStart((reference) => seen.push(reference.executionId));
    runtime.start({ provider: "test-runtime", executionId: "x" });
    expect(seen).toEqual(["x"]);
    expect(runtime.capabilities.automaticHeartbeat).toBe(false);
  });
});
