import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  discovery?: OpenCodeDiscovery;
}
export interface OpenCodeManifest {
  version: 1;
  runtime: "opencode";
  scope: InstallScope;
  runtimeVersion?: string;
  files: Record<string, string>;
  configEntries: Record<string, string>;
  modelProfile?: string;
  resolvedModels?: Record<AgentId, string | null>;
  protocolGuard?: { path: string; sha256: string; version: 2 };
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
export const planOpenCodeInstall = async (
  options: OpenCodeInstallOptions,
): Promise<InstallationPlan> => {
  const root =
    options.scope === "local"
      ? resolve(options.workspace ?? process.cwd())
      : resolve(options.homeDir ?? homedir(), ".config", "opencode");
  const renderedConfig = openCodeRuntime.buildRuntimeConfig({
    scope: options.scope,
    mcpCommand: options.mcpCommand,
    ...(options.scope === "local" ? { mcpCwd: root } : {}),
  })[0];
  if (!renderedConfig) throw new Error("OPENCODE_CONFIG_RENDERER_EMPTY");
  const configPath = join(root, renderedConfig.path);
  const manifestPath =
    options.scope === "local"
      ? join(root, ".opencode", ".pulso-manifest.json")
      : join(root, ".pulso-manifest.json");
  const previous = await optionalRead(manifestPath);
  let previousManifest: OpenCodeManifest | undefined;
  if (previous) {
    try {
      previousManifest = JSON.parse(previous) as OpenCodeManifest;
      if (
        previousManifest.version !== 1 ||
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
    }).content;
    const path = join(agentDir, `${id}.md`);
    assets.push({ path, content, sha256: digest(content) });
  }
  for (const skill of options.skills) {
    const rendered = openCodeRuntime.renderSkill(skill);
    const path = join(skillDir, rendered.path);
    assets.push({
      path,
      content: rendered.content,
      sha256: digest(rendered.content),
    });
  }
  const pluginBuild = await Bun.build({
    entrypoints: [
      fileURLToPath(
        new URL(
          "../../../orchestration/src/runtimes/opencode/protocol-guard/plugin.ts",
          import.meta.url,
        ),
      ),
    ],
    target: "bun",
    format: "esm",
    minify: true,
    write: false,
  } as Parameters<typeof Bun.build>[0] & { write: false });
  if (!pluginBuild.success || !pluginBuild.outputs[0])
    throw new Error("OPENCODE_PROTOCOL_GUARD_BUILD_FAILED");
  const guardPath = join(
    options.scope === "local" ? join(root, ".opencode") : root,
    "plugins",
    "pulso-protocol-guard.js",
  );
  const guardContent = await pluginBuild.outputs[0].text();
  assets.push({
    path: guardPath,
    content: guardContent,
    sha256: digest(guardContent),
  });
  const configRaw = await optionalRead(configPath);
  const config = configRaw ? parseJsonc(configRaw) : {};
  const mcp = (
    config.mcp && typeof config.mcp === "object" ? config.mcp : {}
  ) as Record<string, unknown>;
  const renderedValue = JSON.parse(renderedConfig.content) as {
    mcp?: Record<string, unknown>;
  };
  const pulsoConfig = renderedValue.mcp?.pulso;
  if (!pulsoConfig) throw new Error("OPENCODE_MCP_RENDER_FAILED");
  const currentEntry = mcp.pulso;
  const existingManagedHash = previousManifest?.configEntries[configPath];
  if (
    currentEntry !== undefined &&
    digest(JSON.stringify(currentEntry)) !==
      digest(JSON.stringify(pulsoConfig)) &&
    digest(JSON.stringify(currentEntry)) !== existingManagedHash
  )
    throw new Error(`INSTALL_CONFLICT:${configPath}#mcp.pulso`);
  const mutation: PlannedConfigMutation = {
    path: configPath,
    key: "mcp.pulso",
    value: pulsoConfig,
    ...(currentEntry === undefined
      ? {}
      : { previousHash: digest(JSON.stringify(currentEntry)) }),
  };
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
    ...(options.version ? { runtimeVersion: options.version } : {}),
    assets,
    config: [mutation],
    ...(options.modelConfig ? { modelConfig: options.modelConfig } : {}),
  };
  const plan: InstallationPlan = {
    runtimes: [runtimePlan],
    scope: options.scope,
    fileMutations: assets,
    configMutations: [mutation],
    warnings: [],
  };
  return plan;
};

