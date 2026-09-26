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
type CapabilityError = {
  code: string;
  message: string;
  entity?: { type?: string; id?: string };
  expected?: string;
  actual?: string;
  recovery?: string;
};

const recoveries: Record<string, string> = {
  WORK_NOT_FOUND:
    "Use pulso_work_get to find a Work ID, or create the Work first.",
  WORK_ACTIVE_OBJECTIVE:
    "Complete or otherwise terminalize the current Work before starting a new objective.",
  WORK_ITEM_NOT_FOUND:
    "Create or retrieve a WorkItem, then pass its WorkItem ID.",
  WORK_ID_USED_AS_WORK_ITEM_ID:
    "Create or select a WorkItem inside that Work and retry with its WorkItem ID.",
  WORK_ITEM_WRONG_WORK:
    "Use a WorkItem whose parent Work ID matches workId, then retry.",
  WORK_ITEM_NOT_READY:
    "Use pulso_work_get to inspect the WorkItem, resolve prerequisites or resume it, then retry.",
  WORK_ITEM_NOT_EXECUTABLE:
    "Use pulso_work_get to select a ready WorkItem or prepare an eligible retry.",
  DEPENDENCY_NOT_SATISFIED:
    "Complete the prerequisite WorkItems, then retry with the dependent WorkItem ID.",
  ASSIGNMENT_REQUIRED:
    "Assign the WorkItem to executorId, then retry the bind.",
  ASSIGNMENT_INVALID:
    "Use the active assignee as executorId or reassign the WorkItem before retrying.",
  BINDING_NOT_FOUND:
    "Use the bindingId returned by pulso_runtime_bind; do not pass a Work or WorkItem ID.",
  BINDING_NOT_ACTIVE:
    "Use pulso_runtime_status to inspect this Binding; do not retry a terminal lifecycle action.",
  RUNTIME_EXECUTION_ALREADY_BOUND:
    "Retry pulso_runtime_bind with the same WorkItem, provider and externalExecutionId after the in-progress bind settles.",
  RUNTIME_EXECUTION_CONFLICT:
    "Use a new externalExecutionId for a new invocation; do not reuse one across WorkItems.",
  EXECUTION_NOT_ACTIVE:
    "Use pulso_runtime_status to inspect the Binding; do not retry an operation on an inactive execution.",
  LEASE_LOST:
    "Use pulso_runtime_status to inspect the Binding and WorkItem before starting a new invocation.",
  LEASE_EXPIRED:
    "Use pulso_runtime_status to confirm the Binding is no longer active before recovery.",
  FENCING_MISMATCH:
    "Stop this lifecycle operation and use pulso_runtime_status to inspect the current Binding.",
  RECONCILIATION_FAILED:
    "Retry pulso_runtime_status once; if reconciliation still fails, report the error code.",
  ACTIVE_LEASE_EXISTS:
    "Use pulso_runtime_status for the active execution; assignment cannot change while it is running.",
  LEASE_NOT_OWNER:
    "Use the lifecycle tool for the active Binding; an in-progress WorkItem cannot be changed directly.",
  EXECUTION_REQUIRED:
    "Use pulso_runtime_bind to start an execution on a ready WorkItem.",
  WORK_ITEMS_INCOMPLETE:
    "Complete the remaining WorkItems before completing the parent Work.",
  INVALID_STATE:
    "Use pulso_work_get to inspect current state and retry only after resolving the inconsistency.",
  INVALID_INPUT:
    "Check the required identifiers and values in the tool schema, then retry.",
  INVALID_RUNTIME_REFERENCE:
    "Provide a non-empty provider and externalExecutionId for this invocation.",
  EXECUTION_START_FAILED:
    "The WorkItem passed preflight but execution could not start; do not invoke the specialist until bind succeeds.",
  INTERNAL_ERROR:
    "Retry once; if the error persists, report this error code and operation.",
  STALE_VERSION:
    "Read the current Work or WorkItem version with pulso_work_get and retry using that version.",
  INVALID_TRANSITION:
    "Read the current lifecycle state with pulso_work_get and choose a permitted transition.",
  CROSS_WORK_DEPENDENCY:
    "Use dependency WorkItem IDs from the same parent Work.",
  DEPENDENCY_CYCLE: "Remove the dependency that creates a cycle, then retry.",
  ASSIGNMENT_NOT_FOUND: "Assign the WorkItem before changing its assignment.",
  EXECUTOR_NOT_ASSIGNEE:
    "Use the active assignee as executorId or reassign the WorkItem first.",
};

