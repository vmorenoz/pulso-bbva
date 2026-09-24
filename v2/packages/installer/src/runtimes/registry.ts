import {
  type RuntimeDefinition,
  type RuntimeId,
  runtimes,
} from "../../../orchestration/src/runtimes";

export const runtimeRegistry: Record<RuntimeId, RuntimeDefinition> = runtimes;
export const getRuntime = (id: RuntimeId) => runtimeRegistry[id];
