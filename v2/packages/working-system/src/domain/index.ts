export type WorkStatus =
  | "pending"
  | "active"
  | "blocked"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkItemStatus =
  | "pending"
  | "ready"
  | "in_progress"
  | "blocked"
  | "waiting"
  | "recovery_required"
  | "completed"
  | "failed"
  | "cancelled";
export type WorkItemKind = string;
export interface Work {
  id: string;
  workspaceId: string;
  title: string;
  objective: string;
  status: WorkStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  version: number;
}
export interface WorkItem {
  id: string;
  workId: string;
  title: string;
  description?: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  dependencies: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: string;
  version: number;
}
export interface Assignment {
  id: string;
  workItemId: string;
  assigneeId: string;
  assigneeType?: string;
  assignedAt: string;
  unassignedAt?: string;
  status: "active" | "superseded" | "released";
  version: number;
}
export interface Execution {
  id: string;
  workItemId: string;
  assignmentId: string;
  executorId: string;
  executorType?: string;
  externalExecutionRef?: { provider: string; id: string };
  status:
    | "created"
    | "running"
    | "completed"
    | "failed"
    | "abandoned"
    | "cancelled";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  version: number;
}
export interface WorkLease {
  id: string;
  workItemId: string;
  executionId: string;
  holderId: string;
  status: "active" | "released" | "expired" | "revoked";
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  fencingToken: number;
  version: number;
}
export interface Artifact {
  id: string;
  workId: string;
  itemId?: string;
  type: string;
  uri: string;
  description?: string;
  createdAt: string;
}
export interface WorkEvent {
  id: string;
  sequence: number;
  workId: string;
  itemId?: string;
  executionId?: string;
  type: string;
  actor?: { type: string; id?: string };
  timestamp: string;
  payload: unknown;
}
export interface OperationReceipt {
  operationKey: string;
  inputHash: string;
  entityKind: "work" | "work_item";
  entityId: string;
}
export interface CreateWorkInput {
  workspaceId: string;
  title: string;
  objective: string;
  items?: Array<{
    title: string;
    description?: string;
    kind: WorkItemKind;
    dependencies?: string[];
    assigneeId?: string;
  }>;
}
export interface State {
  works: Work[];
  items: WorkItem[];
  assignments: Assignment[];
  executions: Execution[];
  leases: WorkLease[];
  artifacts: Artifact[];
  events: WorkEvent[];
  operationReceipts: OperationReceipt[];
}
export const validateState = (state: State) => {
  for (const item of state.items) {
    const leases = state.leases.filter(
      (l) => l.workItemId === item.id && l.status === "active",
    );
    const executions = state.executions.filter(
      (e) => e.workItemId === item.id && e.status === "running",
    );
    if (item.status === "in_progress") {
      if (leases.length !== 1 || executions.length !== 1) {
        error(
          "INVALID_STATE",
          "In-progress items require exactly one running execution and active lease",
        );
      }
      if (leases[0].executionId !== executions[0].id) {
        error(
          "INVALID_STATE",
          "Active lease must belong to the running execution",
        );
      }
    } else if (leases.length > 0 || executions.length > 0) {
      error(
        "INVALID_STATE",
        "Only in-progress items may have active execution authority",
      );
    }
  }
  for (const lease of state.leases.filter((l) => l.status === "active")) {
    const execution = state.executions.find((e) => e.id === lease.executionId);
    if (
      execution?.status !== "running" ||
      execution.workItemId !== lease.workItemId
    ) {
      error("INVALID_STATE", "Active lease must reference a running execution");
    }
    const item = state.items.find(
      (candidate) => candidate.id === lease.workItemId,
    );
    const work =
      item && state.works.find((candidate) => candidate.id === item.workId);
    if (work?.status !== "active")
      error(
        "INVALID_STATE",
        "Active execution authority requires an active Work",
      );
  }
  for (const receipt of state.operationReceipts) {
    const entities = receipt.entityKind === "work" ? state.works : state.items;
    if (!entities.some((entity) => entity.id === receipt.entityId))
      error("INVALID_STATE", "Operation receipt must reference its entity");
  }
};
export const validateAppendOnlyEvents = (before: State, after: State) => {
  if (after.events.length < before.events.length) {
    error("EVENT_LOG_APPEND_ONLY", "Events cannot be deleted");
  }
  for (let index = 0; index < before.events.length; index++) {
    if (
      JSON.stringify(before.events[index]) !==
      JSON.stringify(after.events[index])
    ) {
      error("EVENT_LOG_APPEND_ONLY", "Existing events cannot be modified");
    }
  }
  for (const receipt of before.operationReceipts) {
    const current = after.operationReceipts.find(
      (candidate) => candidate.operationKey === receipt.operationKey,
    );
    if (JSON.stringify(current) !== JSON.stringify(receipt))
      error(
        "OPERATION_RECEIPTS_APPEND_ONLY",
        "Operation receipts cannot change",
      );
  }
};
export interface Store {
  read(): Promise<State>;
  transaction<T>(fn: (state: State) => T | Promise<T>): Promise<T>;
}
export interface Clock {
  now(): Date;
}
export class PulsoError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const error = (code: string, message: string): never => {
  throw new PulsoError(code, message);
};
export const systemClock: Clock = { now: () => new Date() };
const clone = <T>(x: T): T => structuredClone(x);
export class MemoryStore implements Store {
  private state: State = {
    works: [],
    items: [],
    assignments: [],
    executions: [],
    leases: [],
    artifacts: [],
    events: [],
    operationReceipts: [],
  };
  private transactionTail = Promise.resolve();
  async read() {
    return clone(this.state);
  }
  async transaction<T>(fn: (s: State) => T | Promise<T>) {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(
      () => turn,
      () => turn,
    );
    await previous;
    try {
      const draft = clone(this.state);
      const out = await fn(draft);
      validateAppendOnlyEvents(this.state, draft);
      validateState(draft);
      this.state = draft;
      return out;
    } finally {
      release();
    }
  }
}
const id = () => crypto.randomUUID();
const at = (c: Clock) => c.now().toISOString();
const workTransitions: Record<WorkStatus, WorkStatus[]> = {
  pending: ["active", "cancelled"],
  active: ["blocked", "waiting", "completed", "failed", "cancelled"],
  blocked: ["active"],
  waiting: ["active"],
  failed: ["active"],
  completed: [],
  cancelled: [],
};
/** Work records remain editable until a terminal decision; only active work may run. */
export const isWorkModifiable = (status: WorkStatus) =>
  status !== "completed" && status !== "cancelled";
