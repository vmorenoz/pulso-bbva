import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  serializeAgentResult,
  serializeTaskEnvelope,
} from "../../orchestration/src/protocol/serialize";
import type { CanonicalSkill } from "../../orchestration/src/runtimes/types";
import type { OpenCodeDiscovery } from "../src/discovery/opencode";
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
      executable: "/bin/opencode",
      mcpCommand: ["/usr/bin/node", "/pulso/mcp.js"],
      version: "1.18.32",
      skills,
    };
    const plan = await planOpenCodeInstall(options);
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
    expect(guard?.content).not.toContain("packages/orchestration/src");
    await applyOpenCodeInstall(options, plan);
    if (!guard) throw new Error("OPENCODE_PROTOCOL_GUARD_ASSET_MISSING");
    const installedPlugin = await import(pathToFileURL(guard.path).href);
    const plugin = await installedPlugin.PulsoProtocolGuard();
    const envelope = {
      protocol: "pulso-task/2" as const,
      delegationId: "external-dlg",
      specialist: "explorer" as const,
      work: { workId: "external-work", workItemId: "external-item" },
      objective: "Test external bundled plugin",
      output: { contract: "pulso-result/2" as const },
    };
    const expectedResult = {
      protocol: "pulso-result/2" as const,
      delegationId: "external-dlg",
      specialist: "explorer" as const,
      workId: "external-work",
      workItemId: "external-item",
      status: "completed" as const,
      summary: "Valid external result",
      specialistResult: {
        kind: "explorer" as const,
        findings: [],
        references: [],
      },
    };
    const hookCall = {
      tool: "task",
      sessionID: "external-session",
      callID: "external-call",
    };
    await plugin["tool.execute.before"](hookCall, {
      args: {
        prompt: serializeTaskEnvelope(envelope),
        subagent_type: "explorer",
      },
    });
    await plugin["tool.execute.after"](hookCall, {
      output: `<task id="child" state="completed"><task_result>${serializeAgentResult(expectedResult)}</task_result></task>`,
    });
    await plugin.dispose();
    const manifest = JSON.parse(
      await readFile(
        join(workspace, ".opencode", ".pulso-manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.protocolGuard.sha256).toBe(guard?.sha256);
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
    expect(installed).toContain('"pulso"');
    expect(installed).toContain('"command": [');
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

test("generated OpenCode Pulso asset materializes effective denies and exact Task allowlist", async () =>
  withTemp(async (workspace) => {
    const plan = await planOpenCodeInstall({
      scope: "local",
      workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "mcp.js"],
      skills: [],
    });
    const pulso = plan.fileMutations.find((asset) =>
      asset.path.endsWith("/agents/pulso.md"),
    )?.content;
    expect(pulso).toBeDefined();
    for (const key of [
      "read",
      "edit",
      "glob",
      "grep",
      "bash",
      "todowrite",
      "skill",
      "webfetch",
    ])
      expect(pulso).toContain(`${key}: deny`);
    expect(pulso).toContain('"*": deny');
    expect(pulso).toContain('"planner": allow');
    expect(pulso).toContain('"security-auditor": allow');
    expect(pulso).toContain("pulso_*: allow");
  }));

test("modified managed files conflict and model disappearance aborts before writing", async () =>
  withTemp(async (workspace) => {
    const options = {
      scope: "local" as const,
      workspace,
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
        discovery: { models: async () => [] } as unknown as OpenCodeDiscovery,
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
      } as unknown as OpenCodeDiscovery,
    });
    expect(result.updatedAgents).toHaveLength(6);
    expect(
      await readFile(
        join(workspace, ".opencode", "agents", "pulso.md"),
        "utf8",
      ),
    ).toContain("model: openai/exact");
    expect(await readFile(skillPath, "utf8")).toBe(skillBefore);
    expect(await readFile(configPath, "utf8")).toBe(configBefore);
  }));
