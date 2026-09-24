import { expect, test } from "bun:test";
import { DelegationCoordinator, serializeAgentResult } from "../src";

const prepare = (coordinator: DelegationCoordinator, delegationId: string) =>
  coordinator.prepareDelegation({
    delegationId,
    specialist: "executor",
    workId: `work-${delegationId}`,
    workItemId: `item-${delegationId}`,
    objective: "bounded work",
    createdAt: "2026-01-01T00:00:00.000Z",
  });
const resultFor = (
  id: string,
  status: "completed" | "failed" | "blocked" | "cancelled",
) => ({
  protocol: "pulso-result/1" as const,
  delegationId: id,
  specialist: "executor" as const,
  workId: `work-${id}`,
  workItemId: `item-${id}`,
  status,
  summary: `${status} work`,
  ...(status === "blocked" ? { blockers: ["human input"] } : {}),
  ...(status === "completed"
    ? { artifacts: [{ type: "report", uri: "file:///tmp/report.txt" }] }
    : {}),
  specialistResult: { kind: "executor" as const, changes: ["src/a.ts"] },
});

test("a direct Executor delegation completes without Planner or Verifier", () => {
  const coordinator = new DelegationCoordinator();
  const prepared = prepare(coordinator, "direct");
  coordinator.attachBinding("direct", "binding-direct");
  coordinator.markRunning("direct");
  const accepted = coordinator.acceptResult(
    "direct",
    serializeAgentResult(resultFor("direct", "completed")),
  );
  expect(prepared.task.specialist).toBe("executor");
  expect(accepted.action).toEqual({
    type: "complete",
    bindingId: "binding-direct",
    artifacts: [{ type: "report", uri: "file:///tmp/report.txt" }],
  });
  expect(accepted.delegation.status).toBe("completed");
});

test("parallel delegations retain isolated identities when results arrive reversed", () => {
  const coordinator = new DelegationCoordinator();
  prepare(coordinator, "a");
  prepare(coordinator, "b");
  coordinator.attachBinding("a", "binding-a");
  coordinator.attachBinding("b", "binding-b");
  const second = coordinator.acceptResult(
    "b",
    serializeAgentResult(resultFor("b", "completed")),
  );
  const first = coordinator.acceptResult(
    "a",
    serializeAgentResult(resultFor("a", "completed")),
  );
  expect(second.action.bindingId).toBe("binding-b");
  expect(first.action.bindingId).toBe("binding-a");
});

test("failed, blocked and cancelled results map once without retry selection", () => {
  for (const status of ["failed", "blocked", "cancelled"] as const) {
    const coordinator = new DelegationCoordinator();
    prepare(coordinator, status);
    coordinator.attachBinding(status, `binding-${status}`);
    const accepted = coordinator.acceptResult(
      status,
      serializeAgentResult(resultFor(status, status)),
    );
    expect(accepted.action.type).toBe(
      status === "cancelled"
        ? "cancel"
        : status === "blocked"
          ? "block"
          : "fail",
    );
    expect(accepted.delegation.status).toBe(status);
  }
});

test("lost bindings are observed without replacing lower-layer recovery", () => {
  const coordinator = new DelegationCoordinator();
  prepare(coordinator, "lost");
  coordinator.attachBinding("lost", "binding-lost");
  expect(coordinator.observeBindingLost("lost").status).toBe("lost");
});
