import { expect, test } from "bun:test";
import { evolutionSchemas } from "../src/adaptive/contracts";

const criterion = { key: "done", description: "Done", evidenceRequired: true };
const graph = {
  protocol: "pulso-graph/1",
  revision: 1,
  branches: [
    {
      key: "b",
      objective: "Objective",
      deliverable: "Output",
      allowedEffects: ["read"],
      criteria: [criterion],
    },
  ],
  nodes: [
    {
      key: "n",
      branch: "b",
      specialist: "explorer",
      objective: "Inspect",
      dependsOn: [],
      effects: ["read"],
      resources: [{ path: "src", coverage: "subtree", access: "read" }],
      mode: "read",
      criteria: [criterion],
      requiredCapabilities: [],
    },
  ],
};
const plan = {
  protocol: "pulso-plan/1",
  status: "draft",
  title: "Plan",
  inventoryComplete: false,
  targets: [
    {
      path: "src/a.ts",
      existence: "existing",
      evidence: [{ kind: "file", ref: "src/a.ts" }],
      behaviors: ["works"],
    },
  ],
  graph,
  unresolved: [],
};
const inventory = {
  protocol: "pulso-inventory/1",
  complete: true,
  universe: ["src"],
  exclusions: [],
  entries: [
    {
      target: "src/a.ts",
      specs: [],
      evidenceLevel: "located",
      behaviors: ["works"],
      evidence: [{ kind: "file", ref: "src/a.ts" }],
    },
  ],
  limitations: [],
};
const review = {
  protocol: "pulso-review/1",
  artifactRef: "artifact-1",
  verdict: "pass",
  checks: [
    {
      criterion: "done",
      result: "pass",
      evidence: [{ kind: "file", ref: "src/a.ts" }],
    },
  ],
  limitations: [],
};
const valid: Record<keyof typeof evolutionSchemas, unknown> = {
  graph,
  work: {
    request: { action: "revise", expectedRevision: 1, graph, reason: "Refine" },
  },
  prepare: { request: { intent: "new", objective: "Objective", graph } },
  preferences: {
    request: {
      action: "set",
      scope: "project",
      key: "tool",
      value: "search",
      expectedRevision: 0,
      reason: "User requested",
    },
  },
  inventory,
  plan,
  inspect: { view: "health", detail: "summary" },
  artifact: { request: { action: "publish", document: plan } },
  review,
};

test("the nine strict Zod contracts accept their documented shapes and reject extras", () => {
  expect(Object.keys(evolutionSchemas)).toHaveLength(9);
  for (const [name, schema] of Object.entries(evolutionSchemas)) {
    expect(
      schema.safeParse(valid[name as keyof typeof evolutionSchemas]).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        ...(valid[name as keyof typeof evolutionSchemas] as object),
        injected: true,
      }).success,
    ).toBe(false);
  }
});

test("contracts preserve discriminants, required fields, and nested strictness", () => {
  expect(
    evolutionSchemas.prepare.safeParse({
      request: { intent: "continue", select: "ready" },
    }).success,
  ).toBe(true);
  expect(
    evolutionSchemas.prepare.safeParse({
      request: { intent: "continue", objective: "silently ignored", graph },
    }).success,
  ).toBe(false);
  expect(
    evolutionSchemas.work.safeParse({
      request: {
        action: "finish",
        outcome: "completed",
        reason: "Done",
        graph,
      },
    }).success,
  ).toBe(false);
  expect(
    evolutionSchemas.preferences.safeParse({
      request: {
        action: "set",
        scope: "project",
        key: "x",
        value: "",
        expectedRevision: 0,
        reason: "Because",
      },
    }).success,
  ).toBe(false);
  expect(
    evolutionSchemas.graph.safeParse({
      ...graph,
      nodes: [{ ...graph.nodes[0], unmodeled: true }],
    }).success,
  ).toBe(false);
  expect(
    evolutionSchemas.artifact.safeParse({
      request: {
        action: "publish",
        document: {
          ...plan,
          targets: [
            {
              ...plan.targets[0],
              evidence: [{ kind: "file", ref: "x", unexpected: true }],
            },
          ],
        },
      },
    }).success,
  ).toBe(false);
});
