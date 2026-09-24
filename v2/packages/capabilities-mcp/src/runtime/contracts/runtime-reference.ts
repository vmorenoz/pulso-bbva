export interface RuntimeExecutionReference {
  provider: string;
  executionId: string;
  sessionId?: string;
  metadata?: Record<string, string>;
}

export const runtimeReferenceKey = (reference: RuntimeExecutionReference) =>
  `${reference.provider}\u0000${reference.executionId}`;