export const isWorkStartable = (status: WorkStatus) =>
  status === "pending" || status === "active";
const itemTransitions: Record<WorkItemStatus, WorkItemStatus[]> = {
  pending: ["ready", "cancelled"],
  ready: ["in_progress", "cancelled"],
  in_progress: [
    "blocked",
    "waiting",
    "recovery_required",
    "completed",
    "failed",
    "cancelled",
  ],
  blocked: ["ready"],
  waiting: ["ready"],
  recovery_required: ["ready", "failed", "cancelled"],
  failed: ["ready"],
  completed: [],
  cancelled: [],
};
const event = (
  s: State,
  c: Clock,
  workId: string,
  type: string,
  extra: Partial<WorkEvent> = {},
) =>
  s.events.push({
    id: id(),
    sequence: s.events.filter((e) => e.workId === workId).length + 1,
    workId,
    type,
    timestamp: at(c),
    payload: {},
    ...extra,
  });
const get = <T extends { id: string }>(xs: T[], key: string, code: string) =>
  xs.find((x) => x.id === key) ?? error(code, `${code}: ${key}`);
const assertVersion = (actual: number, expected: number | undefined) => {
  if (expected !== undefined && actual !== expected)
    error("STALE_VERSION", "Entity version is stale");
};
const ready = (s: State, item: WorkItem) =>
  item.dependencies.every(
    (d) => get(s.items, d, "ITEM_NOT_FOUND").status === "completed",
  );
const activeAssignment = (s: State, itemId: string) =>
  s.assignments.find((a) => a.workItemId === itemId && a.status === "active");
