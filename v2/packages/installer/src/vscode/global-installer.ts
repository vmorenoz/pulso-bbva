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

const manifestFile = "install-manifest.json";
const manifestVersion = 1;
const serverName = "pulso";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export class GlobalInstallConflictError extends Error {
  readonly code = "INSTALL_CONFLICT";

  constructor(readonly paths: string[]) {
    super(`Global installation conflicts: ${paths.join(", ")}`);
  }
}

export interface GlobalInstallOptions {
  homeDir: string;
  mcpConfigPath: string;
  orchestrationRoot: string;
  dataRoot: string;
  runtimeExecutable: string;
  mcpBundle: string;
  enabledSkills?: string[];
  dryRun?: boolean;
}

interface InstallManifest {
  version: number;
  runtime?: "vscode-copilot";
  scope?: "global";
  files: Record<string, string>;
  mcp: { configPath: string; serverHash: string };
}

interface VscodeMcpConfig {
  inputs?: unknown[];
  servers?: Record<string, unknown>;
  sandbox?: unknown;
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

const readManifest = async (
  path: string,
): Promise<InstallManifest | undefined> => {
  const source = await readOptional(path);
  if (source === undefined) return undefined;
  try {
    const value = JSON.parse(source) as InstallManifest;
    if (
      value.version !== manifestVersion ||
      !value.files ||
      typeof value.files !== "object" ||
      !value.mcp ||
      typeof value.mcp.configPath !== "string" ||
      typeof value.mcp.serverHash !== "string"
    )
      throw new Error("invalid manifest");
    if (
      Object.entries(value.files).some(
        ([filePath, digest]) =>
          !isAbsolute(filePath) || typeof digest !== "string",
      )
    )
      throw new Error("invalid manifest paths");
    return value;
  } catch {
    throw new Error("INSTALL_MANIFEST_INVALID");
  }
};

const parseMcpConfig = (source?: string): VscodeMcpConfig => {
  if (source === undefined) return {};
  try {
    const value = JSON.parse(source) as VscodeMcpConfig;
    if (
      value === null ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      (value.servers !== undefined &&
        (value.servers === null ||
          Array.isArray(value.servers) ||
          typeof value.servers !== "object"))
    )
      throw new Error("invalid config");
    return value;
  } catch {
    throw new Error("VSCODE_MCP_CONFIG_INVALID");
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

const ensureNoSymlink = async (path: string) => {
  try {
    if ((await lstat(path)).isSymbolicLink())
      throw new Error(`INSTALL_TARGET_SYMLINK:${path}`);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
};

const atomicWrite = async (path: string, content: string, mode: number) => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await ensureNoSymlink(dirname(path));
  await ensureNoSymlink(path);
  const temporary = `${path}.pulso-${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode, flag: "wx" });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

const resolveUnder = (root: string, path: string) => {
  const resolved = resolve(root, path);
  const rel = relative(resolve(root), resolved);
  if (
    rel === ".." ||
    rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(rel)
  )
    throw new Error("INSTALL_PATH_ESCAPE");
  return resolved;
};

const isWithin = (root: string, path: string) => {
  const rel = relative(resolve(root), resolve(path));
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel))
  );
};

const readCurrentFile = async (path: string) => {
  await ensureNoSymlink(path);
  return readOptional(path);
};

const ensureNoSymlinkAncestors = async (root: string, target: string) => {
  if (!isWithin(root, target)) throw new Error("INSTALL_PATH_ESCAPE");
  const rel = relative(resolve(root), resolve(target));
  let cursor = resolve(root);
  await ensureNoSymlink(cursor);
  for (const segment of rel.split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    await ensureNoSymlink(cursor);
  }
};

export const installGlobalVscode = async (options: GlobalInstallOptions) => {
  const homeDir = resolve(options.homeDir);
  const dataRoot = resolve(options.dataRoot);
  const mcpConfigPath = resolve(options.mcpConfigPath);
  const manifestPath = join(dataRoot, manifestFile);
  const previous = await readManifest(manifestPath);
  if (previous && previous.mcp.configPath !== mcpConfigPath)
    throw new Error("INSTALL_MCP_PROFILE_MISMATCH");
  const previousFiles = previous?.files ?? {};
  const allowedRoots = [
    join(homeDir, ".copilot", "agents"),
    join(homeDir, ".copilot", "skills"),
  ];
  if (
    Object.keys(previousFiles).some(
      (path) => !allowedRoots.some((root) => isWithin(root, path)),
    )
  )
    throw new Error("INSTALL_MANIFEST_PATH_INVALID");
  const planned = new Map<string, string>();

  for (const id of agentIds) {
    const rendered = vscodeCopilotRuntime.renderAgent(agentDefinitions[id]);
    const target = resolveUnder(
      join(homeDir, ".copilot", "agents"),
      rendered.path,
    );
    await ensureNoSymlinkAncestors(homeDir, target);
    planned.set(target, rendered.content);
  }

  for (const directory of ["skills"]) {
    const sourceRoot = join(options.orchestrationRoot, directory);
    for (const sourcePath of await listFiles(sourceRoot)) {
      if (
        directory === "skills" &&
        options.enabledSkills &&
        !options.enabledSkills.includes(sourcePath.split(/[\\/]/)[0] ?? "")
      )
        continue;
      const content = await readFile(join(sourceRoot, sourcePath), "utf8");
      const targetRoot = join(homeDir, ".copilot", directory);
      const target = resolveUnder(targetRoot, sourcePath);
      await ensureNoSymlinkAncestors(homeDir, target);
      planned.set(target, content);
    }
  }

  const bundlePath = join(dataRoot, "pulso-capabilities-mcp.js");
  await ensureNoSymlinkAncestors(homeDir, dataRoot);

  if (isWithin(homeDir, mcpConfigPath))
    await ensureNoSymlinkAncestors(homeDir, mcpConfigPath);
  const config = parseMcpConfig(await readOptional(mcpConfigPath));
  const servers = config.servers ?? {};
  const expectedServer = {
    type: "stdio",
    command: resolve(options.runtimeExecutable),
    args: [bundlePath],
    env: { PULSO_WORKSPACE: "$" + "{workspaceFolder}" },
  };
  const currentServer = servers[serverName];
  const currentServerHash =
    currentServer === undefined
      ? undefined
      : hash(JSON.stringify(currentServer));
  const ownsServer =
    previous?.mcp.configPath === mcpConfigPath &&
    currentServerHash === previous.mcp.serverHash;
  const plannedServerHash = hash(JSON.stringify(expectedServer));
  const conflicts: string[] = [];

  if (
    currentServer !== undefined &&
    !ownsServer &&
    currentServerHash !== plannedServerHash
  )
    conflicts.push(`${mcpConfigPath}#servers.${serverName}`);

  for (const [path, content] of planned) {
    const current = await readCurrentFile(path);
    if (current === undefined) continue;
    const expectedHash = hash(content);
    const previousHash = previousFiles[path];
    if (hash(current) !== expectedHash && hash(current) !== previousHash)
      conflicts.push(path);
  }
  if (conflicts.length) throw new GlobalInstallConflictError(conflicts);
  if (options.dryRun)
    return {
      installedFiles: [...planned.keys()],
      mcpConfigPath,
      bundlePath,
    };

  await installSharedRuntime({
    dataRoot,
    mcpBundle: options.mcpBundle,
    homeDir,
  });
  const installedFiles: Record<string, string> = {};
  for (const [path, content] of planned) {
    await atomicWrite(path, content, path === bundlePath ? 0o700 : 0o644);
    installedFiles[path] = hash(content);
  }

  config.servers ??= {};
  config.servers[serverName] = expectedServer;
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  const existingMode = await (async () => {
    try {
      return (await lstat(mcpConfigPath)).mode & 0o777;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return 0o600;
      throw error;
    }
  })();
  await atomicWrite(mcpConfigPath, configText, existingMode);
  const manifest: InstallManifest = {
    version: manifestVersion,
    runtime: "vscode-copilot",
    scope: "global",
    files: installedFiles,
    mcp: { configPath: mcpConfigPath, serverHash: plannedServerHash },
  };
  await atomicWrite(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    0o600,
  );
  return {
    installedFiles: Object.keys(installedFiles),
    mcpConfigPath,
    bundlePath,
  };
};

export const uninstallGlobalVscode = async (options: {
  dataRoot: string;
  homeDir: string;
  mcpConfigPath: string;
  dryRun?: boolean;
}) => {
  const dataRoot = resolve(options.dataRoot);
  const manifestPath = join(dataRoot, manifestFile);
  const manifest = await readManifest(manifestPath);
  if (!manifest) return { removedFiles: [], conflicts: [] };
  const conflicts: string[] = [];
  const removable: string[] = [];
  const allowedRoots = [
    join(resolve(options.homeDir), ".copilot", "agents"),
    join(resolve(options.homeDir), ".copilot", "skills"),
  ];

  for (const [path, installedHash] of Object.entries(manifest.files)) {
    const resolved = resolve(path);
    if (!allowedRoots.some((root) => isWithin(root, resolved)))
      throw new Error("INSTALL_MANIFEST_PATH_INVALID");
    const current = await readCurrentFile(resolved);
    if (current === undefined) continue;
    if (hash(current) !== installedHash) conflicts.push(resolved);
    else removable.push(resolved);
  }

  const mcpConfigPath = resolve(options.mcpConfigPath);
  if (mcpConfigPath !== manifest.mcp.configPath)
    conflicts.push(
      `${mcpConfigPath} (installed at ${manifest.mcp.configPath})`,
    );
  const config = parseMcpConfig(await readOptional(manifest.mcp.configPath));
  const currentServer = config.servers?.[serverName];
  if (
    currentServer !== undefined &&
    hash(JSON.stringify(currentServer)) !== manifest.mcp.serverHash
  )
    conflicts.push(`${manifest.mcp.configPath}#servers.${serverName}`);

  if (conflicts.length) return { removedFiles: [], conflicts };
  if (options.dryRun)
    return { removedFiles: removable, conflicts: [] as string[] };

  if (config.servers?.[serverName] !== undefined) {
    delete config.servers[serverName];
    await atomicWrite(
      manifest.mcp.configPath,
      `${JSON.stringify(config, null, 2)}\n`,
      0o600,
    );
  }
  for (const path of removable) await rm(path, { force: true });
  await rm(manifestPath, { force: true });
  return { removedFiles: removable, conflicts: [] };
};

export const installSharedRuntime = async (options: {
  dataRoot: string;
  mcpBundle: string;
  homeDir?: string;
}) => {
  const dataRoot = resolve(options.dataRoot);
  if (options.homeDir)
    await ensureNoSymlinkAncestors(options.homeDir, dataRoot);
  const bundlePath = join(dataRoot, "pulso-capabilities-mcp.js");
  const manifestPath = join(dataRoot, "runtime-manifest.json");
  let previousHash: string | undefined;
  const manifestSource = await readOptional(manifestPath);
  if (manifestSource !== undefined) {
    try {
      const value = JSON.parse(manifestSource) as {
        version?: number;
        hash?: string;
      };
      if (value.version !== manifestVersion || typeof value.hash !== "string")
        throw new Error("invalid runtime manifest");
      previousHash = value.hash;
    } catch {
      throw new Error("INSTALL_RUNTIME_MANIFEST_INVALID");
    }
  }
  const current = await readCurrentFile(bundlePath);
  if (
    current !== undefined &&
    hash(current) !== hash(options.mcpBundle) &&
    hash(current) !== previousHash
  )
    throw new GlobalInstallConflictError([bundlePath]);
  await atomicWrite(bundlePath, options.mcpBundle, 0o700);
  await atomicWrite(
    manifestPath,
    `${JSON.stringify({ version: manifestVersion, hash: hash(options.mcpBundle) }, null, 2)}\n`,
    0o600,
  );
  return bundlePath;
};
