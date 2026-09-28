import { expect, test } from "bun:test";
import { validatePlanReadiness } from "../../capabilities-mcp/src/opencode/artifact-service";
import type { ExecutablePlan } from "../src/adaptive/types";

const criterion = {
  key: "coverage",
  description: "Cubre el objetivo",
  evidenceRequired: true,
};
const readyPlan = (): ExecutablePlan => ({
  protocol: "pulso-plan/1",
  status: "ready",
  title: "Plan verificable",
  inventoryComplete: true,
  targets: [
    {
      path: "tests/a.test.ts",
      existence: "existing",
      evidence: [{ kind: "file", ref: "tests/a.test.ts" }],
      behaviors: ["Verifica el caso normal"],
    },
  ],
  unresolved: [],
  graph: {
    protocol: "pulso-graph/1",
    revision: 1,
    branches: [
      {
        key: "tests",
        objective: "Cubrir comportamiento",
        deliverable: "Suite",
        allowedEffects: ["read", "artifact"],
        criteria: [criterion],
      },
    ],
    nodes: [
      {
        key: "review",
        branch: "tests",
        specialist: "planner",
        objective: "Definir el plan",
        dependsOn: [],
        effects: ["read", "artifact"],
        resources: [{ path: "tests", coverage: "subtree", access: "read" }],
        mode: "read",
        criteria: [criterion],
        requiredCapabilities: [],
      },
    ],
  },
});
const targetOf = (plan: ExecutablePlan) => {
  const target = plan.targets[0];
  if (!target) throw new Error("fixture target missing");
  return target;
};
const nodeOf = (plan: ExecutablePlan) => {
  const node = plan.graph.nodes[0];
  if (!node) throw new Error("fixture node missing");
  return node;
};

test("readiness requires complete inventory, verified existing/new paths, evidence and a valid acyclic graph", () => {
  expect(() => validatePlanReadiness(readyPlan())).not.toThrow();
  const incomplete = readyPlan();
  incomplete.inventoryComplete = false;
  expect(() => validatePlanReadiness(incomplete)).toThrow("PLAN_NOT_READY");
  const invented = readyPlan();
  targetOf(invented).evidence = [
    { kind: "file", ref: "tests/elsewhere.test.ts" },
  ];
  expect(() => validatePlanReadiness(invented)).toThrow(
    "PLAN_TARGET_EVIDENCE_REQUIRED",
  );
  const unsafe = readyPlan();
  targetOf(unsafe).path = "../outside.test.ts";
  expect(() => validatePlanReadiness(unsafe)).toThrow("RESOURCE_PATH_INVALID");
  const cyclic = readyPlan();
  const peer = {
    ...nodeOf(cyclic),
    key: "implement",
    objective: "Implementar la suite",
    dependsOn: ["review"],
  };
  nodeOf(cyclic).dependsOn = ["implement"];
  cyclic.graph.nodes.push(peer);
  expect(() => validatePlanReadiness(cyclic)).toThrow("GRAPH_CYCLE");
});

test("new targets require explicit creation evidence and passing reviews require evidence", () => {
  const plan = readyPlan();
  targetOf(plan).existence = "new";
  expect(() => validatePlanReadiness(plan)).toThrow(
    "PLAN_NEW_TARGET_UNVERIFIED",
  );
  targetOf(plan).evidence = [
    { kind: "file", ref: "tests/new.test.ts", note: "Create new file" },
  ];
  targetOf(plan).path = "tests/new.test.ts";
  expect(() => validatePlanReadiness(plan)).not.toThrow();
});
