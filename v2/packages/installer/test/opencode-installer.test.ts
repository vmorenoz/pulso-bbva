import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "jsonc-parser";
import type { CanonicalSkill } from "../../orchestration/src/runtimes/types";
import {
  applyOpenCodeInstall,
  planOpenCodeInstall,
  reconfigureOpenCodeModels,
  uninstallOpenCode,
} from "../src/runtimes/opencode-installer";

const skills: CanonicalSkill[] = [
  {
    id: "bbva-engineering",
    content: "---\nname: bbva-engineering\n---\nSkill body\n",
  },
];
const withTemp = async (callback: (root: string) => Promise<void>) => {
  const root = await mkdtemp(join(tmpdir(), "pulso-opencode-installer-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test("local install preserves JSONC comments and unrelated MCP configuration, then uninstalls only Pulso assets", async () =>
  withTemp(async (workspace) => {
    const config = join(workspace, ".opencode", "opencode.json");
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      config,
      '{\n  // Keep user MCP configuration\n  "provider": { "other": true },\n  "mcp": { "other": { "type": "remote", "url": "https://example.test/mcp" } },\n}\n',
    );
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["/usr/bin/node", "/pulso/mcp.js"],
      version: "1.18.32",
      skills,
    };
    const plan = await planOpenCodeInstall(options);
    const sources = plan.runtimes[0]?.sourceHashes ?? [];
    expect(
      sources.some(
        (source) =>
          source.path ===
          "packages/capabilities-mcp/src/opencode/native-work-service.ts",
      ),
    ).toBe(true);
    expect(sources.map((source) => source.path)).toEqual(
      [...sources.map((source) => source.path)].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
    await mkdir(join(workspace, ".opencode", "agents"), { recursive: true });
    expect(
      plan.fileMutations
        .map((file) => file.path)
        .some((path) => path.includes(".opencode/agents/pulso.md")),
    ).toBe(true);
    const guard = plan.fileMutations.find((file) =>
      file.path.endsWith("/plugins/pulso-protocol-guard.js"),
    );
    expect(guard).toBeDefined();
    expect(plan.fileMutations.some((file) => file.path.includes("/mcp/"))).toBe(
      false,
    );
    expect(guard?.content).not.toContain("packages/orchestration/src");
    await applyOpenCodeInstall(options, plan);
    if (!guard) throw new Error("OPENCODE_PROTOCOL_GUARD_ASSET_MISSING");
    const installedPlugin = await import(pathToFileURL(guard.path).href);
    expect(typeof installedPlugin.default).toBe("function");
    const manifest = JSON.parse(
      await readFile(
        join(workspace, ".opencode", ".pulso-manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.nativeBridge.sha256).toBe(guard?.sha256);
    expect(manifest.nativeBridge.role).toBe("native-bridge");
    expect(manifest).not.toHaveProperty("mcp");
    expect(manifest.version).toBe(5);
    expect(
      manifest.sourceHashes.map((source: { path: string }) => source.path),
    ).toEqual(sources.map((source) => source.path));
    expect(
      manifest.assetHashes.map((asset: { path: string }) => asset.path),
    ).toEqual(
      [
        ...manifest.assetHashes.map((asset: { path: string }) => asset.path),
      ].sort((left: string, right: string) => left.localeCompare(right)),
    );
    const unrelatedPlugin = join(
      workspace,
      ".opencode",
      "plugins",
      "foreign.js",
    );
    await writeFile(
      unrelatedPlugin,
      "export const Foreign = async () => ({})\n",
    );
    const installed = await readFile(config, "utf8");
    expect(installed).toContain("// Keep user MCP configuration");
    expect(installed).toContain('"other"');
    expect(installed).toContain('"plugin": [');
    expect(installed).toContain("pulso-protocol-guard.js");
    expect(parse(installed).mcp).toEqual({
      other: { type: "remote", url: "https://example.test/mcp" },
    });
    const repeatedPlan = await planOpenCodeInstall(options);
    await applyOpenCodeInstall(options, repeatedPlan);
    const result = await uninstallOpenCode({ scope: "local", workspace });
    expect(result.conflicts).toEqual([]);
    expect(await readFile(unrelatedPlugin, "utf8")).toContain("Foreign");
    expect(await readFile(config, "utf8")).toContain('"other"');
  }));

test("global OpenCode plan uses only the official user-level asset locations", async () =>
  withTemp(async (homeDir) => {
    const plan = await planOpenCodeInstall({
      scope: "global",
      homeDir,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    });
    expect(
      plan.fileMutations.some((asset) =>
        asset.path.includes("/.config/opencode/agents/pulso.md"),
      ),
    ).toBe(true);
    expect(
      plan.fileMutations.some((asset) =>
        asset.path.includes(
          "/.config/opencode/plugins/pulso-protocol-guard.js",
        ),
      ),
    ).toBe(true);
    expect(
      plan.fileMutations.some((asset) =>
        asset.path.includes(
          "/.config/opencode/skills/bbva-engineering/SKILL.md",
        ),
      ),
    ).toBe(true);
    expect(plan.configMutations[0]?.path).toBe(
      join(homeDir, ".config", "opencode", "opencode.json"),
    );
  }));

test("global install rebases the plugin list and preserves changes made while the wizard was open", async () =>
  withTemp(async (homeDir) => {
    const globalRoot = join(homeDir, ".config", "opencode");
    const configPath = join(globalRoot, "opencode.json");
    const manifestPath = join(globalRoot, ".pulso-manifest.json");
    await mkdir(globalRoot, { recursive: true });
    await writeFile(
      configPath,
      '{\n  // User-managed plugin and provider entries survive Pulso install.\n  "plugin": ["./plugins/user-a.js"],\n  "provider": { "custom": { "name": "keep" } }\n}\n',
    );
    const options = {
      scope: "global" as const,
      homeDir,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    const plan = await planOpenCodeInstall(options);

    const concurrentConfig =
      '{\n  // A plugin was added while the installer awaited confirmation.\n  "plugin": ["./plugins/user-a.js", "./plugins/user-b.js"],\n  "provider": { "custom": { "name": "keep" } }\n}\n';
    await writeFile(configPath, concurrentConfig);
    await applyOpenCodeInstall(options, plan);

    const installedRaw = await readFile(configPath, "utf8");
    const installedConfig = parse(installedRaw);
    expect(installedConfig.plugin).toEqual([
      "./plugins/user-a.js",
      "./plugins/user-b.js",
      "./plugins/pulso-protocol-guard.js",
    ]);
    expect(installedConfig.provider).toEqual({
      custom: { name: "keep" },
    });
    expect(installedRaw).toContain(
      "A plugin was added while the installer awaited confirmation.",
    );
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.configEntries[`${configPath}#plugin`]).toBe(
      createHash("sha256")
        .update(JSON.stringify(installedConfig.plugin))
        .digest("hex"),
    );
  }));

test("a config edit during staged publication aborts without overwriting it", async () =>
  withTemp(async (homeDir) => {
    const globalRoot = join(homeDir, ".config", "opencode");
    const configPath = join(globalRoot, "opencode.json");
    const manifestPath = join(globalRoot, ".pulso-manifest.json");
    await mkdir(globalRoot, { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({ plugin: ["./user.js"] })}\n`,
    );
    const options = {
      scope: "global" as const,
      homeDir,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    const plan = await planOpenCodeInstall(options);
    const concurrentConfig = `${JSON.stringify({
      plugin: ["./user.js", "./new-user-plugin.js"],
      provider: { custom: { name: "latest" } },
    })}\n`;

    await expect(
      applyOpenCodeInstall(options, plan, {
        beforeActivation: () => writeFile(configPath, concurrentConfig),
      }),
    ).rejects.toThrow("INSTALL_PARTIAL_FAILURE:INSTALL_CONFLICT:");
    expect(await readFile(configPath, "utf8")).toBe(concurrentConfig);
    await expect(readFile(manifestPath, "utf8")).rejects.toThrow();
    await expect(
      readFile(join(globalRoot, "plugins", "pulso-protocol-guard.js"), "utf8"),
    ).rejects.toThrow();
  }));

test("rejects a local managed bridge when a global native bridge is already active", async () =>
  withTemp(async (homeDir) => {
    const workspace = await mkdtemp(
      join(tmpdir(), "pulso-opencode-duplicate-"),
    );
    try {
      const global = {
        scope: "global" as const,
        homeDir,
        executable: "/bin/opencode",
        mcpCommand: ["node", "mcp.js"],
        skills: [],
      };
      await applyOpenCodeInstall(global, await planOpenCodeInstall(global));
      await expect(
        planOpenCodeInstall({
          ...global,
          scope: "local",
          workspace,
        }),
      ).rejects.toThrow("DUPLICATE_NATIVE_BRIDGE");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }));

test("rejects duplicate bridge registrations in either effective OpenCode config", async () =>
  withTemp(async (homeDir) => {
    const workspace = await mkdtemp(
      join(tmpdir(), "pulso-opencode-config-duplicate-"),
    );
    try {
      const globalConfig = join(
        homeDir,
        ".config",
        "opencode",
        "opencode.json",
      );
      await mkdir(join(homeDir, ".config", "opencode"), { recursive: true });
      await writeFile(
        globalConfig,
        JSON.stringify({
          plugin: [
            "./plugins/pulso-protocol-guard.js",
            "./plugins/pulso-protocol-guard.js",
          ],
        }),
      );
      await expect(
        planOpenCodeInstall({
          scope: "local",
          workspace,
          homeDir,
          executable: "/bin/opencode",
          mcpCommand: ["node", "mcp.js"],
          skills: [],
        }),
      ).rejects.toThrow("DUPLICATE_NATIVE_BRIDGE");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }));

test("generated OpenCode CP2 asset activates only the managed native bridge", async () =>
  withTemp(async (workspace) => {
    const plan = await planOpenCodeInstall({
      scope: "local",
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills: [],
    });
    const pulso = plan.fileMutations.find((asset) =>
      asset.path.endsWith("/agents/pulso.md"),
    )?.content;
    expect(pulso).toBeDefined();
    expect(pulso).toContain('"*": deny');
    expect(pulso).not.toMatch(/^\s+\*: deny$/m);
    expect(pulso).toContain('"pulso_native_work": deny');
    expect(pulso).toContain('"pulso_native_prepare": deny');
    expect(pulso).toContain('"pulso_native_status": deny');
    expect(pulso).toContain('"planner": allow');
    expect(pulso).toContain('"security-auditor": allow');
    expect(pulso).not.toContain("pulso_*: allow");
    expect(pulso).toContain("pulso_prepare resuelve el Work");
    expect(pulso).toContain(
      `pulso-build-id:${plan.runtimes[0]?.buildId ?? "missing"}`,
    );
    expect(pulso).not.toMatch(/\bmcp\b/i);
    expect(plan.configMutations).toHaveLength(1);
    expect(plan.configMutations[0]).toMatchObject({
      key: "plugin",
      value: ["./plugins/pulso-protocol-guard.js"],
    });
    const bridge = plan.fileMutations.find((asset) =>
      asset.path.endsWith("/plugins/pulso-protocol-guard.js"),
    );
    expect(bridge?.content).toContain(plan.runtimes[0]?.buildId ?? "missing");
  }));

test("upgrades an unmodified v1 Pulso MCP entry to the managed native bridge without retaining it", async () =>
  withTemp(async (workspace) => {
    const configPath = join(workspace, ".opencode", "opencode.json");
    const manifestPath = join(workspace, ".opencode", ".pulso-manifest.json");
    const legacyMcp = {
      type: "local",
      command: ["node", "pulso-mcp.js"],
    };
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify({ mcp: { pulso: legacyMcp, other: { type: "remote" } } }, null, 2)}\n`,
    );
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        version: 1,
        runtime: "opencode",
        scope: "local",
        files: {},
        configEntries: {
          [configPath]: createHash("sha256")
            .update(JSON.stringify(legacyMcp))
            .digest("hex"),
        },
      })}\n`,
    );
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "pulso-mcp.js"],
      skills: [],
    };
    await applyOpenCodeInstall(options, await planOpenCodeInstall(options));
    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.mcp).toHaveProperty("other");
    expect(config.plugin).toEqual(["./plugins/pulso-protocol-guard.js"]);
    expect(config.mcp).not.toHaveProperty("pulso");
    expect(JSON.parse(await readFile(manifestPath, "utf8")).version).toBe(5);
  }));

test("rolls back a published bridge before manifest activation and keeps the prior build loadable", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    await applyOpenCodeInstall(options, await planOpenCodeInstall(options));
    const configPath = join(workspace, ".opencode", "opencode.json");
    const manifestPath = join(workspace, ".opencode", ".pulso-manifest.json");
    const skillPath = join(
      workspace,
      ".opencode",
      "skills",
      "bbva-engineering",
      "SKILL.md",
    );
    const guardPath = join(
      workspace,
      ".opencode",
      "plugins",
      "pulso-protocol-guard.js",
    );
    const [configBefore, manifestBefore, skillBefore, guardBefore] =
      await Promise.all([
        readFile(configPath, "utf8"),
        readFile(manifestPath, "utf8"),
        readFile(skillPath, "utf8"),
        readFile(guardPath, "utf8"),
      ]);
    const changedPlan = await planOpenCodeInstall({
      ...options,
      skills: [
        {
          ...skills[0],
          content: "---\nname: bbva-engineering\n---\nChanged\n",
        },
      ],
    });
    const stagedBridge = changedPlan.fileMutations.find((asset) =>
      asset.path.endsWith("/plugins/pulso-protocol-guard.js"),
    );
    if (!stagedBridge) throw new Error("OPENCODE_PROTOCOL_GUARD_ASSET_MISSING");
    stagedBridge.content = `${stagedBridge.content}\n// staged bridge\n`;
    stagedBridge.sha256 = createHash("sha256")
      .update(stagedBridge.content)
      .digest("hex");

    await expect(
      applyOpenCodeInstall(options, changedPlan, {
        afterBridgePublish: () => {
          throw new Error("simulated_publish_failure");
        },
      }),
    ).rejects.toThrow("INSTALL_PARTIAL_FAILURE:simulated_publish_failure");
    await expect(readFile(configPath, "utf8")).resolves.toBe(configBefore);
    await expect(readFile(manifestPath, "utf8")).resolves.toBe(manifestBefore);
    await expect(readFile(skillPath, "utf8")).resolves.toBe(skillBefore);
    await expect(readFile(guardPath, "utf8")).resolves.toBe(guardBefore);
    const restoredPlugin = await import(pathToFileURL(guardPath).href);
    await expect(restoredPlugin.default({})).resolves.toBeDefined();
  }));

test("the installed native bridge fails closed when a managed asset is from another build", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills: [],
    };
    const plan = await planOpenCodeInstall(options);
    await applyOpenCodeInstall(options, plan);
    const bridge = plan.fileMutations.find((asset) =>
      asset.path.endsWith("/plugins/pulso-protocol-guard.js"),
    );
    const pulso = plan.fileMutations.find((asset) =>
      asset.path.endsWith("/agents/pulso.md"),
    );
    if (!bridge || !pulso) throw new Error("OPENCODE_MANAGED_ASSET_MISSING");
    const installedPlugin = await import(pathToFileURL(bridge.path).href);
    await expect(installedPlugin.default({})).resolves.toBeDefined();
    await writeFile(pulso.path, "partial asset from another build\n");
    await expect(installedPlugin.default({})).rejects.toThrow(
      "OPENCODE_BUILD_INCOHERENT:asset_hash",
    );
  }));

