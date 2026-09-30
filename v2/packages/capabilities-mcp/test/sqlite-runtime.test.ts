import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ExecutionService,
  RecoveryService,
  WorkService,
} from "../../working-system/src/domain";
import { SqliteStore } from "../../working-system/src/persistence/sqlite-store";
import { ExecutionCoordinator, RuntimeWorkAdapter } from "../src/runtime";
import { SqliteBindingStore } from "../src/runtime/bindings/sqlite-binding-store";

const makeClock = () => {
  let current = new Date("2026-01-01T00:00:00.000Z");
  return {
    now: () => current,
    set: (value: string) => {
      current = new Date(value);
    },
  };
};

const deferred = () => {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve,
  };
};

const openSystem = (directory: string, clock: ReturnType<typeof makeClock>) => {
  const store = new SqliteStore(join(directory, "work.db"));
  const bindings = new SqliteBindingStore(join(directory, "bindings.db"));
  const work = new WorkService(store, clock);
  const execution = new ExecutionService(store, work, clock);
  const gateway = new ExecutionCoordinator(
    store,
    work,
    execution,
    new RecoveryService(store, clock),
  );
  return {
    store,
    bindings,
    work,
    gateway,
    adapter: new RuntimeWorkAdapter(bindings, gateway, clock),
    close: () => {
      bindings.close();
      store.close();
    },
  };
};

