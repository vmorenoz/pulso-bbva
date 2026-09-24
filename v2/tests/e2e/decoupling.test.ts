import { expect, test } from "bun:test";

test("working-system remains host and MCP agnostic", async () => {
  const source = await Bun.file(
    "packages/working-system/src/domain/index.ts",
  ).text();
  const packageJson = await Bun.file(
    "packages/working-system/package.json",
  ).json();
  expect(source).not.toMatch(
    /vscode|Copilot|MCP SDK|agent runtime|orchestration/i,
  );
  expect(packageJson.dependencies ?? {}).toEqual({});
  expect(packageJson.devDependencies ?? {}).toEqual({});
});

test("capabilities MCP has no host-specific dependency", async () => {
  const source = await Bun.file(
    "packages/capabilities-mcp/src/index.ts",
  ).text();
  const packageJson = await Bun.file(
    "packages/capabilities-mcp/package.json",
  ).json();
  expect(source).not.toMatch(/vscode|Copilot|OpenCode/i);
  expect(Object.keys(packageJson.dependencies ?? {})).not.toContain("vscode");
});