export class WorkService {
  private recovery: RecoveryService;
  constructor(
    private store: Store,
    private clock: Clock = systemClock,
  ) {
    this.recovery = new RecoveryService(store, clock);
  }
  async create(
    input: CreateWorkInput,
    operation?: { operationKey: string; inputHash: string },
  ) {
    return this.store.transaction((s) => {
      if (!input.title || !input.objective)
        error("INVALID_INPUT", "title and objective are required");
      const existing = this.receiptEntity(s, operation, "work");
      if (existing)
        return clone(
          get(s.works, existing.entityId, "OPERATION_RECEIPT_CORRUPT"),
        );
      const now = at(this.clock);
      const w: Work = {
        id: id(),
        workspaceId: input.workspaceId,
        title: input.title,
        objective: input.objective,
        status: "pending",
        createdAt: now,
        version: 1,
      };
      s.works.push(w);
      event(s, this.clock, w.id, "work.created");
      for (const raw of input.items ?? []) {
        const item: WorkItem = {
          id: id(),
          workId: w.id,
          title: raw.title,
          description: raw.description,
          kind: raw.kind,
          dependencies: raw.dependencies ?? [],
          status: "pending",
          createdAt: now,
          version: 1,
        };
        this.validateDeps(s, item);
        s.items.push(item);
        event(s, this.clock, w.id, "item.created", { itemId: item.id });
        if (raw.assigneeId)
          this.assignIn(s, item.id, raw.assigneeId, "item.assigned");
      }
      this.promote(s, w.id);
      this.recordReceipt(s, operation, "work", w.id);
      return clone(w);
    });
  }
  private receiptEntity(
    s: State,
    operation: { operationKey: string; inputHash: string } | undefined,
    entityKind: OperationReceipt["entityKind"],
  ) {
    if (!operation) return undefined;
    if (!operation.operationKey || !operation.inputHash)
      error(
        "INVALID_INPUT",
        "operationKey and inputHash are required together",
      );
    const receipt = s.operationReceipts.find(
      (candidate) => candidate.operationKey === operation.operationKey,
    );
    if (!receipt) return undefined;
    if (
      receipt.inputHash !== operation.inputHash ||
      receipt.entityKind !== entityKind
    )
      error(
        "OPERATION_CONFLICT",
        "operationKey was already used with different input",
      );
    return receipt;
  }
  private recordReceipt(
    s: State,
    operation: { operationKey: string; inputHash: string } | undefined,
    entityKind: OperationReceipt["entityKind"],
    entityId: string,
  ) {
    if (!operation) return;
    s.operationReceipts.push({ ...operation, entityKind, entityId });
  }
  private validateDeps(s: State, item: WorkItem) {
    for (const dep of item.dependencies) {
      if (dep === item.id) error("DEPENDENCY_CYCLE", "Self dependency");
      const d = get(s.items, dep, "ITEM_NOT_FOUND");
      if (d.workId !== item.workId)
        error("CROSS_WORK_DEPENDENCY", "Dependencies must belong to same work");
      const walk = (x: string, seen: Set<string>): boolean => {
        if (x === item.id) return true;
        if (seen.has(x)) return false;
        seen.add(x);
        return get(s.items, x, "ITEM_NOT_FOUND").dependencies.some((y) =>
          walk(y, seen),
        );
      };
      if (walk(dep, new Set())) error("DEPENDENCY_CYCLE", "Dependency cycle");
    }
  }
  async addItem(
    input: {
      workId: string;
      title: string;
      kind: WorkItemKind;
      description?: string;
      dependencies?: string[];
      assigneeId?: string;
    },
    operation?: { operationKey: string; inputHash: string },
  ) {
    return this.store.transaction((s) => {
      const w = get(s.works, input.workId, "WORK_NOT_FOUND");
      const existing = this.receiptEntity(s, operation, "work_item");
      if (existing)
        return clone(
          get(s.items, existing.entityId, "OPERATION_RECEIPT_CORRUPT"),
        );
      if (!isWorkModifiable(w.status))
        error("WORK_NOT_MODIFIABLE", "Terminal Work cannot accept WorkItems");
      const item: WorkItem = {
        id: id(),
        workId: w.id,
        title: input.title,
        description: input.description,
        kind: input.kind,
        dependencies: input.dependencies ?? [],
        status: "pending",
        createdAt: at(this.clock),
        version: 1,
      };
      this.validateDeps(s, item);
      s.items.push(item);
      event(s, this.clock, w.id, "item.created", { itemId: item.id });
      if (input.assigneeId)
        this.assignIn(s, item.id, input.assigneeId, "item.assigned");
      this.promote(s, w.id);
      this.recordReceipt(s, operation, "work_item", item.id);
      return clone(item);
    });
  }
  private assignIn(s: State, itemId: string, assigneeId: string, type: string) {
    const item = get(s.items, itemId, "ITEM_NOT_FOUND");
    const old = activeAssignment(s, item.id);
    if (old) {
      old.status = "superseded";
      old.unassignedAt = at(this.clock);
      old.version++;
      event(s, this.clock, item.workId, "item.reassigned", { itemId });
    }
    const a: Assignment = {
      id: id(),
      workItemId: item.id,
      assigneeId,
      assignedAt: at(this.clock),
      status: "active",
      version: 1,
    };
    s.assignments.push(a);
    event(s, this.clock, item.workId, type, {
      itemId,
      payload: { assigneeId },
    });
    return a;
  }
  async assign(itemId: string, assigneeId: string, reassign = false) {
    return this.store.transaction((s) => {
      if (
        s.leases.some(
          (lease) => lease.workItemId === itemId && lease.status === "active",
        )
      )
        error(
          "ACTIVE_LEASE_EXISTS",
          "Assignment cannot change while an execution owns the item",
        );
      if (activeAssignment(s, itemId) && !reassign)
        error("INVALID_INPUT", "Active assignment exists; use reassign");
      return clone(
        this.assignIn(
          s,
          itemId,
          assigneeId,
          reassign ? "item.reassigned" : "item.assigned",
        ),
      );
    });
  }
  async unassign(itemId: string) {
    return this.store.transaction((s) => {
      const item = get(s.items, itemId, "ITEM_NOT_FOUND");
      if (
        s.leases.some(
          (lease) => lease.workItemId === itemId && lease.status === "active",
        )
      )
        error(
          "ACTIVE_LEASE_EXISTS",
          "Assignment cannot change while an execution owns the item",
        );
      const a =
        activeAssignment(s, itemId) ??
        error("ASSIGNMENT_NOT_FOUND", "No active assignment");
      a.status = "released";
      a.unassignedAt = at(this.clock);
      a.version++;
      event(s, this.clock, item.workId, "item.unassigned", { itemId });
      return clone(a);
    });
  }
  async updateItem(
    itemId: string,
    input: {
      title?: string;
      description?: string;
      kind?: WorkItemKind;
      version: number;
    },
  ) {
    return this.store.transaction((s) => {
      const item = get(s.items, itemId, "ITEM_NOT_FOUND");
      assertVersion(item.version, input.version);
      if (input.title !== undefined)
        item.title = input.title || error("INVALID_INPUT", "title is required");
      if (input.description !== undefined) item.description = input.description;
      if (input.kind !== undefined) item.kind = input.kind;
      item.version++;
      event(s, this.clock, item.workId, "item.updated", { itemId });
      return clone(item);
    });
  }
  async updateWork(
    workId: string,
    input: { title?: string; objective?: string; version?: number },
  ) {
    return this.store.transaction((s) => {
      const w = get(s.works, workId, "WORK_NOT_FOUND");
      if (!isWorkModifiable(w.status))
        error("WORK_NOT_MODIFIABLE", "Terminal Work cannot be modified");
      assertVersion(w.version, input.version);
      if (input.title) w.title = input.title;
      if (input.objective) w.objective = input.objective;
      w.version++;
      event(s, this.clock, w.id, "work.updated");
      return clone(w);
    });
  }
  async transition(
    target: "work" | "item",
    entityId: string,
    action:
      | "start"
      | "complete"
      | "block"
      | "wait"
      | "resume"
      | "fail"
      | "cancel"
      | "prepare_retry",
    reason?: string,
    version?: number,
  ) {
    return this.store.transaction((s) => {
      if (target === "work") {
        const work = get(s.works, entityId, "WORK_NOT_FOUND");
        assertVersion(work.version, version);
        const to: WorkStatus =
          action === "start" || action === "resume"
            ? "active"
            : action === "complete"
              ? "completed"
              : action === "block"
                ? "blocked"
                : action === "wait"
                  ? "waiting"
                  : action === "fail"
                    ? "failed"
                    : "cancelled";
        if (
          action === "prepare_retry" ||
          !workTransitions[work.status].includes(to)
        )
          error("INVALID_TRANSITION", `${work.status} -> ${to}`);
        if (
          work.status === "active" &&
          ["blocked", "waiting", "completed", "failed", "cancelled"].includes(
            to,
          )
        ) {
          const itemIds = new Set(
            s.items
              .filter((item) => item.workId === work.id)
              .map((item) => item.id),
          );
          if (
            s.executions.some(
              (execution) =>
                itemIds.has(execution.workItemId) &&
                execution.status === "running",
            ) ||
            s.leases.some(
              (lease) =>
                itemIds.has(lease.workItemId) && lease.status === "active",
            )
          )
            error(
              "WORK_HAS_ACTIVE_EXECUTION",
              "Work cannot change while child execution authority is active",
            );
        }
        if (
          to === "completed" &&
          s.items.some(
            (item) => item.workId === work.id && item.status !== "completed",
          )
        )
          error("WORK_ITEMS_INCOMPLETE", "All work items must be completed");
        work.status = to;
        work.version++;
        if (to === "active") work.startedAt = at(this.clock);
        if (["completed", "failed", "cancelled"].includes(to))
          work.completedAt = at(this.clock);
        event(
          s,
          this.clock,
          work.id,
          `work.${action === "start" ? "started" : action === "resume" ? "resumed" : action === "cancel" ? "cancelled" : action}`,
          {
            payload: { reason },
          },
        );
        return clone(work);
      }
      const item = get(s.items, entityId, "ITEM_NOT_FOUND");
      assertVersion(item.version, version);
      if (item.status === "in_progress")
        error(
          "LEASE_NOT_OWNER",
          "An in-progress item can only be changed by its lease-owning execution",
        );
      if (action === "start")
        error(
          "EXECUTION_REQUIRED",
          "Use startExecution to enter in_progress with an execution and lease",
        );
      const to: WorkItemStatus =
        action === "complete"
          ? "completed"
          : action === "block"
            ? "blocked"
            : action === "wait"
              ? "waiting"
              : action === "prepare_retry" || action === "resume"
                ? "ready"
                : action === "fail"
                  ? "failed"
                  : "cancelled";
      if (!itemTransitions[item.status].includes(to))
        error("INVALID_TRANSITION", `${item.status} -> ${to}`);
      if (to === "ready" && !ready(s, item))
        error("DEPENDENCY_NOT_SATISFIED", "Dependencies are incomplete");
      item.status = to;
      item.version++;
      if (["completed", "failed", "cancelled"].includes(to))
        item.completedAt = at(this.clock);
      event(
        s,
        this.clock,
        item.workId,
        `item.${action === "prepare_retry" || action === "resume" ? "resumed" : action === "cancel" ? "cancelled" : action}`,
        { itemId: item.id, payload: { reason } },
      );
      return clone(item);
    });
  }
  private promote(s: State, workId: string) {
    for (const item of s.items.filter(
      (i) => i.workId === workId && i.status === "pending" && ready(s, i),
    )) {
      item.status = "ready";
      item.version++;
      event(s, this.clock, workId, "item.updated", {
        itemId: item.id,
        payload: { status: "ready" },
      });
    }
  }
  async snapshot(workId: string) {
    await this.recovery.recover();
    const s = await this.store.read();
    const work = get(s.works, workId, "WORK_NOT_FOUND");
    return {
      work,
      items: s.items.filter((i) => i.workId === workId),
      assignments: s.assignments.filter((a) =>
        s.items.some((i) => i.id === a.workItemId && i.workId === workId),
      ),
      executions: s.executions.filter((e) =>
        s.items.some((i) => i.id === e.workItemId && i.workId === workId),
      ),
      leases: s.leases.filter((l) =>
        s.items.some((i) => i.id === l.workItemId && i.workId === workId),
      ),
      artifacts: s.artifacts.filter((a) => a.workId === workId),
      events: s.events.filter((e) => e.workId === workId),
    };
  }
  async list(workspaceId: string) {
    await this.recovery.recover();
    return (await this.store.read()).works.filter(
      (w) => w.workspaceId === workspaceId,
    );
  }
  async artifact(input: {
    workId: string;
    itemId?: string;
    type: string;
    uri: string;
    description?: string;
  }) {
    return this.store.transaction((s) => {
      get(s.works, input.workId, "WORK_NOT_FOUND");
      try {
        const u = new URL(input.uri);
        if (!["file:", "https:", "http:"].includes(u.protocol))
          error("INVALID_INPUT", "Unsupported artifact URI");
      } catch (e) {
        if (e instanceof PulsoError) throw e;
        error("INVALID_INPUT", "Invalid artifact URI");
      }
      if (
        input.itemId &&
        get(s.items, input.itemId, "ITEM_NOT_FOUND").workId !== input.workId
      )
        error("CROSS_WORK_DEPENDENCY", "Artifact item belongs to another work");
      const a: Artifact = { id: id(), ...input, createdAt: at(this.clock) };
      s.artifacts.push(a);
      event(s, this.clock, input.workId, "artifact.registered", {
        itemId: input.itemId,
        payload: { type: input.type, uri: input.uri },
      });
      return clone(a);
    });
  }
}
export class RecoveryService {
  constructor(
    private store: Store,
    private clock: Clock = systemClock,
  ) {}
  async recover() {
    return this.store.transaction((s) => {
      const now = this.clock.now();
      let count = 0;
      for (const lease of s.leases.filter(
        (l) => l.status === "active" && new Date(l.expiresAt) <= now,
      )) {
        const ex = get(s.executions, lease.executionId, "EXECUTION_NOT_FOUND");
        const item = get(s.items, lease.workItemId, "ITEM_NOT_FOUND");
        lease.status = "expired";
        lease.version++;
        if (ex.status === "running") {
          ex.status = "abandoned";
          ex.completedAt = at(this.clock);
          ex.version++;
        }
        if (item.status === "in_progress") {
          item.status = "recovery_required";
          item.version++;
        }
        event(s, this.clock, item.workId, "lease.expired", {
          itemId: item.id,
          executionId: ex.id,
        });
        event(s, this.clock, item.workId, "execution.abandoned", {
          itemId: item.id,
          executionId: ex.id,
        });
        event(s, this.clock, item.workId, "item.recovery_required", {
          itemId: item.id,
          executionId: ex.id,
        });
        count++;
      }
      return count;
    });
  }
}
export class ExecutionService {
  private recovery: RecoveryService;
  constructor(
    private store: Store,
    _work: WorkService,
    private clock: Clock = systemClock,
    private ttlMs = 300000,
  ) {
    this.recovery = new RecoveryService(store, clock);
  }
  async start(
    itemId: string,
    executorId: string,
    options?: { externalExecutionRef?: Execution["externalExecutionRef"] },
  ) {
    await this.recover();
    return this.store.transaction((s) => {
      const item = get(s.items, itemId, "ITEM_NOT_FOUND");
      const work = get(s.works, item.workId, "WORK_NOT_FOUND");
      if (!isWorkStartable(work.status))
        error(
          ["blocked", "waiting", "failed"].includes(work.status)
            ? "WORK_RESUME_REQUIRED"
            : "WORK_NOT_EXECUTABLE",
          "Work must be explicitly resumed before starting an execution",
        );
      if (item.status !== "ready")
        error(
          item.status === "recovery_required"
            ? "RECOVERY_REQUIRED"
            : "INVALID_TRANSITION",
          "Item must be ready",
        );
      if (!ready(s, item))
        error("DEPENDENCY_NOT_SATISFIED", "Dependencies incomplete");
      const assignment =
        activeAssignment(s, itemId) ??
        error("ASSIGNMENT_NOT_FOUND", "Execution requires assignment");
      if (assignment.assigneeId !== executorId)
        error("EXECUTOR_NOT_ASSIGNEE", "Executor differs from assignee");
      if (
        s.leases.some((l) => l.workItemId === itemId && l.status === "active")
      )
        error("ACTIVE_LEASE_EXISTS", "Item already leased");
      const now = at(this.clock);
      if (work.status === "pending") {
        work.status = "active";
        work.startedAt = now;
        work.version++;
        event(s, this.clock, work.id, "work.started");
      }
      const ex: Execution = {
        id: id(),
        workItemId: itemId,
        assignmentId: assignment.id,
        executorId,
        externalExecutionRef: options?.externalExecutionRef,
        status: "running",
        createdAt: now,
        startedAt: now,
        version: 1,
      };
      s.executions.push(ex);
      const lease: WorkLease = {
        id: id(),
        workItemId: itemId,
        executionId: ex.id,
        holderId: executorId,
        status: "active",
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: new Date(
          this.clock.now().getTime() + this.ttlMs,
        ).toISOString(),
        fencingToken:
          Math.max(
            0,
            ...s.leases
              .filter((l) => l.workItemId === itemId)
              .map((l) => l.fencingToken),
          ) + 1,
        version: 1,
      };
      s.leases.push(lease);
      item.status = "in_progress";
      item.startedAt = now;
      item.version++;
      event(s, this.clock, item.workId, "execution.created", {
        itemId,
        executionId: ex.id,
      });
      event(s, this.clock, item.workId, "execution.started", {
        itemId,
        executionId: ex.id,
      });
      event(s, this.clock, item.workId, "lease.acquired", {
        itemId,
        executionId: ex.id,
        payload: { leaseId: lease.id, fencingToken: lease.fencingToken },
      });
      event(s, this.clock, item.workId, "item.started", {
        itemId,
        executionId: ex.id,
      });
      return {
        executionId: ex.id,
        leaseId: lease.id,
        leaseExpiresAt: lease.expiresAt,
        fencingToken: lease.fencingToken,
      };
    });
  }
  private authorize(
    s: State,
    executionId: string,
    leaseId: string,
    fencingToken?: number,
  ) {
    const ex = get(s.executions, executionId, "EXECUTION_NOT_FOUND");
    const lease = get(s.leases, leaseId, "LEASE_NOT_FOUND");
    if (lease.executionId !== ex.id || lease.workItemId !== ex.workItemId)
      error("LEASE_NOT_OWNER", "Execution does not own lease");
    if (fencingToken !== undefined && lease.fencingToken !== fencingToken)
      error("STALE_FENCING_TOKEN", "Lease fencing token is stale");
    if (lease.status === "expired") error("LEASE_EXPIRED", "Lease expired");
    if (lease.status === "revoked") error("LEASE_REVOKED", "Lease revoked");
    if (lease.status !== "active")
      error("STALE_LEASE", "Lease is no longer active");
    if (new Date(lease.expiresAt) <= this.clock.now())
      error("LEASE_EXPIRED", "Lease expired");
    if (ex.status !== "running")
      error("EXECUTION_ALREADY_FINISHED", "Execution is terminal");
    return { ex, lease, item: get(s.items, ex.workItemId, "ITEM_NOT_FOUND") };
  }
  async heartbeat(executionId: string, leaseId: string, fencingToken?: number) {
    await this.recover();
    return this.store.transaction((s) => {
      const { ex, lease, item } = this.authorize(
        s,
        executionId,
        leaseId,
        fencingToken,
      );
      lease.heartbeatAt = at(this.clock);
      lease.expiresAt = new Date(
        this.clock.now().getTime() + this.ttlMs,
      ).toISOString();
      lease.version++;
      event(s, this.clock, item.workId, "lease.renewed", {
        itemId: item.id,
        executionId: ex.id,
        payload: { leaseId, fencingToken: lease.fencingToken },
      });
      return clone(lease);
    });
  }
  async complete(
    executionId: string,
    leaseId: string,
    result?: string,
    fencingToken?: number,
  ) {
    await this.recover();
    return this.store.transaction((s) => {
      const { ex, lease, item } = this.authorize(
        s,
        executionId,
        leaseId,
        fencingToken,
      );
      const now = at(this.clock);
      ex.status = "completed";
      ex.completedAt = now;
      ex.version++;
      lease.status = "released";
      lease.version++;
      item.status = "completed";
      item.completedAt = now;
      item.result = result;
      item.version++;
      event(s, this.clock, item.workId, "execution.completed", {
        itemId: item.id,
        executionId: ex.id,
      });
      event(s, this.clock, item.workId, "lease.released", {
        itemId: item.id,
        executionId: ex.id,
        payload: { fencingToken: lease.fencingToken },
      });
      event(s, this.clock, item.workId, "item.completed", {
        itemId: item.id,
        executionId: ex.id,
        payload: { result },
      });
      for (const dependent of s.items.filter(
        (i) =>
          i.workId === item.workId && i.status === "pending" && ready(s, i),
      )) {
        dependent.status = "ready";
        dependent.version++;
        event(s, this.clock, item.workId, "item.updated", {
          itemId: dependent.id,
          payload: { status: "ready" },
        });
      }
      return clone(item);
    });
  }
  async fail(
    executionId: string,
    leaseId: string,
    reason: string,
    recoverable = false,
    fencingToken?: number,
  ) {
    await this.recover();
    return this.store.transaction((s) => {
      const { ex, lease, item } = this.authorize(
        s,
        executionId,
        leaseId,
        fencingToken,
      );
      const now = at(this.clock);
      ex.status = "failed";
      ex.failureReason = reason;
      ex.completedAt = now;
      ex.version++;
      lease.status = "released";
      lease.version++;
      item.status = recoverable ? "recovery_required" : "failed";
      item.completedAt = now;
      item.version++;
      event(s, this.clock, item.workId, "execution.failed", {
        itemId: item.id,
        executionId: ex.id,
        payload: { reason },
      });
      event(s, this.clock, item.workId, "lease.released", {
        itemId: item.id,
        executionId: ex.id,
        payload: { fencingToken: lease.fencingToken },
      });
      event(
        s,
        this.clock,
        item.workId,
        recoverable ? "item.recovery_required" : "item.failed",
        { itemId: item.id, executionId: ex.id, payload: { reason } },
      );
      return clone(item);
    });
  }
  async cancel(executionId: string, leaseId: string, fencingToken?: number) {
    await this.recover();
    return this.store.transaction((s) => {
      const { ex, lease, item } = this.authorize(
        s,
        executionId,
        leaseId,
        fencingToken,
      );
      const now = at(this.clock);
      ex.status = "cancelled";
      ex.completedAt = now;
      ex.version++;
      lease.status = "released";
      lease.version++;
      item.status = "cancelled";
      item.completedAt = now;
      item.version++;
      event(s, this.clock, item.workId, "execution.cancelled", {
        itemId: item.id,
        executionId: ex.id,
      });
      event(s, this.clock, item.workId, "lease.released", {
        itemId: item.id,
        executionId: ex.id,
        payload: { fencingToken: lease.fencingToken },
      });
      event(s, this.clock, item.workId, "item.cancelled", {
        itemId: item.id,
        executionId: ex.id,
      });
      return clone(item);
    });
  }
  async suspend(
    executionId: string,
    leaseId: string,
    target: "blocked" | "waiting",
    reason?: string,
    fencingToken?: number,
  ) {
    await this.recover();
    return this.store.transaction((s) => {
      const { ex, lease, item } = this.authorize(
        s,
        executionId,
        leaseId,
        fencingToken,
      );
      ex.status = "abandoned";
      ex.completedAt = at(this.clock);
      ex.failureReason = reason;
      ex.version++;
      lease.status = "released";
      lease.version++;
      item.status = target;
      item.version++;
      event(s, this.clock, item.workId, `item.${target}`, {
        itemId: item.id,
        executionId: ex.id,
        payload: { reason },
      });
      event(s, this.clock, item.workId, "execution.abandoned", {
        itemId: item.id,
        executionId: ex.id,
        payload: { reason, cause: target },
      });
      event(s, this.clock, item.workId, "lease.released", {
        itemId: item.id,
        executionId: ex.id,
        payload: { fencingToken: lease.fencingToken, cause: target },
      });
      return clone(item);
    });
  }
  async revokeLease(input: {
    leaseId: string;
    reason: string;
    actor?: string;
  }) {
    await this.recover();
    return this.store.transaction((s) => {
      const lease = get(s.leases, input.leaseId, "LEASE_NOT_FOUND");
      if (lease.status !== "active")
        error("STALE_LEASE", "Lease is no longer active");
      const execution = get(
        s.executions,
        lease.executionId,
        "EXECUTION_NOT_FOUND",
      );
      const item = get(s.items, lease.workItemId, "ITEM_NOT_FOUND");
      lease.status = "revoked";
      lease.version++;
      if (execution.status === "running") {
        execution.status = "abandoned";
        execution.completedAt = at(this.clock);
        execution.failureReason = input.reason;
        execution.version++;
      }
      if (item.status === "in_progress") {
        item.status = "recovery_required";
        item.version++;
      }
      event(s, this.clock, item.workId, "lease.revoked", {
        itemId: item.id,
        executionId: execution.id,
        actor: input.actor ? { type: "user", id: input.actor } : undefined,
        payload: { reason: input.reason, leaseId: lease.id },
      });
      event(s, this.clock, item.workId, "execution.abandoned", {
        itemId: item.id,
        executionId: execution.id,
        payload: { reason: input.reason, cause: "lease.revoked" },
      });
      event(s, this.clock, item.workId, "item.recovery_required", {
        itemId: item.id,
        executionId: execution.id,
        payload: { reason: input.reason, cause: "lease.revoked" },
      });
      return clone(lease);
    });
  }
  async recover() {
    return this.recovery.recover();
  }
}
