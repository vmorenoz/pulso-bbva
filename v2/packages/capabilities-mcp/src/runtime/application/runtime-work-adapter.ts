import type {
  Assignment,
  Execution,
  WorkItem,
  WorkLease,
} from "../../../../working-system/src/domain";
import type {
  ExecutionHandle,
  RuntimeBindingStatus,
  RuntimeExecutionBinding,
} from "../contracts/runtime-execution";
import type { RuntimeExecutionReference } from "../contracts/runtime-reference";
import { runtimeReferenceKey } from "../contracts/runtime-reference";
import { RuntimeWorkError, runtimeError } from "../errors";
import type { Clock } from "../ports/clock";
import { systemClock } from "../ports/clock";
import type { WorkingSystemGateway } from "../ports/working-system-gateway";

export interface BindingRepository {
  reserve(input: {
    bindingId: string;
    runtime: RuntimeExecutionReference;
    workItemId: string;
    createdAt: string;
  }): Promise<RuntimeExecutionBinding | undefined>;
  finalize(binding: RuntimeExecutionBinding): Promise<void>;
  get(bindingId: string): Promise<RuntimeExecutionBinding | undefined>;
  getByRuntime(
    runtime: RuntimeExecutionReference,
  ): Promise<RuntimeExecutionBinding | undefined>;
  list(): Promise<RuntimeExecutionBinding[]>;
  updateStatus(
    bindingId: string,
    status: RuntimeBindingStatus,
  ): Promise<RuntimeExecutionBinding>;
  removePending(bindingId: string): Promise<void>;
}

export interface BindingInput {
  workItemId: string;
  workId?: string;
  executorId: string;
  assigneeId?: string;
  runtimeReference: RuntimeExecutionReference;
}

export interface BindResult extends RuntimeExecutionBinding, ExecutionHandle {}

export interface HeartbeatPolicy {
  leaseTtlMs: number;
  heartbeatIntervalMs: number;
  gracePeriodMs?: number;
}

export interface RuntimeAdapterLogger {
  info(
    event: string,
    fields: Record<string, string | number | undefined>,
  ): void;
}

const silentLogger: RuntimeAdapterLogger = { info: () => undefined };

const id = () => crypto.randomUUID();
const isWorkError = (value: unknown): value is { code: string } =>
  typeof value === "object" && value !== null && "code" in value;

export class RuntimeWorkAdapter {
  private readonly bindLocks = new Map<string, Promise<BindResult>>();

  constructor(
    private readonly repository: BindingRepository,
    private readonly work: WorkingSystemGateway,
    private readonly clock: Clock = systemClock,
    readonly heartbeatPolicy: HeartbeatPolicy = {
      leaseTtlMs: 300_000,
      heartbeatIntervalMs: 100_000,
    },
    private readonly logger: RuntimeAdapterLogger = silentLogger,
  ) {}

  async bind(input: BindingInput): Promise<BindResult> {
    this.validateReference(input.runtimeReference);
    if (!input.workItemId || !input.executorId)
      runtimeError("INVALID_INPUT", "workItemId and executorId are required");
    const key = runtimeReferenceKey(input.runtimeReference);
    const existing = this.bindLocks.get(key);
    if (existing) return existing;
    const operation = this.bindLocked(input, key);
    this.bindLocks.set(key, operation);
    try {
      const result = await operation;
      this.logger.info("binding.created", {
        bindingId: result.bindingId,
        runtime: result.runtime.provider,
        executionId: result.executionId,
        leaseId: result.leaseId,
      });
      return result;
    } finally {
      this.bindLocks.delete(key);
    }
  }

