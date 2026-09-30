import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  agentDefinitions,
  agentIds,
} from "../../../orchestration/src/agents/definitions";
import { vscodeCopilotRuntime } from "../../../orchestration/src/runtimes/vscode-copilot";
import { GlobalInstallConflictError } from "./global-installer";

const manifestName = ".pulso-installer.json";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

interface LocalManifest {
  version: 1;
  runtime?: "vscode-copilot";
  scope?: "local";
  files: Record<string, string>;
  mcpHash: string;
}

interface PortableMcpConfig {
  servers?: Record<string, unknown>;
  [key: string]: unknown;
}

const readOptional = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
};

const listFiles = async (root: string, prefix = ""): Promise<string[]> => {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(prefix, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`INSTALL_SOURCE_SYMLINK:${path}`);
    if (entry.isDirectory()) files.push(...(await listFiles(root, path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

const readManifest = async (
  path: string,
): Promise<LocalManifest | undefined> => {
  const source = await readOptional(path);
  if (source === undefined) return undefined;
  try {
    const manifest = JSON.parse(source) as LocalManifest;
    if (
      manifest.version !== 1 ||
      !manifest.files ||
      typeof manifest.files !== "object" ||
      typeof manifest.mcpHash !== "string"
    )
      throw new Error("invalid manifest");
    if (
      Object.entries(manifest.files).some(
        ([filePath, digest]) =>
          !isAbsolute(filePath) || typeof digest !== "string",
      )
    )
      throw new Error("invalid manifest paths");
    return manifest;
  } catch {
    throw new Error("INSTALL_MANIFEST_INVALID");
  }
};

const parseConfig = (source?: string): PortableMcpConfig => {
  if (source === undefined) return {};
  try {
    const config = JSON.parse(source) as PortableMcpConfig;
    if (
      config === null ||
      Array.isArray(config) ||
      typeof config !== "object" ||
      (config.servers !== undefined &&
        (config.servers === null ||
          Array.isArray(config.servers) ||
          typeof config.servers !== "object"))
    )
      throw new Error("invalid config");
    return config;
  } catch {
    throw new Error("WORKSPACE_MCP_CONFIG_INVALID");
  }
};

const atomicWrite = async (
  path: string,
  content: string,
  workspace: string,
  mode = 0o644,
) => {
  const rel = relative(resolve(workspace), resolve(path));
  if (
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel)
  )
    throw new Error("INSTALL_PATH_ESCAPE");
  let cursor = resolve(workspace);
  for (const segment of rel.split(/[\\/]/)) {
    cursor = join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink())
        throw new Error(`INSTALL_TARGET_SYMLINK:${cursor}`);
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") break;
      throw error;
    }
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o755 });
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`INSTALL_TARGET_SYMLINK:${path}`);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  const temporary = `${path}.pulso-${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

export const installLocalVscode = async (options: {
  workspace: string;
  orchestrationRoot: string;
  runtimeExecutable: string;
  mcpBundlePath: string;
  enabledSkills?: string[];
  dryRun?: boolean;
}) => {
  const workspace = resolve(options.workspace);
  const manifestPath = join(workspace, ".github", manifestName);
  const previous = await readManifest(manifestPath);
  const planned = new Map<string, string>();
  for (const id of agentIds) {
    const rendered = vscodeCopilotRuntime.renderAgent(agentDefinitions[id]);
    planned.set(
      join(workspace, ".github", "agents", rendered.path),
      rendered.content,
    );
  }
  for (const directory of ["skills"]) {
    const sourceRoot = join(options.orchestrationRoot, directory);
    for (const sourcePath of await listFiles(sourceRoot)) {
      const skillId = sourcePath.split(/[\\/]/)[0] ?? "";
      if (
        directory === "skills" &&
        options.enabledSkills &&
        !options.enabledSkills.includes(skillId)
      )
        continue;
      const content = await readFile(join(sourceRoot, sourcePath), "utf8");
      const target = join(workspace, ".github", directory, sourcePath);
      planned.set(target, content);
    }
  }

  const mcpPath = join(workspace, ".vscode", "mcp.json");
  const config = parseConfig(await readOptional(mcpPath));
  const command = {
    type: "stdio",
    command: resolve(options.runtimeExecutable),
    args: [resolve(options.mcpBundlePath)],
    env: { PULSO_WORKSPACE: "$" + "{workspaceFolder}" },
  };
  const currentPulso = config.servers?.pulso;
  const currentPulsoHash =
    currentPulso === undefined ? undefined : hash(JSON.stringify(currentPulso));
  const expectedHash = hash(JSON.stringify(command));
  const conflicts: string[] = [];
  if (
    currentPulso !== undefined &&
    currentPulsoHash !== expectedHash &&
    currentPulsoHash !== previous?.mcpHash
  )
    conflicts.push(`${mcpPath}#servers.pulso`);

  for (const [path, content] of planned) {
    let current: string | undefined;
    try {
      if ((await lstat(path)).isSymbolicLink())
        throw new Error(`INSTALL_TARGET_SYMLINK:${path}`);
      current = await readOptional(path);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
    if (
      current !== undefined &&
      hash(current) !== hash(content) &&
      hash(current) !== previous?.files[path]
    )
      conflicts.push(path);
  }
  if (conflicts.length) throw new GlobalInstallConflictError(conflicts);
  if (options.dryRun) return { installedFiles: [...planned.keys()], mcpPath };

  const installedFiles: Record<string, string> = {};
  for (const [path, content] of planned) {
    await atomicWrite(path, content, workspace);
    installedFiles[path] = hash(content);
  }
  config.servers ??= {};
  config.servers.pulso = command;
  await atomicWrite(mcpPath, `${JSON.stringify(config, null, 2)}\n`, workspace);
  const manifest: LocalManifest = {
    version: 1,
    runtime: "vscode-copilot",
    scope: "local",
    files: installedFiles,
    mcpHash: expectedHash,
  };
  await atomicWrite(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    workspace,
    0o600,
  );
  return { installedFiles: Object.keys(installedFiles), mcpPath };
};

