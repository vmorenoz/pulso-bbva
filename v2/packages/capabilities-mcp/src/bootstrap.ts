import {
  bootstrapWorkingSystem,
  type Clock,
  type WorkingSystem,
} from "../../working-system/src";
import { ExecutionCoordinator } from "./runtime/application/execution-coordinator";
import {
  type HeartbeatPolicy,
  RuntimeWorkAdapter,
} from "./runtime/application/runtime-work-adapter";
import { SqliteBindingStore } from "./runtime/bindings/sqlite-binding-store";

export interface CapabilitiesRuntime extends WorkingSystem {
  runtimeAdapter: RuntimeWorkAdapter;
  runtimeBindings: SqliteBindingStore;
  doctor(): Record<string, boolean | number>;
}

export const bootstrapCapabilities = (
  workspace: string,
  options: {
    dataDir?: string;
    clock?: Clock;
    leaseTtlMs?: number;
    heartbeatPolicy?: Partial<HeartbeatPolicy>;
  } = {},
): CapabilitiesRuntime => {
  const workingSystem = bootstrapWorkingSystem(workspace, options);
  const runtimeBindings = new SqliteBindingStore(
    `${workingSystem.dataDir}/runtime-bindings.db`,
  );
  const gateway = new ExecutionCoordinator(
    workingSystem.store,
    workingSystem.work,
    workingSystem.execution,
    workingSystem.recovery,
  );
  const runtimeAdapter = new RuntimeWorkAdapter(
    runtimeBindings,
    gateway,
    options.clock,
    {
      leaseTtlMs: options.leaseTtlMs ?? 300_000,
      heartbeatIntervalMs:
        options.heartbeatPolicy?.heartbeatIntervalMs ?? 100_000,
      gracePeriodMs: options.heartbeatPolicy?.gracePeriodMs,
    },
  );
  const workingDoctor = workingSystem.doctor;
  return {
    ...workingSystem,
    runtimeAdapter,
    runtimeBindings,
    doctor: () => ({
      ...workingDoctor(),
      capabilities: true,
      runtimeAdapterStorage: runtimeBindings.diagnostics().database,
      runtimeBindingSchema: runtimeBindings.diagnostics().schema,
      runtimeWorkGateway: true,
      singleMcpEntrypoint: true,
    }),
    close: () => {
      runtimeBindings.close();
      workingSystem.close();
    },
  };
};
