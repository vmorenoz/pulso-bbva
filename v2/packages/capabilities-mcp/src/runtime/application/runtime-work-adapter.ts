import { createHash } from "node:crypto";
import type {
  Assignment,
  Execution,
  WorkItem,
  WorkLease,
} from "../../../../working-system/src/domain";
import type {
  ExecutionHandle,
  RuntimeBindingManager,
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
    workId: string;
    workItemId: string;
    executorId: string;
    assigneeId: string;
    requestHash: string;
    managedBy: RuntimeBindingManager;
    creationToken: string;
    createdAt: string;
    creationExpiresAt: string;
  }): Promise<RuntimeExecutionBinding>;
  finalize(
    binding: RuntimeExecutionBinding,
    creationToken: string,
  ): Promise<RuntimeExecutionBinding>;
  get(bindingId: string): Promise<RuntimeExecutionBinding | undefined>;
  getByRuntime(
    runtime: RuntimeExecutionReference,
  ): Promise<RuntimeExecutionBinding | undefined>;
  list(): Promise<RuntimeExecutionBinding[]>;
  updateHeartbeat(
    bindingId: string,
    expiresAt: string,
    version: number,
  ): Promise<RuntimeExecutionBinding>;
  updateStatus(
    bindingId: string,
    status: RuntimeBindingStatus,
    version: number,
    terminalResult?: string,
  ): Promise<RuntimeExecutionBinding>;
  markPendingLost(
    bindingId: string,
    creationToken: string,
    version: number,
    diagnostic: string,
  ): Promise<RuntimeExecutionBinding>;
  recordPendingDiagnostic(
    bindingId: string,
    creationToken: string,
    diagnostic: string,
  ): Promise<boolean>;
  removePending(bindingId: string, creationToken: string): Promise<boolean>;
}

