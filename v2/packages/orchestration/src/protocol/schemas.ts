import { z } from "zod";

const id = z.string().min(1);
const taskTag = "pulso-task" as const;
const resultTag = "pulso-result" as const;
const taskProtocolVersion = 2 as const;
const resultProtocolVersion = 2 as const;
export const taskProtocol = {
  tag: taskTag,
  version: taskProtocolVersion,
  id: `${taskTag}/${taskProtocolVersion}`,
} as const;
export const resultProtocol = {
  tag: resultTag,
  version: resultProtocolVersion,
  id: `${resultTag}/${resultProtocolVersion}`,
} as const;

export const specialistIds = [
  "planner",
  "explorer",
  "executor",
  "verifier",
  "security-auditor",
] as const;
export const specialistIdSchema = z.enum(specialistIds);
export type SpecialistId = z.infer<typeof specialistIdSchema>;
export const agentResultStatuses = [
  "completed",
  "blocked",
  "failed",
  "cancelled",
] as const;
export const agentResultStatusSchema = z.enum(agentResultStatuses);
export type AgentResultStatus = z.infer<typeof agentResultStatusSchema>;
export const resultLifecycleAction = {
  completed: "complete",
  blocked: "block",
  failed: "fail",
  cancelled: "cancel",
} as const satisfies Record<
  AgentResultStatus,
  "complete" | "block" | "fail" | "cancel"
>;

const expectedDelegationIdentityShape = {
  delegationId: id,
  specialist: specialistIdSchema,
  workId: id,
  workItemId: id,
};
export const expectedDelegationIdentitySchema = z
  .object(expectedDelegationIdentityShape)
  .strict();

export const evidenceSchema = z
  .object({
    kind: z.enum(["file", "symbol", "command", "test", "artifact", "url"]),
    ref: z.string().min(1),
    note: z.string().min(1).optional(),
  })
  .strict();

const taskDependencySchema = z
  .object({
    workItemId: id,
    summary: z.string().min(1),
    artifacts: z.array(evidenceSchema).optional(),
  })
  .strict();

export const taskEnvelopeSchema = z
  .object({
    protocol: z.literal(taskProtocol.id),
    delegationId: expectedDelegationIdentitySchema.shape.delegationId,
    specialist: expectedDelegationIdentitySchema.shape.specialist,
    work: z
      .object({
        workId: expectedDelegationIdentitySchema.shape.workId,
        workItemId: expectedDelegationIdentitySchema.shape.workItemId,
      })
      .strict(),
    objective: z.string().min(1),
    context: z
      .object({
        facts: z.array(z.string().min(1)).optional(),
        references: z.array(evidenceSchema).optional(),
      })
      .strict()
      .optional(),
    dependencies: z.array(taskDependencySchema).optional(),
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
    output: z.object({ contract: z.literal(resultProtocol.id) }).strict(),
  })
  .strict();

const validationSchema = z
  .object({
    command: z.string().min(1),
    outcome: z.enum(["passed", "failed", "not-run"]),
    note: z.string().min(1).optional(),
  })
  .strict();
const securityFindingSchema = z
  .object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    summary: z.string().min(1),
    evidence: z.array(evidenceSchema),
    impact: z.string().min(1).optional(),
    remediation: z.string().min(1).optional(),
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
    steps: z.array(
      z
        .object({
          objective: z.string().min(1),
          dependencies: z.array(z.string().min(1)).optional(),
          acceptanceCriteria: z.array(z.string().min(1)).optional(),
        })
        .strict(),
    ),
    assumptions: z.array(z.string().min(1)).optional(),
    risks: z.array(z.string().min(1)).optional(),
  })
  .strict();
const explorerFindingSchema = z
  .object({
    summary: z.string().min(1),
    evidence: z.array(evidenceSchema).optional(),
  })
  .strict();
const explorerPayloadSchema = z
  .object({
    kind: z.literal("explorer"),
    findings: z.array(explorerFindingSchema),
    references: z.array(evidenceSchema).optional(),
    limitations: z.array(z.string().min(1)).optional(),
  })
  .strict();