const withSqlite = async (callback: (directory: string) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), "pulso-runtime-sqlite-"));
  try {
    await callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

test("SQLite heartbeat cannot restore a terminal binding and terminal replays are stable", async () =>
  withSqlite(async (directory) => {
    const clock = makeClock();
    const left = openSystem(directory, clock);
    const right = openSystem(directory, clock);
    try {
      const work = await left.work.create({
        workspaceId: "workspace",
        title: "heartbeat race",
        objective: "verify terminal fencing",
      });
      const item = await left.work.addItem({
        workId: work.id,
        title: "item",
        kind: "task",
        assigneeId: "runtime",
      });
      const binding = await left.adapter.bind({
        workItemId: item.id,
        executorId: "runtime",
        runtimeReference: { provider: "test", executionId: "heartbeat-race" },
      });
      const heartbeatReached = deferred();
      const releaseHeartbeat = deferred();
      const heartbeat = right.gateway.heartbeat.bind(right.gateway);
      right.gateway.heartbeat = async (...args) => {
        const lease = await heartbeat(...args);
        heartbeatReached.resolve();
        await releaseHeartbeat.promise;
        return lease;
      };

      const pendingHeartbeat = right.adapter.heartbeat(binding.bindingId);
      await heartbeatReached.promise;
      const completed = await left.adapter.complete(binding.bindingId, "done");
      const beforeReplay = await left.store.read();
      releaseHeartbeat.resolve();

      await expect(pendingHeartbeat).rejects.toMatchObject({
        code: "BINDING_NOT_ACTIVE",
      });
      expect(await right.adapter.get(binding.bindingId)).toEqual(completed);
      expect(
        (await left.store.read()).leases.find(
          (lease) => lease.id === binding.leaseId,
        )?.status,
      ).toBe("released");
      expect(await right.adapter.complete(binding.bindingId, "done")).toEqual(
        completed,
      );
      await expect(
        right.adapter.fail(binding.bindingId, "different"),
      ).rejects.toMatchObject({
        code: "RUNTIME_EXECUTION_TERMINAL",
      });
      expect(await left.store.read()).toEqual(beforeReplay);
    } finally {
      right.close();
      left.close();
    }
  }));

test("SQLite heartbeat cannot restore failed, blocked, or waiting bindings", async () =>
  withSqlite(async (directory) => {
    const clock = makeClock();
    const left = openSystem(directory, clock);
    const right = openSystem(directory, clock);
    try {
      for (const target of ["failed", "blocked", "waiting"] as const) {
        const work = await left.work.create({
          workspaceId: "workspace",
          title: `heartbeat ${target}`,
          objective: "verify terminal fencing",
        });
        const item = await left.work.addItem({
          workId: work.id,
          title: target,
          kind: "task",
          assigneeId: "runtime",
        });
        const binding = await left.adapter.bind({
          workItemId: item.id,
          executorId: "runtime",
          runtimeReference: {
            provider: "test",
            executionId: `heartbeat-${target}`,
          },
        });
        const heartbeatReached = deferred();
        const releaseHeartbeat = deferred();
        const heartbeat = right.gateway.heartbeat.bind(right.gateway);
        right.gateway.heartbeat = async (...args) => {
          const lease = await heartbeat(...args);
          heartbeatReached.resolve();
          await releaseHeartbeat.promise;
          return lease;
        };

        const pendingHeartbeat = right.adapter.heartbeat(binding.bindingId);
        await heartbeatReached.promise;
        const settled =
          target === "failed"
            ? await left.adapter.fail(binding.bindingId, "failed")
            : await left.adapter.suspend(binding.bindingId, target, "paused");
        const beforeReplay = await left.store.read();
        releaseHeartbeat.resolve();

        await expect(pendingHeartbeat).rejects.toMatchObject({
          code: "BINDING_NOT_ACTIVE",
        });
        expect(await right.adapter.get(binding.bindingId)).toEqual(settled);
        if (target === "failed")
          expect(await right.adapter.fail(binding.bindingId, "failed")).toEqual(
            settled,
          );
        else
          expect(
            await right.adapter.suspend(binding.bindingId, target, "paused"),
          ).toEqual(settled);
        await expect(
          right.adapter.complete(binding.bindingId, "different"),
        ).rejects.toMatchObject({
          code: "RUNTIME_EXECUTION_TERMINAL",
        });
        expect(await left.store.read()).toEqual(beforeReplay);
        right.gateway.heartbeat = heartbeat;
      }
    } finally {
      right.close();
      left.close();
    }
  }));

test("SQLite reconciliation retains valid reservations and recovers expired reservations by authority", async () =>
  withSqlite(async (directory) => {
    const clock = makeClock();
    const left = openSystem(directory, clock);
    const right = openSystem(directory, clock);
    try {
      const valid = await left.bindings.reserve({
        bindingId: "valid-reservation",
        runtime: { provider: "test", executionId: "valid-reservation" },
        workId: "work",
        workItemId: "item",
        executorId: "runtime",
        assigneeId: "runtime",
        requestHash: "valid",
        managedBy: "mcp",
        creationToken: "valid-token",
        createdAt: "2026-01-01T00:00:00.000Z",
        creationExpiresAt: "2026-01-01T00:02:00.000Z",
      });
      expect(await right.adapter.reconcile()).toEqual([]);
      expect(await right.bindings.get(valid.bindingId)).toMatchObject({
        status: "creating",
      });
      clock.set("2026-01-01T00:02:01.000Z");
      expect(await right.adapter.reconcile()).toEqual([]);
      expect(await right.bindings.get(valid.bindingId)).toBeUndefined();

      const work = await left.work.create({
        workspaceId: "workspace",
        title: "reconstruct reservation",
        objective: "recover exact authority",
      });
      const item = await left.work.addItem({
        workId: work.id,
        title: "reconstruct",
        kind: "task",
        assigneeId: "runtime",
      });
      const runtime = { provider: "test", executionId: "reconstruct" };
      await left.bindings.reserve({
        bindingId: "reconstruct-reservation",
        runtime,
        workId: work.id,
        workItemId: item.id,
        executorId: "runtime",
        assigneeId: "runtime",
        requestHash: "reconstruct",
        managedBy: "mcp",
        creationToken: "reconstruct-token",
        createdAt: "2026-01-01T00:02:01.000Z",
        creationExpiresAt: "2026-01-01T00:04:01.000Z",
      });
      const started = await left.gateway.startExecution({
        workItemId: item.id,
        executorId: "runtime",
        runtime,
      });
      clock.set("2026-01-01T00:04:02.000Z");
      expect(await right.adapter.reconcile()).toContainEqual(
        expect.objectContaining({
          bindingId: "reconstruct-reservation",
          executionId: started.execution.id,
          leaseId: started.lease.id,
          status: "active",
        }),
      );

      const lostItem = await left.work.addItem({
        workId: work.id,
        title: "lost authority",
        kind: "task",
        assigneeId: "runtime",
      });
      const lostRuntime = { provider: "test", executionId: "lost-authority" };
      await left.bindings.reserve({
        bindingId: "lost-reservation",
        runtime: lostRuntime,
        workId: work.id,
        workItemId: lostItem.id,
        executorId: "runtime",
        assigneeId: "runtime",
        requestHash: "lost",
        managedBy: "mcp",
        creationToken: "lost-token",
        createdAt: "2026-01-01T00:04:02.000Z",
        creationExpiresAt: "2026-01-01T00:06:02.000Z",
      });
      await left.gateway.startExecution({
        workItemId: lostItem.id,
        executorId: "runtime",
        runtime: lostRuntime,
      });
      clock.set("2026-01-01T00:10:00.000Z");
      expect(await right.adapter.reconcile()).toContainEqual(
        expect.objectContaining({
          bindingId: "lost-reservation",
          status: "lost",
          terminalResult: "reservation_authority_lost",
        }),
      );
      expect(await right.bindings.get("lost-reservation")).toMatchObject({
        status: "lost",
        terminalResult: "reservation_authority_lost",
      });
    } finally {
      right.close();
      left.close();
    }
  }));

test("SQLite instances reject a concurrent bind that reuses an external execution identity", async () =>
  withSqlite(async (directory) => {
    const clock = makeClock();
    const left = openSystem(directory, clock);
    const right = openSystem(directory, clock);
    try {
      const work = await left.work.create({
        workspaceId: "workspace",
        title: "concurrent bindings",
        objective: "preserve external identity",
      });
      const firstItem = await left.work.addItem({
        workId: work.id,
        title: "first item",
        kind: "task",
        assigneeId: "runtime-a",
      });
      const secondItem = await left.work.addItem({
        workId: work.id,
        title: "second item",
        kind: "task",
        assigneeId: "runtime-b",
      });
      const reserveReached = deferred();
      const releaseReserve = deferred();
      const reserve = left.bindings.reserve.bind(left.bindings);
      left.bindings.reserve = async (input) => {
        reserveReached.resolve();
        await releaseReserve.promise;
        return reserve(input);
      };
      const leftBind = left.adapter.bind({
        workItemId: firstItem.id,
        executorId: "runtime-a",
        runtimeReference: {
          provider: "test",
          executionId: "shared-execution",
          sessionId: "session-a",
        },
      });
      await reserveReached.promise;
      const rightBind = right.adapter.bind({
        workItemId: secondItem.id,
        executorId: "runtime-b",
        runtimeReference: {
          provider: "test",
          executionId: "shared-execution",
          sessionId: "session-b",
        },
      });
      releaseReserve.resolve();

      const results = await Promise.allSettled([leftBind, rightBind]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(rejected?.reason).toMatchObject({
        code: "RUNTIME_EXECUTION_CONFLICT",
      });
      expect((await left.store.read()).executions).toHaveLength(1);
    } finally {
      right.close();
      left.close();
    }
  }));

test("SQLite reconciliation rejects an expired reservation with mismatched Work authority", async () =>
  withSqlite(async (directory) => {
    const clock = makeClock();
    const left = openSystem(directory, clock);
    const right = openSystem(directory, clock);
    try {
      const work = await left.work.create({
        workspaceId: "workspace",
        title: "mismatched reservation",
        objective: "do not reconstruct another authority",
      });
      const item = await left.work.addItem({
        workId: work.id,
        title: "item",
        kind: "task",
        assigneeId: "runtime",
      });
      const runtime = { provider: "test", executionId: "identity-mismatch" };
      await left.gateway.startExecution({
        workItemId: item.id,
        executorId: "runtime",
        runtime,
      });
      await left.bindings.reserve({
        bindingId: "mismatched-reservation",
        runtime,
        workId: work.id,
        workItemId: item.id,
        executorId: "runtime",
        assigneeId: "another-runtime",
        requestHash: "mismatch",
        managedBy: "mcp",
        creationToken: "mismatch-token",
        createdAt: "2026-01-01T00:00:00.000Z",
        creationExpiresAt: "2026-01-01T00:02:00.000Z",
      });
      clock.set("2026-01-01T00:02:01.000Z");

      await expect(right.adapter.reconcile()).rejects.toMatchObject({
        code: "RECOVERY_REQUIRED",
      });
      expect(await right.bindings.get("mismatched-reservation")).toMatchObject({
        status: "creating",
      });
    } finally {
      right.close();
      left.close();
    }
  }));

test("SQLite finalize loss between instances revokes authority instead of reporting success", async () =>
  withSqlite(async (directory) => {
    const clock = makeClock();
    const left = openSystem(directory, clock);
    const right = openSystem(directory, clock);
    try {
      const work = await left.work.create({
        workspaceId: "workspace",
        title: "finalize loss",
        objective: "compensate a lost reservation",
      });
      const item = await left.work.addItem({
        workId: work.id,
        title: "item",
        kind: "task",
        assigneeId: "runtime",
      });
      const runtime = { provider: "test", executionId: "finalize-loss" };
      const finalizeReached = deferred();
      const releaseFinalize = deferred();
      const finalize = left.bindings.finalize.bind(left.bindings);
      left.bindings.finalize = async (binding, token) => {
        finalizeReached.resolve();
        await releaseFinalize.promise;
        return finalize(binding, token);
      };
      const pending = left.adapter.bind({
        workItemId: item.id,
        executorId: "runtime",
        runtimeReference: runtime,
      });
      await finalizeReached.promise;
      const reservation = await right.bindings.getByRuntime(runtime);
      if (!reservation?.creationToken)
        throw new Error("RESERVATION_NOT_AVAILABLE");
      expect(
        await right.bindings.removePending(
          reservation.bindingId,
          reservation.creationToken,
        ),
      ).toBe(true);
      releaseFinalize.resolve();

      await expect(pending).rejects.toMatchObject({
        code: "BINDING_RESERVATION_LOST",
      });
      expect(await right.bindings.getByRuntime(runtime)).toBeUndefined();
      expect(
        (await left.store.read()).leases.every(
          (lease) => lease.status !== "active",
        ),
      ).toBe(true);
    } finally {
      right.close();
      left.close();
    }
  }));

test("SQLite retains a diagnosable reservation when lost finalize cannot revoke authority", async () =>
  withSqlite(async (directory) => {
    const clock = makeClock();
    const left = openSystem(directory, clock);
    const right = openSystem(directory, clock);
    try {
      const work = await left.work.create({
        workspaceId: "workspace",
        title: "compensation",
        objective: "retain recovery evidence",
      });
      const item = await left.work.addItem({
        workId: work.id,
        title: "compensation item",
        kind: "task",
        assigneeId: "runtime",
      });
      const finalize = left.bindings.finalize.bind(left.bindings);
      const revoke = left.gateway.revoke.bind(left.gateway);
      left.bindings.finalize = async () => {
        throw new Error("BINDING_RESERVATION_LOST");
      };
      left.gateway.revoke = async () => {
        throw new Error("revoke failed");
      };
      const adapter = new RuntimeWorkAdapter(
        left.bindings,
        left.gateway,
        clock,
      );

      await expect(
        adapter.bind({
          workItemId: item.id,
          executorId: "runtime",
          runtimeReference: { provider: "test", executionId: "compensation" },
        }),
      ).rejects.toMatchObject({ code: "BINDING_RESERVATION_LOST" });
      left.bindings.finalize = finalize;
      left.gateway.revoke = revoke;

      expect(
        await left.bindings.getByRuntime({
          provider: "test",
          executionId: "compensation",
        }),
      ).toMatchObject({
        status: "creating",
        terminalResult: "binding_reservation_lost; compensation_revoke_failed",
      });
      clock.set("2026-01-01T00:02:01.000Z");
      expect(await right.adapter.reconcile()).toContainEqual(
        expect.objectContaining({
          status: "active",
          terminalResult:
            "binding_reservation_lost; compensation_revoke_failed",
        }),
      );
    } finally {
      right.close();
      left.close();
    }
  }));
