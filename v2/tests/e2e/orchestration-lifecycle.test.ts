import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  bootstrapCapabilities,
  createMcpServer,
} from "../../packages/capabilities-mcp/src";
import {
  DelegationCoordinator,
  type LifecycleAction,
  serializeAgentResult,
} from "../../packages/orchestration/src";

type ToolResult = {
  structuredContent?: { ok: boolean; value?: Record<string, unknown> };
};

const call = async (
  client: Client,
  name: string,
  input: Record<string, unknown>,
) => (await client.callTool({ name, arguments: input })) as ToolResult;

const result = (
  delegationId: string,
  workId: string,
  workItemId: string,
  status: "completed" | "failed" | "blocked" | "cancelled",
) => ({
  protocol: "pulso-result/1" as const,
  delegationId,
  specialist: "executor" as const,
  workId,
  workItemId,
  status,
  summary: `${status} result`,
  ...(status === "blocked" ? { blockers: ["human input"] } : {}),
  ...(status === "completed"
    ? { artifacts: [{ type: "report", uri: "file:///tmp/result.txt" }] }
    : {}),
  specialistResult: { kind: "executor" as const, changes: ["src/a.ts"] },
});

test("orchestration lifecycle actions operate through MCP without coordinator side effects", async () => {
  const clock = {
    value: new Date("2026-01-01T00:00:00.000Z"),
    now() {
      return this.value;
    },
  };
  const runtime = bootstrapCapabilities(process.cwd(), {
    dataDir: `/tmp/pulso-orchestration-${crypto.randomUUID()}`,
    clock,
    leaseTtlMs: 1000,
  });
  const server = createMcpServer(runtime);
  const client = new Client({ name: "orchestration-e2e", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const coordinator = new DelegationCoordinator();

  const createDelegation = async (id: string) => {
    const created = await call(client, "pulso_work_create", {
      title: id,
      objective: "exercise orchestration lifecycle",
    });
    const workId = created.structuredContent?.value?.id as string;
    const item = await call(client, "pulso_work_item", {
      operation: "create",
      workId,
      title: id,
      kind: "task",
      assigneeId: "executor",
    });
    const workItemId = item.structuredContent?.value?.id as string;
    const bound = await call(client, "pulso_runtime_bind", {
      workItemId,
      executorId: "executor",
      provider: "fake-specialist",
      externalExecutionId: id,
    });
    const bindingId = bound.structuredContent?.value?.bindingId as string;
    coordinator.prepareDelegation({
      delegationId: id,
      specialist: "executor",
      workId,
      workItemId,
      objective: "bounded work",
    });
    coordinator.attachBinding(id, bindingId);
    coordinator.markRunning(id);
    return { workId, workItemId, bindingId };
  };
  const execute = async (action: LifecycleAction) => {
    if (action.type === "complete")
      return call(client, "pulso_runtime_complete", {
        bindingId: action.bindingId,
        result: JSON.stringify({ artifacts: action.artifacts }),
      });
    if (action.type === "fail")
      return call(client, "pulso_runtime_fail", {
        bindingId: action.bindingId,
        reason: action.reason,
      });
    if (action.type === "block")
      return call(client, "pulso_runtime_block", {
        bindingId: action.bindingId,
        reason: action.reason,
      });
    return call(client, "pulso_runtime_cancel", {
      bindingId: action.bindingId,
      reason: action.reason,
    });
  };

  const completed = await createDelegation("completed");
  const completeAction = coordinator.acceptResult(
    "completed",
    serializeAgentResult(
      result("completed", completed.workId, completed.workItemId, "completed"),
    ),
  ).action;
  expect((await execute(completeAction)).structuredContent?.value?.status).toBe(
    "completed",
  );
  const completeSnapshot = await runtime.work.snapshot(completed.workId);
  expect(completeSnapshot.items[0]?.status).toBe("completed");
  expect(completeSnapshot.executions[0]?.status).toBe("completed");
  expect(completeSnapshot.leases[0]?.status).toBe("released");
  expect(completeSnapshot.events.length).toBeGreaterThan(0);

  for (const status of ["failed", "blocked", "cancelled"] as const) {
    const delegation = await createDelegation(status);
    const action = coordinator.acceptResult(
      status,
      serializeAgentResult(
        result(status, delegation.workId, delegation.workItemId, status),
      ),
    ).action;
    await execute(action);
    const snapshot = await runtime.work.snapshot(delegation.workId);
    expect(snapshot.items[0]?.status).toBe(status);
    expect(snapshot.executions[0]?.status).toBe(
      status === "blocked" ? "abandoned" : status,
    );
    expect(snapshot.executions).toHaveLength(1);
    expect(snapshot.leases[0]?.status).toBe("released");
    expect(snapshot.events.length).toBeGreaterThan(0);
  }

  const first = await createDelegation("parallel-a");
  const second = await createDelegation("parallel-b");
  const secondAction = coordinator.acceptResult(
    "parallel-b",
    serializeAgentResult(
      result("parallel-b", second.workId, second.workItemId, "completed"),
    ),
  ).action;
  const firstAction = coordinator.acceptResult(
    "parallel-a",
    serializeAgentResult(
      result("parallel-a", first.workId, first.workItemId, "completed"),
    ),
  ).action;
  expect(secondAction.bindingId).toBe(second.bindingId);
  expect(firstAction.bindingId).toBe(first.bindingId);
  await execute(secondAction);
  await execute(firstAction);
  expect((await runtime.work.snapshot(first.workId)).items[0]?.status).toBe(
    "completed",
  );
  expect((await runtime.work.snapshot(second.workId)).items[0]?.status).toBe(
    "completed",
  );

  const lost = await createDelegation("host-loss");
  clock.value = new Date("2026-01-01T00:00:02.000Z");
  const reconciled = await runtime.runtimeAdapter.reconcile();
  expect(reconciled.map((binding) => binding.bindingId)).toContain(
    lost.bindingId,
  );
  expect(coordinator.observeBindingLost("host-loss").status).toBe("lost");
  const lostSnapshot = await runtime.work.snapshot(lost.workId);
  expect(lostSnapshot.items[0]?.status).toBe("recovery_required");
  expect(lostSnapshot.executions[0]?.status).toBe("abandoned");
  expect(lostSnapshot.leases[0]?.status).toBe("expired");

  await client.close();
  runtime.close();
});