const executorChangeSchema = z
  .object({
    target: z.string().min(1),
    summary: z.string().min(1),
  })
  .strict();
const executorPayloadSchema = z
  .object({
    kind: z.literal("executor"),
    changes: z.array(executorChangeSchema),
    validations: z.array(validationSchema).optional(),
    artifacts: z.array(artifactSchema).optional(),
    unresolved: z.array(z.string().min(1)).optional(),
  })
  .strict();
const verifierCheckSchema = z
  .object({
    criterion: z.string().min(1),
    result: z.enum(["pass", "fail"]),
    evidence: z.array(evidenceSchema).optional(),
  })
  .strict();
const verifierPayloadSchema = z
  .object({
    kind: z.literal("verifier"),
    verdict: z.enum(["pass", "fail", "partial"]),
    checks: z.array(verifierCheckSchema),
    failures: z.array(z.string().min(1)).optional(),
    risks: z.array(z.string().min(1)).optional(),
  })
  .strict();
const securityAuditorPayloadSchema = z
  .object({
    kind: z.literal("security-auditor"),
    findings: z.array(securityFindingSchema),
  })
  .strict();

export const specialistPayloadSchemas = {
  planner: plannerPayloadSchema,
  explorer: explorerPayloadSchema,
  executor: executorPayloadSchema,
  verifier: verifierPayloadSchema,
  "security-auditor": securityAuditorPayloadSchema,
} as const;
/** Canonical result-contract schema set; each entry is the wire validator. */
export type SpecialistResultContract = typeof specialistPayloadSchemas;

export const specialistPayloadSchema = z.discriminatedUnion("kind", [
  specialistPayloadSchemas.planner,
  specialistPayloadSchemas.explorer,
  specialistPayloadSchemas.executor,
  specialistPayloadSchemas.verifier,
  specialistPayloadSchemas["security-auditor"],
]);

export const agentResultFieldsSchema = z
  .object({
    protocol: z.literal(resultProtocol.id),
    ...expectedDelegationIdentitySchema.shape,
    status: agentResultStatusSchema,
    summary: z.string().min(1),
    specialistResult: specialistPayloadSchema,
  })
  .strict();

export const agentResultSchema = agentResultFieldsSchema.superRefine(
  (result, context) => {
    if (result.specialist !== result.specialistResult.kind)
      context.addIssue({
        code: "custom",
        message: "SPECIALIST_MISMATCH",
        path: ["specialistResult", "kind"],
      });
  },
);

type JsonObjectShape = {
  properties?: Record<string, unknown>;
  required?: string[];
};
const objectFieldContract = (schema: z.ZodObject<z.ZodRawShape>) => {
  const jsonSchema = z.toJSONSchema(schema) as JsonObjectShape;
  const fields = Object.keys(jsonSchema.properties ?? {});
  const required = jsonSchema.required ?? [];
  return {
    required,
    optional: fields.filter((field) => !required.includes(field)),
  };
};

export const protocolContractMetadata = {
  task: {
    protocol: taskProtocol.id,
    version: taskProtocol.version,
    tag: taskProtocol.tag,
    fields: objectFieldContract(taskEnvelopeSchema),
    workFields: objectFieldContract(taskEnvelopeSchema.shape.work),
    outputFields: objectFieldContract(taskEnvelopeSchema.shape.output),
  },
  result: {
    protocol: resultProtocol.id,
    version: resultProtocol.version,
    tag: resultProtocol.tag,
    fields: objectFieldContract(agentResultFieldsSchema),
    identityFields: objectFieldContract(expectedDelegationIdentitySchema)
      .required,
    statuses: agentResultStatuses,
    payloads: Object.fromEntries(
      Object.entries(specialistPayloadSchemas).map(([specialist, schema]) => [
        specialist,
        objectFieldContract(schema),
      ]),
    ) as Record<SpecialistId, ReturnType<typeof objectFieldContract>>,
  },
} as const;

export type ExpectedDelegationIdentity = z.infer<
  typeof expectedDelegationIdentitySchema
>;

export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type TaskDependency = z.infer<typeof taskDependencySchema>;
export type SpecialistPayload = z.infer<typeof specialistPayloadSchema>;
