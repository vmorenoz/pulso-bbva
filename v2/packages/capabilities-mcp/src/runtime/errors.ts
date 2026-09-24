export type RuntimeWorkErrorCode =
  | "BINDING_NOT_FOUND"
  | "BINDING_NOT_ACTIVE"
  | "RUNTIME_EXECUTION_ALREADY_BOUND"
  | "RUNTIME_EXECUTION_CONFLICT"
  | "WORK_ITEM_NOT_EXECUTABLE"
  | "EXECUTION_START_FAILED"
  | "EXECUTION_NOT_ACTIVE"
  | "LEASE_LOST"
  | "LEASE_EXPIRED"
  | "FENCING_MISMATCH"
  | "INVALID_RUNTIME_REFERENCE"
  | "INVALID_INPUT"
  | "RECONCILIATION_FAILED"
  | "STORAGE_ERROR";

export class RuntimeWorkError extends Error {
  constructor(
    public readonly code: RuntimeWorkErrorCode,
    message: string,
    public readonly cause?: unknown,
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
