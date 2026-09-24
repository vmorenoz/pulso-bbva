export interface CapabilitiesClient {
  call(name: string, input: Record<string, unknown>): Promise<unknown>;
}
export const requiredCapabilities = [
  "pulso_work_create",
  "pulso_work_item",
  "pulso_runtime_bind",
  "pulso_runtime_complete",
  "pulso_runtime_fail",
  "pulso_runtime_cancel",
  "pulso_runtime_block",
  "pulso_runtime_wait",
  "pulso_work_artifact",
] as const;
