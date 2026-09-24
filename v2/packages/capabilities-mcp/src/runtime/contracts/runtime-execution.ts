import type { RuntimeExecutionReference } from "./runtime-reference";

export type RuntimeBindingStatus =
  | "creating"
  | "active"
  | "completed"
  | "failed"
  | "cancelled"
  | "blocked"
  | "waiting"
  | "lost";

export interface RuntimeExecutionBinding {
  bindingId: string;
  runtime: RuntimeExecutionReference;
  workId: string;
  workItemId: string;
  assignmentId?: string;
  executionId: string;
  leaseId: string;
  fencingToken: number;
  createdAt: string;
  expiresAt: string;
  status: RuntimeBindingStatus;
}

export interface ExecutionHandle {
  bindingId: string;
  executionId: string;
  leaseId: string;
  fencingToken: number;
  expiresAt: string;
}
