import { createProtocolEnforcer } from "../../../protocol/enforcement";
import type {
  ExpectedDelegationIdentity,
  TaskEnvelope,
} from "../../../protocol/schemas";

type HookInput = {
  tool: string;
  sessionID: string;
  callID: string;
  args?: Record<string, unknown>;
};
type HookOutput = {
  args?: Record<string, unknown>;
  output?: string;
};

// Recognize old/new Pulso markers so stale installed prompts fail closed.
const protocolMarker = /pulso-task\/\d+/;
const extractTaskResult = (output: string) => {
  const match =
    /^\s*<task\b[^>]*state="completed"[^>]*>[\s\S]*?<task_result>([\s\S]*?)<\/task_result>\s*<\/task>\s*$/.exec(
      output,
    );
  if (!match?.[1]) throw new Error("TASK_RESULT_NOT_COMPLETED_OR_TEXT_MISSING");
  return match[1].trim();
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const PulsoProtocolGuard = async () => {
  const pending = new Map<string, ExpectedDelegationIdentity>();
  const expiry = new Map<string, ReturnType<typeof setTimeout>>();
  const enforcer = createProtocolEnforcer();
  const keyOf = (input: Pick<HookInput, "sessionID" | "callID">) =>
    `${input.sessionID}\u0000${input.callID}`;

  return {
    "tool.execute.before": async (input: HookInput, output: HookOutput) => {
      if (input.tool !== "task" || !isRecord(output.args)) return;
      const prompt = output.args.prompt;
      if (typeof prompt !== "string" || !protocolMarker.test(prompt)) return;
      let task: TaskEnvelope;
      try {
        task = enforcer.validateTask(prompt);
        if (output.args.subagent_type !== task.specialist)
          throw new Error("SUBAGENT_SPECIALIST_MISMATCH");
      } catch (error) {
        throw new Error(
          `PULSO_PROTOCOL_INVALID_TASK: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const key = keyOf(input);
      const oldExpiry = expiry.get(key);
      if (oldExpiry) clearTimeout(oldExpiry);
      pending.set(key, {
        delegationId: task.delegationId,
        specialist: task.specialist,
        workId: task.work.workId,
        workItemId: task.work.workItemId,
      });
      const timer = setTimeout(
        () => {
          pending.delete(key);
          expiry.delete(key);
        },
        10 * 60 * 1000,
      );
      timer.unref?.();
      expiry.set(key, timer);
    },
    "tool.execute.after": async (input: HookInput, output: HookOutput) => {
      if (input.tool !== "task") return;
      const key = keyOf(input);
      const expected = pending.get(key);
      if (!expected) return;
      pending.delete(key);
      const timer = expiry.get(key);
      if (timer) clearTimeout(timer);
      expiry.delete(key);
      try {
        if (typeof output.output !== "string")
          throw new Error("RESULT_TEXT_MISSING");
        enforcer.validateResult(extractTaskResult(output.output), expected);
      } catch (error) {
        throw new Error(
          `PULSO_PROTOCOL_INVALID_RESULT: ${expected.specialist} result rejected (${error instanceof Error ? error.message : String(error)}). Delegation was not accepted.`,
        );
      }
    },
    dispose: async () => {
      for (const timer of expiry.values()) clearTimeout(timer);
      expiry.clear();
      pending.clear();
    },
  };
};
