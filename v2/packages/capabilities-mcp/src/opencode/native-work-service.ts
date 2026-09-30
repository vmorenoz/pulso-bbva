import { createHash } from "node:crypto";
import {
  PulsoError,
  type Work,
  type WorkItem,
} from "../../../working-system/src";
import type { CapabilitiesRuntime } from "../bootstrap";
import type { NativeWorkInput } from "./facade-contracts";
import type { NativeDelegation, NativeJournal } from "./native-journal";

export type NativeSession = {
  workspaceId: string;
  parentSessionId: string;
  messageId: string;
  agent: string;
};

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
const now = () => new Date().toISOString();
const selectable = new Set([
  "pending",
  "active",
  "blocked",
  "waiting",
  "failed",
]);

export class NativeWorkService {
  constructor(
    private readonly runtime: CapabilitiesRuntime,
    private readonly journal: NativeJournal,
  ) {}

  async execute(input: NativeWorkInput, session: NativeSession) {
    this.assertPulso(session);
    if (input.action === "get") return this.get(session);
    if (input.action === "open") return this.open(input, session);
    if (input.action === "use") return this.use(input.workId, session);
    if (input.action === "resume")
      return this.resume(input.workId, input.reason, session);
    if (input.action === "close")
      return this.close(input.workId, input.outcome, input.reason, session);
    return this.retry(input, session);
  }

  async get(session: NativeSession) {
    const workId = await this.journal.currentWork(
      session.workspaceId,
      session.parentSessionId,
    );
    if (!workId) return { currentWork: null };
    const snapshot = await this.ownedSnapshot(workId, session);
    return { currentWork: this.view(snapshot.work, snapshot.items) };
  }

  private async open(
    input: Extract<NativeWorkInput, { action: "open" }>,
    session: NativeSession,
  ) {
    const currentId = await this.journal.currentWork(
      session.workspaceId,
      session.parentSessionId,
    );
    if (input.intent === "continue" && currentId) {
      const snapshot = await this.ownedSnapshot(currentId, session);
      if (selectable.has(snapshot.work.status))
        return {
          ...this.view(snapshot.work, snapshot.items),
          reused: true,
          ...(["blocked", "waiting", "failed"].includes(snapshot.work.status)
            ? { resumeRequired: true }
            : {}),
        };
    }
    const operation = this.operation(session, "open", input);
    const work = await this.runtime.work.create(
      {
        workspaceId: session.workspaceId,
        title: input.title ?? input.objective.slice(0, 80),
        objective: input.objective,
      },
      operation,
    );
    await this.journal.associateWork({
      workspaceId: session.workspaceId,
      parentSessionId: session.parentSessionId,
      workId: work.id,
      associatedAt: now(),
    });
    return { ...this.view(work, []), reused: false };
  }

  private async use(workId: string, session: NativeSession) {
    const snapshot = await this.ownedSnapshot(workId, session);
    await this.journal.associateWork({
      workspaceId: session.workspaceId,
      parentSessionId: session.parentSessionId,
      workId,
      associatedAt: now(),
    });
    return { ...this.view(snapshot.work, snapshot.items), reused: true };
  }

  private async resume(workId: string, reason: string, session: NativeSession) {
    await this.ownedSnapshot(workId, session);
    await this.runtime.work.transition("work", workId, "resume", reason);
    const snapshot = await this.runtime.work.snapshot(workId);
    return { ...this.view(snapshot.work, snapshot.items), reused: false };
  }

  private async close(
    workId: string,
    outcome: "completed" | "failed" | "cancelled",
    reason: string,
    session: NativeSession,
  ) {
    await this.ownedSnapshot(workId, session);
    const action =
      outcome === "completed"
        ? "complete"
        : outcome === "failed"
          ? "fail"
          : "cancel";
    await this.runtime.work.transition("work", workId, action, reason);
    const snapshot = await this.runtime.work.snapshot(workId);
    return { ...this.view(snapshot.work, snapshot.items), reused: false };
  }