test("the installed native bridge manifest has no MCP asset", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills: [],
    };
    const plan = await planOpenCodeInstall(options);
    await applyOpenCodeInstall(options, plan);
    const manifestPath = join(workspace, ".opencode", ".pulso-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest).not.toHaveProperty("mcp");
    expect(
      plan.fileMutations.some((asset) => asset.path.includes("/mcp/")),
    ).toBe(false);
  }));

test("modified managed files conflict and model disappearance aborts before writing", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    const plan = await planOpenCodeInstall(options);
    await mkdir(join(workspace, ".opencode", "agents"), { recursive: true });
    const firstAsset = plan.fileMutations[0];
    if (!firstAsset) throw new Error("OPENCODE_TEST_ASSET_MISSING");
    await writeFile(firstAsset.path, "user edit");
    await expect(planOpenCodeInstall(options)).rejects.toThrow(
      "INSTALL_CONFLICT",
    );

    const other = await mkdtemp(join(tmpdir(), "pulso-opencode-model-stale-"));
    try {
      const modelOptions = {
        ...options,
        workspace: other,
        modelConfig: {
          profile: "custom" as const,
          agents: {
            pulso: "openai/gone",
            planner: null,
            explorer: null,
            executor: null,
            verifier: null,
            "security-auditor": null,
          },
        },
        discovery: { models: async () => [] },
      };
      const modelPlan = await planOpenCodeInstall(modelOptions);
      await expect(
        applyOpenCodeInstall(modelOptions, modelPlan),
      ).rejects.toThrow("MODEL_CATALOG_STALE");
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  }));

