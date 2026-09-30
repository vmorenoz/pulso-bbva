import { z } from "zod";

const id = z.string().min(1);
const evidence = z
  .object({
    kind: z.enum(["file", "symbol", "command", "test", "artifact", "url"]),
    ref: id,
    note: id.optional(),
  })
  .strict();
const criterion = z
  .object({ key: id, description: id, evidenceRequired: z.boolean() })
  .strict();
const effect = z.enum([
  "read",
  "artifact",
  "preference",
  "edit",
  "test",
  "shell",
  "delete",
  "network",
  "commit",
  "push",
]);
const resource = z
  .object({
    path: id,
    coverage: z.enum(["exact", "subtree"]),
    access: z.enum(["read", "write"]),
  })
  .strict();
const branch = z
  .object({
    key: id,
    objective: id,
    deliverable: id,
    allowedEffects: z.array(effect).min(1),
    criteria: z.array(criterion).min(1),
  })
  .strict();
const node = z
  .object({
    key: id,
    branch: id,
    specialist: z.enum([
      "explorer",
      "planner",
      "executor",
      "verifier",
      "security-auditor",
    ]),
    objective: id,
    dependsOn: z.array(id),
    effects: z.array(effect).min(1),
    resources: z.array(resource).min(1),
    mode: z.enum(["read", "files", "exclusive"]),
    criteria: z.array(criterion).min(1),
    requiredCapabilities: z.array(id),
    context: z
      .object({ facts: z.array(id), references: z.array(evidence) })
      .strict()
      .optional(),
    constraints: z.array(id).optional(),
    requestedEvidence: z.array(id).optional(),
  })
  .strict();
export const graphSchema = z
  .object({
    protocol: z.literal("pulso-graph/1"),
    revision: z.number().int().min(1),
    branches: z.array(branch).min(1),
    nodes: z.array(node).min(1),
  })
  .strict();
const target = z
  .object({
    path: id,
    existence: z.enum(["existing", "new"]),
    evidence: z.array(evidence),
    behaviors: z.array(id),
  })
  .strict();
export const planSchema = z
  .object({
    protocol: z.literal("pulso-plan/1"),
    status: z.enum(["draft", "ready"]),
    title: id,
    inventoryComplete: z.boolean(),
    targets: z.array(target),
    graph: graphSchema,
    unresolved: z.array(id),
  })
  .strict();
const inventoryEntry = z
  .object({
    target: id,
    specs: z.array(id),
    evidenceLevel: z.enum([
      "located",
      "reviewed",
      "executed",
      "coverage-measured",
    ]),
    behaviors: z.array(id),
    evidence: z.array(evidence),
  })
  .strict();
export const inventorySchema = z
  .object({
    protocol: z.literal("pulso-inventory/1"),
    complete: z.boolean(),
    universe: z.array(id),
    exclusions: z.array(z.object({ path: id, reason: id }).strict()),
    entries: z.array(inventoryEntry),
    limitations: z.array(id),
  })
  .strict();
const reviewCheck = z
  .object({
    criterion: id,
    result: z.enum(["pass", "fail", "unknown"]),
    evidence: z.array(evidence),
  })
  .strict();
export const reviewSchema = z
  .object({
    protocol: z.literal("pulso-review/1"),
    artifactRef: id,
    verdict: z.enum(["pass", "fail", "partial"]),
    checks: z.array(reviewCheck).min(1),
    limitations: z.array(id),
  })
  .strict();
export const inspectSchema = z
  .object({
    view: z.enum(["health", "capabilities", "work", "receipt"]),
    detail: z.enum(["summary", "full"]),
    reference: id.optional(),
  })
  .strict();
const publishedDocument = z.union([planSchema, inventorySchema, reviewSchema]);
export const artifactSchema = z
  .object({
    request: z.union([
      z.object({ action: z.literal("read"), reference: id }).strict(),
      z
        .object({ action: z.literal("publish"), document: publishedDocument })
        .strict(),
    ]),
  })
  .strict();
const prepareNew = z
  .object({ intent: z.literal("new"), objective: id, graph: graphSchema })
  .strict();
const prepareContinue = z
  .object({ intent: z.literal("continue"), select: z.literal("ready") })
  .strict();
export const prepareSchema = z
  .object({ request: z.union([prepareNew, prepareContinue]) })
  .strict();
const workRevise = z
  .object({
    action: z.literal("revise"),
    expectedRevision: z.number().int().min(1),
    graph: graphSchema,
    reason: id,
  })
  .strict();
const workAdopt = z
  .object({
    action: z.literal("adopt_plan"),
    artifactRef: id,
    expectedRevision: z.number().int().min(1),
    reason: id,
  })
  .strict();
const workFinish = z
  .object({
    action: z.literal("finish"),
    outcome: z.enum(["completed", "failed", "cancelled"]),
    reason: id,
  })
  .strict();
const workPauseResume = z
  .object({ action: z.enum(["pause", "resume"]), reason: id })
  .strict();
const workRetry = z
  .object({
    action: z.literal("retry"),
    nodeKey: id,
    receiptRef: id,
    reason: id,
  })
  .strict();
export const workSchema = z
  .object({
    request: z.union([
      workRevise,
      workAdopt,
      workFinish,
      workPauseResume,
      workRetry,
    ]),
  })
  .strict();
const preferenceScope = z.enum(["project", "global"]);
export const preferencesSchema = z
  .object({
    request: z.union([
      z.object({ action: z.literal("list"), scope: preferenceScope }).strict(),
      z
        .object({
          action: z.literal("set"),
          scope: preferenceScope,
          key: id,
          value: z.union([id, z.boolean(), z.array(id)]),
          expectedRevision: z.number().int().min(0),
          reason: id,
        })
        .strict(),
      z
        .object({
          action: z.literal("remove"),
          scope: preferenceScope,
          key: id,
          expectedRevision: z.number().int().min(1),
          reason: id,
        })
        .strict(),
    ]),
  })
  .strict();
export const evolutionSchemas = {
  graph: graphSchema,
  work: workSchema,
  prepare: prepareSchema,
  preferences: preferencesSchema,
  inventory: inventorySchema,
  plan: planSchema,
  inspect: inspectSchema,
  artifact: artifactSchema,
  review: reviewSchema,
} as const;
