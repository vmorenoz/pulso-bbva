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
    "pulso_work_create",
    {
      description:
        "WHAT: Creates a top-level Work container representing an objective; a Work is not directly executable and is different from a WorkItem. WHEN: Use to start tracking a new objective. PREREQUISITES: Provide a non-empty title and objective. You may create initial independent WorkItems inline; create dependency chains later with pulso_work_item when their WorkItem IDs are available. RETURNS: The new Work ID and status, any inline WorkItems with their IDs, plus a next step when no WorkItems were created. DO NOT USE WHEN: You need to execute or delegate work directly; create a WorkItem with pulso_work_item first. Use pulso_work_transition for Work lifecycle changes.",
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
                  "Must be empty for inline initial WorkItems; create dependency links later with pulso_work_item using existing WorkItem IDs from this Work.",
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
            "Optional initial WorkItems. Omit only when you will create them later with pulso_work_item.",
          ),
      }),
    },
    tool(async (x) => {
      const work = await runtime.work.create({
        ...x,
        workspaceId: runtime.workspaceId,
      });
      const items = x.items?.length
        ? (await runtime.work.snapshot(work.id)).items
        : [];
      return {
        ...work,
        workId: work.id,
        items: items.map((item) => ({
          ...item,
          workItemId: item.id,
          workId: item.workId,
        })),
        ...(x.items?.length
          ? {}
          : {
              next: "Create a WorkItem with pulso_work_item before binding an external execution.",
            }),
      };
    }),
  );
  server.registerTool(
    "pulso_work_get",
    {
      description:
        "WHAT: Reads authoritative Work, WorkItem, dependency, assignment, Artifact, Execution, Lease and event state after Work recovery. WHEN: Use to find IDs, check status/prerequisites, or recover Work state after uncertainty. PREREQUISITES: Supply a Work ID, or omit it to select the active/latest Work when one exists. RETURNS: summary lists counts, ready nextItems, active/blocked/waiting items and running executions; full includes WorkItems with IDs/dependencies/status plus assignments, Artifacts, Executions, Leases and events; events returns history; executions returns execution/lease lifecycle. Use pulso_runtime_status for Binding state. DO NOT USE WHEN: You need to mutate state; use the matching Work, WorkItem, or runtime lifecycle tool.",
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
        "WHAT: Updates only descriptive fields on a Work using optimistic version checking. WHEN: Use to correct its title or objective. PREREQUISITES: Provide the Work ID and current version when available. RETURNS: The updated Work. DO NOT USE WHEN: Changing lifecycle state or editing a WorkItem; use pulso_work_transition or pulso_work_item instead.",
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
    tool((x) => runtime.work.updateWork(x.workId, x)),
  );
  server.registerTool(
    "pulso_work_item",
    {
      description:
        "WHAT: Creates or manages executable, trackable WorkItems inside a Work. WHEN: Create a WorkItem before delegating/executing; use other operations to edit or assign one. PREREQUISITES: Create the parent Work first; for create, provide its Work ID. RETURNS: Create prominently returns workItemId (the WorkItem ID), parent workId and status; this WorkItem ID is required by pulso_runtime_bind. DO NOT USE WHEN: You need to change Work lifecycle or an active external execution; use pulso_work_transition or the matching pulso_runtime_* tool.",
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
        return { ...item, workItemId: item.id, workId: item.workId };
      }
      if (operation.operation === "update")
        return runtime.work.updateItem(operation.itemId, operation);
      if (operation.operation === "unassign")
        return runtime.work.unassign(operation.itemId);
      return runtime.work.assign(
        operation.itemId,
        operation.assigneeId,
        operation.operation === "reassign",
      );
    }),
  );
  server.registerTool(
    "pulso_work_transition",
    {
      description:
        "WHAT: Changes Work or WorkItem lifecycle through validated semantic transitions. WHEN: Use for non-runtime control such as starting/completing a Work, blocking/waiting/resuming an unbound WorkItem, or preparing an eligible retry. PREREQUISITES: Supply the exact Work or WorkItem ID, allowed transition and current version. RETURNS: The updated entity. DO NOT USE WHEN: Completing, failing, cancelling, blocking or waiting an active externally-bound execution; use its pulso_runtime_* lifecycle tool with bindingId instead.",
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
      return runtime.work.transition(
        parsed.data.target,
        parsed.data.id,
        parsed.data.transition,
        parsed.data.reason,
        parsed.data.version,
      );
    }),
  );
  server.registerTool(
    "pulso_work_artifact",
    {
      description:
        "WHAT: Registers a reference to a meaningful Artifact produced or used by tracked Work. WHEN: Use after producing a durable report, patch, or other relevant output. PREREQUISITES: The Work must exist; an optional WorkItem ID must belong to it; URI must be a supported file or HTTP(S) reference. RETURNS: The immutable Artifact reference. DO NOT USE WHEN: Uploading full source content, temporary files, or irrelevant logs; store only the URI and concise description.",
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
        "WHAT: Binds an external specialist/runtime invocation to an existing executable WorkItem. WHEN: Call immediately before invoking the specialist or external execution that will perform the WorkItem. PREREQUISITES: The WorkItem must exist, be ready, have completed prerequisites, and match the active assignee; if unassigned, this operation assigns executorId. Pass a WorkItem ID, NOT the parent Work ID. RETURNS: bindingId, workItemId and active status. Use bindingId for pulso_runtime_complete/fail/cancel/block/wait/status and heartbeat. DO NOT USE WHEN: No WorkItem exists, the WorkItem is not ready, or you only have a Work ID; create/select a WorkItem first. Do not manage executionId, leaseId or fencingToken yourself.",
      inputSchema: z.object({
        workItemId: z
          .string()
          .describe(
            "ID of an existing ready WorkItem. NOT its parent Work ID. Returned by pulso_work_item create or pulso_work_get.",
          ),
        workId: z
          .string()
          .optional()
          .describe(
            "Optional expected parent Work ID; when supplied, the WorkItem must belong to it.",
          ),
        executorId: z
          .string()
          .min(1)
          .describe(
            "Opaque identity of the specialist/runtime executor that will perform this WorkItem.",
          ),
        assigneeId: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional expected assignee identity. If provided, it must equal executorId and the active assignment.",
          ),
        provider: z
          .string()
          .min(1)
          .describe(
            "Stable provider name for the active runtime's native specialist execution.",
          ),
        externalExecutionId: z
          .string()
          .min(1)
          .describe(
            "Stable identifier generated by orchestration for this specialist invocation/delegation; reuse it only to retry/correlate this same invocation.",
          ),
        sessionId: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Optional host session ID that contains the specialist invocation.",
          ),
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
    "pulso_runtime_heartbeat",
    {
      description:
        "WHAT: Renews an active external execution's lifecycle. WHEN: Use while the bound execution is still running and needs more time. PREREQUISITES: Requires the bindingId returned by pulso_runtime_bind. RETURNS: The current Binding status and expiry. DO NOT USE WHEN: You have a Work ID or WorkItem ID instead of bindingId, or the execution is terminal; use the relevant lifecycle/status tool.",
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
    "pulso_runtime_complete",
    {
      description:
        "WHAT: Completes the active external execution and records its result on tracked work. WHEN: Use only after the specialist/external execution has finished successfully and its pulso-result has been validated. PREREQUISITES: Requires bindingId returned by pulso_runtime_bind. RETURNS: Completed Binding and linked WorkItem status. DO NOT USE WHEN: You have a Work ID or WorkItem ID instead of bindingId, or the execution failed, was cancelled, blocked, or is waiting; use the matching pulso_runtime_* tool.",
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
    "pulso_runtime_fail",
    {
      description:
        "WHAT: Records that the bound external execution failed. WHEN: Use after the specialist/external execution returns a failure. PREREQUISITES: Requires bindingId returned by pulso_runtime_bind and a concise failure reason. RETURNS: Failed Binding and linked WorkItem status. DO NOT USE WHEN: You have a Work ID or WorkItem ID instead of bindingId, or the execution succeeded, was cancelled, blocked, or is waiting; use the matching pulso_runtime_* tool.",
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
    "pulso_runtime_cancel",
    {
      description:
        "WHAT: Cancels the bound external execution. WHEN: Use when the invocation is intentionally stopped without success/failure. PREREQUISITES: Requires bindingId returned by pulso_runtime_bind. RETURNS: Cancelled Binding and linked WorkItem status. DO NOT USE WHEN: You have a Work ID or WorkItem ID instead of bindingId, or the execution succeeded, failed, is blocked, or is waiting; use the matching pulso_runtime_* tool.",
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
      `pulso_runtime_${target === "blocked" ? "block" : "wait"}`,
      {
        description: `WHAT: Suspends the active external execution as ${target}. WHEN: Use when the execution cannot currently proceed and must be resumed later (wait) or is blocked on a condition (block). PREREQUISITES: Requires bindingId returned by pulso_runtime_bind. RETURNS: Suspended Binding and linked WorkItem status. DO NOT USE WHEN: You have a Work ID or WorkItem ID instead of bindingId, or the execution completed, failed, or was cancelled; use the matching pulso_runtime_* tool.`,
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
    "pulso_runtime_status",
    {
      description:
        "WHAT: Reads a Binding, its linked WorkItem and execution lifecycle without exposing internal authority details. WHEN: Use for recovery, uncertainty after a host/runtime interruption, or to check whether an execution is still authoritative. PREREQUISITES: Requires bindingId returned by pulso_runtime_bind. RETURNS: Binding status and linked Work/WorkItem IDs. DO NOT USE WHEN: You have a Work ID or WorkItem ID instead of bindingId, or only an externalExecutionId; recover the bindingId first.",
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