test("modified protocol guard is a conflict and remains untouched", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    const plan = await planOpenCodeInstall(options);
    await applyOpenCodeInstall(options, plan);
    const plugin = plan.fileMutations.find((asset) =>
      asset.path.endsWith("/plugins/pulso-protocol-guard.js"),
    );
    if (!plugin) throw new Error("OPENCODE_PROTOCOL_GUARD_ASSET_MISSING");
    await writeFile(plugin.path, "// user customization\n");
    await expect(planOpenCodeInstall(options)).rejects.toThrow(
      "INSTALL_CONFLICT",
    );
    expect(await readFile(plugin.path, "utf8")).toContain("user customization");
  }));

test("updates a hash-matching prior Pulso-managed agent/plugin asset safely", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    const initial = await planOpenCodeInstall(options);
    await applyOpenCodeInstall(options, initial);
    const managed = initial.fileMutations.find((asset) =>
      asset.path.endsWith("/agents/pulso.md"),
    );
    if (!managed) throw new Error("OPENCODE_MANAGED_AGENT_MISSING");
    const oldContent = "previous Pulso-managed renderer output\n";
    await writeFile(managed.path, oldContent);
    const manifestPath = join(workspace, ".opencode", ".pulso-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.files[managed.path] = createHash("sha256")
      .update(oldContent)
      .digest("hex");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    const upgrade = await planOpenCodeInstall(options);
    await applyOpenCodeInstall(options, upgrade);
    const upgradedAsset = upgrade.fileMutations.find(
      (asset) => asset.path === managed.path,
    );
    if (!upgradedAsset) throw new Error("OPENCODE_UPGRADE_ASSET_MISSING");
    expect(await readFile(managed.path, "utf8")).toBe(upgradedAsset.content);
  }));

