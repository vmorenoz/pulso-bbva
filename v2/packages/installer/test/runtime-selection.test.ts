import { expect, test } from "bun:test";
import {
  applySharedScope,
  validateRuntimeSelection,
} from "../src/wizard/runtime-selection";

test("one or both runtimes are selectable; an empty selection is rejected", () => {
  expect(validateRuntimeSelection(["vscode-copilot"])).toEqual([
    "vscode-copilot",
  ]);
  expect(validateRuntimeSelection(["opencode"])).toEqual(["opencode"]);
  expect(validateRuntimeSelection(["vscode-copilot", "opencode"])).toHaveLength(
    2,
  );
  expect(() => validateRuntimeSelection([])).toThrow(
    "RUNTIME_SELECTION_REQUIRED",
  );
});

test("one scope applies to every selected runtime", () => {
  const selected = [
    { runtime: "vscode-copilot" as const },
    { runtime: "opencode" as const },
  ];
  expect(applySharedScope("local", selected)).toEqual([
    { runtime: "vscode-copilot", scope: "local" },
    { runtime: "opencode", scope: "local" },
  ]);
  expect(
    applySharedScope("global", selected).every(
      (runtime) => runtime.scope === "global",
    ),
  ).toBe(true);
});
