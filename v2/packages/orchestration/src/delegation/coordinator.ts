import type { TaskContextBuildInput } from "../protocol/context-budget";
import { buildTaskEnvelope } from "../protocol/context-budget";
import {
  parseAgentResult,
  validateAgentResultIdentity,
} from "../protocol/parse";
import { repairAgentResult } from "../protocol/repair";
import type {
  AgentResult,
  SpecialistId,
  TaskEnvelope,
} from "../protocol/schemas";
import { resultLifecycleAction } from "../protocol/schemas";
import { serializeTaskEnvelope } from "../protocol/serialize";

export type DelegationStatus =
  | "prepared"
  | "bound"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "lost"
  | "protocol_error";

export interface Delegation {
  delegationId: string;
  specialist: SpecialistId;
  workId: string;
  workItemId: string;
  bindingId?: string;
  status: DelegationStatus;
  createdAt: string;
}

export type LifecycleAction =
  | { type: "complete"; bindingId: string; artifacts: AgentResult["artifacts"] }
  | { type: "fail"; bindingId: string; reason: string }
  | { type: "cancel"; bindingId: string; reason?: string }
  | { type: "block"; bindingId: string; reason: string };

export interface PreparedDelegation {
  delegation: Delegation;
  task: TaskEnvelope;
  serializedTask: string;
  warnings: string[];
}

export type PrepareDelegationInput = Omit<
  TaskContextBuildInput,
  "delegationId"
> & {
  delegationId: string;
  createdAt?: string;
};

const reason = (result: AgentResult) => result.blockers?.[0] ?? result.summary;

export class DelegationCoordinator {
  private readonly delegations = new Map<string, Delegation>();

  prepareDelegation(input: PrepareDelegationInput): PreparedDelegation {
    if (this.delegations.has(input.delegationId))
      throw new Error("DELEGATION_ID_ALREADY_EXISTS");
    const { task, warnings } = buildTaskEnvelope(input);
    const delegation: Delegation = {
      delegationId: input.delegationId,
      specialist: input.specialist,
      workId: input.workId,
      workItemId: input.workItemId,
      status: "prepared",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.delegations.set(delegation.delegationId, delegation);
    return {
      delegation: { ...delegation },
      task,
      serializedTask: serializeTaskEnvelope(task),
      warnings,
    };
  }

  attachBinding(delegationId: string, bindingId: string): Delegation {
    const delegation = this.require(delegationId);
    this.ensureNotTerminal(delegation);
    if (delegation.status !== "prepared")
      throw new Error("DELEGATION_NOT_PREPARED");
    delegation.bindingId = bindingId;
    delegation.status = "bound";
    return { ...delegation };
  }

  markRunning(delegationId: string): Delegation {
    const delegation = this.require(delegationId);
    this.ensureNotTerminal(delegation);
    if (delegation.status !== "bound") throw new Error("DELEGATION_NOT_BOUND");
    delegation.status = "running";
    return { ...delegation };
  }

  acceptResult(delegationId: string, serializedResult: string) {
    const delegation = this.require(delegationId);
    this.ensureNotTerminal(delegation);
    if (delegation.status !== "running")
      throw new Error("INVALID_DELEGATION_STATE");
    try {
      let result: AgentResult;
      try {
        result = parseAgentResult(serializedResult);
      } catch {
        result = repairAgentResult(serializedResult);
      }
      validateAgentResultIdentity(result, delegation);
      const action = this.mapResultLifecycle(delegation, result);
      delegation.status = result.status;
      return { result, action, delegation: { ...delegation } };
    } catch (error) {
      delegation.status = "protocol_error";
      if (error instanceof Error && error.message === "PROTOCOL_PARSE_ERROR")
        throw error;
      if (error instanceof Error && error.message.startsWith("PROTOCOL_"))
        throw new Error("PROTOCOL_PARSE_ERROR");
      throw error;
    }
  }

  mapResultLifecycle(
    delegation: Delegation,
    result: AgentResult,
  ): LifecycleAction {
    if (!delegation.bindingId) throw new Error("DELEGATION_NOT_BOUND");
    const type = resultLifecycleAction[result.status];
    if (type === "complete")
      return {
        type,
        bindingId: delegation.bindingId,
        artifacts: result.artifacts,
      };
    if (type === "fail")
      return {
        type,
        bindingId: delegation.bindingId,
        reason: reason(result),
      };
    if (type === "cancel")
      return {
        type,
        bindingId: delegation.bindingId,
        reason: result.summary,
      };
    return {
      type,
      bindingId: delegation.bindingId,
      reason: reason(result),
    };
  }

  observeBindingLost(delegationId: string): Delegation {
    const delegation = this.require(delegationId);
    this.ensureNotTerminal(delegation);
    if (delegation.status !== "running")
      throw new Error("INVALID_DELEGATION_STATE");
    delegation.status = "lost";
    return { ...delegation };
  }

  get(delegationId: string): Delegation | undefined {
    const delegation = this.delegations.get(delegationId);
    return delegation ? { ...delegation } : undefined;
  }

  private require(delegationId: string): Delegation {
    const delegation = this.delegations.get(delegationId);
    if (!delegation) throw new Error("DELEGATION_NOT_FOUND");
    return delegation;
  }

  private ensureNotTerminal(delegation: Delegation) {
    if (
      [
        "completed",
        "failed",
        "blocked",
        "cancelled",
        "lost",
        "protocol_error",
      ].includes(delegation.status)
    )
      throw new Error("DELEGATION_ALREADY_TERMINAL");
  }
}
