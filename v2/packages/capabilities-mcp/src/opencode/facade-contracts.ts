import { z } from "zod";
import { taskEnvelopeSchema } from "../../../orchestration/src/protocol/schemas";

/** Native inputs never contain the host-derived workspace or session identity. */
const id = z.string().min(1);

export const nativeWorkInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get") }).strict(),
  z
    .object({
      action: z.literal("open"),
      intent: z.enum(["continue", "new"]),
      objective: z.string().min(1),
      title: z.string().min(1).optional(),
    })
    .strict(),
  z.object({ action: z.literal("use"), workId: id }).strict(),
  z
    .object({
      action: z.literal("resume"),
      workId: id,
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("retry_item"),
      workItemId: id,
      previousDelegationId: id,
      reviewedReceiptHash: id,
      reason: z.string().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal("close"),
      workId: id,
      outcome: z.enum(["completed", "failed", "cancelled"]),
      reason: z.string().min(1),
    })
    .strict(),
]);

export const nativePrepareInputSchema = taskEnvelopeSchema
  .pick({
    specialist: true,
    objective: true,
    context: true,
    dependencies: true,
    constraints: true,
    acceptanceCriteria: true,
    scope: true,
    requestedEvidence: true,
  })
  .extend({
    workItemId: id.optional(),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const nativeStatusInputSchema = z
  .object({
    delegationId: id.optional(),
    view: z.enum(["summary", "full"]).default("summary"),
  })
  .strict();

export type NativeWorkInput = z.infer<typeof nativeWorkInputSchema>;
export type NativePrepareInput = z.infer<typeof nativePrepareInputSchema>;
export type NativeStatusInput = z.infer<typeof nativeStatusInputSchema>;

export const nativePolicy = Object.freeze({
  certifiedOpenCodeVersion: "1.18.32",
  preparationTtlMs: 120_000,
  leaseTtlMs: 300_000,
  observationIntervalMs: 30_000,
  observationTimeoutMs: 10_000,
  maximumObservationAgeMs: 60_000,
  heartbeatIntervalMs: 60_000,
  maximumExecutionMs: 1_800_000,
  maximumTaskWireBytes: 65_536,
  maximumDiagnosticBytes: 65_536,
});
