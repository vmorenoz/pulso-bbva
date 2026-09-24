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
    error?: {
      code: string;
      message: string;
      entity?: { type?: string; id?: string };
      expected?: string;
      actual?: string;
      recovery?: string;
    };
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
  const toolByName = new Map(tools.tools.map((tool) => [tool.name, tool]));
  for (const definition of tools.tools) {
    expect(definition.description?.trim().length).toBeGreaterThan(0);
  }
  const schemaFor = (name: string) =>
    toolByName.get(name)?.inputSchema as {
      properties?: Record<string, { description?: string }>;
    };
  for (const [name, field] of [
    ["pulso_work_create", "title"],
    ["pulso_work_create", "objective"],
    ["pulso_work_get", "workId"],
    ["pulso_work_update", "workId"],
    ["pulso_work_item", "workId"],
    ["pulso_work_item", "itemId"],
    ["pulso_work_item", "version"],
    ["pulso_work_transition", "id"],
    ["pulso_work_transition", "version"],
    ["pulso_work_artifact", "workId"],
    ["pulso_work_artifact", "itemId"],
    ["pulso_runtime_bind", "workItemId"],
    ["pulso_runtime_bind", "workId"],
    ["pulso_runtime_bind", "executorId"],
    ["pulso_runtime_bind", "externalExecutionId"],
    ["pulso_runtime_heartbeat", "bindingId"],
    ["pulso_runtime_complete", "bindingId"],
    ["pulso_runtime_fail", "bindingId"],
    ["pulso_runtime_cancel", "bindingId"],
    ["pulso_runtime_block", "bindingId"],
    ["pulso_runtime_wait", "bindingId"],
    ["pulso_runtime_status", "bindingId"],
  ]) {
    expect(
      schemaFor(name).properties?.[field]?.description?.trim().length,
    ).toBeGreaterThan(0);
  }
  const agentToolView = tools.tools.map(
    ({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }),
  );
  const createDescription = agentToolView.find(
    (definition) => definition.name === "pulso_work_create",
  )?.description;
  const itemDescription = agentToolView.find(
    (definition) => definition.name === "pulso_work_item",
  )?.description;
  const bindDescription = agentToolView.find(
    (definition) => definition.name === "pulso_runtime_bind",
  )?.description;
  expect(createDescription).toContain("not directly executable");
  expect(createDescription).toContain("pulso_work_item");
  expect(itemDescription).toContain("WorkItem ID");
  expect(itemDescription).toContain("pulso_runtime_bind");
  expect(bindDescription).toContain("WorkItem ID, NOT the parent Work ID");
  expect(bindDescription).toContain("bindingId");
  expect(bindDescription).toContain("PREREQUISITES");
  for (const definition of agentToolView.filter(
    (candidate) =>
      candidate.name.startsWith("pulso_runtime_") &&
      !["pulso_runtime_bind"].includes(candidate.name),
  )) {
    expect(definition.description).toContain("bindingId");
    expect(definition.description).toContain(
      "Work ID or WorkItem ID instead of bindingId",
    );
  }
  const schemaInvalid = await call(client, "pulso_work_create", {
    title: "",
    objective: "x",
  });
  expect(schemaInvalid.isError).toBe(true);
  expect(schemaInvalid.content?.[0]).toMatchObject({ type: "text" });
  const invalidItemOperation = await call(client, "pulso_work_item", {
    operation: "create",
  });
  expect(invalidItemOperation.structuredContent?.error).toMatchObject({
    code: "INVALID_INPUT",
    recovery: expect.stringContaining("tool schema"),
  });

  const created = await call(client, "pulso_work_create", {
    title: "MCP workflow",
    objective: "exercise the public server",
  });
  expect(created.structuredContent?.ok).toBe(true);
  const workId = created.structuredContent?.value?.id as string;
  expect(created.structuredContent?.value?.workId).toBe(workId);
  expect(created.structuredContent?.value?.next).toContain("pulso_work_item");
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
  expect(item.structuredContent?.value).toMatchObject({
    workItemId: itemId,
    workId,
  });
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