  private async bindLocked(
    input: BindingInput,
    _key: string,
  ): Promise<BindResult> {
    const found = await this.repository.getByRuntime(input.runtimeReference);
    if (found) {
      if (found.workItemId !== input.workItemId)
        runtimeError(
          "RUNTIME_EXECUTION_CONFLICT",
          "Runtime execution is bound to another WorkItem",
        );
      if (found.status === "creating")
        runtimeError(
          "RUNTIME_EXECUTION_ALREADY_BOUND",
          "Runtime execution binding is being created",
        );
      if (input.workId && input.workId !== found.workId)
        runtimeError(
          "WORK_ITEM_WRONG_WORK",
          `WorkItem '${input.workItemId}' belongs to Work '${found.workId}', not '${input.workId}'.`,
        );
      return this.result(found);
    }
    const item = await this.preflight(input);
    const bindingId = id();
    const reserved = await this.repository.reserve({
      bindingId,
      runtime: input.runtimeReference,
      workItemId: input.workItemId,
      createdAt: this.clock.now().toISOString(),
    });
    if (reserved) {
      if (reserved.workItemId !== input.workItemId)
        runtimeError(
          "RUNTIME_EXECUTION_CONFLICT",
          "Runtime execution is bound to another WorkItem",
        );
      if (reserved.status === "creating")
        runtimeError(
          "RUNTIME_EXECUTION_ALREADY_BOUND",
          "Runtime execution binding is being created",
        );
      if (input.workId && input.workId !== reserved.workId)
        runtimeError(
          "WORK_ITEM_WRONG_WORK",
          `WorkItem '${input.workItemId}' belongs to Work '${reserved.workId}', not '${input.workId}'.`,
        );
      return this.result(reserved);
    }
    let started: { execution: Execution; lease: WorkLease } | undefined;
    try {
      const assignment = await this.ensureAssignment(
        input.workItemId,
        input.executorId,
        input.assigneeId,
      );
      started = await this.work.startExecution({
        workItemId: input.workItemId,
        executorId: input.executorId,
        runtime: input.runtimeReference,
      });
      const binding: RuntimeExecutionBinding = {
        bindingId,
        runtime: input.runtimeReference,
        workId: item.workId,
        workItemId: item.id,
        assignmentId: assignment?.id ?? started.execution.assignmentId,
        executionId: started.execution.id,
        leaseId: started.lease.id,
        fencingToken: started.lease.fencingToken,
        createdAt: this.clock.now().toISOString(),
        expiresAt: started.lease.expiresAt,
        status: "active",
      };
      await this.repository.finalize(binding);
      return this.result(binding);
    } catch (cause) {
      if (started) {
        try {
          await this.work.revoke({
            leaseId: started.lease.id,
            reason: "runtime binding creation failed",
          });
        } catch {
          // The Work System remains authoritative; reconciliation handles a failed compensation.
        }
      }
      await this.repository.removePending(bindingId);
      if (cause instanceof RuntimeWorkError) throw cause;
      if (isWorkError(cause)) throw this.mapStartError(cause, input.workItemId);
      throw new RuntimeWorkError(
        "EXECUTION_START_FAILED",
        "Could not start Work execution",
        cause,
      );
    }
  }

