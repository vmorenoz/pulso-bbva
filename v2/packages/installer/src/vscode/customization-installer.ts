import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  agentDefinitions,
  agentIds,
} from "../../../orchestration/src/agents/definitions";
import { vscodeCopilotRuntime } from "../../../orchestration/src/runtimes/vscode-copilot";

const manifestName = ".pulso-orchestration.json";
const managedVersion = 1;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class InstallationConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(readonly paths: string[]) {
    super(`Installation conflicts: ${paths.join(", ")}`);
  }
}

interface ManagedManifest {
  version: number;
  files: Record<string, string>;
  mcp?: string;
}

interface McpConfig {
  mcpServers?: Record<string, unknown>;
}

export interface McpCommand {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface InstallOptions {
  mcpCommand?: McpCommand;
}

const defaultMcpCommand: McpCommand = {
  command: "pulso-capabilities-mcp",
  env: { PULSO_WORKSPACE: "$" + "{workspaceFolder}" },
};

const readOptional = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
};

const managedFiles = async (source: string) => {
  const files: Array<{ target: string; content: string }> = [];
  for (const directory of ["skills"]) {
    const base = join(source, directory);
    const entries = await readdir(base, {
      recursive: true,
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const sourcePath = join(entry.parentPath, entry.name);
      const target = join(".github", directory, relative(base, sourcePath));
      files.push({ target, content: await readFile(sourcePath, "utf8") });
    }
  }
  for (const id of agentIds) {
    const rendered = vscodeCopilotRuntime.renderAgent(agentDefinitions[id]);
    files.push({
      target: join(".github", "agents", rendered.path),
      content: rendered.content,
    });
  }
  return files;
};

const parseManifest = (source?: string): ManagedManifest => {
  if (!source) return { version: managedVersion, files: {} };
  try {
    const manifest = JSON.parse(source) as ManagedManifest;
    if (manifest.version !== managedVersion || !manifest.files)
      throw new Error("Unsupported manifest");
    return manifest;
  } catch {
    throw new Error("INSTALL_MANIFEST_INVALID");
  }
};

const parseConfig = (source?: string): McpConfig => {
  if (!source) return {};
  try {
    const config = JSON.parse(source) as McpConfig;
    if (
      config.mcpServers !== undefined &&
      typeof config.mcpServers !== "object"
    )
      throw new Error("Invalid MCP servers");
    return config;
  } catch {
    throw new Error("INSTALL_CONFIG_INVALID");
  }
};

const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

export const installVscodeCustomizations = async (
  workspace: string,
  source: string,
  options: InstallOptions = {},
) => {
  const files = await managedFiles(source);
  const github = join(workspace, ".github");
  const manifestPath = join(github, manifestName);
  const manifest = parseManifest(await readOptional(manifestPath));
  const conflicts: string[] = [];

  for (const file of files) {
    const current = await readOptional(join(workspace, file.target));
    if (!current) continue;
    const currentHash = digest(current);
    const sourceHash = digest(file.content);
    if (
      currentHash !== sourceHash &&
      manifest.files[file.target] !== currentHash
    )
      conflicts.push(file.target);
  }

  const mcpPath = join(workspace, ".mcp.json");
  const config = parseConfig(await readOptional(mcpPath));
  const command = options.mcpCommand ?? defaultMcpCommand;
  const existingPulso = config.mcpServers?.pulso;
  const mcpHash = digest(JSON.stringify(command));
  if (
    existingPulso !== undefined &&
    !same(existingPulso, command) &&
    manifest.mcp !== digest(JSON.stringify(existingPulso))
  )
    conflicts.push(".mcp.json#pulso");
  if (conflicts.length) throw new InstallationConflictError(conflicts);

  for (const file of files) {
    const path = join(workspace, file.target);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
    manifest.files[file.target] = digest(file.content);
  }
  config.mcpServers ??= {};
  config.mcpServers.pulso = command;
  manifest.mcp = mcpHash;
  await mkdir(github, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(mcpPath, `${JSON.stringify(config, null, 2)}\n`);
};
