import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import {
  formatMcpBundleBuildException,
  formatMcpBundleBuildFailure,
  type PackageInstallRunner,
  withMcpBundleDependencies,
} from "../src/mcp-bundle";

test("MCP bundle failures retain resolver diagnostics and source location", () => {
  const message = formatMcpBundleBuildFailure([
    {
      level: "error",
      message: 'Could not resolve "zod"',
      position: {
        file: "packages/capabilities-mcp/src/mcp/server.ts",
        line: 3,
        column: 19,
      },
    },
  ]);
  expect(message).toContain("INSTALL_MCP_BUNDLE_BUILD_FAILED");
  expect(message).toContain(
    "error packages/capabilities-mcp/src/mcp/server.ts:3:19",
  );
  expect(message).toContain('Could not resolve "zod"');
  expect(message).toContain("Verify the workspace dependencies are installed");
});

test("MCP bundle failures explain an empty diagnostic response", () => {
  expect(formatMcpBundleBuildFailure([])).toContain(
    "Bun.build returned success=false without diagnostics.",
  );
});

test("thrown Bun build failures preserve the original error and stack", () => {
  const message = formatMcpBundleBuildException(new Error("Bundle failed"));
  expect(message).toContain("INSTALL_MCP_BUNDLE_BUILD_FAILED");
  expect(message).toContain(
    "Bun.build threw before returning build diagnostics",
  );
  expect(message).toContain("Error: Bundle failed");
  expect(message).toContain("Verify the workspace dependencies are installed");
});

test("AggregateError diagnostics expose nested module resolution causes", () => {
  const error = new AggregateError(
    [new Error('Could not resolve "zod"')],
    "Bundle failed",
  );
  expect(formatMcpBundleBuildException(error)).toContain(
    "AggregateError: Bundle failed",
  );
  expect(formatMcpBundleBuildException(error)).toContain(
    'Error: Could not resolve "zod"',
  );
});

test("missing MCP build dependencies download to a temporary prefix and are revalidated", async () => {
  let available = false;
  const invocations: { executable: string; args: string[]; cwd: string }[] = [];
  let temporaryDependencyRoot = "";
  const install: PackageInstallRunner = async (executable, args, cwd) => {
    invocations.push({ executable, args, cwd });
    available = true;
    return 0;
  };
  const result = await withMcpBundleDependencies({
    installerEntry: "/workspace/packages/installer/src/cli.ts",
    registry: "https://registry.npmjs.org",
    resolveModule: (specifier) => {
      if (!available) throw new Error(`missing ${specifier}`);
      return `/workspace/packages/installer/node_modules/${specifier}`;
    },
    install,
    build: async (dependencyRoot) => {
      temporaryDependencyRoot = dependencyRoot ?? "";
      return "mcp bundle";
    },
  });
  expect(result).toBe("mcp bundle");
  expect(temporaryDependencyRoot).toContain("pulso-mcp-bundle-");
  await expect(access(temporaryDependencyRoot)).rejects.toThrow();
  expect(invocations).toEqual([
    {
      executable: "npm",
      args: [
        "install",
        "--prefix",
        temporaryDependencyRoot,
        "--no-save",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry",
        "https://registry.npmjs.org",
        "@modelcontextprotocol/sdk@1.30.1",
        "zod@4.3.6",
      ],
      cwd: temporaryDependencyRoot,
    },
  ]);
});

test("dependency download errors stay actionable without exposing command output", async () => {
  await expect(
    withMcpBundleDependencies({
      installerEntry: "/workspace/packages/installer/src/cli.ts",
      resolveModule: () => {
        throw new Error("missing dependency");
      },
      install: async () => 1,
      build: async () => "unreachable",
    }),
  ).rejects.toThrow("MCP_BUNDLE_DEPENDENCIES_DOWNLOAD_FAILED");
});
