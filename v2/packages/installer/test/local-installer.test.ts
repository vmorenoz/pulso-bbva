import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installLocalVscode, uninstallLocalVscode } from "../src";

const orchestrationRoot = join(import.meta.dir, "../../orchestration");

test("local install is isolated to the selected workspace and keeps unrelated MCP entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-local-installer-"));
  const workspace = join(root, "project");
  const bundlePath = join(root, "app-data/pulso-capabilities-mcp.js");
  try {
    await mkdir(workspace, { recursive: true });
    await writeFile(join(root, "mcp.json"), "{}");
    await mkdir(join(workspace, ".vscode"), { recursive: true });
    await writeFile(
      join(workspace, ".vscode/mcp.json"),
      JSON.stringify({ servers: { other: { command: "other" } } }),
    );
    const result = await installLocalVscode({
      workspace,
      orchestrationRoot,
      runtimeExecutable: "/opt/bun/bin/bun",
      mcpBundlePath: bundlePath,
      enabledSkills: ["bbva-cells"],
    });
    const mcp = JSON.parse(
      await readFile(join(workspace, ".vscode/mcp.json"), "utf8"),
    );
    expect(mcp.servers.other).toEqual({ command: "other" });
    expect(mcp.servers.pulso).toEqual({
      type: "stdio",
      command: "/opt/bun/bin/bun",
      args: [bundlePath],
      env: { PULSO_WORKSPACE: "$" + "{workspaceFolder}" },
    });
    expect(
      await readFile(
        join(workspace, ".github/agents/executor.agent.md"),
        "utf8",
      ),
    ).not.toMatch(/^model:/m);
    expect(
      await readFile(
        join(workspace, ".github/skills/bbva-cells/SKILL.md"),
        "utf8",
      ),
    ).toContain("Cells");
    await expect(
      readFile(join(workspace, ".github/skills/bbva-apx/SKILL.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(result.installedFiles.length).toBeGreaterThan(0);
    const removed = await uninstallLocalVscode(workspace);
    expect(removed.conflicts).toEqual([]);
    expect(
      JSON.parse(await readFile(join(workspace, ".vscode/mcp.json"), "utf8"))
        .servers,
    ).toEqual({ other: { command: "other" } });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local uninstaller refuses to remove edited customizations", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-local-conflict-"));
  const workspace = join(root, "project");
  try {
    await installLocalVscode({
      workspace,
      orchestrationRoot,
      runtimeExecutable: "/opt/bun/bin/bun",
      mcpBundlePath: join(root, "pulso-capabilities-mcp.js"),
    });
    const agent = join(workspace, ".github/agents/pulso.agent.md");
    await writeFile(agent, "modified by user");
    const result = await uninstallLocalVscode(workspace);
    expect(result.conflicts).toContain(agent);
    expect(await readFile(agent, "utf8")).toBe("modified by user");
    expect(
      JSON.parse(await readFile(join(workspace, ".vscode/mcp.json"), "utf8"))
        .servers.pulso,
    ).toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