export const uninstallLocalVscode = async (
  workspacePath: string,
  dryRun = false,
) => {
  const workspace = resolve(workspacePath);
  const manifestPath = join(workspace, ".github", manifestName);
  const manifest = await readManifest(manifestPath);
  if (!manifest) return { removedFiles: [], conflicts: [] };
  const allowedRoots = [
    join(workspace, ".github", "agents"),
    join(workspace, ".github", "skills"),
  ].map((path) => resolve(path));
  const conflicts: string[] = [];
  const removable: string[] = [];
  for (const [filePath, installedHash] of Object.entries(manifest.files)) {
    const absolute = resolve(filePath);
    if (
      !allowedRoots.some((root) => {
        const rel = relative(root, absolute);
        return (
          rel !== "" &&
          rel !== ".." &&
          !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
          !isAbsolute(rel)
        );
      })
    )
      throw new Error("INSTALL_MANIFEST_PATH_INVALID");
    const current = await readOptional(absolute);
    if (current === undefined) continue;
    if (hash(current) === installedHash) removable.push(absolute);
    else conflicts.push(absolute);
  }
  const mcpPath = join(workspace, ".vscode", "mcp.json");
  const config = parseConfig(await readOptional(mcpPath));
  const currentPulso = config.servers?.pulso;
  if (
    currentPulso !== undefined &&
    hash(JSON.stringify(currentPulso)) !== manifest.mcpHash
  )
    conflicts.push(`${mcpPath}#servers.pulso`);
  if (conflicts.length) return { removedFiles: [], conflicts };
  if (dryRun) return { removedFiles: removable, conflicts: [] as string[] };
  if (currentPulso !== undefined) {
    delete config.servers?.pulso;
    await atomicWrite(
      mcpPath,
      `${JSON.stringify(config, null, 2)}\n`,
      workspace,
    );
  }
  for (const path of removable) await rm(path, { force: true });
  await rm(manifestPath, { force: true });
  return { removedFiles: removable, conflicts: [] };
};

export const localManifestPath = (workspace: string) =>
  join(resolve(workspace), ".github", manifestName);