test("model reconfiguration updates agents without reinstalling skills or changing MCP configuration", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    const plan = await planOpenCodeInstall(options);
    await applyOpenCodeInstall(options, plan);
    const skillPath = join(
      workspace,
      ".opencode",
      "skills",
      "bbva-engineering",
      "SKILL.md",
    );
    const configPath = join(workspace, ".opencode", "opencode.json");
    const skillBefore = await readFile(skillPath, "utf8");
    const configBefore = await readFile(configPath, "utf8");
    const result = await reconfigureOpenCodeModels({
      scope: "local",
      workspace,
      executable: "opencode",
      modelConfig: {
        profile: "custom",
        agents: {
          pulso: "openai/exact",
          planner: null,
          explorer: null,
          executor: null,
          verifier: null,
          "security-auditor": null,
        },
      },
      discovery: {
        models: async () => [
          { id: "openai/exact", provider: "openai", modelId: "exact" },
        ],
      },
    });
    expect(result.updatedAgents).toHaveLength(6);
    expect(
      await readFile(
        join(workspace, ".opencode", "agents", "pulso.md"),
        "utf8",
      ),
    ).toContain("model: openai/exact");
    const pulso = await readFile(
      join(workspace, ".opencode", "agents", "pulso.md"),
      "utf8",
    );
    const manifest = JSON.parse(
      await readFile(
        join(workspace, ".opencode", ".pulso-manifest.json"),
        "utf8",
      ),
    );
    expect(pulso).toContain(`pulso-build-id:${manifest.buildId}`);
    expect(manifest.assetHashes).toEqual(
      [...manifest.assetHashes].sort(
        (left: { path: string }, right: { path: string }) =>
          left.path.localeCompare(right.path),
      ),
    );
    expect(await readFile(skillPath, "utf8")).toBe(skillBefore);
    expect(await readFile(configPath, "utf8")).toBe(configBefore);
  }));