  private async preflight(input: BindingInput): Promise<WorkItem> {
    const inspected = await this.work.inspectItem(input.workItemId);
    const item = inspected?.items.find(
      (candidate) => candidate.id === input.workItemId,
    );
    if (!item) {
      const possibleWork = await this.work.inspectWork(input.workItemId);
      if (!possibleWork.work)
        throw new RuntimeWorkError(
          "WORK_ITEM_NOT_FOUND",
          `No WorkItem exists with id '${input.workItemId}'.`,
          undefined,
          {
            entity: { type: "WorkItem", id: input.workItemId },
            expected: "An existing WorkItem ID",
            actual: "No WorkItem or Work with this ID",
          },
        );
      throw new RuntimeWorkError(
        "WORK_ID_USED_AS_WORK_ITEM_ID",
        "pulso_runtime_bind expects a WorkItem ID, but the supplied ID belongs to a Work.",
        undefined,
        {
          entity: { type: "Work", id: input.workItemId },
          expected: "WorkItem ID",
          actual: "Work ID",
        },
      );
    }

    if (input.workId && item.workId !== input.workId)
      throw new RuntimeWorkError(
        "WORK_ITEM_WRONG_WORK",
        `WorkItem '${item.id}' belongs to a different Work than '${input.workId}'.`,
        undefined,
        {
          entity: { type: "WorkItem", id: item.id },
          expected: input.workId,
          actual: item.workId,
        },
      );

    const snapshot = await this.work.inspectWork(item.workId);
    if (!snapshot.work)
      throw new RuntimeWorkError(
        "WORK_NOT_FOUND",
        `No Work exists with id '${item.workId}'.`,
        undefined,
        { entity: { type: "Work", id: item.workId } },
      );
    const current =
      snapshot.items.find((candidate) => candidate.id === item.id) ?? item;
    const incompleteDependencies = current.dependencies.filter(
      (dependencyId) =>
        !snapshot.items.some(
          (dependency) =>
            dependency.id === dependencyId && dependency.status === "completed",
        ),
    );
    if (incompleteDependencies.length > 0)
      throw new RuntimeWorkError(
        "DEPENDENCY_NOT_SATISFIED",
        `WorkItem '${item.id}' has incomplete prerequisite WorkItems.`,
        undefined,
        {
          entity: { type: "WorkItem", id: item.id },
          expected: "All prerequisite WorkItems completed",
          actual: `Incomplete WorkItem IDs: ${incompleteDependencies.join(", ")}`,
        },
      );

    if (current.status !== "ready") {
      const notReady = ["pending", "blocked", "waiting"].includes(
        current.status,
      );
      throw new RuntimeWorkError(
        notReady ? "WORK_ITEM_NOT_READY" : "WORK_ITEM_NOT_EXECUTABLE",
        `WorkItem '${item.id}' has status '${current.status}' and cannot be bound for execution.`,
        undefined,
        {
          entity: { type: "WorkItem", id: item.id },
          expected: "ready",
          actual: current.status,
        },
      );
    }

    const assignment = snapshot.assignments.find(
      (candidate) =>
        candidate.workItemId === item.id && candidate.status === "active",
    );
    const expectedAssignee = input.assigneeId ?? input.executorId;
    if (
      expectedAssignee !== input.executorId ||
      (assignment && assignment.assigneeId !== input.executorId)
    )
      throw new RuntimeWorkError(
        "ASSIGNMENT_INVALID",
        `WorkItem '${item.id}' is not assigned to executor '${input.executorId}'.`,
        undefined,
        {
          entity: { type: "WorkItem", id: item.id },
          expected: input.executorId,
          actual: assignment?.assigneeId ?? input.assigneeId ?? "unassigned",
        },
      );
    return current;
  }

  private mapStartError(
    cause: { code: string },
    workItemId: string,
  ): RuntimeWorkError {
    const message = cause instanceof Error ? cause.message : cause.code;
    const entity = { type: "WorkItem", id: workItemId };
    switch (cause.code) {
      case "ITEM_NOT_FOUND":
        return new RuntimeWorkError("WORK_ITEM_NOT_FOUND", message, cause, {
          entity,
        });
      case "WORK_NOT_FOUND":
        return new RuntimeWorkError("WORK_NOT_FOUND", message, cause, {
          entity: { type: "Work", id: workItemId },
        });
      case "INVALID_TRANSITION":
        return new RuntimeWorkError("WORK_ITEM_NOT_READY", message, cause, {
          entity,
        });
      case "RECOVERY_REQUIRED":
      case "ACTIVE_LEASE_EXISTS":
        return new RuntimeWorkError(
          "WORK_ITEM_NOT_EXECUTABLE",
          message,
          cause,
          { entity },
        );
      case "DEPENDENCY_NOT_SATISFIED":
        return new RuntimeWorkError(
          "DEPENDENCY_NOT_SATISFIED",
          message,
          cause,
          { entity },
        );
      case "ASSIGNMENT_NOT_FOUND":
        return new RuntimeWorkError("ASSIGNMENT_REQUIRED", message, cause, {
          entity,
        });
      case "EXECUTOR_NOT_ASSIGNEE":
        return new RuntimeWorkError("ASSIGNMENT_INVALID", message, cause, {
          entity,
        });
      case "INVALID_INPUT":
        return new RuntimeWorkError("INVALID_INPUT", message, cause, {
          entity,
        });
      default:
        return new RuntimeWorkError(
          "EXECUTION_START_FAILED",
          "Could not start Work execution",
          cause,
          { entity },
        );
    }
  }

