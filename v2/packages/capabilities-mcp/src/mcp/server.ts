import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PulsoError } from "../../../working-system/src";
import type { CapabilitiesRuntime } from "../bootstrap";
import { RuntimeWorkError } from "../runtime/errors";

const text = (value: unknown) => ({
  content: [
    { type: "text" as const, text: JSON.stringify({ ok: true, value }) },
  ],
  structuredContent: { ok: true, value },
});
const failure = (e: unknown) => {
  const error =
    e instanceof PulsoError || e instanceof RuntimeWorkError
      ? { code: e.code, message: e.message }
      : { code: "STORAGE_ERROR", message: "Unexpected storage failure" };
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify({ ok: false, error }) },
    ],
    structuredContent: { ok: false, error },
  };
};
const tool =
  <T>(fn: (x: T) => Promise<unknown>) =>
  async (x: T) => {
    try {
      return text(await fn(x));
    } catch (e) {
      return failure(e);
    }
  };
const kind = z.string().min(1);
export const createMcpServer = (runtime: CapabilitiesRuntime) => {
  const server = new McpServer({ name: "pulso-work", version: "0.1.0" });
  server.registerTool(
    "pulso_work_create",
    {
      description:
        "Create authoritative work and optional DAG items. Use to begin a tracked objective; do not use it to mutate lifecycle. Returns the created work. Items with no incomplete dependencies become ready.",
      inputSchema: z.object({
        title: z.string().min(1),
        objective: z.string().min(1),
        items: z
          .array(
            z.object({
              title: z.string().min(1),
              description: z.string().optional(),
              kind,
              dependencies: z.array(z.string()).optional(),
              assigneeId: z.string().min(1).optional(),
            }),
          )
          .optional(),
      }),
    },
    tool((x) =>
      runtime.work.create({ ...x, workspaceId: runtime.workspaceId }),
    ),
  );
  server.registerTool(
    "pulso_work_get",
    {
      description:
        "Read authoritative work state after lazy recovery. Use for status, dependencies, leases and history; it does not change work. Returns a full snapshot or summary for a supplied work ID.",
      inputSchema: z.object({
        workId: z.string().optional(),
        view: z
          .enum(["summary", "full", "events", "executions"])
          .default("summary"),
      }),
    },
    tool(async (x) => {
      await runtime.recovery.recover();
      const works = await runtime.work.list(runtime.workspaceId);
      const id =
        x.workId ??
        works.find((w) => w.status === "active")?.id ??
        works.at(-1)?.id;
      if (!id) throw new PulsoError("WORK_NOT_FOUND", "No work in workspace");
      const s = await runtime.work.snapshot(id);
      if (x.view === "full") return s;
      if (x.view === "events") return s.events;
      if (x.view === "executions")
        return { executions: s.executions, leases: s.leases };
      return {
        work: s.work,
        counts: s.items.reduce<Record<string, number>>((counts, item) => {
          counts[item.status] = (counts[item.status] ?? 0) + 1;
          return counts;
        }, {}),
        activeItems: s.items.filter((i) => i.status === "in_progress"),
        blockedItems: s.items.filter((i) => i.status === "blocked"),
        waitingItems: s.items.filter((i) => i.status === "waiting"),
        recoveryRequiredItems: s.items.filter(
          (i) => i.status === "recovery_required",
        ),
        nextItems: s.items.filter((i) => i.status === "ready"),
        activeExecutions: s.executions.filter((e) => e.status === "running"),
        activeLeases: s.leases.filter((l) => l.status === "active"),
      };
    }),
  );
  server.registerTool(
    "pulso_work_update",
    {
      description:
        "Update descriptive title or objective with optimistic version checking. Do not use for lifecycle state; use pulso_work_transition instead.",
      inputSchema: z.object({
        workId: z.string(),
        title: z.string().min(1).optional(),
        objective: z.string().min(1).optional(),
        version: z.number().int().positive().optional(),
      }),
    },
    tool((x) => runtime.work.updateWork(x.workId, x)),
  );
  server.registerTool(
    "pulso_work_item",
    {
      description:
        "Create, describe, assign, reassign or unassign an item. Assignment stores an opaque assignee identity and does not grant execution authority. Returns the changed item or assignment.",
      inputSchema: z.discriminatedUnion("operation", [
        z.object({
          operation: z.literal("create"),
          workId: z.string(),
          title: z.string().min(1),
          description: z.string().optional(),
          kind,
          dependencies: z.array(z.string()).optional(),
          assigneeId: z.string().min(1).optional(),
        }),
        z.object({
          operation: z.literal("update"),
          itemId: z.string(),
          title: z.string().min(1).optional(),
          description: z.string().optional(),
          kind: kind.optional(),
          version: z.number().int().positive(),
        }),
        z.object({
          operation: z.enum(["assign", "reassign"]),
          itemId: z.string(),
          assigneeId: z.string().min(1),
        }),
        z.object({ operation: z.literal("unassign"), itemId: z.string() }),
      ]),
    },
    tool((x) =>
      x.operation === "create"
        ? runtime.work.addItem(x)
        : x.operation === "update"
          ? runtime.work.updateItem(x.itemId, x)
          : x.operation === "unassign"
            ? runtime.work.unassign(x.itemId)
            : runtime.work.assign(
                x.itemId,
                x.assigneeId,
                x.operation === "reassign",
              ),
    ),
  );
  server.registerTool(
    "pulso_work_transition",
    {
      description:
        "Apply a named non-execution lifecycle transition. Use for work control, block/wait/resume, retry preparation, failure, completion or cancellation. It never accepts an arbitrary status setter, and cannot mutate an in-progress item because its lease-owning execution has that authority.",
      inputSchema: z.discriminatedUnion("target", [
        z.object({
          target: z.literal("work"),
          id: z.string(),
          transition: z.enum([
            "start",
            "complete",
            "block",
            "wait",
            "resume",
            "fail",
            "cancel",
          ]),
          reason: z.string().optional(),
          version: z.number().int().positive(),
        }),
        z.object({
          target: z.literal("item"),
          id: z.string(),
          transition: z.enum([
            "block",
            "wait",
            "resume",
            "fail",
            "cancel",
            "prepare_retry",
          ]),
          reason: z.string().optional(),
          version: z.number().int().positive(),
        }),
      ]),
    },
    tool((x) =>
      runtime.work.transition(
        x.target,
        x.id,
        x.transition,
        x.reason,
        x.version,
      ),
    ),
  );
  server.registerTool(
    "pulso_work_artifact",
    {
      description:
        "Register a small external artifact reference only. Use after producing a result; never use for blob upload. Accepts safe file, HTTP(S) URIs and returns the immutable reference.",
      inputSchema: z.object({
        workId: z.string(),
        itemId: z.string().optional(),
        type: z.string().min(1),
        uri: z.string().url(),
        description: z.string().optional(),
      }),
    },
    tool((x) => runtime.work.artifact(x)),
  );
  const bindingView = (binding: {
    bindingId: string;
    runtime: { provider: string; executionId: string; sessionId?: string };
    workId: string;
    workItemId: string;
    createdAt: string;
    expiresAt: string;
    status: string;
  }) => ({
    bindingId: binding.bindingId,
    runtime: binding.runtime,
    workId: binding.workId,
    workItemId: binding.workItemId,
    createdAt: binding.createdAt,
    expiresAt: binding.expiresAt,
    status: binding.status,
  });
  server.registerTool(
    "pulso_runtime_bind",
    {
      description:
        "Bind an external execution to a ready tracked work item. Repeating the same provider and external execution ID returns the existing binding. Returns a binding ID for all later runtime lifecycle operations.",
      inputSchema: z.object({
        workItemId: z.string(),
        executorId: z.string().min(1),
        assigneeId: z.string().min(1).optional(),
        provider: z.string().min(1),
        externalExecutionId: z.string().min(1),
        sessionId: z.string().min(1).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      }),
    },
    tool(async (x) =>
      bindingView(
        await runtime.runtimeAdapter.bind({
          workItemId: x.workItemId,
          executorId: x.executorId,
          assigneeId: x.assigneeId,
          runtimeReference: {
            provider: x.provider,
            executionId: x.externalExecutionId,
            sessionId: x.sessionId,
            metadata: x.metadata,
          },
        }),
      ),
    ),
  );
  server.registerTool(
    "pulso_runtime_heartbeat",
    {
      description:
        "Renew the execution lifecycle represented by a binding ID. Lease authority is resolved internally.",
      inputSchema: z.object({ bindingId: z.string() }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.heartbeat(x.bindingId)),
    ),
  );
  server.registerTool(
    "pulso_runtime_complete",
    {
      description:
        "Complete the external execution represented by a binding ID and persist its result in tracked work.",
      inputSchema: z.object({
        bindingId: z.string(),
        result: z.string().optional(),
      }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.complete(x.bindingId, x.result)),
    ),
  );
  server.registerTool(
    "pulso_runtime_fail",
    {
      description:
        "Record failure of the external execution represented by a binding ID.",
      inputSchema: z.object({
        bindingId: z.string(),
        reason: z.string().min(1),
      }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.fail(x.bindingId, x.reason)),
    ),
  );
  server.registerTool(
    "pulso_runtime_cancel",
    {
      description: "Cancel the external execution represented by a binding ID.",
      inputSchema: z.object({
        bindingId: z.string(),
        reason: z.string().optional(),
      }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.cancel(x.bindingId, x.reason)),
    ),
  );
  for (const target of ["blocked", "waiting"] as const) {
    server.registerTool(
      `pulso_runtime_${target === "blocked" ? "block" : "wait"}`,
      {
        description: `Suspend an active external execution as ${target}. The binding retains history while internal execution authority is released.`,
        inputSchema: z.object({
          bindingId: z.string(),
          reason: z.string().optional(),
        }),
      },
      tool(async (x) =>
        bindingView(
          await runtime.runtimeAdapter.suspend(x.bindingId, target, x.reason),
        ),
      ),
    );
  }
  server.registerTool(
    "pulso_runtime_status",
    {
      description:
        "Read the lifecycle status of an external execution binding without exposing internal execution authority.",
      inputSchema: z.object({ bindingId: z.string() }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.get(x.bindingId)),
    ),
  );
  return server;
};
export const runStdio = async (runtime: CapabilitiesRuntime) =>
  createMcpServer(runtime).connect(new StdioServerTransport());