test("model reconfiguration rejects a manifest whose transitive source closure drifted", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills,
    };
    await applyOpenCodeInstall(options, await planOpenCodeInstall(options));
    const manifestPath = join(workspace, ".opencode", ".pulso-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.sourceHashes[0].sha256 = "source-drift";
    const driftedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
    await writeFile(manifestPath, driftedManifest);
    const pulsoPath = join(workspace, ".opencode", "agents", "pulso.md");
    const pulsoBefore = await readFile(pulsoPath, "utf8");

    await expect(
      reconfigureOpenCodeModels({
        scope: "local",
        workspace,
        executable: "opencode",
        modelConfig: {
          profile: "inherited",
          agents: {
            pulso: null,
            planner: null,
            explorer: null,
            executor: null,
            verifier: null,
            "security-auditor": null,
          },
        },
      }),
    ).rejects.toThrow(/OPENCODE_BUILD_DRIFT:.*REINSTALL_REQUIRED/);
    expect(await readFile(pulsoPath, "utf8")).toBe(pulsoBefore);
    expect(await readFile(manifestPath, "utf8")).toBe(driftedManifest);
  }));

test("apply rechecks bridge duplicates added to the target plugin array after planning", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills: [],
    };
    const plan = await planOpenCodeInstall(options);
    const configPath = join(workspace, ".opencode", "opencode.json");
    const changedConfig = `${JSON.stringify({
      plugin: [
        "./plugins/pulso-protocol-guard.js",
        "./plugins/pulso-protocol-guard.js",
      ],
    })}\n`;
    await mkdir(join(workspace, ".opencode"), { recursive: true });
    await writeFile(configPath, changedConfig);

    await expect(applyOpenCodeInstall(options, plan)).rejects.toThrow(
      "DUPLICATE_NATIVE_BRIDGE",
    );
    expect(await readFile(configPath, "utf8")).toBe(changedConfig);
    await expect(
      readFile(join(workspace, ".opencode", ".pulso-manifest.json"), "utf8"),
    ).rejects.toThrow();
    const firstAsset = plan.fileMutations[0];
    if (!firstAsset) throw new Error("OPENCODE_TEST_ASSET_MISSING");
    await expect(readFile(firstAsset.path, "utf8")).rejects.toThrow();
  }));

