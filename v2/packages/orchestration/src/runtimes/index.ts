import { openCodeRuntime } from "./opencode";
import type { RuntimeDefinition, RuntimeId } from "./types";
import { vscodeCopilotRuntime } from "./vscode-copilot";

export * from "../agents/definitions";
export { openCodeRuntime } from "./opencode";
export * from "./types";
export { vscodeCopilotRuntime } from "./vscode-copilot";

export const runtimes: Record<RuntimeId, RuntimeDefinition> = {
  "vscode-copilot": vscodeCopilotRuntime,
  opencode: openCodeRuntime,
};
