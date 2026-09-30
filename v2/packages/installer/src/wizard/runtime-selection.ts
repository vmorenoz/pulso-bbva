import type { RuntimeId } from "../../../orchestration/src/runtimes/types";
import type { InstallScope } from "../runtimes/opencode-installer";

export const validateRuntimeSelection = (
  runtimes: RuntimeId[],
): RuntimeId[] => {
  const selected = [...new Set(runtimes)];
  if (!selected.length) throw new Error("RUNTIME_SELECTION_REQUIRED");
  return selected;
};

export const applySharedScope = <T extends { runtime: RuntimeId }>(
  scope: InstallScope,
  runtimes: T[],
) => runtimes.map((runtime) => ({ ...runtime, scope }));