test("apply rechecks effective global config and manifest bridges added after planning", async () =>
  withTemp(async (workspace) => {
    const homeDir = join(workspace, "home");
    const options = {
      scope: "local" as const,
      workspace,
      homeDir,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills: [],
    };
    const globalRoot = join(homeDir, ".config", "opencode");
    const plan = await planOpenCodeInstall(options);
    const globalConfig = join(globalRoot, "opencode.json");
    await mkdir(globalRoot, { recursive: true });
    await writeFile(
      globalConfig,
      `${JSON.stringify({ plugin: ["./plugins/pulso-protocol-guard.js"] })}\n`,
    );

    await expect(applyOpenCodeInstall(options, plan)).rejects.toThrow(
      "DUPLICATE_NATIVE_BRIDGE",
    );
    await rm(globalConfig);
    await writeFile(
      join(globalRoot, ".pulso-manifest.json"),
      `${JSON.stringify({
        nativeBridge: {
          path: join(globalRoot, "plugins", "pulso-protocol-guard.js"),
        },
      })}\n`,
    );

    await expect(applyOpenCodeInstall(options, plan)).rejects.toThrow(
      "DUPLICATE_NATIVE_BRIDGE",
    );
    await expect(
      readFile(join(workspace, ".opencode", ".pulso-manifest.json"), "utf8"),
    ).rejects.toThrow();
  }));
