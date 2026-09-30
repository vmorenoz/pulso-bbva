import { expect, test } from "bun:test";
import { scopeSelectionOptions } from "../src/wizard/scope-selection";

test("scope descriptions apply to every selected runtime without VS Code-specific copy", () => {
  expect(scopeSelectionOptions).toHaveLength(2);
  const descriptions = scopeSelectionOptions.map(
    (option) => option.description ?? "",
  );
  expect(
    descriptions.every((description) => /runtimes/i.test(description)),
  ).toBe(true);
  expect(descriptions.join(" ")).not.toMatch(/VS Code|Copilot/i);
});
