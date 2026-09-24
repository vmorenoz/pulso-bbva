"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const vscodeAgents = ["pulso", "pulso-executor", "pulso-planner", "pulso-challenger", "pulso-contact-manager", "pulso-explorer", "pulso-verifier", "pulso-integration-auditor", "pulso-security-auditor", "pulso-ui-auditor", "pulso-experience-curator", "pulso-delivery-reporter"];

test("ships an Agent Plugins 1.0 VS Code adapter without CLI dependencies", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  const mcp = fs.readFileSync(path.join(root, "mcp.json"), "utf8");
  const mcpConfig = JSON.parse(mcp);
  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.version, "0.3.3");
  assert.match(plugin.description, /VS Code Agents/);
  assert.match(mcp, /\$\{PLUGIN_ROOT\}\/vscode\/pulso-mcp-server\.cjs/);
  assert.equal(mcpConfig.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
  assert.ok(mcpConfig.mcpServers["pulso-control"]);
  assert.equal(mcpConfig.servers, undefined);
  assert.doesNotMatch(`${mcp}\n${fs.readFileSync(path.join(root, "vscode", "pulso-mcp-server.mjs"), "utf8")}`, /\b--agent\b/);
  const hooks = JSON.parse(fs.readFileSync(path.join(root, "com.github.copilot", "hooks", "hooks.json"), "utf8"));
  for (const entries of Object.values(hooks.hooks)) for (const hook of entries) {
    assert.equal(hook.type, "command");
    assert.equal(typeof hook.command, "string");
    assert.equal(hook.exec, undefined);
    assert.equal(hook.args, undefined);
  }
  const handler = fs.readFileSync(path.join(root, "vscode", "pulso-hook.mjs"), "utf8");
  assert.match(handler, /hookSpecificOutput/);
  assert.match(handler, /runTerminalCommand/);
  assert.match(handler, /replace_string_in_file/);
  const server = fs.readFileSync(path.join(root, "vscode", "pulso-mcp-server.mjs"), "utf8");
  assert.match(server, /const engine = PulsoExperienceEnginePlugin/);
  assert.match(server, /\(await engine\)\.tool\.pulso_status/);
  assert.match(server, /register\("pulso_capabilities"/);
  assert.doesNotMatch(server, /\(\) => \(\{ status: "healthy", runtime: "vscode", project: directory \}\)/);
  assert.match(server, /register\("pulso_artifacts"/);
  assert.match(server, /register\("pulso_agent_contacts"/);
  assert.doesNotMatch(server, /register\("pulso_(?:models|dashboard|metrics)"/);
});

test("keeps OpenCode and VS Code prompts under the shared semantic contracts", () => {
  const agentDirectory = path.join(root, "agents");
  for (const name of fs.readdirSync(agentDirectory).filter((file) => file.endsWith(".md"))) {
    const contents = fs.readFileSync(path.join(agentDirectory, name), "utf8");
    assert.match(contents, /^---\n[\s\S]+?\n---\n/, name);
    assert.match(contents, /<identity>/, name);
    assert.match(contents, /(?:debe estar|siempre con|Toda comunicación|Todo texto natural).*en español/, name);
    assert.match(contents, name === "pulso.md" ? /pulso_lease: allow/ : /pulso_lease: deny/, name);
  }
});

test("installs Agent Host agents, skills, and MCP without using the extension directory", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-vscode-install-"));
  try {
    const copilotHome = path.join(directory, "copilot");
    const legacy = path.join(directory, "extensions");
    const env = { ...process.env, COPILOT_HOME: copilotHome, VSCODE_EXTENSIONS_DIR: legacy };
    let result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "install", "--target", "vscode"], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    for (const name of vscodeAgents) assert.equal(fs.existsSync(path.join(copilotHome, "agents", `${name}.agent.md`)), true, name);
    for (const name of ["pulso-doctor", "pulso-autointegrate", "bbva-engineering", "bbva-cells", "bbva-cells-testing", "bbva-apx", "bbva-apx-testing"]) assert.equal(fs.existsSync(path.join(copilotHome, "skills", name, "SKILL.md")), true, name);
    for (const name of ["pulso-dashboard", "pulso-configure"]) assert.equal(fs.existsSync(path.join(copilotHome, "skills", name)), false, name);
    assert.equal(fs.existsSync(path.join(copilotHome, "hooks", "pulso.json")), true);
    assert.equal(fs.existsSync(path.join(copilotHome, "pulso", "vscode", "pulso-mcp-server.cjs")), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(copilotHome, "mcp-config.json"), "utf8")).mcpServers["pulso-control"].command, process.execPath);
    assert.equal(JSON.parse(fs.readFileSync(path.join(copilotHome, "mcp-config.json"), "utf8")).servers, undefined);
    const executor = fs.readFileSync(path.join(copilotHome, "agents", "pulso-executor.agent.md"), "utf8");
    const primary = fs.readFileSync(path.join(copilotHome, "agents", "pulso.agent.md"), "utf8");
    assert.match(executor, /"pulso-codegraph\/codegraph_explore"/); assert.doesNotMatch(primary, /codegraph/);
    assert.match(executor, /read, search, LSP o terminal nativos/);
    assert.equal(fs.existsSync(path.join(legacy, "pulso-vscode-agent-plugin")), false);
    result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "uninstall", "--target", "vscode"], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.join(copilotHome, "agents", "pulso.agent.md")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(copilotHome, "mcp-config.json"), "utf8")).mcpServers, undefined);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("VS Code uninstall removes only an exact workspace CodeGraph registration", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-vscode-codegraph-uninstall-"));
  try {
    const workspace = path.join(directory, "workspace"); const configFile = path.join(workspace, ".vscode", "mcp.json"); const core = require(path.join(root, "lib", "pulso-vscode-codegraph.js"));
    core.updateMcpRegistration({ configFile, cwd: workspace, enabled: true });
    let result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "uninstall", "--target", "vscode"], { cwd: workspace, env: { ...process.env, COPILOT_HOME: path.join(directory, "copilot") }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers, undefined);
    fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { [core.SERVER]: { command: "user" } } }));
    fs.writeFileSync(`${configFile}.pulso-codegraph.json`, JSON.stringify({ managed_by: "pulso", server: core.SERVER, cwd: workspace, runtime: "vscode", configuration: core.managedServer(workspace) }));
    result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "uninstall", "--target", "vscode"], { cwd: workspace, env: { ...process.env, COPILOT_HOME: path.join(directory, "copilot") }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers[core.SERVER].command, "user");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("rejects retired CLI targets and references", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  assert.equal(Object.hasOwn(scripts, "install:copilot"), false);
  assert.equal(Object.hasOwn(scripts, "install:both"), false);
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "install", "--target", "copilot"], { cwd: root, encoding: "utf8" });
  assert.notEqual(result.status, 0);
});