  private async retry(
    input: Extract<NativeWorkInput, { action: "retry_item" }>,
    session: NativeSession,
  ) {
    const currentId = await this.journal.currentWork(
      session.workspaceId,
      session.parentSessionId,
    );
    if (!currentId)
      throw new PulsoError(
        "WORK_NOT_FOUND",
        "No current Work for this session",
      );
    const snapshot = await this.ownedSnapshot(currentId, session);
    if (["completed", "cancelled"].includes(snapshot.work.status))
      throw new PulsoError(
        "WORK_NOT_MODIFIABLE",
        "Terminal Work cannot retry a WorkItem",
      );
    const item = snapshot.items.find(
      (candidate) => candidate.id === input.workItemId,
    );
    if (!item)
      throw new PulsoError(
        "WORK_ITEM_NOT_FOUND",
        "WorkItem is not in the current Work",
      );
    const delegation = await this.journal.get(input.previousDelegationId);
    this.assertRetryReceipt(delegation, input, session, item);
    if (
      snapshot.executions.some(
        (execution) =>
          execution.workItemId === item.id && execution.status === "running",
      ) ||
      snapshot.leases.some(
        (lease) => lease.workItemId === item.id && lease.status === "active",
      )
    )
      throw new PulsoError(
        "WORK_HAS_ACTIVE_EXECUTION",
        "Retry requires extinguished authority",
      );
    if (
      !["failed", "blocked", "waiting", "recovery_required"].includes(
        item.status,
      )
    )
      throw new PulsoError(
        "INVALID_TRANSITION",
        "WorkItem is not eligible for explicit retry",
      );
    await this.runtime.work.transition(
      "item",
      item.id,
      "prepare_retry",
      input.reason,
    );
    const retried = await this.runtime.work.snapshot(currentId);
    return {
      ...this.view(retried.work, retried.items),
      retryPrepared: true,
      warning:
        "Previous side effects may continue; inspect them before prepare.",
    };
  }

  private assertRetryReceipt(
    delegation: NativeDelegation | undefined,
    input: Extract<NativeWorkInput, { action: "retry_item" }>,
    session: NativeSession,
    item: WorkItem,
  ) {
    if (!delegation)
      throw new PulsoError(
        "DELEGATION_NOT_FOUND",
        "Previous delegation was not found",
      );
    if (
      delegation.workspaceId !== session.workspaceId ||
      delegation.parentSessionId !== session.parentSessionId ||
      delegation.workItemId !== item.id ||
      delegation.receiptHash !== input.reviewedReceiptHash ||
      !["closed", "expired"].includes(delegation.transportPhase) ||
      delegation.receiptPhase === "none"
    )
      throw new PulsoError(
        "RETRY_RECEIPT_MISMATCH",
        "Previous delegation receipt is not eligible for retry",
      );
  }

  private async ownedSnapshot(workId: string, session: NativeSession) {
    if (
      !(await this.journal.ownsWork(
        session.workspaceId,
        session.parentSessionId,
        workId,
      ))
    )
      throw new PulsoError(
        "WORK_SESSION_OWNERSHIP",
        "Work does not belong to this parent session",
      );
    const snapshot = await this.runtime.work.snapshot(workId);
    if (snapshot.work.workspaceId !== session.workspaceId)
      throw new PulsoError(
        "WORKSPACE_MISMATCH",
        "Work belongs to another workspace",
      );
    return snapshot;
  }

  private operation(session: NativeSession, name: string, input: unknown) {
    const inputHash = hash(input);
    return {
      operationKey: hash({
        workspaceId: session.workspaceId,
        parentSessionId: session.parentSessionId,
        messageId: session.messageId,
        name,
        inputHash,
      }),
      inputHash,
    };
  }

  private view(work: Work, items: WorkItem[]) {
    const counts = items.reduce<Record<string, number>>((result, item) => {
      result[item.status] = (result[item.status] ?? 0) + 1;
      return result;
    }, {});
    return {
      workId: work.id,
      objective: work.objective,
      status: work.status,
      counts,
      items: items.map((item) => ({
        workItemId: item.id,
        kind: item.kind,
        status: item.status,
      })),
    };
  }

  private assertPulso(session: NativeSession) {
    if (session.agent !== "pulso")
      throw new PulsoError(
        "NATIVE_PERMISSION_DENIED",
        "Only the Pulso parent agent may use this tool",
      );
    if (!session.workspaceId || !session.parentSessionId || !session.messageId)
      throw new PulsoError(
        "WORKSPACE_OR_SESSION",
        "Host workspace and session identity are required",
      );
  }
}