  private async ensureAssignment(
    itemId: string,
    executorId: string,
    assigneeId?: string,
  ): Promise<Assignment | undefined> {
    const item = await this.workItem(itemId);
    if (item.status !== "ready")
      runtimeError("WORK_ITEM_NOT_EXECUTABLE", "WorkItem must be ready");
    const assignment = (await this.workSnapshot(item.workId)).assignments.find(
      (candidate) =>
        candidate.workItemId === itemId && candidate.status === "active",
    );
    const expected = assigneeId ?? executorId;
    if (assignment) {
      if (assignment.assigneeId !== expected || expected !== executorId)
        runtimeError(
          "ASSIGNMENT_INVALID",
          "WorkItem assignment does not match executor",
        );
      return assignment;
    }
    if (expected !== executorId)
      runtimeError("ASSIGNMENT_INVALID", "Assignee must match executor");
    return this.work.assign(itemId, executorId);
  }

  private async workItem(itemId: string): Promise<WorkItem> {
    const snapshot = await this.workSnapshotByItem(itemId);
    const items =
      snapshot?.items ??
      runtimeError("WORK_ITEM_NOT_FOUND", `WorkItem not found: ${itemId}`);
    return (
      items.find((item) => item.id === itemId) ??
      runtimeError("WORK_ITEM_NOT_FOUND", "WorkItem not found")
    );
  }

  private async workSnapshotByItem(itemId: string) {
    const bindings = await this.repository.list();
    const known = bindings.find((binding) => binding.workItemId === itemId);
    if (!known?.workId) {
      const item = await this.work.inspectItem(itemId);
      return item;
    }
    return this.work.snapshot(known.workId);
  }

  private async workSnapshot(workId: string) {
    return this.work.snapshot(workId);
  }

  async heartbeat(bindingId: string): Promise<RuntimeExecutionBinding> {
    const binding = await this.active(bindingId);
    try {
      const lease = await this.work.heartbeat(
        binding.executionId,
        binding.leaseId,
        binding.fencingToken,
      );
      this.logger.info("binding.heartbeat", {
        bindingId,
        executionId: binding.executionId,
        leaseId: binding.leaseId,
        fencingToken: binding.fencingToken,
      });
      return this.persistLease(binding, lease);
    } catch (cause) {
      throw this.mapAuthorityError(cause);
    }
  }

  async complete(
    bindingId: string,
    result?: string,
  ): Promise<RuntimeExecutionBinding> {
    const binding =
      (await this.repository.get(bindingId)) ??
      runtimeError("BINDING_NOT_FOUND", `Binding not found: ${bindingId}`);
    if (binding.status === "completed") return binding;
    const active = this.requireActive(binding);
    try {
      await this.work.complete(
        active.executionId,
        active.leaseId,
        active.fencingToken,
        result,
      );
      const completed = await this.repository.updateStatus(
        bindingId,
        "completed",
      );
      this.logger.info("binding.completed", {
        bindingId,
        executionId: active.executionId,
      });
      return completed;
    } catch (cause) {
      throw this.mapAuthorityError(cause);
    }
  }

  async fail(
    bindingId: string,
    reason: string,
  ): Promise<RuntimeExecutionBinding> {
    if (!reason) runtimeError("INVALID_INPUT", "Failure reason is required");
    const binding =
      (await this.repository.get(bindingId)) ??
      runtimeError("BINDING_NOT_FOUND", `Binding not found: ${bindingId}`);
    if (binding.status === "failed") return binding;
    const active = this.requireActive(binding);
    try {
      await this.work.fail(
        active.executionId,
        active.leaseId,
        active.fencingToken,
        reason,
      );
      const failed = await this.repository.updateStatus(bindingId, "failed");
      this.logger.info("binding.failed", {
        bindingId,
        executionId: active.executionId,
      });
      return failed;
    } catch (cause) {
      throw this.mapAuthorityError(cause);
    }
  }

  async cancel(
    bindingId: string,
    reason?: string,
  ): Promise<RuntimeExecutionBinding> {
    const binding =
      (await this.repository.get(bindingId)) ??
      runtimeError("BINDING_NOT_FOUND", `Binding not found: ${bindingId}`);
    if (binding.status === "cancelled") return binding;
    const active = this.requireActive(binding);
    try {
      await this.work.cancel(
        active.executionId,
        active.leaseId,
        active.fencingToken,
        reason,
      );
      const cancelled = await this.repository.updateStatus(
        bindingId,
        "cancelled",
      );
      this.logger.info("binding.cancelled", {
        bindingId,
        executionId: active.executionId,
      });
      return cancelled;
    } catch (cause) {
      throw this.mapAuthorityError(cause);
    }
  }