const entityFromInput = (input: unknown): CapabilityError["entity"] => {
  if (!input || typeof input !== "object") return undefined;
  const values = input as Record<string, unknown>;
  if (typeof values.bindingId === "string")
    return { type: "Binding", id: values.bindingId };
  if (typeof values.workItemId === "string")
    return { type: "WorkItem", id: values.workItemId };
  if (typeof values.itemId === "string")
    return { type: "WorkItem", id: values.itemId };
  if (typeof values.workId === "string")
    return { type: "Work", id: values.workId };
  return undefined;
};

const failure = (e: unknown, input?: unknown) => {
  let error: CapabilityError;
  if (e instanceof PulsoError || e instanceof RuntimeWorkError) {
    error = { code: e.code, message: e.message };
    if (e instanceof RuntimeWorkError) Object.assign(error, e.details);
  } else {
    error = {
      code: "INTERNAL_ERROR",
      message: "Unexpected internal capability failure.",
    };
  }
  if (error.code === "ITEM_NOT_FOUND") error.code = "WORK_ITEM_NOT_FOUND";
  if (error.code === "STORAGE_ERROR") error.code = "INTERNAL_ERROR";
  if (error.code === "ASSIGNMENT_NOT_FOUND") error.code = "ASSIGNMENT_REQUIRED";
  if (error.code === "EXECUTOR_NOT_ASSIGNEE") error.code = "ASSIGNMENT_INVALID";
  error.entity ??= entityFromInput(input);
  error.recovery ??= recoveries[error.code] ?? recoveries.INTERNAL_ERROR;
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
      return failure(e, x);
    }
  };
