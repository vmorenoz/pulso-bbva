export interface CapabilitiesClient {
  call(name: string, input: Record<string, unknown>): Promise<unknown>;
}
export const requiredCapabilities = [
  "work_create",
  "work_item",
  "runtime_bind",
  "runtime_complete",
  "runtime_fail",
  "runtime_cancel",
  "runtime_block",
  "runtime_wait",
  "work_artifact",
] as const;