export const applyOpenCodeInstall = async (
  options: OpenCodeInstallOptions,
  plan: InstallationPlan,
) => {
  if (
    plan.scope !== options.scope ||
    plan.runtimes.length !== 1 ||
    plan.runtimes[0]?.runtime !== "opencode"
  )
    throw new Error("INSTALL_PLAN_STALE");
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
  const previousManifestPath =
    options.scope === "local"
      ? join(
          resolve(options.workspace ?? process.cwd()),
          ".opencode",
          ".pulso-manifest.json",
        )
      : join(
          resolve(options.homeDir ?? homedir(), ".config", "opencode"),
          ".pulso-manifest.json",
        );
  const previousRaw = await optionalRead(previousManifestPath);
  const previous = previousRaw
    ? (JSON.parse(previousRaw) as OpenCodeManifest)
    : undefined;
  if (
    previous &&
    (previous.version !== 1 ||
      previous.runtime !== "opencode" ||
      previous.scope !== options.scope)
  )
    throw new Error("INSTALL_MANIFEST_INVALID");
  for (const asset of plan.fileMutations) {
    const current = await optionalRead(asset.path);
    if (
      current !== undefined &&
      digest(current) !== asset.sha256 &&
      digest(current) !== previous?.files[asset.path]
    )
      throw new Error(`INSTALL_CONFLICT:${asset.path}`);
  }
  const configMutation = plan.configMutations[0];
  if (!configMutation) throw new Error("INSTALL_CONFIG_MUTATION_MISSING");
  const configRaw = (await optionalRead(configMutation.path)) ?? "{}\n";
  const parsed = parseJsonc(configRaw);
  const current = (parsed.mcp as Record<string, unknown> | undefined)?.pulso;
  if (
    current !== undefined &&
    digest(JSON.stringify(current)) !==
      digest(JSON.stringify(configMutation.value)) &&
    digest(JSON.stringify(current)) !==
      previous?.configEntries[configMutation.path]
  )
    throw new Error(`INSTALL_CONFLICT:${configMutation.path}#mcp.pulso`);
  let configText: string;
  if (configRaw.trim() === "{}" || configRaw.trim() === "{}\n")
    configText = `${JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { pulso: configMutation.value } }, null, 2)}\n`;
  else if (!parsed.mcp || typeof parsed.mcp !== "object")
    configText = applyEdits(
      configRaw,
      modify(
        configRaw,
        ["mcp"],
        { pulso: configMutation.value },
        { formattingOptions: { insertSpaces: true, tabSize: 2 } },
      ),
    );
  else
    configText = applyEdits(
      configRaw,
      modify(configRaw, ["mcp", "pulso"], configMutation.value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
  try {
    for (const asset of plan.fileMutations)
      await atomicWrite(asset.path, asset.content);
    await atomicWrite(configMutation.path, configText);
    const manifest: OpenCodeManifest = {
      version: 1,
      runtime: "opencode",
      scope: options.scope,
      ...(options.version ? { runtimeVersion: options.version } : {}),
      files: Object.fromEntries(
        plan.fileMutations.map((asset) => [asset.path, asset.sha256]),
      ),
      configEntries: {
        [configMutation.path]: digest(JSON.stringify(configMutation.value)),
        ...(previous?.configEntries ?? {}),
      },
      ...(options.modelConfig
        ? {
            modelProfile: options.modelConfig.profile,
            resolvedModels: options.modelConfig.agents,
          }
        : {}),
      protocolGuard: {
        path:
          plan.fileMutations.find((asset) =>
            asset.path.endsWith("/plugins/pulso-protocol-guard.js"),
          )?.path ?? "",
        sha256:
          plan.fileMutations.find((asset) =>
            asset.path.endsWith("/plugins/pulso-protocol-guard.js"),
          )?.sha256 ?? "",
        version: 2,
      },
    };
    await atomicWrite(
      previousManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } catch (error) {
    throw new Error(
      `INSTALL_PARTIAL_FAILURE:${error instanceof Error ? error.message : String(error)}`,
    );
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
  discovery?: OpenCodeDiscovery;
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
  const manifestPath =
    options.scope === "local"
      ? join(root, ".opencode", ".pulso-manifest.json")
      : join(root, ".pulso-manifest.json");
  const source = await optionalRead(manifestPath);
  if (!source) throw new Error("OPENCODE_MANIFEST_MISSING");
  const manifest = JSON.parse(source) as OpenCodeManifest;
  if (
    manifest.version !== 1 ||
    manifest.runtime !== "opencode" ||
    manifest.scope !== options.scope
  )
    throw new Error("INSTALL_MANIFEST_INVALID");
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
    manifest.version !== 1 ||
    manifest.runtime !== "opencode" ||
    manifest.scope !== options.scope
  )
    throw new Error("INSTALL_MANIFEST_INVALID");
  const conflicts: string[] = [];
  for (const [path, expected] of Object.entries(manifest.files)) {
    const current = await optionalRead(path);
    if (current !== undefined && digest(current) !== expected)
      conflicts.push(path);
  }
  for (const [path, expected] of Object.entries(manifest.configEntries)) {
    const sourceConfig = await optionalRead(path);
    if (!sourceConfig) continue;
    const config = parseJsonc(sourceConfig);
    const entry = (config.mcp as Record<string, unknown> | undefined)?.pulso;
    if (entry !== undefined && digest(JSON.stringify(entry)) !== expected)
      conflicts.push(`${path}#mcp.pulso`);
  }
  if (conflicts.length) return { removedFiles: [] as string[], conflicts };
  if (options.dryRun)
    return {
      removedFiles: Object.keys(manifest.files),
      conflicts: [] as string[],
    };
  for (const path of Object.keys(manifest.files))
    await rm(path, { force: true });
  for (const [path] of Object.entries(manifest.configEntries)) {
    const sourceConfig = await optionalRead(path);
    if (!sourceConfig) continue;
    const config = parseJsonc(sourceConfig);
    const mcp = config.mcp as Record<string, unknown> | undefined;
    if (!mcp?.pulso) continue;
    const updated = applyEdits(
      sourceConfig,
      modify(sourceConfig, ["mcp", "pulso"], undefined, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      }),
    );
    await atomicWrite(path, updated);
  }
  await rm(manifestPath, { force: true });
  return {
    removedFiles: Object.keys(manifest.files),
    conflicts: [] as string[],
  };
};

export const openCodeModelCatalog = (catalog: AvailableModel[]) => catalog;