const workReference = (work: {
  id: string;
  status: string;
  version: number;
}) => ({
  workId: work.id,
  status: work.status,
  version: work.version,
});
const terminalWorkStatuses = new Set(["completed", "failed", "cancelled"]);
const workItemReference = (item: {
  id: string;
  status: string;
  version: number;
}) => ({
  workItemId: item.id,
  status: item.status,
  version: item.version,
});
const kind = z.string().min(1);
const workItemOperationSchema = z.discriminatedUnion("operation", [
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
]);
const workItemInputSchema = z.object({
  operation: z
    .enum(["create", "update", "assign", "reassign", "unassign"])
    .describe("Operation to perform; field requirements vary by operation."),
  workId: z
    .string()
    .optional()
    .describe(
      "Required for create: parent top-level Work ID, not the WorkItem ID returned by this operation.",
    ),
  itemId: z
    .string()
    .optional()
    .describe(
      "Required for update/assign/reassign/unassign: existing WorkItem ID, not its parent Work ID.",
    ),
  title: z
    .string()
    .optional()
    .describe("Required for create; optional replacement title for update."),
  description: z
    .string()
    .optional()
    .describe("Optional WorkItem context; replacement value for update."),
  kind: z
    .string()
    .optional()
    .describe(
      "Required for create; optional replacement WorkItem category for update.",
    ),
  dependencies: z
    .array(z.string())
    .optional()
    .describe(
      "For create: prerequisite WorkItem IDs from the same Work. All must be completed before execution.",
    ),
  assigneeId: z
    .string()
    .optional()
    .describe(
      "For create/assign/reassign: opaque specialist/executor identity. If omitted at create, runtime_bind may assign its executorId.",
    ),
  version: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Required for update: current WorkItem version for optimistic concurrency.",
    ),
});
const workTransitionOperationSchema = z.discriminatedUnion("target", [
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
]);
const workTransitionInputSchema = z.object({
  target: z
    .enum(["work", "item"])
    .describe(
      "Entity type: work targets a top-level Work; item targets a WorkItem.",
    ),
  id: z
    .string()
    .describe(
      "ID of the entity selected by target: Work ID or WorkItem ID. Never a Binding ID.",
    ),
  transition: z
    .enum([
      "start",
      "complete",
      "block",
      "wait",
      "resume",
      "fail",
      "cancel",
      "prepare_retry",
    ])
    .describe(
      "Validated lifecycle action; availability depends on target and current status.",
    ),
  reason: z
    .string()
    .optional()
    .describe("Optional concise reason for the transition."),
  version: z
    .number()
    .int()
    .positive()
    .describe("Current version of the selected Work or WorkItem."),
});
export const createMcpServer = (runtime: CapabilitiesRuntime) => {
  const server = new McpServer({ name: "pulso-work", version: "0.1.0" });
  server.registerTool(
    "work_create",
    {
      description:
        "Ensure a Work exists for the current objective. Reuse the active Work by default; set newObjective only for a clearly different objective.",
      inputSchema: z.object({
        title: z
          .string()
          .min(1)
          .describe(
            "Short human-readable title for the top-level Work objective.",
          ),
        objective: z
          .string()
          .min(1)
          .describe(
            "Outcome this Work tracks. A Work itself is not executable; execution happens on a WorkItem.",
          ),
        newObjective: z
          .boolean()
          .default(false)
          .describe(
            "Explicitly start a different objective. The current Work must be terminalized first.",
          ),
        reason: z
          .string()
          .min(1)
          .optional()
          .describe("Optional reason for explicitly starting a new objective."),
        items: z
          .array(
            z.object({
              title: z
                .string()
                .min(1)
                .describe(
                  "Title of an initial executable WorkItem inside this Work.",
                ),
              description: z
                .string()
                .optional()
                .describe("Optional context for this WorkItem."),
              kind: kind.describe(
                "WorkItem category, such as research, implementation, or validation.",
              ),
              dependencies: z
                .array(z.string())
                .optional()
                .describe(
                  "Leave empty for inline items; add dependencies after item creation.",
                ),
              assigneeId: z
                .string()
                .min(1)
                .optional()
                .describe(
                  "Optional opaque specialist/executor identity to assign to this WorkItem.",
                ),
            }),
          )
          .optional()
          .describe(
            "Optional independent executable items created with this Work.",
          ),
      }),
    },
    tool(async (x) => {
      const works = await runtime.work.list(runtime.workspaceId);
      const current = [...works]
        .reverse()
        .find((work) => !terminalWorkStatuses.has(work.status));
      if (current && x.newObjective) {
        throw new RuntimeWorkError(
          "WORK_ACTIVE_OBJECTIVE",
          "A Work objective is still active in this workspace.",
          undefined,
          {
            entity: { type: "Work", id: current.id },
            actual: current.status,
            expected: "completed, failed, or cancelled",
          },
        );
      }
      if (current)
        return {
          ...workReference(current),
          reused: true,
        };
      const { newObjective: _newObjective, reason: _reason, ...input } = x;
      const work = await runtime.work.create({
        ...input,
        workspaceId: runtime.workspaceId,
      });
      const items = x.items?.length
        ? (await runtime.work.snapshot(work.id)).items
        : [];
      return {
        ...workReference(work),
        reused: false,
        items: items.map(workItemReference),
        ...(x.items?.length
          ? {}
          : { next: "Create a ready WorkItem before binding." }),
      };
    }),
  );
  server.registerTool(
    "work_get",
    {
      description:
        "Resolve current/recent Work before creating one. With no Work, returns an empty summary; request full, events, or executions only when needed.",
      inputSchema: z.object({
        workId: z
          .string()
          .optional()
          .describe(
            "ID of a top-level Work container, not a WorkItem or Binding ID.",
          ),
        view: z
          .enum(["summary", "full", "events", "executions"])
          .default("summary")
          .describe(
            "summary: ready/active/blocked counts and nextItems; full: WorkItems and related entities; events: append-only history; executions: execution and lease status.",
          ),
      }),
    },
    tool(async (x) => {
      await runtime.recovery.recover();
      const works = await runtime.work.list(runtime.workspaceId);
      const id = x.workId ?? works.find((w) => w.status === "active")?.id;
      if (!id) return { work: null };
      const s = await runtime.work.snapshot(id);
      if (x.view === "full") return s;
      if (x.view === "events") return s.events;
      if (x.view === "executions")
        return { executions: s.executions, leases: s.leases };
      return {
        work: workReference(s.work),
        counts: s.items.reduce<Record<string, number>>((counts, item) => {
          counts[item.status] = (counts[item.status] ?? 0) + 1;
          return counts;
        }, {}),
        activeItems: s.items
          .filter((i) => i.status === "in_progress")
          .map(workItemReference),
        blockedItems: s.items
          .filter((i) => i.status === "blocked")
          .map(workItemReference),
        waitingItems: s.items
          .filter((i) => i.status === "waiting")
          .map(workItemReference),
        recoveryRequiredItems: s.items
          .filter((i) => i.status === "recovery_required")
          .map(workItemReference),
        nextItems: s.items
          .filter((i) => i.status === "ready")
          .map(workItemReference),
        activeExecutions: s.executions
          .filter((e) => e.status === "running")
          .map((e) => ({ workItemId: e.workItemId, status: e.status })),
        activeLeaseCount: s.leases.filter((l) => l.status === "active").length,
      };
    }),
  );
  server.registerTool(
    "work_update",
    {
      description:
        "Update a Work title or objective using its current version.",
      inputSchema: z.object({
        workId: z
          .string()
          .describe("ID of the top-level Work container; not a WorkItem ID."),
        title: z.string().min(1).optional().describe("Replacement Work title."),
        objective: z
          .string()
          .min(1)
          .optional()
          .describe("Replacement Work objective."),
        version: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Current Work version for optimistic concurrency."),
      }),
    },
    tool(async (x) =>
      workReference(await runtime.work.updateWork(x.workId, x)),
    ),
  );
  server.registerTool(
    "work_item",
    {
      description:
        "Create a bounded WorkItem under the current objective for implementation, investigation, fixes, verification, documentation, or commit steps.",
      inputSchema: workItemInputSchema,
    },
    tool(async (x) => {
      const parsed = workItemOperationSchema.safeParse(x);
      if (!parsed.success)
        throw new RuntimeWorkError(
          "INVALID_INPUT",
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          undefined,
          { expected: "Fields required for the selected WorkItem operation" },
        );
      const operation = parsed.data;
      if (operation.operation === "create") {
        const item = await runtime.work.addItem(operation);
        return workItemReference(item);
      }
      if (operation.operation === "update")
        return workItemReference(
          await runtime.work.updateItem(operation.itemId, operation),
        );
      if (operation.operation === "unassign") {
        const assignment = await runtime.work.unassign(operation.itemId);
        return {
          workItemId: operation.itemId,
          status: assignment.status,
        };
      }
      const assignment = await runtime.work.assign(
        operation.itemId,
        operation.assigneeId,
        operation.operation === "reassign",
      );
      return {
        workItemId: operation.itemId,
        assigneeId: assignment.assigneeId,
        status: assignment.status,
      };
    }),
  );
  server.registerTool(
    "work_transition",
    {
      description:
        "Apply a permitted non-runtime transition to a Work or WorkItem.",
      inputSchema: workTransitionInputSchema,
    },
    tool(async (x) => {
      const parsed = workTransitionOperationSchema.safeParse(x);
      if (!parsed.success)
        throw new RuntimeWorkError(
          "INVALID_INPUT",
          parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          undefined,
          {
            expected:
              "A transition allowed for the selected target and current status",
          },
        );
      const updated = await runtime.work.transition(
        parsed.data.target,
        parsed.data.id,
        parsed.data.transition,
        parsed.data.reason,
        parsed.data.version,
      );
      return parsed.data.target === "work"
        ? workReference(
            updated as { id: string; status: string; version: number },
          )
        : workItemReference(
            updated as {
              id: string;
              workId: string;
              status: string;
              version: number;
            },
          );
    }),
  );
  server.registerTool(
    "work_artifact",
    {
      description:
        "Register a durable artifact reference on its owning Work or WorkItem.",
      inputSchema: z.object({
        workId: z
          .string()
          .describe("ID of the top-level Work that owns the Artifact."),
        itemId: z
          .string()
          .optional()
          .describe(
            "Optional ID of a WorkItem inside workId; not a Binding ID.",
          ),
        type: z
          .string()
          .min(1)
          .describe(
            "Short Artifact kind, such as report, patch, or test-result.",
          ),
        uri: z
          .string()
          .url()
          .describe(
            "Supported durable file or HTTP(S) URI; do not provide file contents.",
          ),
        description: z
          .string()
          .optional()
          .describe(
            "Optional concise explanation of why the Artifact matters.",
          ),
      }),
    },
    tool(async (x) => {
      const artifact = await runtime.work.artifact(x);
      return { artifactId: artifact.id, type: artifact.type };
    }),
  );
  const bindingView = (binding: {
    bindingId: string;
    expiresAt: string;
    status: string;
  }) => ({
    bindingId: binding.bindingId,
    expiresAt: binding.expiresAt,
    status: binding.status,
  });
  server.registerTool(
    "runtime_bind",
    {
      description:
        "Start a runtime execution for a ready WorkItem. Use the returned bindingId for every lifecycle action.",
      inputSchema: z.object({
        workItemId: z
          .string()
          .describe(
            "ID of an existing ready WorkItem. NOT its parent Work ID. Returned by pulso_work_item create or pulso_work_get.",
          ),
        workId: z
          .string()
          .optional()
          .describe("Optional expected parent Work ID."),
        executorId: z
          .string()
          .min(1)
          .describe("Specialist identity that will execute the WorkItem."),
        assigneeId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional expected active assignee identity."),
        provider: z.string().min(1).describe("Runtime provider name."),
        externalExecutionId: z
          .string()
          .min(1)
          .describe("Fresh delegation ID used to correlate this invocation."),
        sessionId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional host session ID for diagnostics."),
        metadata: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            "Optional safe string metadata; do not include prompts, credentials, tokens, or source content.",
          ),
      }),
    },
    tool(async (x) =>
      bindingView(
        await runtime.runtimeAdapter.bind({
          workItemId: x.workItemId,
          workId: x.workId,
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
    "runtime_heartbeat",
    {
      description:
        "Renew an active runtime lease when more execution time is needed.",
      inputSchema: z.object({
        bindingId: z
          .string()
          .describe(
            "Binding ID returned by pulso_runtime_bind; not a Work ID or WorkItem ID and not an externalExecutionId.",
          ),
      }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.heartbeat(x.bindingId)),
    ),
  );
  server.registerTool(
    "runtime_complete",
    {
      description:
        "Complete a bound execution only after validating its specialist result.",
      inputSchema: z.object({
        bindingId: z
          .string()
          .describe(
            "Binding ID returned by pulso_runtime_bind; not a Work ID or WorkItem ID and not an externalExecutionId.",
          ),
        result: z
          .string()
          .optional()
          .describe(
            "Optional concise validated result summary to persist on the WorkItem.",
          ),
      }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.complete(x.bindingId, x.result)),
    ),
  );
  server.registerTool(
    "runtime_fail",
    {
      description: "Fail a bound execution with a concise operational reason.",
      inputSchema: z.object({
        bindingId: z
          .string()
          .describe(
            "Binding ID returned by pulso_runtime_bind; not a Work ID or WorkItem ID and not an externalExecutionId.",
          ),
        reason: z
          .string()
          .min(1)
          .describe("Concise reason the external execution failed."),
      }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.fail(x.bindingId, x.reason)),
    ),
  );
  server.registerTool(
    "runtime_cancel",
    {
      description: "Cancel a bound execution when it is intentionally stopped.",
      inputSchema: z.object({
        bindingId: z
          .string()
          .describe(
            "Binding ID returned by pulso_runtime_bind; not a Work ID or WorkItem ID and not an externalExecutionId.",
          ),
        reason: z
          .string()
          .optional()
          .describe("Optional concise cancellation reason."),
      }),
    },
    tool(async (x) =>
      bindingView(await runtime.runtimeAdapter.cancel(x.bindingId, x.reason)),
    ),
  );
  for (const target of ["blocked", "waiting"] as const) {
    server.registerTool(
      `runtime_${target === "blocked" ? "block" : "wait"}`,
      {
        description: `${target === "blocked" ? "Block" : "Wait on"} a bound execution that needs external input before it can proceed.`,
        inputSchema: z.object({
          bindingId: z
            .string()
            .describe(
              "Binding ID returned by pulso_runtime_bind; not a Work ID or WorkItem ID and not an externalExecutionId.",
            ),
          reason: z
            .string()
            .optional()
            .describe("Concise blocker or wait reason."),
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
    "runtime_status",
    {
      description: "Read and reconcile the status of a bound execution.",
      inputSchema: z.object({
        bindingId: z
          .string()
          .describe(
            "Binding ID returned by pulso_runtime_bind; not a Work ID or WorkItem ID and not an externalExecutionId.",
          ),
      }),
    },
    tool(async (x) => {
      await runtime.runtimeAdapter.reconcile();
      return bindingView(await runtime.runtimeAdapter.get(x.bindingId));
    }),
  );
  return server;
};
export const runStdio = async (runtime: CapabilitiesRuntime) =>
  createMcpServer(runtime).connect(new StdioServerTransport());
