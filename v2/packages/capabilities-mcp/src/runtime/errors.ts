export type RuntimeWorkErrorCode =
  | "BINDING_NOT_FOUND"
  | "BINDING_NOT_ACTIVE"
  | "BINDING_MANAGED_BY_NATIVE"
  | "BINDING_RESERVATION_LOST"
  | "RUNTIME_EXECUTION_TERMINAL"
  | "RUNTIME_EXECUTION_ALREADY_BOUND"
  | "RUNTIME_EXECUTION_CONFLICT"
  | "WORK_NOT_FOUND"
  | "WORK_ACTIVE_OBJECTIVE"
  | "WORK_AMBIGUOUS"
  | "WORK_REUSE_WITH_ITEMS"
  | "WORK_ITEM_NOT_FOUND"
  | "WORK_ID_USED_AS_WORK_ITEM_ID"
  | "WORK_ITEM_WRONG_WORK"
  | "WORK_ITEM_NOT_READY"
  | "WORK_ITEM_NOT_EXECUTABLE"
  | "DEPENDENCY_NOT_SATISFIED"
  | "ASSIGNMENT_REQUIRED"
  | "ASSIGNMENT_INVALID"
  | "EXECUTION_START_FAILED"
  | "INTERNAL_ERROR"
  | "EXECUTION_NOT_ACTIVE"
  | "LEASE_LOST"
  | "LEASE_EXPIRED"
  | "FENCING_MISMATCH"
  | "INVALID_RUNTIME_REFERENCE"
  | "INVALID_INPUT"
  | "RECONCILIATION_FAILED"
  | "RECOVERY_REQUIRED"
  | "STORAGE_ERROR";

export interface RuntimeWorkErrorDetails {
  entity?: { type?: string; id?: string };
  expected?: string;
  actual?: string;
  recovery?: string;
}

export class RuntimeWorkError extends Error {
  constructor(
    public readonly code: RuntimeWorkErrorCode,
    message: string,
    public readonly cause?: unknown,
    public readonly details: RuntimeWorkErrorDetails = {},
  ) {
    super(message);
    this.name = "RuntimeWorkError";
  }
}

export const runtimeError = (
  code: RuntimeWorkErrorCode,
  message: string,
): never => {
  throw new RuntimeWorkError(code, message);
};