test("derives Agent Host bodies from the OpenCode contracts", () => {
  for (const name of fs.readdirSync(path.join(root, "com.github.copilot", "agents")).map((file) => path.basename(file, ".agent.md"))) {
    const source = fs.readFileSync(path.join(root, "agents", `${name}.md`), "utf8");
    assert.match(source, /<identity>/, name);
  }
});

test("limits CodeGraph to approved read-only VS Code roles with native fallback", () => {
  const enabled = new Set(["pulso-executor", "pulso-planner", "pulso-explorer", "pulso-verifier", "pulso-challenger", "pulso-integration-auditor", "pulso-security-auditor"]);
  for (const name of fs.readdirSync(path.join(root, "com.github.copilot", "agents")).map((file) => path.basename(file, ".agent.md"))) {
    const source = fs.readFileSync(path.join(root, "com.github.copilot", "agents", `${name}.agent.md`), "utf8");
    assert.equal(source.includes('"pulso-codegraph/codegraph_explore"'), enabled.has(name), name);
    assert.doesNotMatch(source, /codegraph\/\*/);
    if (enabled.has(name)) {
      assert.match(source, /investigación estructural multiarchivo/);
      assert.match(source, /read, search, LSP o terminal nativos/);
      assert.match(source, /No indexes, sincronices, edites, borres ni administres/);
    }
  }
});

test("keeps creator data out of agent prompts", () => {
  const identity = fs.readFileSync(path.join(root, "lib", "pulso-identity.js"), "utf8");
  const primary = fs.readFileSync(path.join(root, "agents", "pulso.md"), "utf8");
  assert.match(identity, /ENCODED_IDENTITY/);
  assert.doesNotMatch(primary, /P041413|@vmorenoz|@vicodev|victor\.moreno\.zapata@bbva\.com/);
});
