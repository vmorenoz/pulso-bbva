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

export type RuntimeBindingManager = "mcp" | "opencode-native";

export interface RuntimeExecutionBinding {
  bindingId: string;
  runtime: RuntimeExecutionReference;
  workId: string;
  workItemId: string;
  /** Missing fields identify a legacy row that must be resolved from Work state. */
  executorId?: string;
  assigneeId?: string;
  requestHash?: string;
  managedBy?: RuntimeBindingManager;
  assignmentId?: string;
  executionId: string;
  leaseId: string;
  fencingToken: number;
  createdAt: string;
  creationToken?: string;
  creationExpiresAt?: string;
  expiresAt: string;
  status: RuntimeBindingStatus;
  terminalResult?: string;
  version: number;
}

export interface ExecutionHandle {
  bindingId: string;
  executionId: string;
  leaseId: string;
  fencingToken: number;
  expiresAt: string;
}
