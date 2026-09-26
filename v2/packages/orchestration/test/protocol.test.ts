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
  protocol: "pulso-result/2" as const,
  delegationId: "dlg-1",
  specialist: "executor" as const,
  workId: "work-1",
  workItemId: "item-1",
  status: "completed" as const,
  summary: "Completed <safely> & fully",
  specialistResult: {
    kind: "executor" as const,
    changes: [{ target: "src/a.ts", summary: "Implemented safely" }],
    validations: [{ command: "bun test", outcome: "passed" as const }],
    artifacts: [{ type: "report", uri: "file:///tmp/result.txt" }],
  },
};

test("task envelope round trips all supported context", () => {
  const task = {
    protocol: "pulso-task/2" as const,
    delegationId: "dlg-1",
    specialist: "executor" as const,
    work: { workId: "work-1", workItemId: "item-1" },
    objective: "Inspect <all> & preserve",
    context: {
      facts: ["fact"],
      references: [{ kind: "symbol" as const, ref: "a&b", note: "note" }],
    },
    dependencies: [
      {
        workItemId: "item-prior",
        summary: "Prior implementation mapped",
        artifacts: [{ kind: "file" as const, ref: "src/a.ts:1" }],
      },
    ],
    constraints: ["no scope creep"],
    acceptanceCriteria: ["passes"],
    scope: { include: ["src"], exclude: ["dist"] },
    requestedEvidence: ["test output"],
    output: { contract: "pulso-result/2" as const },
  };
  expect(parseTaskEnvelope(serializeTaskEnvelope(task))).toEqual(task);
});

test("agent result round trips every common and specialized field", () => {
  expect(parseAgentResult(serializeAgentResult(result))).toEqual(result);
});

test("v2 audit wire is raw JSON, tag-safe, and reads legacy v2 payloads", () => {
  const wire = serializeAgentResult({
    ...result,
    summary: "literal </pulso-result> & <tag>",
  });
  expect(wire).not.toContain("<payload>");
  expect(wire).not.toContain("&quot;");
  expect(wire).toContain("\\u003C/pulso-result>");
  expect(parseAgentResult(wire).summary).toContain("</pulso-result>");

  const legacy = `<pulso-result v="2"><payload>${JSON.stringify(result)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")}</payload></pulso-result>`;
  expect(parseAgentResult(legacy)).toEqual(result);
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
  expect(() => parseAgentResult(serialized.replace('v="2"', 'v="3"'))).toThrow(
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
  expect(taskProtocol.id).toBe("pulso-task/2");
  expect(resultProtocol.id).toBe("pulso-result/2");
});

test("repair only removes a single outer fence and malformed structures fail", () => {
  expect(
    repairAgentResult(`\`\`\`xml\n${serializeAgentResult(result)}\n\`\`\``),
  ).toEqual(result);
  expect(() =>
    repairAgentResult('```xml\n<pulso-result v="1">bad</pulso-result>\n```'),
  ).toThrow("PROTOCOL_PARSE_ERROR");
});

test("specialist payloads are discriminated by ResultContract v2", () => {
  const common = {
    protocol: "pulso-result/2" as const,
    delegationId: "dlg-contract",
    workId: "work-contract",
    workItemId: "item-contract",
    status: "completed" as const,
    summary: "Contract fixture",
  };
  const explorer = {
    ...common,
    specialist: "explorer" as const,
    specialistResult: {
      kind: "explorer" as const,
      findings: [{ summary: "Observed behavior; no severity is required." }],
      references: [{ kind: "file" as const, ref: "src/route.ts:10-18" }],
    },
  };
  expect(agentResultSchema.parse(explorer)).toEqual(explorer);
  expect(() =>
    agentResultSchema.parse({
      ...explorer,
      specialistResult: {
        ...explorer.specialistResult,
        findings: [
          { summary: "Unexpected security-like field", severity: "high" },
        ],
      },
    }),
  ).toThrow();
  expect(() =>
    agentResultSchema.parse({
      ...explorer,
      specialistResult: {
        kind: "security-auditor",
        findings: [{ summary: "Security issue", evidence: [] }],
      },
    }),
  ).toThrow();
  expect(taskProtocol.id).toBe("pulso-task/2");
  expect(resultProtocol.id).toBe("pulso-result/2");
});

test("context warnings are opt-in and never remove context", () => {
  const built = buildTaskEnvelope({
    delegationId: "dlg-budget",
    specialist: "explorer",
    workId: "work-budget",
    workItemId: "item-budget",
    objective: "Inspect",
    facts: ["long fact"],
    dependencies: [
      {
        workItemId: "prior-item",
        summary: "large dependency summary",
      },
    ],
    contextBudget: {
      warnAt: 0,
      dependencySummaryWarnAt: 1,
      inlineSnippetWarnAt: 1,
    },
  });
  expect(built.warnings).toEqual([
    "context exceeds configured warning budget",
    "dependency summary exceeds configured warning budget",
    "inline snippet exceeds configured warning budget",
  ]);
  expect(built.task.context?.facts).toEqual(["long fact"]);
  expect(built.task.dependencies).toHaveLength(1);
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
    dependencies: [
      {
        workItemId: "item-upstream",
        summary: "done",
        artifacts: [{ kind: "file" as const, ref: "src/a.ts" }],
      },
    ],
    constraints: [""],
  });
  expect(built.task.objective).toBe("Investigate");
  expect(built.task.context).toEqual({
    facts: ["important", "same"],
    references: [{ kind: "file", ref: "src/a.ts" }],
  });
  expect(built.task.dependencies).toEqual([
    {
      workItemId: "item-upstream",
      summary: "done",
      artifacts: [{ kind: "file", ref: "src/a.ts" }],
    },
  ]);
  expect(built.task).not.toHaveProperty("constraints");
});
