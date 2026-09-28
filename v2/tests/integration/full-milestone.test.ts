import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { bootstrapWorkingSystem as bootstrap } from "../../packages/working-system/src";

test("runs the complete work-system milestone scenario", async () => {
  const dir = mkdtempSync(`${tmpdir()}/pulso-`);
  const clock = {
    d: new Date("2026-01-01T00:00:00Z"),
    now() {
      return this.d;
    },
  };
  const runtime = bootstrap(process.cwd(), {
    dataDir: dir,
    clock,
    leaseTtlMs: 1000,
  });
  const work = await runtime.work.create({
    workspaceId: runtime.workspaceId,
    title: "milestone",
    objective: "complete work system",
  });
  const research = await runtime.work.addItem({
    workId: work.id,
    title: "research",
    kind: "research",
    assigneeId: "executor-a",
  });
  const implementation = await runtime.work.addItem({
    workId: work.id,
    title: "implementation",
    kind: "implementation",
    dependencies: [research.id],
    assigneeId: "executor-a",
  });
  const review = await runtime.work.addItem({
    workId: work.id,
    title: "review",
    kind: "review",
    dependencies: [implementation.id],
    assigneeId: "executor-b",
  });

  const researchExecution = await runtime.execution.start(
    research.id,
    "executor-a",
  );
  expect((await runtime.work.snapshot(work.id)).work.status).toBe("active");
  await runtime.execution.heartbeat(
    researchExecution.executionId,
    researchExecution.leaseId,
  );
  await runtime.execution.complete(
    researchExecution.executionId,
    researchExecution.leaseId,
    "research complete",
  );
  expect(
    (await runtime.work.snapshot(work.id)).items.find(
      (item) => item.id === implementation.id,
    )?.status,
  ).toBe("ready");

  const blockedExecution = await runtime.execution.start(
    implementation.id,
    "executor-a",
  );
  await runtime.execution.suspend(
    blockedExecution.executionId,
    blockedExecution.leaseId,
    "blocked",
    "waiting for input",
  );
  await runtime.work.transition("item", implementation.id, "resume");
  const waitingExecution = await runtime.execution.start(
    implementation.id,
    "executor-a",
  );
  await runtime.execution.suspend(
    waitingExecution.executionId,
    waitingExecution.leaseId,
    "waiting",
    "external dependency",
  );
  await runtime.work.transition("item", implementation.id, "resume");

  const expiringExecution = await runtime.execution.start(
    implementation.id,
    "executor-a",
  );
  clock.d = new Date("2026-01-01T00:00:02Z");
  const recovered = await runtime.work.snapshot(work.id);
  expect(
    recovered.items.find((item) => item.id === implementation.id)?.status,
  ).toBe("recovery_required");
  expect(
    recovered.executions.find(
      (execution) => execution.id === expiringExecution.executionId,
    )?.status,
  ).toBe("abandoned");

  await runtime.work.transition("item", implementation.id, "prepare_retry");
  await runtime.work.assign(implementation.id, "executor-b", true);
  const revokedExecution = await runtime.execution.start(
    implementation.id,
    "executor-b",
  );
  await runtime.execution.revokeLease({
    leaseId: revokedExecution.leaseId,
    reason: "operator review",
  });
  await expect(
    runtime.execution.heartbeat(
      revokedExecution.executionId,
      revokedExecution.leaseId,
    ),
  ).rejects.toMatchObject({ code: "LEASE_REVOKED" });
  await runtime.work.transition("item", implementation.id, "prepare_retry");
  const finalExecution = await runtime.execution.start(
    implementation.id,
    "executor-b",
  );
  await expect(
    runtime.execution.complete(
      expiringExecution.executionId,
      expiringExecution.leaseId,
    ),
  ).rejects.toMatchObject({ code: "LEASE_EXPIRED" });
  await runtime.execution.complete(
    finalExecution.executionId,
    finalExecution.leaseId,
  );
  expect(
    (await runtime.work.snapshot(work.id)).items.find(
      (item) => item.id === review.id,
    )?.status,
  ).toBe("ready");

  const reviewExecution = await runtime.execution.start(
    review.id,
    "executor-b",
  );
  await runtime.execution.complete(
    reviewExecution.executionId,
    reviewExecution.leaseId,
  );
  await runtime.work.transition("work", work.id, "complete");
  runtime.close();

  const restarted = bootstrap(process.cwd(), { dataDir: dir, clock });
  const finalState = await restarted.work.snapshot(work.id);
  expect(finalState.work.status).toBe("completed");
  expect(finalState.items.every((item) => item.status === "completed")).toBe(
    true,
  );
  expect(finalState.executions.map((execution) => execution.status)).toContain(
    "abandoned",
  );
  expect(finalState.leases.map((lease) => lease.status)).toContain("expired");
  expect(finalState.leases.map((lease) => lease.status)).toContain("revoked");
  expect(finalState.events.map((event) => event.type)).toContain(
    "item.blocked",
  );
  expect(finalState.events.map((event) => event.type)).toContain(
    "item.waiting",
  );
  expect(finalState.events.map((event) => event.type)).toContain(
    "lease.revoked",
  );
  restarted.close();
});
