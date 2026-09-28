import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEdits,
  modify,
  type ParseError,
  parse,
  printParseErrorCode,
} from "jsonc-parser";
import {
  type AgentId,
  agentDefinitions,
  agentIds,
  type CanonicalSkill,
  openCodeRuntime,
  type RuntimeId,
} from "../../../orchestration/src/runtimes";
import { type AvailableModel, OpenCodeDiscovery } from "../discovery/opencode";
import type { ResolvedAgentModelConfig } from "../wizard/model-profiles";

export type InstallScope = "local" | "global";
export interface PlannedAsset {
  path: string;
  content: string;
  sha256: string;
}
export interface HashedSource {
  path: string;
  sha256: string;
}
export interface PlannedConfigMutation {
  path: string;
  key: string;
  value: unknown;
  previousHash?: string;
}
export interface RuntimeInstallPlan {
  runtime: RuntimeId;
  runtimeVersion?: string;
  assets: PlannedAsset[];
  config: PlannedConfigMutation[];
  modelConfig?: ResolvedAgentModelConfig;
  buildId?: string;
  sourceHashes?: HashedSource[];
}
export interface InstallationWarning {
  code: string;
  message: string;
}
export interface InstallationPlan {
  runtimes: RuntimeInstallPlan[];
  scope: InstallScope;
  fileMutations: PlannedAsset[];
  configMutations: PlannedConfigMutation[];
  warnings: InstallationWarning[];
}
export interface OpenCodeInstallOptions {
  scope: InstallScope;
  workspace?: string;
  homeDir?: string;
  executable: string;
  mcpCommand: string[];
  version?: string;
  modelConfig?: ResolvedAgentModelConfig;
  skills: CanonicalSkill[];
  discovery?: Pick<OpenCodeDiscovery, "models">;
}
export interface OpenCodeManifest {
  version: 1 | 2 | 3 | 4 | 5;
  runtime: "opencode";
  scope: InstallScope;
  runtimeVersion?: string;
  files: Record<string, string>;
  assetHashes?: HashedSource[];
  sourceHashes?: HashedSource[];
  configEntries: Record<string, string>;
  modelProfile?: string;
  resolvedModels?: Record<AgentId, string | null>;
  buildId: string;
  nativeBridge: {
    path: string;
    sha256: string;
    version: "1.18.32";
    role: "native-bridge";
  };
  mcp?: {
    path: string;
    sha256: string;
    buildId: string;
  };
}

export interface OpenCodeInstallPublicationHooks {
  beforeActivation?(): Promise<void> | void;
  afterBridgePublish?(): Promise<void> | void;
}

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const optionalRead = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return undefined;
    throw error;
  }
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const parseJsonc = (source: string) => {
  const errors: ParseError[] = [];
  const value = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (
    errors.length ||
    !value ||
    Array.isArray(value) ||
    typeof value !== "object"
  )
    throw new Error(
      `OPENCODE_CONFIG_INVALID:${errors.map((entry) => printParseErrorCode(entry.error)).join(",")}`,
    );
  return value as Record<string, unknown>;
};
const atomicWrite = async (path: string, content: string) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.pulso-${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};
const nativeBridgePath = (manifest: unknown) => {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    return undefined;
  const bridge = (manifest as Record<string, unknown>).nativeBridge;
  if (!bridge || typeof bridge !== "object" || Array.isArray(bridge))
    return undefined;
  const path = (bridge as Record<string, unknown>).path;
  return typeof path === "string" && path.length ? path : undefined;
};
const guardPathForScope = (root: string, scope: InstallScope) =>
  join(
    scope === "local" ? join(root, ".opencode") : root,
    "plugins",
    "pulso-protocol-guard.js",
  );
const managedBridgePlugin = "./plugins/pulso-protocol-guard.js";
const configPathForScope = (root: string, scope: InstallScope) =>
  join(scope === "local" ? join(root, ".opencode") : root, "opencode.json");
const manifestPathForScope = (root: string, scope: InstallScope) =>
  join(
    scope === "local" ? join(root, ".opencode") : root,
    ".pulso-manifest.json",
  );
const configEntryKey = (path: string, key: "plugin" | "mcp.pulso") =>
  `${path}#${key}`;
