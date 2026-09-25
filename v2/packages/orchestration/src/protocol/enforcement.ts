import { protocolIssueCode, summarizeValidationError } from "./errors";
import {
  parseAgentResult,
  parseTaskEnvelope,
  validateAgentResultIdentity,
} from "./parse";
import { repairAgentResult } from "./repair";
import type {
  AgentResult,
  ExpectedDelegationIdentity,
  SpecialistId,
  TaskEnvelope,
} from "./schemas";

export interface ExpectedTaskIdentity {
  delegationId: string;
  specialist: SpecialistId;
  workId: string;
  workItemId: string;
}

export interface ProtocolEnforcer {
  validateTask(input: unknown, expected?: ExpectedTaskIdentity): TaskEnvelope;
  validateResult(
    input: unknown,
    expected: ExpectedDelegationIdentity,
  ): AgentResult;
}

const identityFromTask = (task: TaskEnvelope): ExpectedTaskIdentity => ({
  delegationId: task.delegationId,
  specialist: task.specialist,
  workId: task.work.workId,
  workItemId: task.work.workItemId,
});

const enforcer: ProtocolEnforcer = {
  validateTask(input, expected) {
    let task: TaskEnvelope;
    try {
      task = parseTaskEnvelope(String(input));
    } catch (error) {
      const code =
        error instanceof Error && error.message.startsWith("PROTOCOL_")
          ? error.message
          : protocolIssueCode(error, "task");
      throw new Error(
        `TASK_ENVELOPE_INVALID:${code}: ${summarizeValidationError(error)}`,
        { cause: error },
      );
    }
    if (expected) {
      const actual = identityFromTask(task);
      for (const key of Object.keys(
        expected,
      ) as (keyof ExpectedTaskIdentity)[]) {
        if (actual[key] !== expected[key])
          throw new Error(`${taskIdentityCode(key)}:${String(actual[key])}`);
      }
    }
    return task;
  },
  validateResult(input, expected) {
    const source = typeof input === "string" ? input : String(input);
    try {
      return parseAgentResult(source, expected);
    } catch (initialError) {
      try {
        const repaired = repairAgentResult(source);
        return validateAgentResultIdentity(repaired, expected);
      } catch (error) {
        const cause =
          error instanceof Error && error.message === "PROTOCOL_PARSE_ERROR"
            ? initialError
            : error;
        const code =
          cause instanceof Error && cause.message.startsWith("PROTOCOL_")
            ? cause.message
            : cause instanceof Error &&
                /(?:DELEGATION_ID|SPECIALIST|WORK_ID|WORK_ITEM_ID)_MISMATCH/.test(
                  cause.message,
                )
              ? cause.message.split(":")[0]
              : protocolIssueCode(cause, "result");
        throw new Error(
          `AGENT_RESULT_INVALID:${code}: ${summarizeValidationError(cause)}`,
          { cause },
        );
      }
    }
  },
};

const taskIdentityCode = (key: keyof ExpectedTaskIdentity) =>
  ({
    delegationId: "DELEGATION_ID_MISMATCH",
    specialist: "SPECIALIST_MISMATCH",
    workId: "WORK_ID_MISMATCH",
    workItemId: "WORK_ITEM_ID_MISMATCH",
  })[key];

export const createProtocolEnforcer = (): ProtocolEnforcer => enforcer;
