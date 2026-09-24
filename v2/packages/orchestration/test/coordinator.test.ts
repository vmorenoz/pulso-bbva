import { expect, test } from "bun:test";
import {
  DelegationCoordinator,
  parseTaskEnvelope,
  serializeAgentResult,
} from "../src";

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
  coordinator.markRunning("a");
  coordinator.markRunning("b");
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
    coordinator.markRunning(status);
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
  coordinator.markRunning("lost");
  expect(coordinator.observeBindingLost("lost").status).toBe("lost");
});

test("rejects results before running without consuming the delegation", () => {
  const coordinator = new DelegationCoordinator();
  prepare(coordinator, "early");
  expect(() =>
    coordinator.acceptResult(
      "early",
      serializeAgentResult(resultFor("early", "completed")),
    ),
  ).toThrow("INVALID_DELEGATION_STATE");
  coordinator.attachBinding("early", "binding-early");
  expect(() =>
    coordinator.acceptResult(
      "early",
      serializeAgentResult(resultFor("early", "completed")),
    ),
  ).toThrow("INVALID_DELEGATION_STATE");
  expect(coordinator.get("early")?.status).toBe("bound");
});

test("rejects duplicate and post-terminal results without another action", () => {
  const coordinator = new DelegationCoordinator();
  for (const status of [
    "completed",
    "failed",
    "blocked",
    "cancelled",
  ] as const) {
    prepare(coordinator, status);
    coordinator.attachBinding(status, `binding-${status}`);
    coordinator.markRunning(status);
    coordinator.acceptResult(
      status,
      serializeAgentResult(resultFor(status, status)),
    );
    expect(() =>
      coordinator.acceptResult(
        status,
        serializeAgentResult(resultFor(status, "completed")),
      ),
    ).toThrow("DELEGATION_ALREADY_TERMINAL");
  }
  prepare(coordinator, "lost-after");
  coordinator.attachBinding("lost-after", "binding-lost-after");
  coordinator.markRunning("lost-after");
  coordinator.observeBindingLost("lost-after");
  expect(() =>
    coordinator.acceptResult(
      "lost-after",
      serializeAgentResult(resultFor("lost-after", "completed")),
    ),
  ).toThrow("DELEGATION_ALREADY_TERMINAL");
});

test("repairs one outer fence before identity validation and rejects malformed input", () => {
  const coordinator = new DelegationCoordinator();
  prepare(coordinator, "repaired");
  coordinator.attachBinding("repaired", "binding-repaired");
  coordinator.markRunning("repaired");
  const repaired = coordinator.acceptResult(
    "repaired",
    `\`\`\`xml\n${serializeAgentResult(resultFor("repaired", "completed"))}\n\`\`\``,
  );
  expect(repaired.action.type).toBe("complete");

  const malformed = new DelegationCoordinator();
  prepare(malformed, "malformed");
  malformed.attachBinding("malformed", "binding-malformed");
  malformed.markRunning("malformed");
  expect(() =>
    malformed.acceptResult("malformed", "not a protocol result"),
  ).toThrow("PROTOCOL_PARSE_ERROR");

  const mismatch = new DelegationCoordinator();
  prepare(mismatch, "identity");
  mismatch.attachBinding("identity", "binding-identity");
  mismatch.markRunning("identity");
  const mismatched = { ...resultFor("identity", "completed"), workId: "other" };
  expect(() =>
    mismatch.acceptResult(
      "identity",
      `\`\`\`xml\n${serializeAgentResult(mismatched)}\n\`\`\``,
    ),
  ).toThrow("WORK_ID_MISMATCH");
});

test("session reproduction correlates the serialized Task, Binding and valid Explorer result", () => {
  const coordinator = new DelegationCoordinator();
  const delegationId = "smoke-delegation-1";
  const workId = "smoke-work-1";
  const workItemId = "smoke-item-1";
  const prepared = coordinator.prepareDelegation({
    delegationId,
    specialist: "explorer",
    workId,
    workItemId,
    objective: "Read-only repository status review",
    facts: ["Do not modify files"],
  });
  const externalExecutionId = prepared.delegation.delegationId;
  const parsedTask = parseTaskEnvelope(prepared.serializedTask);
  expect(externalExecutionId).toBe(delegationId);
  expect(parsedTask).toMatchObject({
    protocol: "pulso-task/1",
    delegationId,
    specialist: "explorer",
    work: { workId, workItemId },
    output: { contract: "pulso-result/1" },
  });

  coordinator.attachBinding(delegationId, "smoke-binding-1");
  coordinator.markRunning(delegationId);
  const accepted = coordinator.acceptResult(
    delegationId,
    serializeAgentResult({
      protocol: "pulso-result/1",
      delegationId: externalExecutionId,
      specialist: "explorer",
      workId,
      workItemId,
      status: "completed",
      summary: "Repository status reviewed without changes",
      specialistResult: {
        kind: "explorer",
        findings: [],
        references: [],
      },
    }),
  );
  expect(accepted.result).toMatchObject({
    protocol: "pulso-result/1",
    delegationId,
    specialist: "explorer",
    workId,
    workItemId,
    status: "completed",
    specialistResult: { kind: "explorer" },
  });
  expect(accepted.action).toMatchObject({
    type: "complete",
    bindingId: "smoke-binding-1",
  });
});

test("legacy status and missing identity set protocol_error and yield no lifecycle action", () => {
  for (const invalidResult of [
    { ...resultFor("invalid-status", "completed"), status: "succeeded" },
    (() => {
      const { delegationId: _, ...missing } = resultFor(
        "missing-identity",
        "completed",
      );
      return missing;
    })(),
  ]) {
    const coordinator = new DelegationCoordinator();
    const id =
      "delegationId" in invalidResult
        ? invalidResult.delegationId
        : "missing-identity";
    prepare(coordinator, id);
    coordinator.attachBinding(id, `binding-${id}`);
    coordinator.markRunning(id);
    const raw = `<pulso-result v="1"><payload>${JSON.stringify(invalidResult)}</payload></pulso-result>`;
    const lifecycleActions: unknown[] = [];
    expect(() => {
      const accepted = coordinator.acceptResult(id, raw);
      lifecycleActions.push(accepted.action);
    }).toThrow();
    expect(coordinator.get(id)?.status).toBe("protocol_error");
    expect(lifecycleActions).toEqual([]);
  }
});
