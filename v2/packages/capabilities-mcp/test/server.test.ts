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
) =>
  (await client.callTool({
    name: name.replace(/^pulso_/, ""),
    arguments: args,
  })) as ToolResult;

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
    "runtime_bind",
    "runtime_block",
    "runtime_cancel",
    "runtime_complete",
    "runtime_fail",
    "runtime_heartbeat",
    "runtime_status",
    "runtime_wait",
    "work_artifact",
    "work_create",
    "work_get",
    "work_item",
    "work_transition",
    "work_update",
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
    ["work_create", "title"],
    ["work_create", "objective"],
    ["work_get", "workId"],
    ["work_update", "workId"],
    ["work_item", "workId"],
    ["work_item", "itemId"],
    ["work_item", "version"],
    ["work_transition", "id"],
    ["work_transition", "version"],
    ["work_artifact", "workId"],
    ["work_artifact", "itemId"],
    ["runtime_bind", "workItemId"],
    ["runtime_bind", "executorId"],
    ["runtime_bind", "externalExecutionId"],
    ["runtime_heartbeat", "bindingId"],
    ["runtime_complete", "bindingId"],
    ["runtime_fail", "bindingId"],
    ["runtime_cancel", "bindingId"],
    ["runtime_block", "bindingId"],
    ["runtime_wait", "bindingId"],
    ["runtime_status", "bindingId"],
  ]) {
    expect(
      schemaFor(name).properties?.[field]?.description?.trim().length,
    ).toBeGreaterThan(0);
  }
  const emptyWork = await call(client, "pulso_work_get", {});
  expect(emptyWork).toMatchObject({
    structuredContent: { ok: true, value: { work: null } },
  });
  const agentToolView = tools.tools.map(
    ({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }),
  );
  const createDescription = agentToolView.find(
    (definition) => definition.name === "work_create",
  )?.description;
  const itemDescription = agentToolView.find(
    (definition) => definition.name === "work_item",
  )?.description;
  const bindDescription = agentToolView.find(
    (definition) => definition.name === "runtime_bind",
  )?.description;
  expect(createDescription).toContain("Reuse");
  expect(createDescription).toContain("newObjective");
  expect(itemDescription).toContain("current objective");
  expect(bindDescription).toContain("ready WorkItem");
  expect(bindDescription).toContain("bindingId");
  for (const definition of agentToolView.filter(
    (candidate) =>
      candidate.name.startsWith("runtime_") &&
      !["runtime_bind"].includes(candidate.name),
  )) {
    expect(definition.description?.length).toBeLessThan(100);
    expect(definition.inputSchema.properties).toHaveProperty("bindingId");
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
  const workId = created.structuredContent?.value?.workId as string;
  expect(created.structuredContent?.value?.reused).toBe(false);
  expect(created.structuredContent?.value?.status).toBe("pending");
  expect(created.structuredContent?.value?.next).toContain("ready WorkItem");
  expect(created.structuredContent?.value).not.toHaveProperty("objective");
  expect(created.structuredContent?.value).not.toHaveProperty("workspaceId");
  const updated = await call(client, "pulso_work_update", {
    workId,
    title: "Updated MCP workflow",
  });
  expect(updated.structuredContent?.value).toMatchObject({
    workId,
    status: "pending",
  });
  const item = await call(client, "pulso_work_item", {
    operation: "create",
    workId,
    title: "complete item",
    kind: "implementation",
    assigneeId: "executor-a",
  });
  const itemId = item.structuredContent?.value?.workItemId as string;
  expect(item.structuredContent?.value).toMatchObject({
    workItemId: itemId,
    status: "ready",
  });
  expect(item.structuredContent?.value?.status).toBe("ready");
  expect(item.structuredContent?.value).not.toHaveProperty("title");
  expect(item.structuredContent?.value).not.toHaveProperty("description");
  const artifact = await call(client, "pulso_work_artifact", {
    workId,
    itemId,
    type: "report",
    uri: "file:///tmp/result.txt",
  });
  expect(artifact.structuredContent?.value).toMatchObject({
    artifactId: expect.any(String),
    type: "report",
  });

  const started = await call(client, "pulso_runtime_bind", {
    workItemId: itemId,
    executorId: "executor-a",
    provider: "test-runtime",
    externalExecutionId: "execution-a",
  });
  const bindingId = started.structuredContent?.value?.bindingId as string;
  expect(started.structuredContent?.value).toEqual({
    bindingId,
    expiresAt: expect.any(String),
    status: "active",
  });
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
  const noActiveWork = await call(client, "pulso_work_get", {});
  expect(noActiveWork).toMatchObject({
    structuredContent: { ok: true, value: { work: null } },
  });
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
    workItemId: failedItem.structuredContent?.value?.workItemId as string,
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
    workItemId: blockedItem.structuredContent?.value?.workItemId as string,
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

test("work_create is continuation-safe and requires explicit terminalization for a new objective", async () => {
  const runtime = bootstrapCapabilities(process.cwd(), {
    dataDir: `/tmp/pulso-mcp-continuity-${crypto.randomUUID()}`,
  });
  const server = createMcpServer(runtime);
  const client = new Client({ name: "pulso-mcp-continuity", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const first = await call(client, "pulso_work_create", {
    title: "Continuity A",
    objective: "Keep one objective across follow-ups",
  });
  const workA = first.structuredContent?.value?.workId as string;
  expect(first.structuredContent?.value).toMatchObject({
    workId: workA,
    reused: false,
  });

  const started = await call(client, "pulso_work_transition", {
    target: "work",
    id: workA,
    transition: "start",
    version: 1,
  });
  expect(started.structuredContent?.value?.status).toBe("active");

  const repeated = await Promise.all(
    Array.from({ length: 7 }, () =>
      call(client, "pulso_work_create", {
        title: "Follow-up",
        objective: "Keep one objective across follow-ups",
      }),
    ),
  );
  expect(repeated.every((result) => result.structuredContent?.ok)).toBe(true);
  expect(
    new Set(repeated.map((result) => result.structuredContent?.value?.workId)),
  ).toEqual(new Set([workA]));
  expect(
    repeated.every((result) => result.structuredContent?.value?.reused),
  ).toBe(true);
  expect(await runtime.work.list(runtime.workspaceId)).toHaveLength(1);

  const conflict = await call(client, "pulso_work_create", {
    title: "Continuity B",
    objective: "Start an unrelated objective",
    newObjective: true,
    reason: "The user changed objectives",
  });
  expect(conflict).toMatchObject({
    isError: true,
    structuredContent: {
      ok: false,
      error: {
        code: "WORK_ACTIVE_OBJECTIVE",
        recovery: expect.stringContaining("terminalize"),
      },
    },
  });
  expect(await runtime.work.list(runtime.workspaceId)).toHaveLength(1);

  const completed = await call(client, "pulso_work_transition", {
    target: "work",
    id: workA,
    transition: "complete",
    version: 2,
  });
  expect(completed.structuredContent?.value?.status).toBe("completed");
  const second = await call(client, "pulso_work_create", {
    title: "Continuity B",
    objective: "Start an unrelated objective",
    newObjective: true,
  });
  const workB = second.structuredContent?.value?.workId as string;
  expect(workB).not.toBe(workA);
  expect(second.structuredContent?.value).toMatchObject({
    workId: workB,
    reused: false,
  });
  expect(await runtime.work.list(runtime.workspaceId)).toHaveLength(2);

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
  const bindSchema = (await client.listTools()).tools.find(
    (definition) => definition.name === "runtime_bind",
  )?.inputSchema;
  expect(bindSchema?.properties).toHaveProperty("workId");
  expect(bindSchema?.properties).toHaveProperty("assigneeId");
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
  const binding = await call(client, "pulso_runtime_bind", {
    workItemId,
    workId,
    executorId: "explorer",
    assigneeId: "explorer",
    provider: "test-runtime",
    externalExecutionId: crypto.randomUUID(),
  });
  const bindingId = binding.structuredContent?.value?.bindingId as string;
  expect(binding.structuredContent?.value).toMatchObject({
    bindingId,
    status: "active",
  });
  expect(binding.structuredContent?.value).not.toHaveProperty("leaseId");

  const completed = await call(client, "pulso_runtime_complete", {
    bindingId,
    result: "Read-only repository review completed",
  });
  expect(completed.structuredContent?.value).toMatchObject({
    bindingId,
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
    assigneeId: "executor-b",
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
