import { expect, test } from "bun:test";
import { assembleSpecialistPrompt } from "../src/prompting/specialist-prompt-assembler";
import { createProtocolEnforcer } from "../src/protocol/enforcement";
import { renderAgentProtocolInstructions } from "../src/protocol/instructions";
import { parseTaskEnvelope } from "../src/protocol/parse";
import {
  agentResultSchema,
  resultProtocol,
  specialistIds,
  specialistPayloadSchemas,
} from "../src/protocol/schemas";
import { serializeAgentResult } from "../src/protocol/serialize";
import { specialistTaskContracts } from "../src/protocol/specialist-contracts";

const payloads = {
  planner: {
    kind: "planner",
    steps: [{ objective: "Inspect current behavior" }],
    assumptions: ["Read-only task"],
  },
  explorer: {
    kind: "explorer",
    findings: [
      {
        summary: "The route delegates to the service.",
        evidence: [{ kind: "file", ref: "src/routes.ts:10-18" }],
      },
    ],
    references: [{ kind: "symbol", ref: "RouteService.handle" }],
    limitations: ["No integration environment was available."],
  },
  executor: {
    kind: "executor",
    changes: [{ target: "src/a.ts", summary: "Updated the request mapping." }],
    validations: [{ command: "bun test", outcome: "passed" }],
    artifacts: [{ type: "patch", uri: "file:///tmp/change.patch" }],
  },
  verifier: {
    kind: "verifier",
    verdict: "partial",
    checks: [
      {
        criterion: "API response remains stable",
        result: "pass",
        evidence: [{ kind: "test", ref: "api contract test" }],
      },
    ],
    risks: ["Deployment environment was not checked."],
  },
  "security-auditor": {
    kind: "security-auditor",
    findings: [
      {
        summary: "The endpoint requires authorization.",
        severity: "low",
        evidence: [{ kind: "file", ref: "src/auth.ts:4-12" }],
      },
    ],
  },
} as const;

const resultFor = (specialist: (typeof specialistIds)[number]) => ({
  protocol: resultProtocol.id,
  delegationId: `dlg-${specialist}`,
  specialist,
  workId: "work-1",
  workItemId: "item-1",
  status: "completed" as const,
  summary: `Compact ${specialist} summary`,
  specialistResult: payloads[specialist],
});

test("minimum and representative ResultContract payloads validate for every specialist", () => {
  const minimum = {
    planner: { kind: "planner", steps: [] },
    explorer: { kind: "explorer", findings: [] },
    executor: { kind: "executor", changes: [] },
    verifier: { kind: "verifier", verdict: "pass", checks: [] },
    "security-auditor": { kind: "security-auditor", findings: [] },
  } as const;
  for (const specialist of specialistIds) {
    expect(
      agentResultSchema.parse(resultFor(specialist)).specialistResult.kind,
    ).toBe(specialist);
    expect(() =>
      specialistPayloadSchemas[specialist].parse(minimum[specialist]),
    ).not.toThrow();
  }
});

test("every specialist rejects a payload belonging to another ResultContract", () => {
  for (const specialist of specialistIds) {
    const other = specialistIds.find((candidate) => candidate !== specialist);
    if (!other) throw new Error("SPECIALIST_FIXTURE_MISSING");
    expect(() =>
      specialistPayloadSchemas[specialist].parse({
        ...payloads[other],
        kind: other,
      }),
    ).toThrow();
  }
});

test("Explorer findings need no severity; security findings require severity and Evidence objects", () => {
  const enforcer = createProtocolEnforcer();
  const expected = {
    delegationId: "dlg-explorer",
    specialist: "explorer" as const,
    workId: "work-1",
    workItemId: "item-1",
  };
  const explorer = {
    ...resultFor("explorer"),
    specialistResult: {
      kind: "explorer" as const,
      findings: [{ summary: "Observed behavior." }],
      references: [{ kind: "file" as const, ref: "src/a.ts:1-3" }],
    },
  };
  expect(
    enforcer.validateResult(serializeAgentResult(explorer), expected),
  ).toEqual(explorer);
  expect(() =>
    specialistPayloadSchemas["security-auditor"].parse({
      kind: "security-auditor",
      findings: [{ summary: "Missing severity and evidence." }],
    }),
  ).toThrow();
  expect(() =>
    specialistPayloadSchemas.explorer.parse({
      kind: "explorer",
      findings: [],
      references: ["src/a.ts:1-3"],
    }),
  ).toThrow();
});

test("programmatic assembler builds a canonical wire Task without embedding a conversation dump", () => {
  const assembled = assembleSpecialistPrompt({
    delegationId: "dlg-assembly",
    specialist: "explorer",
    workId: "work-1",
    workItemId: "item-1",
    objective: "Inspect route behavior",
    facts: ["The request is read-only."],
    references: [{ kind: "file", ref: "src/routes.ts" }],
  });
  expect(assembled.task.protocol).toBe("pulso-task/2");
  expect(assembled.task.output.contract).toBe("pulso-result/2");
  expect(assembled.specialist.taskContract?.purpose).toContain("read-only");
  expect(assembled.serializedTask).toContain('<pulso-task v="2">');
  expect(assembled.serializedTask).not.toContain("conversation");
});

test("TaskEnvelope assembly and wire round-trip cover every specialist contract", () => {
  for (const specialist of specialistIds) {
    const assembled = assembleSpecialistPrompt({
      delegationId: `dlg-${specialist}`,
      specialist,
      workId: "work-1",
      workItemId: "item-1",
      objective: `Review ${specialist} scope`,
      dependencies: [
        {
          workItemId: "item-upstream",
          summary: "Authentication flow mapped.",
          artifacts: [{ kind: "file", ref: "src/auth.ts:1-20" }],
        },
      ],
      constraints: ["read-only unless explicitly assigned"],
      acceptanceCriteria: ["return scoped evidence"],
    });
    expect(parseTaskEnvelope(assembled.serializedTask)).toEqual(assembled.task);
    expect(assembled.task.output.contract).toBe("pulso-result/2");
    expect(assembled.task.dependencies?.[0]).toEqual({
      workItemId: "item-upstream",
      summary: "Authentication flow mapped.",
      artifacts: [{ kind: "file", ref: "src/auth.ts:1-20" }],
    });
    expect(assembled.instructions).toContain(
      specialistTaskContracts[specialist].purpose,
    );
  }
});

test("Pulso lifecycle prompt explicitly fails a bound execution after Task/protocol error", () => {
  const prompt = renderAgentProtocolInstructions("pulso", undefined, {
    guarded: true,
  });
  expect(prompt).toContain("terminalize the binding before responding");
  expect(prompt).toContain("pulso_runtime_fail");
  expect(prompt).toContain(
    "Never call pulso_runtime_complete for an invalid result",
  );
});