const managedConfigHash = (
  manifest: OpenCodeManifest | undefined,
  path: string,
  key: "plugin" | "mcp.pulso",
) => {
  if (!manifest) return undefined;
  const current = manifest.configEntries[configEntryKey(path, key)];
  if (current) return current;
  const legacy = manifest.configEntries[path];
  if (!legacy) return undefined;
  return manifest.version === 1
    ? key === "mcp.pulso"
      ? legacy
      : undefined
    : key === "plugin"
      ? legacy
      : undefined;
};
const managedConfigEntry = (
  manifest: OpenCodeManifest,
  entry: string,
): { path: string; key: "plugin" | "mcp.pulso" } => {
  const separator = entry.lastIndexOf("#");
  const key = entry.slice(separator + 1);
  if (separator > 0 && (key === "plugin" || key === "mcp.pulso"))
    return { path: entry.slice(0, separator), key };
  return {
    path: entry,
    key: manifest.version === 1 ? "mcp.pulso" : "plugin",
  } as const;
};
const validManifestVersion = (
  version: unknown,
): version is OpenCodeManifest["version"] =>
  version === 1 ||
  version === 2 ||
  version === 3 ||
  version === 4 ||
  version === 5;
const bridgeRegistrations = async (path: string) => {
  const source = await optionalRead(path);
  if (!source) return [] as string[];
  const config = parseJsonc(source);
  if (config.plugin !== undefined && !Array.isArray(config.plugin))
    throw new Error("OPENCODE_PLUGIN_CONFIG_INVALID");
  if (
    Array.isArray(config.plugin) &&
    !config.plugin.every((entry) => typeof entry === "string")
  )
    throw new Error("OPENCODE_PLUGIN_CONFIG_INVALID");
  return (Array.isArray(config.plugin) ? config.plugin : []).filter(
    (entry): entry is string =>
      typeof entry === "string" &&
      (entry === managedBridgePlugin ||
        entry.endsWith("/plugins/pulso-protocol-guard.js")),
  );
};

const assertNoDuplicateNativeBridge = async (
  options: Pick<OpenCodeInstallOptions, "scope" | "workspace" | "homeDir">,
  configPath: string,
) => {
  const localRoot = resolve(options.workspace ?? process.cwd());
  const globalRoot = resolve(
    options.homeDir ?? homedir(),
    ".config",
    "opencode",
  );
  const effectiveConfigPaths = [
    configPathForScope(localRoot, "local"),
    configPathForScope(globalRoot, "global"),
  ];
  for (const effectivePath of [...new Set(effectiveConfigPaths)]) {
    const registrations = await bridgeRegistrations(effectivePath);
    if (registrations.length > 1)
      throw new Error(
        `DUPLICATE_NATIVE_BRIDGE:${effectivePath}#plugin:${registrations.join(",")}`,
      );
    if (
      registrations.length &&
      (effectivePath !== configPath || registrations[0] !== managedBridgePlugin)
    )
      throw new Error(`DUPLICATE_NATIVE_BRIDGE:${effectivePath},${configPath}`);
  }
  const root = options.scope === "local" ? localRoot : globalRoot;
  const alternateManifestPath = manifestPathForScope(
    options.scope === "local" ? globalRoot : localRoot,
    options.scope === "local" ? "global" : "local",
  );
  const alternate = await optionalRead(alternateManifestPath);
  if (!alternate) return;
  const bridge = nativeBridgePath(JSON.parse(alternate));
  if (bridge)
    throw new Error(
      `DUPLICATE_NATIVE_BRIDGE:${bridge},${guardPathForScope(root, options.scope)}`,
    );
};

const sourceRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const openCodeBuildEntrypoints = [
  "packages/capabilities-mcp/src/opencode/plugin-entry.ts",
  "packages/orchestration/src/runtimes/opencode/index.ts",
] as const;
const openCodeBuildManifests = [
  "packages/capabilities-mcp/package.json",
  "packages/orchestration/package.json",
  "packages/working-system/package.json",
  "package.json",
  "bun.lock",
] as const;
const sourceImport =
  /(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']/g;
const sourceCandidates = (path: string) => [
  path,
  `${path}.ts`,
  join(path, "index.ts"),
];
const sourcePath = (path: string) => relative(sourceRoot, path);
const sourceFile = async (path: string) => {
  for (const candidate of sourceCandidates(path)) {
    try {
      const source = await optionalRead(candidate);
      if (source !== undefined) return { path: candidate, source };
    } catch (error) {
      if ((error as { code?: string }).code !== "EISDIR") throw error;
    }
  }
  return undefined;
};
const importedSources = async (entrypoints: readonly string[]) => {
  const pending = entrypoints.map((path) => join(sourceRoot, path));
  const seen = new Set<string>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || seen.has(current)) continue;
    const file = await sourceFile(current);
    if (!file)
      throw new Error(`OPENCODE_BUILD_SOURCE_MISSING:${sourcePath(current)}`);
    seen.add(file.path);
    for (const match of file.source.matchAll(sourceImport)) {
      const specifier = match[1];
      if (!specifier?.startsWith(".")) continue;
      const imported = await sourceFile(resolve(dirname(file.path), specifier));
      if (!imported)
        throw new Error(
          `OPENCODE_BUILD_SOURCE_MISSING:${sourcePath(resolve(dirname(file.path), specifier))}`,
        );
      if (!seen.has(imported.path)) pending.push(imported.path);
    }
  }
  return [...seen]
    .map(sourcePath)
    .sort((left, right) => left.localeCompare(right));
};
const hashSources = async (paths: readonly string[]): Promise<HashedSource[]> =>
  Promise.all(
    [...paths]
      .sort((left, right) => left.localeCompare(right))
      .map(async (path) => ({
        path,
        sha256: digest(await readFile(join(sourceRoot, path), "utf8")),
      })),
  );