export interface BindingInput {
  workItemId: string;
  workId?: string;
  executorId: string;
  assigneeId?: string;
  runtimeReference: RuntimeExecutionReference;
  /** Only the native adapter supplies this internal marker; MCP schemas omit it. */
  managedBy?: RuntimeBindingManager;
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

type Preflight = { item: WorkItem; assigneeId: string };
type BindingIdentity = {
  workId: string;
  workItemId: string;
  executorId: string;
  assigneeId: string;
  managedBy: RuntimeBindingManager;
  runtime: RuntimeExecutionReference;
};

const silentLogger: RuntimeAdapterLogger = { info: () => undefined };
const id = () => crypto.randomUUID();
const isWorkError = (value: unknown): value is { code: string } =>
  typeof value === "object" && value !== null && "code" in value;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export class RuntimeWorkAdapter {
  private readonly bindLocks = new Map<
    string,
    { identity: string; promise: Promise<BindResult> }
  >();
  private readonly mutationTails = new Map<string, Promise<void>>();

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
    const persisted = await this.repository.getByRuntime(
      input.runtimeReference,
    );
    const preflight = await this.preflight(input, !persisted);
    const identity = this.identity(input, preflight);
    if (persisted) return this.existingResult(persisted, identity);
    const key = runtimeReferenceKey(input.runtimeReference);
    const existing = this.bindLocks.get(key);
    if (existing) {
      if (existing.identity !== canonical(identity))
        runtimeError(
          "RUNTIME_EXECUTION_CONFLICT",
          "Runtime execution is already being bound with a different identity",
        );
      return existing.promise;
    }
    const promise = this.bindLocked(input, preflight, identity);
    this.bindLocks.set(key, { identity: canonical(identity), promise });
    try {
      const result = await promise;
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
    preflight: Preflight,
    identity: BindingIdentity,
  ): Promise<BindResult> {
    const found = await this.repository.getByRuntime(input.runtimeReference);
    if (found) return this.existingResult(found, identity);

    const bindingId = id();
    const creationToken = id();
    const createdAt = this.clock.now().toISOString();
    const reserved = await this.repository.reserve({
      bindingId,
      runtime: input.runtimeReference,
      workId: identity.workId,
      workItemId: identity.workItemId,
      executorId: identity.executorId,
      assigneeId: identity.assigneeId,
      requestHash: hash(identity),
      managedBy: identity.managedBy,
      creationToken,
      createdAt,
      creationExpiresAt: new Date(
        this.clock.now().getTime() + 120_000,
      ).toISOString(),
    });
    if (reserved.bindingId !== bindingId)
      return this.existingResult(reserved, identity);

    let started: { execution: Execution; lease: WorkLease } | undefined;
    try {
      const assignment = await this.ensureAssignment(
        preflight.item,
        input.executorId,
        preflight.assigneeId,
      );
      started = await this.work.startExecution({
        workItemId: input.workItemId,
        executorId: input.executorId,
        runtime: input.runtimeReference,
      });
      const binding: RuntimeExecutionBinding = {
        ...reserved,
        assignmentId: assignment?.id ?? started.execution.assignmentId,
        executionId: started.execution.id,
        leaseId: started.lease.id,
        fencingToken: started.lease.fencingToken,
        expiresAt: started.lease.expiresAt,
        status: "active",
      };
      return this.result(
        await this.repository.finalize(binding, creationToken),
      );
    } catch (cause) {
      let reconciliationRequired = false;
      if (started) {
        try {
          await this.work.revoke({
            leaseId: started.lease.id,
            reason: "runtime binding creation failed",
          });
        } catch {
          reconciliationRequired = true;
          await this.repository
            .recordPendingDiagnostic(
              bindingId,
              creationToken,
              String(cause).includes("BINDING_RESERVATION_LOST")
                ? "binding_reservation_lost; compensation_revoke_failed"
                : "binding_creation_failed; compensation_revoke_failed",
            )
            .catch(() => undefined);
        }
      }
      if (!reconciliationRequired)
        await this.repository.removePending(bindingId, creationToken);
      if (cause instanceof RuntimeWorkError) throw cause;
      if (isWorkError(cause)) throw this.mapStartError(cause, input.workItemId);
      throw new RuntimeWorkError(
        String(cause).includes("BINDING_RESERVATION_LOST")
          ? "BINDING_RESERVATION_LOST"
          : "EXECUTION_START_FAILED",
        "Could not start Work execution",
        cause,
      );
    }
  }

  private identity(input: BindingInput, preflight: Preflight): BindingIdentity {
    return {
      workId: preflight.item.workId,
      workItemId: preflight.item.id,
      executorId: input.executorId,
      assigneeId: preflight.assigneeId,
      managedBy: input.managedBy ?? "mcp",
      runtime: input.runtimeReference,
    };
  }

  private async existingResult(
    binding: RuntimeExecutionBinding,
    identity: BindingIdentity,
  ): Promise<BindResult> {
    await this.assertBindingIdentity(binding, identity);
    if (binding.status === "active") return this.result(binding);
    if (binding.status === "creating")
      runtimeError(
        "RUNTIME_EXECUTION_ALREADY_BOUND",
        "Runtime execution binding is being created",
      );
    throw new RuntimeWorkError(
      "RUNTIME_EXECUTION_TERMINAL",
      `Runtime execution is terminal; inspect binding '${binding.bindingId}'.`,
      undefined,
      { entity: { type: "Binding", id: binding.bindingId } },
    );
  }

  private async assertBindingIdentity(
    binding: RuntimeExecutionBinding,
    identity: BindingIdentity,
  ) {
    if (
      binding.executorId &&
      binding.assigneeId &&
      binding.requestHash &&
      binding.managedBy
    ) {
      if (
        binding.workId !== identity.workId ||
        binding.workItemId !== identity.workItemId ||
        binding.executorId !== identity.executorId ||
        binding.assigneeId !== identity.assigneeId ||
        binding.managedBy !== identity.managedBy ||
        canonical(binding.runtime) !== canonical(identity.runtime) ||
        binding.requestHash !== hash(identity)
      )
        runtimeError(
          "RUNTIME_EXECUTION_CONFLICT",
          "Runtime execution is bound to a different Work identity",
        );
      return;
    }
    if (!binding.executionId || !binding.workId)
      runtimeError(
        "RUNTIME_EXECUTION_CONFLICT",
        "Legacy runtime binding cannot be verified",
      );
    const [state, snapshot] = await Promise.all([
      this.work.inspect(binding.executionId),
      this.work.inspectWork(binding.workId),
    ]).catch(() =>
      runtimeError(
        "RUNTIME_EXECUTION_CONFLICT",
        "Legacy runtime binding cannot be resolved from Work authority",
      ),
    );
    const assignment = snapshot.assignments.find(
      (candidate) => candidate.id === state.execution.assignmentId,
    );
    if (
      state.execution.workItemId !== identity.workItemId ||
      state.execution.executorId !== identity.executorId ||
      assignment?.assigneeId !== identity.assigneeId ||
      binding.workId !== identity.workId ||
      canonical(binding.runtime) !== canonical(identity.runtime)
    )
      runtimeError(
        "RUNTIME_EXECUTION_CONFLICT",
        "Legacy runtime binding conflicts with the requested identity",
      );
  }

  private async preflight(
    input: BindingInput,
    requireReady = true,
  ): Promise<Preflight> {
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
    if (requireReady && incompleteDependencies.length)
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
    if (requireReady && current.status !== "ready")
      throw new RuntimeWorkError(
        ["pending", "blocked", "waiting"].includes(current.status)
          ? "WORK_ITEM_NOT_READY"
          : "WORK_ITEM_NOT_EXECUTABLE",
        `WorkItem '${item.id}' has status '${current.status}' and cannot be bound for execution.`,
        undefined,
        {
          entity: { type: "WorkItem", id: item.id },
          expected: "ready",
          actual: current.status,
        },
      );
    const assignment = snapshot.assignments.find(
      (candidate) =>
        candidate.workItemId === item.id && candidate.status === "active",
    );
    const assigneeId = input.assigneeId ?? input.executorId;
    if (
      assigneeId !== input.executorId ||
      (assignment && assignment.assigneeId !== assigneeId)
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
    return { item: current, assigneeId };
  }

  private async ensureAssignment(
    item: WorkItem,
    executorId: string,
    assigneeId: string,
  ): Promise<Assignment | undefined> {
    const snapshot = await this.work.inspectWork(item.workId);
    const assignment = snapshot.assignments.find(
      (candidate) =>
        candidate.workItemId === item.id && candidate.status === "active",
    );
    if (assignment) return assignment;
    if (assigneeId !== executorId)
      runtimeError("ASSIGNMENT_INVALID", "Assignee must match executor");
    return this.work.assign(item.id, executorId);
  }

  async heartbeat(bindingId: string): Promise<RuntimeExecutionBinding> {
    return this.heartbeatFrom(bindingId, "mcp");
  }

  /** Native delegation observation is the only non-MCP source permitted to renew a native binding. */
  heartbeatNative(bindingId: string): Promise<RuntimeExecutionBinding> {
    return this.heartbeatFrom(bindingId, "opencode-native");
  }

  private async heartbeatFrom(
    bindingId: string,
    source: RuntimeBindingManager,
  ): Promise<RuntimeExecutionBinding> {
    return this.mutate<RuntimeExecutionBinding>(bindingId, async () => {
      const binding = await this.active(bindingId, source);
      try {
        const lease = await this.work.heartbeat(
          binding.executionId,
          binding.leaseId,
          binding.fencingToken,
        );
        return await this.repository.updateHeartbeat(
          bindingId,
          lease.expiresAt,
          binding.version,
        );
      } catch (cause) {
        if (String(cause).includes("BINDING_CAS_CONFLICT"))
          return this.reconcileHeartbeatCas(bindingId);
        throw this.mapAuthorityError(cause);
      }
    });
  }

  async complete(bindingId: string, result?: string) {
    return this.settle(bindingId, "completed", result ?? "", "mcp");
  }

  async fail(bindingId: string, reason: string) {
    if (!reason) runtimeError("INVALID_INPUT", "Failure reason is required");
    return this.settle(bindingId, "failed", reason, "mcp");
  }

  async cancel(bindingId: string, reason?: string) {
    return this.settle(bindingId, "cancelled", reason ?? "", "mcp");
  }

  async suspend(
    bindingId: string,
    target: "blocked" | "waiting",
    reason?: string,
  ) {
    return this.settle(bindingId, target, reason ?? "", "mcp");
  }

  // CP2 calls these internal entry points; MCP cannot select their authority.
  completeNative(bindingId: string, result?: string) {
    return this.settle(bindingId, "completed", result ?? "", "opencode-native");
  }
  failNative(bindingId: string, reason: string) {
    return this.settle(bindingId, "failed", reason, "opencode-native");
  }
  cancelNative(bindingId: string, reason?: string) {
    return this.settle(bindingId, "cancelled", reason ?? "", "opencode-native");
  }
  suspendNative(
    bindingId: string,
    target: "blocked" | "waiting",
    reason?: string,
  ) {
    return this.settle(bindingId, target, reason ?? "", "opencode-native");
  }

  private async settle(
    bindingId: string,
    target: Exclude<RuntimeBindingStatus, "creating" | "active" | "lost">,
    outcome: string,
    source: RuntimeBindingManager,
  ): Promise<RuntimeExecutionBinding> {
    return this.mutate<RuntimeExecutionBinding>(bindingId, async () => {
      let binding = await this.require(bindingId);
      this.assertMutableBy(binding, source);
      if (binding.status === "lost")
        runtimeError(
          "BINDING_NOT_ACTIVE",
          "Binding authority is no longer active",
        );
      if (binding.status !== "active")
        return this.replay(binding, target, outcome);
      try {
        if (target === "completed")
          await this.work.complete(
            binding.executionId,
            binding.leaseId,
            binding.fencingToken,
            outcome || undefined,
          );
        else if (target === "failed")
          await this.work.fail(
            binding.executionId,
            binding.leaseId,
            binding.fencingToken,
            outcome,
          );
        else if (target === "cancelled")
          await this.work.cancel(
            binding.executionId,
            binding.leaseId,
            binding.fencingToken,
            outcome || undefined,
          );
        else
          await this.work.suspend(
            binding.executionId,
            binding.leaseId,
            binding.fencingToken,
            target,
            outcome || undefined,
          );
        return await this.repository.updateStatus(
          bindingId,
          target,
          binding.version,
          outcome,
        );
      } catch (cause) {
        if (String(cause).includes("BINDING_CAS_CONFLICT")) {
          binding = await this.require(bindingId);
          if (binding.status !== "active")
            return this.replay(binding, target, outcome);
          return this.repository.updateStatus(
            bindingId,
            target,
            binding.version,
            outcome,
          );
        }
        throw this.mapAuthorityError(cause);
      }
    });
  }

  async get(bindingId: string) {
    return this.require(bindingId);
  }

  /** Recovery uses the persisted runtime reference; it never manufactures a binding. */
  async getByRuntime(runtime: RuntimeExecutionReference) {
    return this.repository.getByRuntime(runtime);
  }

  async reconcile(): Promise<RuntimeExecutionBinding[]> {
    await this.work.recover();
    const changed: RuntimeExecutionBinding[] = [];
    for (const binding of await this.repository.list()) {
      const result = await this.mutate(binding.bindingId, async () => {
        const current = await this.require(binding.bindingId);
        if (current.status === "creating")
          return this.reconcileReservation(current);
        if (current.status !== "active") return undefined;
        try {
          const state = await this.work.inspect(current.executionId);
          const status: RuntimeBindingStatus =
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
          if (status === "active") return undefined;
          return this.repository.updateStatus(
            current.bindingId,
            status,
            current.version,
            status === "lost" ? "authority_lost" : undefined,
          );
        } catch (cause) {
          throw new RuntimeWorkError(
            "RECONCILIATION_FAILED",
            `Could not reconcile ${current.bindingId}`,
            cause,
          );
        }
      });
      if (result) changed.push(result);
    }
    return changed;
  }

  private async reconcileReservation(binding: RuntimeExecutionBinding) {
    if (
      binding.creationExpiresAt &&
      new Date(binding.creationExpiresAt) > this.clock.now()
    )
      return undefined;
    const creationToken =
      binding.creationToken ??
      runtimeError(
        "RECOVERY_REQUIRED",
        `Creating binding '${binding.bindingId}' has no reservation token`,
      );
    const executions = await this.work.findExecutionsByRuntime(binding.runtime);
    if (!executions.length) {
      await this.repository.removePending(binding.bindingId, creationToken);
      return undefined;
    }
    if (executions.length !== 1)
      runtimeError(
        "RECOVERY_REQUIRED",
        "Runtime reference matches multiple executions",
      );
    const { execution, lease } = executions[0];
    await this.assertReservationIdentity(binding, execution);
    if (
      lease?.status !== "active" ||
      new Date(lease.expiresAt) <= this.clock.now()
    ) {
      await this.work.recover();
      return this.repository.markPendingLost(
        binding.bindingId,
        creationToken,
        binding.version,
        [binding.terminalResult, "reservation_authority_lost"]
          .filter(Boolean)
          .join("; "),
      );
    }
    if (
      !binding.workId ||
      !binding.assigneeId ||
      !binding.requestHash ||
      !binding.managedBy
    )
      runtimeError(
        "RECOVERY_REQUIRED",
        "Creating legacy binding cannot be reconstructed safely",
      );
    try {
      return await this.repository.finalize(
        {
          ...binding,
          assignmentId: execution.assignmentId,
          executionId: execution.id,
          leaseId: lease.id,
          fencingToken: lease.fencingToken,
          expiresAt: lease.expiresAt,
          status: "active",
        },
        creationToken,
      );
    } catch (cause) {
      if (!String(cause).includes("BINDING_RESERVATION_LOST")) throw cause;
      const current = await this.repository.get(binding.bindingId);
      if (current?.status === "active" || current?.status === "lost")
        return current;
      throw new RuntimeWorkError(
        "RECOVERY_REQUIRED",
        `Creating binding '${binding.bindingId}' changed during reconciliation`,
        cause,
      );
    }
  }

  private async assertReservationIdentity(
    binding: RuntimeExecutionBinding,
    execution: Execution,
  ) {
    if (
      !binding.workId ||
      !binding.executorId ||
      !binding.assigneeId ||
      !binding.requestHash ||
      !binding.managedBy
    )
      runtimeError(
        "RECOVERY_REQUIRED",
        "Creating legacy binding cannot be reconstructed safely",
      );
    const snapshot = await this.work.inspectWork(binding.workId);
    const item = snapshot.items.find(
      (candidate) => candidate.id === binding.workItemId,
    );
    const assignment = snapshot.assignments.find(
      (candidate) => candidate.id === execution.assignmentId,
    );
    if (
      !snapshot.work ||
      !item ||
      item.workId !== binding.workId ||
      execution.workItemId !== binding.workItemId ||
      execution.executorId !== binding.executorId ||
      execution.externalExecutionRef?.provider !== binding.runtime.provider ||
      execution.externalExecutionRef.id !== binding.runtime.executionId ||
      assignment?.workItemId !== binding.workItemId ||
      assignment.assigneeId !== binding.assigneeId ||
      assignment.status !== "active"
    )
      runtimeError(
        "RECOVERY_REQUIRED",
        `Creating binding '${binding.bindingId}' conflicts with Work authority`,
      );
  }

  bindExecution(input: BindingInput) {
    return this.bind(input);
  }

  getBinding(bindingId: string) {
    return this.get(bindingId);
  }

  private async reconcileHeartbeatCas(bindingId: string) {
    const current = await this.require(bindingId);
    if (current.status !== "active")
      runtimeError("BINDING_NOT_ACTIVE", `Binding is ${current.status}`);
    const state = await this.work.inspect(current.executionId);
    if (state.lease.status !== "active")
      runtimeError(
        "BINDING_NOT_ACTIVE",
        "Binding authority is no longer active",
      );
    return this.repository.updateHeartbeat(
      bindingId,
      state.lease.expiresAt,
      current.version,
    );
  }

  private async active(bindingId: string, source: RuntimeBindingManager) {
    const binding = await this.require(bindingId);
    this.assertMutableBy(binding, source);
    if (binding.status !== "active")
      runtimeError("BINDING_NOT_ACTIVE", `Binding is ${binding.status}`);
    return binding;
  }

  private assertMutableBy(
    binding: RuntimeExecutionBinding,
    source: RuntimeBindingManager,
  ) {
    if (binding.managedBy === "opencode-native" && source !== "opencode-native")
      runtimeError(
        "BINDING_MANAGED_BY_NATIVE",
        "This binding is managed by the native OpenCode adapter",
      );
    if (source === "opencode-native" && binding.managedBy !== "opencode-native")
      runtimeError("BINDING_NOT_ACTIVE", "Binding is not native-managed");
  }

  private replay(
    binding: RuntimeExecutionBinding,
    target: RuntimeBindingStatus,
    outcome: string,
  ): RuntimeExecutionBinding {
    if (binding.status === target && (binding.terminalResult ?? "") === outcome)
      return binding;
    return runtimeError(
      "RUNTIME_EXECUTION_TERMINAL",
      `Binding '${binding.bindingId}' already has terminal status '${binding.status}'.`,
    );
  }

  private result(binding: RuntimeExecutionBinding): BindResult {
    return { ...binding, bindingId: binding.bindingId };
  }

  private async require(bindingId: string) {
    return (
      (await this.repository.get(bindingId)) ??
      runtimeError("BINDING_NOT_FOUND", `Binding not found: ${bindingId}`)
    );
  }

  private async mutate<T>(bindingId: string, fn: () => Promise<T>) {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.mutationTails.get(bindingId) ?? Promise.resolve();
    const tail = previous.then(
      () => turn,
      () => turn,
    );
    this.mutationTails.set(bindingId, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.mutationTails.get(bindingId) === tail)
        this.mutationTails.delete(bindingId);
    }
  }

  private validateReference(reference: RuntimeExecutionReference) {
    if (!reference.provider || !reference.executionId)
      runtimeError(
        "INVALID_RUNTIME_REFERENCE",
        "provider and executionId are required",
      );
  }

  private mapStartError(cause: { code: string }, workItemId: string) {
    const message = cause instanceof Error ? cause.message : cause.code;
    const entity = { type: "WorkItem", id: workItemId };
    const mapped: Record<string, RuntimeWorkError["code"]> = {
      ITEM_NOT_FOUND: "WORK_ITEM_NOT_FOUND",
      WORK_NOT_FOUND: "WORK_NOT_FOUND",
      INVALID_TRANSITION: "WORK_ITEM_NOT_READY",
      WORK_RESUME_REQUIRED: "WORK_ITEM_NOT_READY",
      WORK_NOT_EXECUTABLE: "WORK_ITEM_NOT_EXECUTABLE",
      RECOVERY_REQUIRED: "WORK_ITEM_NOT_EXECUTABLE",
      ACTIVE_LEASE_EXISTS: "WORK_ITEM_NOT_EXECUTABLE",
      DEPENDENCY_NOT_SATISFIED: "DEPENDENCY_NOT_SATISFIED",
      ASSIGNMENT_NOT_FOUND: "ASSIGNMENT_REQUIRED",
      EXECUTOR_NOT_ASSIGNEE: "ASSIGNMENT_INVALID",
      INVALID_INPUT: "INVALID_INPUT",
    };
    return new RuntimeWorkError(
      mapped[cause.code] ?? "EXECUTION_START_FAILED",
      message,
      cause,
      { entity },
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
