import { expect, test } from "bun:test";
import {
  agentResultSchema,
  agentResultStatuses,
  buildTaskEnvelope,
  parseAgentResult,
  parseTaskEnvelope,
  repairAgentResult,
  resultProtocol,
  serializeAgentResult,
  serializeTaskEnvelope,
  taskProtocol,
} from "../src";

const result = {
  protocol: "pulso-result/1" as const,
  delegationId: "dlg-1",
  specialist: "executor" as const,
  workId: "work-1",
  workItemId: "item-1",
  status: "completed" as const,
  summary: "Completed <safely> & fully",
  evidence: [{ kind: "file" as const, ref: "src/a.ts:1", note: "changed" }],
  artifacts: [
    { type: "report", uri: "file:///tmp/result.txt", description: "report" },
  ],
  validations: [
    { command: "bun test", outcome: "passed" as const, note: "all" },
  ],
  findings: [
    {
      severity: "low" as const,
      summary: "none",
      evidence: [{ kind: "test" as const, ref: "suite" }],
    },
  ],
  blockers: ["none known"],
  risks: ["follow-up"],
  suggestedNextStep: "Review",
  specialistResult: {
    kind: "executor" as const,
    changes: ["src/a.ts:1"],
    validations: [{ command: "bun test", outcome: "passed" as const }],
    artifacts: [{ type: "report", uri: "file:///tmp/result.txt" }],
  },
};

test("task envelope round trips all supported context", () => {
  const task = {
    protocol: "pulso-task/1" as const,
    delegationId: "dlg-1",
    specialist: "executor" as const,
    work: { workId: "work-1", workItemId: "item-1" },
    objective: "Inspect <all> & preserve",
    context: {
      facts: ["fact"],
      references: [{ kind: "symbol" as const, ref: "a&b", note: "note" }],
      priorResults: [
        {
          delegationId: "dlg-0",
          specialist: "explorer" as const,
          summary: "prior",
          evidenceRefs: ["src/a.ts:1"],
        },
      ],
    },
    constraints: ["no scope creep"],
    acceptanceCriteria: ["passes"],
    scope: { include: ["src"], exclude: ["dist"] },
    requestedEvidence: ["test output"],
    output: { contract: "pulso-result/1" as const },
  };
  expect(parseTaskEnvelope(serializeTaskEnvelope(task))).toEqual(task);
});

test("agent result round trips every common and specialized field", () => {
  expect(parseAgentResult(serializeAgentResult(result))).toEqual(result);
});

test("result identity and protocol versions are rejected explicitly", () => {
  const serialized = serializeAgentResult(result);
  const expected = {
    delegationId: "dlg-1",
    specialist: "executor" as const,
    workId: "work-1",
    workItemId: "item-1",
  };
  expect(parseAgentResult(serialized, expected)).toEqual(result);
  expect(() =>
    parseAgentResult(serialized, { ...expected, delegationId: "other" }),
  ).toThrow("DELEGATION_ID_MISMATCH");
  expect(() =>
    parseAgentResult(serialized, { ...expected, workId: "other" }),
  ).toThrow("WORK_ID_MISMATCH");
  expect(() =>
    parseAgentResult(serialized, { ...expected, workItemId: "other" }),
  ).toThrow("WORK_ITEM_ID_MISMATCH");
  expect(() => parseAgentResult(serialized.replace('v="1"', 'v="2"'))).toThrow(
    "PROTOCOL_VERSION_MISMATCH",
  );
});

test("the observed legacy status and missing delegation identity are rejected", () => {
  const legacy = { ...result, status: "succeeded" };
  expect(() => agentResultSchema.parse(legacy)).toThrow();
  expect(agentResultStatuses).toEqual([
    "completed",
    "blocked",
    "failed",
    "cancelled",
  ]);

  const { delegationId: _, ...withoutDelegation } = result;
  expect(() => agentResultSchema.parse(withoutDelegation)).toThrow();
  expect(taskProtocol.id).toBe("pulso-task/1");
  expect(resultProtocol.id).toBe("pulso-result/1");
});

test("repair only removes a single outer fence and malformed structures fail", () => {
  expect(
    repairAgentResult(`\`\`\`xml\n${serializeAgentResult(result)}\n\`\`\``),
  ).toEqual(result);
  expect(() =>
    repairAgentResult('```xml\n<pulso-result v="1">bad</pulso-result>\n```'),
  ).toThrow("PROTOCOL_PARSE_ERROR");
});

test("context warnings are opt-in and never remove context", () => {
  const built = buildTaskEnvelope({
    delegationId: "dlg-budget",
    specialist: "explorer",
    workId: "work-budget",
    workItemId: "item-budget",
    objective: "Inspect",
    facts: ["long fact"],
    priorResults: [
      {
        delegationId: "prior",
        specialist: "explorer",
        summary: "large prior result",
      },
    ],
    contextBudget: { warnAt: 0, priorResultWarnAt: 1, inlineSnippetWarnAt: 1 },
  });
  expect(built.warnings).toEqual([
    "context exceeds configured warning budget",
    "prior result exceeds configured warning budget",
    "inline snippet exceeds configured warning budget",
  ]);
  expect(built.task.context?.facts).toEqual(["long fact"]);
  expect(built.task.context?.priorResults).toHaveLength(1);
});

test("context builder deduplicates, prioritizes and omits empty sections", () => {
  const built = buildTaskEnvelope({
    delegationId: "dlg-1",
    specialist: "explorer",
    workId: "work-1",
    workItemId: "item-1",
    objective: " Investigate ",
    facts: ["", "same", { value: "important", priority: 2 }, "same"],
    references: [
      { kind: "file", ref: "src/a.ts" },
      { kind: "file", ref: "src/a.ts" },
    ],
    priorResults: [
      {
        delegationId: "dlg-0",
        specialist: "executor",
        summary: "done",
        evidenceRefs: ["src/a.ts"],
      },
    ],
    constraints: [""],
  });
  expect(built.task.objective).toBe("Investigate");
  expect(built.task.context).toEqual({
    facts: ["important", "same"],
    references: [{ kind: "file", ref: "src/a.ts" }],
    priorResults: [
      {
        delegationId: "dlg-0",
        specialist: "executor",
        summary: "done",
        evidenceRefs: ["src/a.ts"],
      },
    ],
  });
  expect(built.task).not.toHaveProperty("constraints");
});
