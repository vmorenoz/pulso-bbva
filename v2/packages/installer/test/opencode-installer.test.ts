import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    await applyOpenCodeInstall(options, plan);
    const installed = await readFile(config, "utf8");
    expect(installed).toContain("// Keep user MCP configuration");
    expect(installed).toContain('"other"');
    expect(installed).toContain('"pulso"');
    expect(installed).toContain('"command": [');
    const result = await uninstallOpenCode({ scope: "local", workspace });
    expect(result.conflicts).toEqual([]);
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
          "/.config/opencode/skills/bbva-engineering/SKILL.md",
        ),
      ),
    ).toBe(true);
    expect(plan.configMutations[0]?.path).toBe(
      join(homeDir, ".config", "opencode", "opencode.json"),
    );
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
