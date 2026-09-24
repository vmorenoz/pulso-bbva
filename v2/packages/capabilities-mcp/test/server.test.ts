import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { bootstrapCapabilities, createMcpServer } from "../src";

type ToolResult = {
  content?: Array<{ type: string }>;
  isError?: boolean;
  structuredContent?: {
    ok: boolean;
    value?: Record<string, unknown>;
    error?: { code: string; message: string };
  };
};

const call = async (
  client: Client,
  name: string,
  args: Record<string, unknown>,
) => (await client.callTool({ name, arguments: args })) as ToolResult;

test("MCP server registers tools and applies work operations through the public protocol", async () => {
  const runtime = bootstrapCapabilities(process.cwd(), {
    dataDir: `/tmp/pulso-mcp-${crypto.randomUUID()}`,
    leaseTtlMs: 1000,
  });
  const server = createMcpServer(runtime);
  const client = new Client({ name: "pulso-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const tools = await client.listTools();
  expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
    "pulso_runtime_bind",
    "pulso_runtime_block",
    "pulso_runtime_cancel",
    "pulso_runtime_complete",
    "pulso_runtime_fail",
    "pulso_runtime_heartbeat",
    "pulso_runtime_status",
    "pulso_runtime_wait",
    "pulso_work_artifact",
    "pulso_work_create",
    "pulso_work_get",
    "pulso_work_item",
    "pulso_work_transition",
    "pulso_work_update",
  ]);
  const schemaInvalid = await call(client, "pulso_work_create", {
    title: "",
    objective: "x",
  });
  expect(schemaInvalid.isError).toBe(true);
  expect(schemaInvalid.content?.[0]).toMatchObject({ type: "text" });

  const created = await call(client, "pulso_work_create", {
    title: "MCP workflow",
    objective: "exercise the public server",
  });
  expect(created.structuredContent?.ok).toBe(true);
  const workId = created.structuredContent?.value?.id as string;
  const updated = await call(client, "pulso_work_update", {
    workId,
    title: "Updated MCP workflow",
  });
  expect(updated.structuredContent?.value?.title).toBe("Updated MCP workflow");
  const item = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "complete item",
    kind: "implementation",
    assigneeId: "executor-a",
  });
  const itemId = item.structuredContent?.value?.id as string;
  expect(item.structuredContent?.value?.status).toBe("ready");
  const artifact = await call(client, "pulso_work_artifact", {
    workId,
    itemId,
    type: "report",
    uri: "file:///tmp/result.txt",
  });
  expect(artifact.structuredContent?.value?.itemId).toBe(itemId);

  const started = await call(client, "pulso_runtime_bind", {
    workItemId: itemId,
    executorId: "executor-a",
    provider: "test-runtime",
    externalExecutionId: "execution-a",
  });
  const bindingId = started.structuredContent?.value?.bindingId as string;
  expect(started.structuredContent?.value).not.toHaveProperty("leaseId");
  expect(started.structuredContent?.value).not.toHaveProperty("fencingToken");
  const duplicate = await call(client, "pulso_runtime_bind", {
    workItemId: itemId,
    executorId: "executor-a",
    provider: "test-runtime",
    externalExecutionId: "execution-a",
  });
  expect(duplicate.structuredContent?.value?.bindingId).toBe(bindingId);
  const heartbeat = await call(client, "pulso_runtime_heartbeat", {
    bindingId,
  });
  expect(heartbeat.structuredContent?.value?.status).toBe("active");
  const completed = await call(client, "pulso_runtime_complete", {
    bindingId,
    result: "complete",
  });
  expect(completed.structuredContent?.value?.status).toBe("completed");
  const zombie = await call(client, "pulso_runtime_heartbeat", {
    bindingId,
  });
  expect(zombie).toMatchObject({
    isError: true,
    structuredContent: { ok: false, error: { code: "BINDING_NOT_ACTIVE" } },
  });

  const failedItem = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "fail item",
    kind: "validation",
    assigneeId: "executor-b",
  });
  const failedStart = await call(client, "pulso_runtime_bind", {
    workItemId: failedItem.structuredContent?.value?.id as string,
    executorId: "executor-b",
    provider: "test-runtime",
    externalExecutionId: "execution-b",
  });
  const failed = await call(client, "pulso_runtime_fail", {
    bindingId: failedStart.structuredContent?.value?.bindingId as string,
    reason: "validation failed",
  });
  expect(failed.structuredContent?.value?.status).toBe("failed");
  const blockedItem = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "blocked item",
    kind: "research",
    assigneeId: "executor-c",
  });
  const blockedStart = await call(client, "pulso_runtime_bind", {
    workItemId: blockedItem.structuredContent?.value?.id as string,
    executorId: "executor-c",
    provider: "test-runtime",
    externalExecutionId: "execution-c",
  });
  const blocked = await call(client, "pulso_runtime_block", {
    bindingId: blockedStart.structuredContent?.value?.bindingId as string,
    reason: "needs human input",
  });
  expect(blocked.structuredContent?.value?.status).toBe("blocked");
  const blockedState = await call(client, "pulso_work_get", {
    workId,
    view: "full",
  });
  expect(blockedState.structuredContent?.value?.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: "blocked" })]),
  );
  const invalidState = await call(client, "pulso_work_get", {
    workId: "missing",
  });
  expect(invalidState).toMatchObject({
    isError: true,
    structuredContent: { ok: false, error: { code: "WORK_NOT_FOUND" } },
  });
  const transition = await call(client, "pulso_work_transition", {
    target: "work",
    id: workId,
    transition: "start",
    version: 2,
  });
  expect(transition.structuredContent?.value?.status).toBe("active");
  const state = await call(client, "pulso_work_get", { workId, view: "full" });
  expect(state.structuredContent?.value?.artifacts).toHaveLength(1);

  await client.close();
  runtime.close();
});