  async suspend(
    bindingId: string,
    target: "blocked" | "waiting",
    reason?: string,
  ): Promise<RuntimeExecutionBinding> {
    const binding = await this.active(bindingId);
    try {
      await this.work.suspend(
        binding.executionId,
        binding.leaseId,
        binding.fencingToken,
        target,
        reason,
      );
      return await this.repository.updateStatus(bindingId, target);
    } catch (cause) {
      throw this.mapAuthorityError(cause);
    }
  }

  async get(bindingId: string) {
    return (
      (await this.repository.get(bindingId)) ??
      runtimeError("BINDING_NOT_FOUND", `Binding not found: ${bindingId}`)
    );
  }

  async reconcile(): Promise<RuntimeExecutionBinding[]> {
    await this.work.recover();
    const changed: RuntimeExecutionBinding[] = [];
    for (const binding of await this.repository.list()) {
      if (binding.status === "creating") {
        await this.repository.removePending(binding.bindingId);
        continue;
      }
      if (binding.status !== "active") continue;
      try {
        const state = await this.work.inspect(binding.executionId);
        const status =
          state.execution.status === "completed"
            ? "completed"
            : state.execution.status === "failed"
              ? "failed"
              : state.execution.status === "cancelled"
                ? "cancelled"
                : state.lease.status === "active" &&
                    new Date(state.lease.expiresAt) > this.clock.now()
                  ? "active"
                  : "lost";
        if (status !== "active") {
          const updated = await this.repository.updateStatus(
            binding.bindingId,
            status,
          );
          this.logger.info("binding.reconciled", {
            bindingId: binding.bindingId,
            executionId: binding.executionId,
          });
          changed.push(updated);
        }
      } catch (cause) {
        throw new RuntimeWorkError(
          "RECONCILIATION_FAILED",
          `Could not reconcile ${binding.bindingId}`,
          cause,
        );
      }
    }
    return changed;
  }

  bindExecution(input: BindingInput) {
    return this.bind(input);
  }

  getBinding(bindingId: string) {
    return this.get(bindingId);
  }

  private async active(bindingId: string) {
    const binding =
      (await this.repository.get(bindingId)) ??
      runtimeError("BINDING_NOT_FOUND", `Binding not found: ${bindingId}`);
    return this.requireActive(binding);
  }

  private requireActive(binding: RuntimeExecutionBinding) {
    if (binding.status !== "active")
      runtimeError("BINDING_NOT_ACTIVE", `Binding is ${binding.status}`);
    return binding;
  }

  private result(binding: RuntimeExecutionBinding): BindResult {
    return { ...binding, bindingId: binding.bindingId };
  }

  private async persistLease(
    binding: RuntimeExecutionBinding,
    lease: WorkLease,
  ) {
    const next = { ...binding, expiresAt: lease.expiresAt };
    await this.repository.finalize(next);
    return next;
  }

  private validateReference(reference: RuntimeExecutionReference) {
    if (!reference.provider || !reference.executionId)
      runtimeError(
        "INVALID_RUNTIME_REFERENCE",
        "provider and executionId are required",
      );
  }

  private mapAuthorityError(cause: unknown): RuntimeWorkError {
    if (cause instanceof RuntimeWorkError) return cause;
    const code = isWorkError(cause) ? cause.code : "";
    if (["LEASE_EXPIRED", "STALE_LEASE", "LEASE_REVOKED"].includes(code))
      return new RuntimeWorkError(
        code === "LEASE_EXPIRED" ? "LEASE_EXPIRED" : "LEASE_LOST",
        String(cause),
      );
    if (code === "STALE_FENCING_TOKEN")
      return new RuntimeWorkError("FENCING_MISMATCH", String(cause));
    if (code === "EXECUTION_ALREADY_FINISHED")
      return new RuntimeWorkError("EXECUTION_NOT_ACTIVE", String(cause));
    return new RuntimeWorkError(
      "INTERNAL_ERROR",
      "Work operation failed",
      cause,
    );
  }
}
