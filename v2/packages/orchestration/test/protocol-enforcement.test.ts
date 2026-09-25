import { expect, test } from "bun:test";
import { createProtocolEnforcer } from "../src/protocol/enforcement";
import { summarizeValidationError } from "../src/protocol/errors";
import { agentResultSchema } from "../src/protocol/schemas";
import {
  serializeAgentResult,
  serializeTaskEnvelope,
} from "../src/protocol/serialize";
import { PulsoProtocolGuard } from "../src/runtimes/opencode/protocol-guard/plugin";

const task = {
  protocol: "pulso-task/2" as const,
  delegationId: "dlg-1",
  specialist: "explorer" as const,
  work: { workId: "work-1", workItemId: "item-1" },
  objective: "Inspect code",
  output: { contract: "pulso-result/2" as const },
};
const result = {
  protocol: "pulso-result/2" as const,
  delegationId: "dlg-1",
  specialist: "explorer" as const,
  workId: "work-1",
  workItemId: "item-1",
  status: "completed" as const,
  summary: "Inspected",
  specialistResult: {
    kind: "explorer" as const,
    findings: [],
  },
};
const call = { sessionID: "session-1", callID: "call-1" };
const taskOutput = (body: string, session = "child-1") =>
  `<task id="${session}" state="completed"><task_result>${body}</task_result></task>`;

test("host-agnostic enforcer validates exact task and result identities and canonical statuses", () => {
  const enforcer = createProtocolEnforcer();
  expect(enforcer.validateTask(serializeTaskEnvelope(task))).toEqual(task);
  expect(() =>
    enforcer.validateTask(serializeTaskEnvelope(task), {
      delegationId: "dlg-1",
      specialist: "executor",
      workId: "work-1",
      workItemId: "item-1",
    }),
  ).toThrow("SPECIALIST_MISMATCH");
  expect(() =>
    enforcer.validateResult(
      serializeAgentResult(result).replace("completed", "succeeded"),
      {
        delegationId: "dlg-1",
        specialist: "explorer",
        workId: "work-1",
        workItemId: "item-1",
      },
    ),
  ).toThrow("AGENT_RESULT_INVALID");
});

test("result enforcement rejects missing specialist, identity mismatches, and payload-kind mismatch", () => {
  const enforcer = createProtocolEnforcer();
  const expected = {
    delegationId: "dlg-1",
    specialist: "explorer" as const,
    workId: "work-1",
    workItemId: "item-1",
  };
  const wire = serializeAgentResult(result);
  const invalid = [
    wire.replace("&quot;specialist&quot;:&quot;explorer&quot;,", ""),
    wire.replace(
      "&quot;delegationId&quot;:&quot;dlg-1&quot;",
      "&quot;delegationId&quot;:&quot;dlg-other&quot;",
    ),
    wire.replace(
      "&quot;workItemId&quot;:&quot;item-1&quot;",
      "&quot;workItemId&quot;:&quot;item-other&quot;",
    ),
    wire.replace(
      "&quot;kind&quot;:&quot;explorer&quot;",
      "&quot;kind&quot;:&quot;executor&quot;",
    ),
  ];
  for (const source of invalid)
    expect(() => enforcer.validateResult(source, expected)).toThrow(
      "AGENT_RESULT_INVALID",
    );
});

test("specialist contract diagnostics are bounded while retaining the issue count", () => {
  const findings = Array.from({ length: 8 }, (_, index) => ({
    statement: `Observation ${index}`,
    severity: "informational",
    references: [`src/file-${index}.ts:1`],
  }));
  const parsed = agentResultSchema.safeParse({
    ...result,
    specialistResult: {
      kind: "explorer",
      findings,
      references: findings.map((finding) => finding.references[0]),
    },
  });
  if (parsed.success) throw new Error("INVALID_FIXTURE_SHOULD_FAIL");
  const summary = summarizeValidationError(parsed.error);
  expect(summary.length).toBeLessThan(400);
  expect(summary).toContain("contract issues");
  expect(summary).toContain("specialistResult");
  expect(summary).toContain("more");
});

test("OpenCode guard leaves non-Pulso tasks untouched and rejects invalid Pulso tasks before execution", async () => {
  const guard = await PulsoProtocolGuard();
  const before = guard["tool.execute.before"];
  await before(
    { tool: "task", ...call },
    { args: { prompt: "ordinary task", subagent_type: "explorer" } },
  );
  await expect(
    before(
      { tool: "task", ...call },
      { args: { prompt: "pulso-task/2 invalid", subagent_type: "explorer" } },
    ),
  ).rejects.toThrow("PULSO_PROTOCOL_INVALID_TASK");
  await expect(
    before(
      { tool: "task", sessionID: "session-1", callID: "legacy" },
      {
        args: {
          prompt:
            '<pulso-task v="1"><payload>{&quot;protocol&quot;:&quot;pulso-task/1&quot;}</payload></pulso-task>',
          subagent_type: "explorer",
        },
      },
    ),
  ).rejects.toThrow("PULSO_PROTOCOL_INVALID_TASK");
  await expect(
    before(
      { tool: "task", ...call },
      {
        args: {
          prompt: serializeTaskEnvelope(task),
          subagent_type: "executor",
        },
      },
    ),
  ).rejects.toThrow("SUBAGENT_SPECIALIST_MISMATCH");
  await guard.dispose?.();
});

test("OpenCode guard validates each parallel result by public session and call IDs and clears correlation", async () => {
  const guard = await PulsoProtocolGuard();
  const before = guard["tool.execute.before"];
  const after = guard["tool.execute.after"];
  const secondTask = {
    ...task,
    delegationId: "dlg-2",
    work: { ...task.work, workItemId: "item-2" },
  };
  await before(
    { tool: "task", ...call },
    {
      args: { prompt: serializeTaskEnvelope(task), subagent_type: "explorer" },
    },
  );
  await before(
    { tool: "task", sessionID: "session-1", callID: "call-2" },
    {
      args: {
        prompt: serializeTaskEnvelope(secondTask),
        subagent_type: "explorer",
      },
    },
  );
  await expect(
    after(
      { tool: "task", ...call },
      {
        output: taskOutput(
          serializeAgentResult(result).replace("completed", "succeeded"),
        ),
      },
    ),
  ).rejects.toThrow("PULSO_PROTOCOL_INVALID_RESULT");
  await expect(
    after(
      { tool: "task", sessionID: "session-1", callID: "call-2" },
      {
        output: taskOutput(
          serializeAgentResult({
            ...result,
            delegationId: "dlg-2",
            workItemId: "item-2",
          }),
          "child-2",
        ),
      },
    ),
  ).resolves.toBeUndefined();
  await expect(
    after({ tool: "task", ...call }, { output: "anything" }),
  ).resolves.toBeUndefined();
  await guard.dispose?.();
});
