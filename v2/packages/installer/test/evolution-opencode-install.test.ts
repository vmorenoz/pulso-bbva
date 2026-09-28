import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalSkill } from "../../orchestration/src/runtimes/types";
import {
  applyOpenCodeInstall,
  planOpenCodeInstall,
  uninstallOpenCode,
} from "../src/runtimes/opencode-installer";

test("E09 installs all OpenCode roles and Pulso skills while preserving instruction files byte-for-byte", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pulso-e09-opencode-"));
  try {
    const protectedFiles = ["AGENTS.md", "CLAUDE.md", "PULSO.md"];
    const contents = new Map<string, string>();
    for (const [index, name] of protectedFiles.entries()) {
      const content = `# user-owned ${name}\nbytes ${index}\r\n`;
      contents.set(name, content);
      await writeFile(join(workspace, name), content);
    }
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "pulso-mcp.js"],
      skills: [] as CanonicalSkill[],
      modelConfig: {
        profile: "custom" as const,
        agents: {
          pulso: "provider/model",
          planner: null,
          explorer: null,
          executor: null,
          verifier: null,
          "security-auditor": null,
        },
      },
      discovery: {
        models: async () => [
          { id: "provider/model", provider: "provider", modelId: "model" },
        ],
      },
    };
    const plan = await planOpenCodeInstall(options);
    const assets = plan.fileMutations.map((asset) => asset.path);
    expect(
      assets.filter((path) => path.includes("/.opencode/agents/")).length,
    ).toBe(6);
    const pulsoSkills = assets.filter((path) =>
      /\/skills\/pulso-[^/]+\/SKILL\.md$/.test(path),
    );
    expect(pulsoSkills).toHaveLength(8);
    expect(
      assets.some((path) => /\/(AGENTS|CLAUDE|PULSO)\.md$/.test(path)),
    ).toBe(false);
    await applyOpenCodeInstall(options, plan);
    for (const name of protectedFiles)
      expect(await readFile(join(workspace, name), "utf8")).toBe(
        contents.get(name)!,
      );
    const manifestPath = join(workspace, ".opencode", ".pulso-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.modelProfile).toBe("custom");
    expect(manifest.resolvedModels.pulso).toBe("provider/model");
    expect(manifest.assetHashes).toHaveLength(plan.fileMutations.length);
    expect(
      manifest.assetHashes.every((asset: { sha256: string }) => asset.sha256),
    ).toBe(true);
    const result = await uninstallOpenCode({ scope: "local", workspace });
    expect(result.conflicts).toEqual([]);
    for (const name of protectedFiles)
      expect(await readFile(join(workspace, name), "utf8")).toBe(
        contents.get(name)!,
      );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("E09 leaves an absent PULSO.md absent through local install and uninstall", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pulso-e09-absent-"));
  try {
    const options = {
      scope: "local" as const,
      workspace,
      homeDir: workspace,
      executable: "/bin/opencode",
      mcpCommand: ["node", "pulso-mcp.js"],
      skills: [] as CanonicalSkill[],
    };
    await applyOpenCodeInstall(options, await planOpenCodeInstall(options));
    expect(await Bun.file(join(workspace, "PULSO.md")).exists()).toBe(false);
    await uninstallOpenCode({ scope: "local", workspace });
    expect(await Bun.file(join(workspace, "PULSO.md")).exists()).toBe(false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
