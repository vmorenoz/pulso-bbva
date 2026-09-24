import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentDefinitions } from "../../orchestration/src/agents/definitions";
import { vscodeCopilotRuntime } from "../../orchestration/src/runtimes/vscode-copilot";
import {
  GlobalInstallConflictError,
  installGlobalVscode,
  uninstallGlobalVscode,
} from "../src";

const orchestrationRoot = join(import.meta.dir, "../../orchestration");
const bundle = 'console.log("Pulso MCP test bundle");\n';

test("global install manages user agents, selected skills and MCP without replacing foreign servers", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-global-installer-"));
  const homeDir = join(root, "home");
  const dataRoot = join(homeDir, ".local", "share", "pulso", "v2");
  const mcpConfigPath = join(root, "Code", "User", "mcp.json");
  try {
    await mkdir(join(root, "Code", "User"), { recursive: true });
    await writeFile(
      mcpConfigPath,
      JSON.stringify({
        servers: { existing: { type: "stdio", command: "existing" } },
      }),
    );
    const first = await installGlobalVscode({
      homeDir,
      dataRoot,
      mcpConfigPath,
      orchestrationRoot,
      runtimeExecutable: "/opt/bun/bin/bun",
      mcpBundle: bundle,
      enabledSkills: ["bbva-apx"],
    });
    const config = JSON.parse(await readFile(mcpConfigPath, "utf8"));
    const agent = await readFile(
      join(homeDir, ".copilot/agents/pulso.agent.md"),
      "utf8",
    );
    expect(config.servers.existing).toEqual({
      type: "stdio",
      command: "existing",
    });
    expect(config.servers.pulso).toEqual({
      type: "stdio",
      command: "/opt/bun/bin/bun",
      args: [join(dataRoot, "pulso-capabilities-mcp.js")],
      env: { PULSO_WORKSPACE: "$" + "{workspaceFolder}" },
    });
    expect(agent).not.toMatch(/^model:/m);
    expect(
      await readFile(
        join(homeDir, ".copilot/skills/bbva-apx/SKILL.md"),
        "utf8",
      ),
    ).toContain("Online Transactions");
    await expect(
      readFile(join(homeDir, ".copilot/skills/bbva-cells/SKILL.md"), "utf8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(first.installedFiles.length).toBeGreaterThan(1);

    await expect(
      installGlobalVscode({
        homeDir,
        dataRoot,
        mcpConfigPath,
        orchestrationRoot,
        runtimeExecutable: "/opt/bun/bin/bun",
        mcpBundle: bundle,
        enabledSkills: ["bbva-apx"],
      }),
    ).resolves.toBeDefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global installer refuses to overwrite user edits and uninstalls only unchanged managed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-global-conflict-"));
  const homeDir = join(root, "home");
  const dataRoot = join(homeDir, ".local", "share", "pulso", "v2");
  const mcpConfigPath = join(root, "Code", "User", "mcp.json");
  const options = {
    homeDir,
    dataRoot,
    mcpConfigPath,
    orchestrationRoot,
    runtimeExecutable: "/opt/bun/bin/bun",
    mcpBundle: bundle,
  };
  try {
    await installGlobalVscode(options);
    const pulsoAgent = join(homeDir, ".copilot/agents/pulso.agent.md");
    await writeFile(pulsoAgent, "user-owned edit\n");
    await expect(installGlobalVscode(options)).rejects.toBeInstanceOf(
      GlobalInstallConflictError,
    );
    const blocked = await uninstallGlobalVscode({
      homeDir,
      dataRoot,
      mcpConfigPath,
    });
    expect(blocked.conflicts).toContain(pulsoAgent);
    expect(
      JSON.parse(await readFile(mcpConfigPath, "utf8")).servers.pulso,
    ).toBeDefined();
    await writeFile(
      pulsoAgent,
      vscodeCopilotRuntime.renderAgent(agentDefinitions.pulso).content,
    );
    const removed = await uninstallGlobalVscode({
      homeDir,
      dataRoot,
      mcpConfigPath,
    });
    expect(removed.conflicts).toEqual([]);
    expect(
      JSON.parse(await readFile(mcpConfigPath, "utf8")).servers.pulso,
    ).toBeUndefined();
    expect(JSON.parse(await readFile(mcpConfigPath, "utf8")).servers).toEqual(
      {},
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global installer does not claim a pre-existing Pulso MCP entry", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-global-mcp-conflict-"));
  const homeDir = join(root, "home");
  const dataRoot = join(homeDir, ".local", "share", "pulso", "v2");
  const mcpConfigPath = join(root, "Code", "User", "mcp.json");
  try {
    await mkdir(join(root, "Code", "User"), { recursive: true });
    await writeFile(
      mcpConfigPath,
      JSON.stringify({ servers: { pulso: { command: "other" } } }),
    );
    await expect(
      installGlobalVscode({
        homeDir,
        dataRoot,
        mcpConfigPath,
        orchestrationRoot,
        runtimeExecutable: "/opt/bun/bin/bun",
        mcpBundle: bundle,
      }),
    ).rejects.toBeInstanceOf(GlobalInstallConflictError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
