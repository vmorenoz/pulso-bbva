import { z } from "zod";

const id = z.string().min(1);
export const specialistIdSchema = z.enum([
  "planner",
  "explorer",
  "executor",
  "verifier",
  "security-auditor",
]);
export type SpecialistId = z.infer<typeof specialistIdSchema>;

export const evidenceSchema = z
  .object({
    kind: z.enum(["file", "symbol", "command", "test", "artifact", "url"]),
    ref: z.string().min(1),
    note: z.string().min(1).optional(),
  })
  .strict();

const priorResultReferenceSchema = z
  .object({
    delegationId: id,
    specialist: specialistIdSchema,
    summary: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const taskEnvelopeSchema = z
  .object({
    protocol: z.literal("pulso-task/1"),
    delegationId: id,
    specialist: specialistIdSchema,
    work: z.object({ workId: id, workItemId: id }).strict(),
    objective: z.string().min(1),
    context: z
      .object({
        facts: z.array(z.string().min(1)).optional(),
        references: z.array(evidenceSchema).optional(),
        priorResults: z.array(priorResultReferenceSchema).optional(),
      })
      .strict()
      .optional(),
    constraints: z.array(z.string().min(1)).optional(),
    acceptanceCriteria: z.array(z.string().min(1)).optional(),
    scope: z
      .object({
        include: z.array(z.string().min(1)).optional(),
        exclude: z.array(z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    requestedEvidence: z.array(z.string().min(1)).optional(),
    output: z.object({ contract: z.literal("pulso-result/1") }).strict(),
  })
  .strict();

const validationSchema = z
  .object({
    command: z.string().min(1),
    outcome: z.enum(["passed", "failed", "not-run"]),
    note: z.string().min(1).optional(),
  })
  .strict();
const findingSchema = z
  .object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    summary: z.string().min(1),
    evidence: z.array(evidenceSchema).optional(),
  })
  .strict();
const artifactSchema = z
  .object({
    type: z.string().min(1),
    uri: z.string().url(),
    description: z.string().min(1).optional(),
  })
  .strict();

const plannerPayloadSchema = z
  .object({
    kind: z.literal("planner"),
    proposedWorkItems: z.array(
      z
        .object({
          title: z.string().min(1),
          objective: z.string().min(1),
        })
        .strict(),
    ),
    dependencies: z.array(z.string().min(1)).optional(),
    assumptions: z.array(z.string().min(1)).optional(),
    risks: z.array(z.string().min(1)).optional(),
  })
  .strict();
const explorerPayloadSchema = z
  .object({
    kind: z.literal("explorer"),
    findings: z.array(findingSchema),
    references: z.array(evidenceSchema),
    unknowns: z.array(z.string().min(1)).optional(),
  })
  .strict();
const executorPayloadSchema = z
  .object({
    kind: z.literal("executor"),
    changes: z.array(z.string().min(1)),
    validations: z.array(validationSchema).optional(),
    artifacts: z.array(artifactSchema).optional(),
  })
  .strict();
const verifierPayloadSchema = z
  .object({
    kind: z.literal("verifier"),
    verdict: z.enum(["passed", "failed", "inconclusive"]),
    criteria: z.array(z.string().min(1)),
    regressions: z.array(z.string().min(1)).optional(),
    findings: z.array(findingSchema).optional(),
  })
  .strict();
const securityAuditorPayloadSchema = z
  .object({
    kind: z.literal("security-auditor"),
    findings: z.array(findingSchema),
    severity: z.enum(["low", "medium", "high", "critical", "none"]),
    evidence: z.array(evidenceSchema).optional(),
    mitigations: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const specialistPayloadSchema = z.discriminatedUnion("kind", [
  plannerPayloadSchema,
  explorerPayloadSchema,
  executorPayloadSchema,
  verifierPayloadSchema,
  securityAuditorPayloadSchema,
]);

export const agentResultSchema = z
  .object({
    protocol: z.literal("pulso-result/1"),
    delegationId: id,
    specialist: specialistIdSchema,
    workId: id,
    workItemId: id,
    status: z.enum(["completed", "blocked", "failed", "cancelled"]),
    summary: z.string().min(1),
    evidence: z.array(evidenceSchema).optional(),
    artifacts: z.array(artifactSchema).optional(),
    validations: z.array(validationSchema).optional(),
    findings: z.array(findingSchema).optional(),
    blockers: z.array(z.string().min(1)).optional(),
    risks: z.array(z.string().min(1)).optional(),
    suggestedNextStep: z.string().min(1).optional(),
    specialistResult: specialistPayloadSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.specialist !== result.specialistResult.kind)
      context.addIssue({
        code: "custom",
        message: "SPECIALIST_MISMATCH",
        path: ["specialistResult", "kind"],
      });
  });

export interface ExpectedDelegationIdentity {
  delegationId: string;
  specialist: SpecialistId;
  workId: string;
  workItemId: string;
}

export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type PriorResultReference = z.infer<typeof priorResultReferenceSchema>;
export type SpecialistPayload = z.infer<typeof specialistPayloadSchema>;
