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
  async reserve(input: Parameters<BindingRepository["reserve"]>[0]) {
    const existing = this.rows.find(
      (row) =>
        row.runtime.provider === input.runtime.provider &&
        row.runtime.executionId === input.runtime.executionId,
    );
    if (existing) return existing;
    const binding: RuntimeExecutionBinding = {
      ...input,
      executionId: "",
      leaseId: "",
      fencingToken: 0,
      expiresAt: "",
      status: "creating",
      version: 1,
    };
    this.rows.push(binding);
    return structuredClone(binding);
  }
  async finalize(binding: RuntimeExecutionBinding, creationToken: string) {
    const index = this.rows.findIndex(
      (row) =>
        row.bindingId === binding.bindingId &&
        row.status === "creating" &&
        row.creationToken === creationToken,
    );
    if (index < 0) throw new Error("BINDING_RESERVATION_LOST");
    const finalized = {
      ...binding,
      status: "active" as const,
      creationToken: undefined,
      creationExpiresAt: undefined,
      version: binding.version + 1,
    };
    this.rows[index] = structuredClone(finalized);
    return structuredClone(finalized);
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
  async updateHeartbeat(id: string, expiresAt: string, version: number) {
    const row = this.rows.find((candidate) => candidate.bindingId === id);
    if (!row) throw new Error("missing");
    if (row.status !== "active" || row.version !== version)
      throw new Error("BINDING_CAS_CONFLICT");
    row.expiresAt = expiresAt;
    row.version++;
    return structuredClone(row);
  }
  async updateStatus(
    id: string,
    status: RuntimeExecutionBinding["status"],
    version: number,
    terminalResult?: string,
  ) {
    const row = this.rows.find((candidate) => candidate.bindingId === id);
    if (!row) throw new Error("missing");
    if (row.status !== "active" || row.version !== version)
      throw new Error("BINDING_CAS_CONFLICT");
    row.status = status;
    row.terminalResult = terminalResult;
    row.version++;
    return structuredClone(row);
  }
  async markPendingLost(
    id: string,
    creationToken: string,
    version: number,
    diagnostic: string,
  ) {
    const row = this.rows.find((candidate) => candidate.bindingId === id);
    if (
      row?.status !== "creating" ||
      row.creationToken !== creationToken ||
      row.version !== version
    )
      throw new Error("BINDING_RESERVATION_LOST");
    row.status = "lost";
    row.terminalResult = diagnostic;
    row.creationToken = undefined;
    row.creationExpiresAt = undefined;
    row.version++;
    return structuredClone(row);
  }
  async recordPendingDiagnostic(
    id: string,
    creationToken: string,
    diagnostic: string,
  ) {
    const row = this.rows.find((candidate) => candidate.bindingId === id);
    if (row?.status !== "creating" || row.creationToken !== creationToken)
      return false;
    row.terminalResult = diagnostic;
    row.version++;
    return true;
  }
  async removePending(id: string, creationToken: string) {
    const length = this.rows.length;
    this.rows = this.rows.filter(
      (row) =>
        row.bindingId !== id ||
        row.status !== "creating" ||
        row.creationToken !== creationToken,
    );
    return this.rows.length !== length;
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

  test("does not share an external runtime reference across identities", async () => {
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
    const first = await adapter.bind({
      workItemId: item.id,
      executorId: "runtime",
      runtimeReference: {
        provider: "test-runtime",
        executionId: "same",
        sessionId: "session-a",
      },
    });
    await expect(
      adapter.bind({
        workItemId: item.id,
        executorId: "runtime",
        runtimeReference: {
          provider: "test-runtime",
          executionId: "same",
          sessionId: "session-b",
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_EXECUTION_CONFLICT" });
    await adapter.complete(first.bindingId, "done");
    await expect(
      adapter.bind({
        workItemId: item.id,
        executorId: "runtime",
        runtimeReference: {
          provider: "test-runtime",
          executionId: "same",
          sessionId: "session-a",
        },
      }),
    ).rejects.toMatchObject({ code: "RUNTIME_EXECUTION_TERMINAL" });
  });

  test("rejects MCP lifecycle writes and heartbeats for native-managed bindings", async () => {
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
      managedBy: "opencode-native",
      runtimeReference: { provider: "opencode", executionId: "delegation" },
    });
    await expect(
      adapter.complete(binding.bindingId, "done"),
    ).rejects.toMatchObject({
      code: "BINDING_MANAGED_BY_NATIVE",
    });
    await expect(adapter.heartbeat(binding.bindingId)).rejects.toMatchObject({
      code: "BINDING_MANAGED_BY_NATIVE",
    });
    system.clock.date = new Date("2026-01-01T00:00:00.500Z");
    expect((await adapter.heartbeatNative(binding.bindingId)).status).toBe(
      "active",
    );
    expect((await adapter.get(binding.bindingId)).status).toBe("active");
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