const openCodeBuildSources = async () =>
  hashSources([
    ...(await importedSources(openCodeBuildEntrypoints)),
    ...openCodeBuildManifests,
  ]);
const buildIdFromSources = (sources: readonly HashedSource[]) =>
  digest(sources.map(({ path, sha256 }) => `${path}:${sha256}`).join("\n"));
const orderedAssetHashes = (assets: readonly PlannedAsset[]): HashedSource[] =>
  [...assets]
    .map(({ path, sha256 }) => ({ path, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
const protectedWorkspaceFile = (path: string) =>
  ["AGENTS.md", "CLAUDE.md", "PULSO.md"].includes(
    path.split(/[\\/]/).pop() ?? "",
  );

const pulsoSkillIds = [
  "pulso-adaptive-orchestration",
  "pulso-evidence-inventory",
  "pulso-executable-plans",
  "pulso-human-delivery",
  "pulso-parallel-work",
  "pulso-preferences-capabilities",
  "pulso-quality-review",
  "pulso-safe-recovery",
] as const;
export const planOpenCodeInstall = async (
  options: OpenCodeInstallOptions,
): Promise<InstallationPlan> => {
  const root =
    options.scope === "local"
      ? resolve(options.workspace ?? process.cwd())
      : resolve(options.homeDir ?? homedir(), ".config", "opencode");
  const sourceHashes = await openCodeBuildSources();
  const buildId = buildIdFromSources(sourceHashes);
  const renderedConfig = openCodeRuntime.buildRuntimeConfig({
    scope: options.scope,
    mcpCommand: options.mcpCommand,
  })[0];
  if (!renderedConfig) throw new Error("OPENCODE_CONFIG_RENDERER_EMPTY");
  const configPath = join(root, renderedConfig.path);
  await assertNoDuplicateNativeBridge(options, configPath);
  const manifestPath = manifestPathForScope(root, options.scope);
  const previous = await optionalRead(manifestPath);
  let previousManifest: OpenCodeManifest | undefined;
  if (previous) {
    try {
      previousManifest = JSON.parse(previous) as OpenCodeManifest;
      if (
        !validManifestVersion(previousManifest.version) ||
        previousManifest.runtime !== "opencode"
      )
        throw new Error();
    } catch {
      throw new Error("INSTALL_MANIFEST_INVALID");
    }
  }
  const agentDir =
    options.scope === "local"
      ? join(root, ".opencode", "agents")
      : join(root, "agents");
  const skillDir =
    options.scope === "local"
      ? join(root, ".opencode", "skills")
      : join(root, "skills");
  const assets: PlannedAsset[] = [];
  for (const id of agentIds) {
    const content = openCodeRuntime.renderAgent(agentDefinitions[id], {
      model: options.modelConfig?.agents[id] ?? null,
      buildId,
    }).content;
    const path = join(agentDir, `${id}.md`);
    assets.push({ path, content, sha256: digest(content) });
  }
  const suppliedSkillIds = new Set(options.skills.map((skill) => skill.id));
  const bundledPulsoSkills = await Promise.all(
    pulsoSkillIds
      .filter((id) => !suppliedSkillIds.has(id))
      .map(async (id) => ({
        id,
        content: await readFile(
          join(sourceRoot, "packages/orchestration/skills", `${id}.md`),
          "utf8",
        ),
      })),
  );
  for (const skill of [...options.skills, ...bundledPulsoSkills]) {
    const rendered = openCodeRuntime.renderSkill(skill);
    const path = join(skillDir, rendered.path);
    assets.push({
      path,
      content: rendered.content,
      sha256: digest(rendered.content),
    });
  }
  const pluginSource = fileURLToPath(
    new URL(
      "../../../capabilities-mcp/src/opencode/plugin-entry.ts",
      import.meta.url,
    ),
  );
  const pluginBuild = await Bun.build({
    entrypoints: [pluginSource],
    target: "bun",
    format: "esm",
    minify: true,
    define: { __PULSO_BUILD_ID__: JSON.stringify(buildId) },
    write: false,
  } as Parameters<typeof Bun.build>[0] & { write: false });
  if (!pluginBuild.success || !pluginBuild.outputs[0])
    throw new Error("OPENCODE_NATIVE_BRIDGE_BUILD_FAILED");
  const guardPath = guardPathForScope(root, options.scope);
  const guardContent = await pluginBuild.outputs[0].text();
  assets.push({
    path: guardPath,
    content: guardContent,
    sha256: digest(guardContent),
  });
  const configRaw = await optionalRead(configPath);
  const config = configRaw ? parseJsonc(configRaw) : {};
  if (config.mcp !== undefined && !isRecord(config.mcp))
    throw new Error("OPENCODE_MCP_CONFIG_INVALID");
  const plugins = Array.isArray(config.plugin) ? config.plugin : [];
  if (!plugins.every((entry) => typeof entry === "string"))
    throw new Error("OPENCODE_PLUGIN_CONFIG_INVALID");
  const renderedValue = JSON.parse(renderedConfig.content) as {
    plugin?: string[];
  };
  const bridgePlugin = renderedValue.plugin?.[0];
  if (!bridgePlugin) throw new Error("OPENCODE_NATIVE_BRIDGE_RENDER_FAILED");
  const pluginConfig = plugins.includes(bridgePlugin)
    ? plugins
    : [...plugins, bridgePlugin];
  const currentEntry = config.plugin;
  const currentMcp = isRecord(config.mcp) ? config.mcp.pulso : undefined;
  const existingMcpHash = managedConfigHash(
    previousManifest,
    configPath,
    "mcp.pulso",
  );
  if (
    existingMcpHash &&
    (currentMcp === undefined ||
      digest(JSON.stringify(currentMcp)) !== existingMcpHash)
  )
    throw new Error(`INSTALL_CONFLICT:${configPath}#mcp.pulso`);
  const pluginMutation: PlannedConfigMutation = {
    path: configPath,
    key: "plugin",
    value: pluginConfig,
    ...(currentEntry === undefined
      ? {}
      : { previousHash: digest(JSON.stringify(currentEntry)) }),
  };
  const mcpMutation =
    !existingMcpHash || currentMcp === undefined
      ? undefined
      : ({
          path: configPath,
          key: "mcp.pulso",
          value: undefined,
          previousHash: digest(JSON.stringify(currentMcp)),
        } satisfies PlannedConfigMutation);
  const conflicts: string[] = [];
  for (const asset of assets) {
    const current = await optionalRead(asset.path);
    if (
      current !== undefined &&
      digest(current) !== asset.sha256 &&
      digest(current) !== previousManifest?.files[asset.path]
    )
      conflicts.push(asset.path);
  }
  if (conflicts.length)
    throw new Error(`INSTALL_CONFLICT:${conflicts.join(",")}`);
  const runtimePlan: RuntimeInstallPlan = {
    runtime: "opencode",
    buildId,
    sourceHashes,
    ...(options.version ? { runtimeVersion: options.version } : {}),
    assets,
    config: [pluginMutation, ...(mcpMutation ? [mcpMutation] : [])],
    ...(options.modelConfig ? { modelConfig: options.modelConfig } : {}),
  };
  const plan: InstallationPlan = {
    runtimes: [runtimePlan],
    scope: options.scope,
    fileMutations: assets,
    configMutations: [pluginMutation, ...(mcpMutation ? [mcpMutation] : [])],
    warnings: [],
  };
  return plan;
};

export const applyOpenCodeInstall = async (
  options: OpenCodeInstallOptions,
  plan: InstallationPlan,
  hooks: OpenCodeInstallPublicationHooks = {},
) => {
  if (
    plan.scope !== options.scope ||
    plan.runtimes.length !== 1 ||
    plan.runtimes[0]?.runtime !== "opencode"
  )
    throw new Error("INSTALL_PLAN_STALE");
  const configMutation = plan.configMutations.find(
    (mutation) => mutation.key === "plugin",
  );
  const mcpMutation = plan.configMutations.find(
    (mutation) => mutation.key === "mcp.pulso",
  );
  if (!configMutation) throw new Error("INSTALL_CONFIG_MUTATION_MISSING");
  if (
    plan.configMutations.length > 2 ||
    plan.configMutations.some(
      (mutation) => mutation.key !== "plugin" && mutation.key !== "mcp.pulso",
    ) ||
    (mcpMutation && mcpMutation.path !== configMutation.path)
  )
    throw new Error("INSTALL_PLAN_STALE");
  await assertNoDuplicateNativeBridge(options, configMutation.path);
  const runtimePlan = plan.runtimes[0];
  const sourceHashes = runtimePlan?.sourceHashes;
  if (
    !runtimePlan?.buildId ||
    !sourceHashes?.length ||
    sourceHashes.some(
      (source) =>
        !source.path ||
        !source.sha256 ||
        typeof source.path !== "string" ||
        typeof source.sha256 !== "string",
    ) ||
    buildIdFromSources(sourceHashes) !== runtimePlan.buildId
  )
    throw new Error("INSTALL_PLAN_BUILD_INVALID");
  const buildId = runtimePlan.buildId;
  if (
    options.modelConfig &&
    Object.values(options.modelConfig.agents).some((id) => id !== null)
  ) {
    const catalog = await (options.discovery ?? new OpenCodeDiscovery()).models(
      options.executable,
    );
    const lost = Object.values(options.modelConfig.agents).filter(
      (id): id is string =>
        id !== null && !catalog.some((model) => model.id === id),
    );
    if (lost.length)
      throw new Error(`MODEL_CATALOG_STALE:${[...new Set(lost)].join(",")}`);
  }
  const root =
    options.scope === "local"
      ? resolve(options.workspace ?? process.cwd())
      : resolve(options.homeDir ?? homedir(), ".config", "opencode");
  if (configMutation.path !== configPathForScope(root, options.scope))
    throw new Error("INSTALL_PLAN_STALE");
  const previousManifestPath = manifestPathForScope(root, options.scope);
  const previousRaw = await optionalRead(previousManifestPath);
  const previous = previousRaw
    ? (JSON.parse(previousRaw) as OpenCodeManifest)
    : undefined;
  if (
    previous &&
    (!validManifestVersion(previous.version) ||
      previous.runtime !== "opencode" ||
      previous.scope !== options.scope)
  )
    throw new Error("INSTALL_MANIFEST_INVALID");
  for (const asset of plan.fileMutations) {
    if (protectedWorkspaceFile(asset.path))
      throw new Error(`INSTALL_PROTECTED_PATH:${asset.path}`);
    if (digest(asset.content) !== asset.sha256)
      throw new Error(`INSTALL_PLAN_ASSET_HASH_INVALID:${asset.path}`);
    const assetPath = relative(root, asset.path);
    if (!assetPath || assetPath === ".." || assetPath.startsWith("../"))
      throw new Error(`INSTALL_PLAN_ASSET_PATH_INVALID:${asset.path}`);
    const current = await optionalRead(asset.path);
    if (
      current !== undefined &&
      digest(current) !== asset.sha256 &&
      digest(current) !== previous?.files[asset.path]
    )
      throw new Error(`INSTALL_CONFLICT:${asset.path}`);
  }
  if (
    new Set(plan.fileMutations.map((asset) => asset.path)).size !==
    plan.fileMutations.length
  )
    throw new Error("INSTALL_PLAN_ASSET_PATH_DUPLICATE");
  const nativeBridge = plan.fileMutations.find((asset) =>
    asset.path.endsWith("/plugins/pulso-protocol-guard.js"),
  );
  if (!nativeBridge?.content.includes(buildId))
    throw new Error("INSTALL_PLAN_NATIVE_BRIDGE_INVALID");
  const configOriginal = await optionalRead(configMutation.path);
  const configRaw = configOriginal ?? "{}\n";
  const parsed = parseJsonc(configRaw);
  if (mcpMutation && parsed.mcp !== undefined && !isRecord(parsed.mcp))
    throw new Error("OPENCODE_MCP_CONFIG_INVALID");
  if (
    parsed.plugin !== undefined &&
    (!Array.isArray(parsed.plugin) ||
      !parsed.plugin.every((entry) => typeof entry === "string"))
  )
    throw new Error("OPENCODE_PLUGIN_CONFIG_INVALID");
  const plannedPlugins = configMutation.value;
  if (
    !Array.isArray(plannedPlugins) ||
    !plannedPlugins.every((entry) => typeof entry === "string") ||
    !plannedPlugins.includes(managedBridgePlugin)
  )
    throw new Error("INSTALL_PLAN_STALE");
  const currentPlugins = (parsed.plugin as string[] | undefined) ?? [];
  const effectivePluginConfig = currentPlugins.includes(managedBridgePlugin)
    ? currentPlugins
    : [...currentPlugins, managedBridgePlugin];
  // Re-read every effective source after planning and immediately before writes.
  await assertNoDuplicateNativeBridge(options, configMutation.path);
  if (mcpMutation) {
    const currentMcp = isRecord(parsed.mcp) ? parsed.mcp.pulso : undefined;
    if (
      currentMcp === undefined ||
      digest(JSON.stringify(currentMcp)) !==
        managedConfigHash(previous, mcpMutation.path, "mcp.pulso")
    )
      throw new Error(`INSTALL_CONFLICT:${configMutation.path}#mcp.pulso`);
  }
  let configText: string;
  if (configRaw.trim() === "{}" || configRaw.trim() === "{}\n")
    configText = `${JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: configMutation.value }, null, 2)}\n`;
  else {
    configText = applyEdits(
      configRaw,
      modify(configRaw, ["plugin"], effectivePluginConfig, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    if (mcpMutation)
      configText = applyEdits(
        configText,
        modify(configText, ["mcp", "pulso"], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
  }
  const configEntries = { ...(previous?.configEntries ?? {}) };
  delete configEntries[configMutation.path];
  delete configEntries[configEntryKey(configMutation.path, "mcp.pulso")];
  configEntries[configEntryKey(configMutation.path, "plugin")] = digest(
    JSON.stringify(effectivePluginConfig),
  );
  const manifest: OpenCodeManifest = {
    version: 5,
    runtime: "opencode",
    scope: options.scope,
    ...(options.version ? { runtimeVersion: options.version } : {}),
    files: Object.fromEntries(
      orderedAssetHashes(plan.fileMutations).map(({ path, sha256 }) => [
        path,
        sha256,
      ]),
    ),
    assetHashes: orderedAssetHashes(plan.fileMutations),
    sourceHashes: [...sourceHashes].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    configEntries,
    ...(options.modelConfig
      ? {
          modelProfile: options.modelConfig.profile,
          resolvedModels: options.modelConfig.agents,
        }
      : {}),
    buildId,
    nativeBridge: {
      path: nativeBridge.path,
      sha256: nativeBridge.sha256,
      version: "1.18.32",
      role: "native-bridge",
    },
  };
  const stagingRoot = join(
    dirname(previousManifestPath),
    ".pulso-staging",
    `${buildId}-${crypto.randomUUID()}`,
  );
  const stagedAssets = plan.fileMutations.map((asset) => ({
    asset,
    path: join(stagingRoot, relative(root, asset.path)),
  }));
  const stagedConfigPath = join(stagingRoot, "opencode.json");
  const stagedManifestPath = join(stagingRoot, ".pulso-manifest.json");
  const publish = async (source: string, destination: string) => {
    await mkdir(dirname(destination), { recursive: true });
    await rename(source, destination);
  };
  const snapshots = await Promise.all(
    [
      ...new Set([
        ...plan.fileMutations.map((asset) => asset.path),
        configMutation.path,
        previousManifestPath,
      ]),
    ].map(async (path) => ({ path, content: await optionalRead(path) })),
  );
  const rollback = async () => {
    for (const snapshot of snapshots) {
      if (snapshot.content === undefined)
        await rm(snapshot.path, { force: true });
      else await atomicWrite(snapshot.path, snapshot.content);
    }
  };
  let publicationStarted = false;
  try {
    for (const staged of stagedAssets)
      await atomicWrite(staged.path, staged.asset.content);
    await atomicWrite(stagedConfigPath, configText);
    await atomicWrite(
      stagedManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    for (const staged of stagedAssets)
      if (digest(await readFile(staged.path, "utf8")) !== staged.asset.sha256)
        throw new Error(`INSTALL_STAGING_HASH_MISMATCH:${staged.asset.path}`);
    const stagedManifest = JSON.parse(
      await readFile(stagedManifestPath, "utf8"),
    ) as OpenCodeManifest;
    if (
      stagedManifest.buildId !== buildId ||
      stagedManifest.nativeBridge.path !== nativeBridge.path ||
      stagedManifest.nativeBridge.sha256 !== nativeBridge.sha256 ||
      stagedManifest.nativeBridge.version !== "1.18.32"
    )
      throw new Error("INSTALL_STAGING_MANIFEST_INVALID");
    await hooks.beforeActivation?.();
    if ((await optionalRead(configMutation.path)) !== configOriginal)
      throw new Error(`INSTALL_CONFLICT:${configMutation.path}#plugin`);
    const stagedBridge = stagedAssets.find(
      (staged) => staged.asset.path === nativeBridge.path,
    );
    if (!stagedBridge) throw new Error("INSTALL_STAGING_NATIVE_BRIDGE_MISSING");
    publicationStarted = true;
    await publish(stagedBridge.path, nativeBridge.path);
    await hooks.afterBridgePublish?.();
    for (const staged of stagedAssets)
      if (staged.asset.path !== nativeBridge.path)
        await publish(staged.path, staged.asset.path);
    await publish(stagedConfigPath, configMutation.path);
    // The manifest switch is the sole point that permits the new bridge to run.
    await publish(stagedManifestPath, previousManifestPath);
  } catch (error) {
    if (publicationStarted)
      try {
        await rollback();
      } catch (rollbackError) {
        throw new Error(
          `INSTALL_PARTIAL_FAILURE:${error instanceof Error ? error.message : String(error)}:ROLLBACK_FAILED:${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    throw new Error(
      `INSTALL_PARTIAL_FAILURE:${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  return {
    installedFiles: plan.fileMutations.map((asset) => asset.path),
    configPath: configMutation.path,
    manifestPath: previousManifestPath,
  };
};

export const reconfigureOpenCodeModels = async (options: {
  scope: InstallScope;
  workspace?: string;
  homeDir?: string;
  executable: string;
  modelConfig: ResolvedAgentModelConfig;
  discovery?: Pick<OpenCodeDiscovery, "models">;
}) => {
  if (Object.values(options.modelConfig.agents).some((id) => id !== null)) {
    const catalog = await (options.discovery ?? new OpenCodeDiscovery()).models(
      options.executable,
    );
    const missing = Object.values(options.modelConfig.agents).filter(
      (id): id is string =>
        id !== null && !catalog.some((model) => model.id === id),
    );
    if (missing.length)
      throw new Error(`MODEL_CATALOG_STALE:${[...new Set(missing)].join(",")}`);
  }
  const root =
    options.scope === "local"
      ? resolve(options.workspace ?? process.cwd())
      : resolve(options.homeDir ?? homedir(), ".config", "opencode");
  const manifestPath = manifestPathForScope(root, options.scope);
  const source = await optionalRead(manifestPath);
  if (!source) throw new Error("OPENCODE_MANIFEST_MISSING");
  const manifest = JSON.parse(source) as OpenCodeManifest;
  if (
    !validManifestVersion(manifest.version) ||
    manifest.runtime !== "opencode" ||
    manifest.scope !== options.scope
  )
    throw new Error("INSTALL_MANIFEST_INVALID");
  if (!manifest.buildId) throw new Error("OPENCODE_MANIFEST_BUILD_ID_MISSING");
  const sourceHashes = await openCodeBuildSources();
  const buildId = buildIdFromSources(sourceHashes);
  const manifestSources = manifest.sourceHashes ?? [];
  const sourcesMatch =
    manifestSources.length === sourceHashes.length &&
    manifestSources.every(
      (source, index) =>
        source.path === sourceHashes[index]?.path &&
        source.sha256 === sourceHashes[index]?.sha256,
    );
  if (manifest.buildId !== buildId || !sourcesMatch)
    throw new Error(
      `OPENCODE_BUILD_DRIFT:manifest=${manifest.buildId},current=${buildId}:REINSTALL_REQUIRED`,
    );
  const agentRoot =
    options.scope === "local"
      ? join(root, ".opencode", "agents")
      : join(root, "agents");
  const planned = agentIds.map((id) => {
    const path = join(agentRoot, `${id}.md`);
    const currentHash = manifest.files[path];
    if (!currentHash) throw new Error(`OPENCODE_MANAGED_AGENT_MISSING:${id}`);
    const content = openCodeRuntime.renderAgent(agentDefinitions[id], {
      model: options.modelConfig.agents[id],
      buildId: manifest.buildId,
    }).content;
    return {
      id,
      path,
      content,
      sha256: digest(content),
      expectedHash: currentHash,
    };
  });
  for (const asset of planned) {
    const current = await optionalRead(asset.path);
    if (current === undefined || digest(current) !== asset.expectedHash)
      throw new Error(`INSTALL_CONFLICT:${asset.path}`);
  }
  for (const asset of planned) await atomicWrite(asset.path, asset.content);
  for (const asset of planned) manifest.files[asset.path] = asset.sha256;
  const assetHashes = new Map<string, string>();
  for (const entry of manifest.assetHashes ?? [])
    assetHashes.set(entry.path, entry.sha256);
  if (!manifest.assetHashes)
    for (const [path, sha256] of Object.entries(manifest.files))
      assetHashes.set(path, sha256);
  for (const asset of planned) assetHashes.set(asset.path, asset.sha256);
  manifest.assetHashes = [...assetHashes]
    .map(([path, sha256]) => ({ path, sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
  manifest.modelProfile = options.modelConfig.profile;
  manifest.resolvedModels = options.modelConfig.agents;
  await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { updatedAgents: planned.map((asset) => asset.path), manifestPath };
};

export const uninstallOpenCode = async (options: {
  scope: InstallScope;
  workspace?: string;
  homeDir?: string;
  dryRun?: boolean;
}) => {
  const root =
    options.scope === "local"
      ? resolve(options.workspace ?? process.cwd())
      : resolve(options.homeDir ?? homedir(), ".config", "opencode");
  const manifestPath =
    options.scope === "local"
      ? join(root, ".opencode", ".pulso-manifest.json")
      : join(root, ".pulso-manifest.json");
  const source = await optionalRead(manifestPath);
  if (!source)
    return { removedFiles: [] as string[], conflicts: [] as string[] };
  const manifest = JSON.parse(source) as OpenCodeManifest;
  if (
    !validManifestVersion(manifest.version) ||
    manifest.runtime !== "opencode" ||
    manifest.scope !== options.scope
  )
    throw new Error("INSTALL_MANIFEST_INVALID");
  const conflicts: string[] = [];
  for (const [path, expected] of Object.entries(manifest.files)) {
    if (protectedWorkspaceFile(path)) {
      conflicts.push(path);
      continue;
    }
    const current = await optionalRead(path);
    if (current !== undefined && digest(current) !== expected)
      conflicts.push(path);
  }
  const managedConfigEntries = Object.entries(manifest.configEntries).map(
    ([entry, expected]) => ({
      ...managedConfigEntry(manifest, entry),
      expected,
    }),
  );
  for (const entry of managedConfigEntries) {
    const sourceConfig = await optionalRead(entry.path);
    if (!sourceConfig) continue;
    const config = parseJsonc(sourceConfig);
    const value =
      entry.key === "plugin"
        ? config.plugin
        : isRecord(config.mcp)
          ? config.mcp.pulso
          : undefined;
    if (value !== undefined && digest(JSON.stringify(value)) !== entry.expected)
      conflicts.push(`${entry.path}#${entry.key}`);
  }
  if (conflicts.length) return { removedFiles: [] as string[], conflicts };
  if (options.dryRun)
    return {
      removedFiles: Object.keys(manifest.files).filter(
        (path) => !protectedWorkspaceFile(path),
      ),
      conflicts: [] as string[],
    };
  for (const path of Object.keys(manifest.files))
    if (!protectedWorkspaceFile(path)) await rm(path, { force: true });
  const configKeys = new Map<string, Set<"plugin" | "mcp.pulso">>();
  for (const entry of managedConfigEntries) {
    const keys =
      configKeys.get(entry.path) ?? new Set<"plugin" | "mcp.pulso">();
    keys.add(entry.key);
    configKeys.set(entry.path, keys);
  }
  for (const [path, keys] of configKeys) {
    const sourceConfig = await optionalRead(path);
    if (!sourceConfig) continue;
    let updated = sourceConfig;
    if (keys.has("plugin")) {
      const config = parseJsonc(updated);
      const plugins = Array.isArray(config.plugin) ? config.plugin : undefined;
      if (plugins) {
        const remaining = plugins.filter(
          (entry) => entry !== managedBridgePlugin,
        );
        updated = applyEdits(
          updated,
          modify(updated, ["plugin"], remaining, {
            formattingOptions: { insertSpaces: true, tabSize: 2 },
          }),
        );
      }
    }
    if (keys.has("mcp.pulso"))
      updated = applyEdits(
        updated,
        modify(updated, ["mcp", "pulso"], undefined, {
          formattingOptions: { insertSpaces: true, tabSize: 2 },
        }),
      );
    await atomicWrite(path, updated);
  }
  await rm(manifestPath, { force: true });
  return {
    removedFiles: Object.keys(manifest.files).filter(
      (path) => !protectedWorkspaceFile(path),
    ),
    conflicts: [] as string[],
  };
};

export const openCodeModelCatalog = (catalog: AvailableModel[]) => catalog;
