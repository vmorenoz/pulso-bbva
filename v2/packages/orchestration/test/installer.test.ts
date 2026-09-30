import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  InstallationConflictError,
  installVscodeCustomizations,
} from "../../installer/src";

test("workspace installation is idempotent and preserves foreign MCP servers", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pulso-install-"));
  const source = join(import.meta.dir, "..");
  try {
    await writeFile(
      join(workspace, ".mcp.json"),
      JSON.stringify({ mcpServers: { existing: { command: "x" } } }),
    );
    await installVscodeCustomizations(workspace, source);
    await installVscodeCustomizations(workspace, source);
    const mcp = JSON.parse(
      await readFile(join(workspace, ".mcp.json"), "utf8"),
    );
    expect(mcp.mcpServers.existing).toEqual({ command: "x" });
    expect(mcp.mcpServers.pulso).toEqual({
      command: "pulso-capabilities-mcp",
      env: { PULSO_WORKSPACE: "$" + "{workspaceFolder}" },
    });
    expect(
      await readFile(join(workspace, ".github/agents/pulso.agent.md"), "utf8"),
    ).toContain("tools: ['agent', 'pulso/*']");
    expect(
      await readFile(
        join(workspace, ".github/skills/bbva-apx/SKILL.md"),
        "utf8",
      ),
    ).toContain("Online Transactions");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("installer surfaces modified Pulso files and foreign Pulso MCP configuration", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pulso-conflict-"));
  const source = join(import.meta.dir, "..");
  try {
    await installVscodeCustomizations(workspace, source);
    await writeFile(
      join(workspace, ".github/agents/pulso.agent.md"),
      "user modification",
    );
    await expect(
      installVscodeCustomizations(workspace, source),
    ).rejects.toBeInstanceOf(InstallationConflictError);
    await rm(join(workspace, ".github"), { recursive: true, force: true });
    await writeFile(
      join(workspace, ".mcp.json"),
      JSON.stringify({ mcpServers: { pulso: { command: "foreign" } } }),
    );
    await expect(
      installVscodeCustomizations(workspace, source),
    ).rejects.toBeInstanceOf(InstallationConflictError);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("external workspace uses a distributed MCP executable rather than a repository source path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "external-consumer-"));
  const source = join(import.meta.dir, "..");
  try {
    await installVscodeCustomizations(workspace, source);
    const mcp = await readFile(join(workspace, ".mcp.json"), "utf8");
    expect(mcp).toContain("pulso-capabilities-mcp");
    expect(mcp).not.toContain("packages/capabilities-mcp/src");
    const packageJson = JSON.parse(
      await readFile(
        join(source, "..", "capabilities-mcp", "package.json"),
        "utf8",
      ),
    );
    expect(packageJson.bin["pulso-capabilities-mcp"]).toBe("src/mcp/stdio.ts");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
