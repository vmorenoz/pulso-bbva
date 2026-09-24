import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface McpBundleBuildDiagnostic {
  level: string;
  message: string;
  position?: { file: string; line: number; column: number } | null;
}

export const mcpBundleDependencies = [
  "@modelcontextprotocol/sdk/server/mcp.js",
  "@modelcontextprotocol/sdk/server/stdio.js",
  "zod",
] as const;

export type PackageInstallRunner = (
  executable: string,
  args: string[],
  cwd: string,
) => Promise<number>;

export const runPackageInstall: PackageInstallRunner = (
  executable,
  args,
  cwd,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code ?? 1);
    });
  });

export const withMcpBundleDependencies = async <T>(options: {
  installerEntry: string;
  registry?: string;
  resolveModule?: (specifier: string, importer: string) => string;
  install?: PackageInstallRunner;
  build: (temporaryDependencyRoot?: string) => Promise<T>;
}): Promise<T> => {
  const resolveModule =
    options.resolveModule ??
    ((specifier: string, importer: string) =>
      Bun.resolveSync(specifier, importer));
  const canResolve = (specifier: string, importer: string) => {
    try {
      resolveModule(specifier, importer);
      return true;
    } catch {
      return false;
    }
  };
  const missing = mcpBundleDependencies.filter(
    (specifier) => !canResolve(specifier, options.installerEntry),
  );
  if (!missing.length) return options.build();

  const temporaryDependencyRoot = await mkdtemp(
    join(tmpdir(), "pulso-mcp-bundle-"),
  );
  try {
    const registry = options.registry ?? "https://registry.npmjs.org";
    const exitCode = await (options.install ?? runPackageInstall)(
      "npm",
      [
        "install",
        "--prefix",
        temporaryDependencyRoot,
        "--no-save",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--registry",
        registry,
        "@modelcontextprotocol/sdk@1.30.1",
        "zod@4.3.6",
      ],
      temporaryDependencyRoot,
    );
    if (exitCode !== 0)
      throw new Error(
        `MCP_BUNDLE_DEPENDENCIES_DOWNLOAD_FAILED: npm exited ${exitCode}. Check registry access and retry.`,
      );

    const fallbackImporter = join(temporaryDependencyRoot, "package.json");
    const stillMissing = missing.filter(
      (specifier) => !canResolve(specifier, fallbackImporter),
    );
    if (stillMissing.length)
      throw new Error(
        `MCP_BUNDLE_DEPENDENCIES_MISSING: ${stillMissing.join(", ")}`,
      );
    return await options.build(temporaryDependencyRoot);
  } finally {
    await rm(temporaryDependencyRoot, { recursive: true, force: true });
  }
};

export const installerDependencyPlugin = (
  installerEntry: string,
  temporaryDependencyRoot?: string,
): Bun.BunPlugin => ({
  name: "pulso-installer-dependency-resolution",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith("node:") || args.path.startsWith("bun:")) return;
      try {
        return { path: Bun.resolveSync(args.path, args.importer) };
      } catch {
        try {
          return { path: Bun.resolveSync(args.path, installerEntry) };
        } catch {
          if (!temporaryDependencyRoot) return;
          try {
            return {
              path: Bun.resolveSync(
                args.path,
                join(temporaryDependencyRoot, "package.json"),
              ),
            };
          } catch {
            return;
          }
        }
      }
    });
  },
});

export const formatMcpBundleBuildFailure = (
  diagnostics: McpBundleBuildDiagnostic[],
) => {
  const details = diagnostics.map((entry) => {
    const location = entry.position
      ? `${entry.position.file}:${entry.position.line}:${entry.position.column}`
      : undefined;
    return `${entry.level}${location ? ` ${location}` : ""}: ${entry.message}`;
  });
  return [
    "INSTALL_MCP_BUNDLE_BUILD_FAILED",
    ...(details.length
      ? details
      : ["Bun.build returned success=false without diagnostics."]),
    "Verify the workspace dependencies are installed before retrying.",
  ].join("\n");
};

export const formatMcpBundleBuildException = (error: unknown) => {
  const formatNestedError = (cause: unknown, depth = 0): string => {
    if (depth >= 4) return `${"  ".repeat(depth)}[cause depth limit reached]`;
    const indent = "  ".repeat(depth);
    if (!(cause instanceof Error)) return `${indent}${String(cause)}`;
    const stack =
      cause.stack && cause.stack !== `${cause.name}: ${cause.message}`
        ? `\n${indent}${cause.stack.split("\n").slice(1).join(`\n${indent}`)}`
        : "";
    const nested =
      cause instanceof AggregateError
        ? [...cause.errors].map((item) => formatNestedError(item, depth + 1))
        : cause.cause === undefined
          ? []
          : [formatNestedError(cause.cause, depth + 1)];
    return `${indent}${cause.name}: ${cause.message}${stack}${nested.length ? `\n${nested.join("\n")}` : ""}`;
  };
  const details = formatNestedError(error);
  return [
    "INSTALL_MCP_BUNDLE_BUILD_FAILED",
    "Bun.build threw before returning build diagnostics:",
    details,
    "Verify the workspace dependencies are installed before retrying.",
  ].join("\n");
};