test("runtime bind diagnoses Work versus WorkItem IDs and supports the corrected flow", async () => {
  const runtime = bootstrapCapabilities(process.cwd(), {
    dataDir: `/tmp/pulso-mcp-bind-smoke-${crypto.randomUUID()}`,
    leaseTtlMs: 1000,
  });
  const server = createMcpServer(runtime);
  const client = new Client({ name: "pulso-bind-smoke", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const work = await call(client, "pulso_work_create", {
    title: "Bind smoke",
    objective: "Reproduce a bind attempt before a WorkItem exists",
  });
  const workId = work.structuredContent?.value?.workId as string;
  const wrongEntity = await call(client, "pulso_runtime_bind", {
    workItemId: workId,
    executorId: "explorer",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  expect(wrongEntity.structuredContent?.error).toMatchObject({
    code: "WORK_ID_USED_AS_WORK_ITEM_ID",
    expected: "WorkItem ID",
    actual: "Work ID",
    recovery: expect.stringContaining("WorkItem ID"),
  });

  const missing = await call(client, "pulso_runtime_bind", {
    workItemId: crypto.randomUUID(),
    executorId: "explorer",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  expect(missing.structuredContent?.error?.code).toBe("WORK_ITEM_NOT_FOUND");
  expect(missing.structuredContent?.error?.recovery).toContain("WorkItem");
  expect(await runtime.runtimeBindings.list()).toHaveLength(0);
  const untouched = await runtime.work.snapshot(workId);
  expect(untouched.items).toHaveLength(0);
  expect(untouched.executions).toHaveLength(0);
  expect(untouched.leases).toHaveLength(0);

  const item = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "Explore repository state",
    kind: "research",
    assigneeId: "explorer",
  });
  const workItemId = item.structuredContent?.value?.workItemId as string;
  const otherWork = await call(client, "pulso_work_create", {
    title: "Different parent",
    objective: "Check optional parent identity validation",
  });
  const wrongParent = await call(client, "pulso_runtime_bind", {
    workItemId,
    workId: otherWork.structuredContent?.value?.workId,
    executorId: "explorer",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  expect(wrongParent.structuredContent?.error).toMatchObject({
    code: "WORK_ITEM_WRONG_WORK",
    expected: otherWork.structuredContent?.value?.workId,
    actual: workId,
    recovery: expect.stringContaining("parent Work ID"),
  });
  const binding = await call(client, "pulso_runtime_bind", {
    workItemId,
    workId,
    executorId: "explorer",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  const bindingId = binding.structuredContent?.value?.bindingId as string;
  expect(binding.structuredContent?.value).toMatchObject({
    bindingId,
    workItemId,
    status: "active",
  });
  expect(binding.structuredContent?.value).not.toHaveProperty("leaseId");

  const completed = await call(client, "pulso_runtime_complete", {
    bindingId,
    result: "Read-only repository review completed",
  });
  expect(completed.structuredContent?.value).toMatchObject({
    bindingId,
    workItemId,
    status: "completed",
  });
  const snapshot = await call(client, "pulso_work_get", {
    workId,
    view: "full",
  });
  expect(snapshot.structuredContent?.value?.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: workItemId, status: "completed" }),
    ]),
  );
  const completedBind = await call(client, "pulso_runtime_bind", {
    workItemId,
    workId,
    executorId: "explorer",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  expect(completedBind.structuredContent?.error).toMatchObject({
    code: "WORK_ITEM_NOT_EXECUTABLE",
    actual: "completed",
  });

  await client.close();
  runtime.close();
});

test("runtime bind distinguishes non-ready items, pending dependencies and assignment mismatch", async () => {
  const runtime = bootstrapCapabilities(process.cwd(), {
    dataDir: `/tmp/pulso-mcp-bind-preflight-${crypto.randomUUID()}`,
  });
  const server = createMcpServer(runtime);
  const client = new Client({ name: "pulso-bind-preflight", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const work = await call(client, "pulso_work_create", {
    title: "Preflight",
    objective: "Exercise bind diagnostics",
  });
  const workId = work.structuredContent?.value?.workId as string;
  const prerequisite = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "Prerequisite",
    kind: "research",
  });
  const prerequisiteId = prerequisite.structuredContent?.value
    ?.workItemId as string;
  const dependent = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "Dependent",
    kind: "implementation",
    dependencies: [prerequisiteId],
  });
  const dependentId = dependent.structuredContent?.value?.workItemId as string;
  const blockedOnDependency = await call(client, "pulso_runtime_bind", {
    workItemId: dependentId,
    executorId: "executor",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  expect(blockedOnDependency.structuredContent?.error).toMatchObject({
    code: "DEPENDENCY_NOT_SATISFIED",
    entity: { type: "WorkItem", id: dependentId },
    recovery: expect.stringContaining("prerequisite WorkItems"),
  });

  const blocked = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "Blocked item",
    kind: "research",
    assigneeId: "executor",
  });
  const blockedId = blocked.structuredContent?.value?.workItemId as string;
  const firstBinding = await call(client, "pulso_runtime_bind", {
    workItemId: blockedId,
    executorId: "executor",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  const blockedExecution = await call(client, "pulso_runtime_block", {
    bindingId: firstBinding.structuredContent?.value?.bindingId as string,
    reason: "Needs additional input",
  });
  const notReady = await call(client, "pulso_runtime_bind", {
    workItemId: blockedId,
    executorId: "executor",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  expect(blockedExecution.structuredContent?.value?.status).toBe("blocked");
  expect(notReady.structuredContent?.error).toMatchObject({
    code: "WORK_ITEM_NOT_READY",
    expected: "ready",
    actual: "blocked",
  });

  const invalidAssignment = await call(client, "pulso_runtime_bind", {
    workItemId: prerequisiteId,
    executorId: "executor-a",
    assigneeId: "executor-b",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  expect(invalidAssignment.structuredContent?.error?.code).toBe(
    "ASSIGNMENT_INVALID",
  );

  const state = await call(client, "pulso_work_get", { workId, view: "full" });
  expect(state.structuredContent?.value?.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: prerequisiteId, status: "ready" }),
      expect.objectContaining({ id: dependentId, status: "pending" }),
      expect.objectContaining({ id: blockedId, status: "blocked" }),
    ]),
  );
  await client.close();
  runtime.close();
});
