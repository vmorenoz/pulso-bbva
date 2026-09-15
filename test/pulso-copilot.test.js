"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("ships a valid Copilot plugin with every Pulso agent", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  const mcp = JSON.parse(fs.readFileSync(path.join(root, "mcp.json"), "utf8"));
  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name, "pulso");
  assert.equal(mcp.mcpServers["pulso-control"].type, "stdio");
  const sources = fs.readdirSync(path.join(root, "agents")).filter((name) => name.endsWith(".md")).sort();
  const generated = fs.readdirSync(path.join(root, "copilot", "profiles", "openai", "agents")).filter((name) => name.endsWith(".agent.md")).map((name) => name.replace(".agent.md", ".md")).sort();
  assert.deepEqual(generated, sources);
  assert.equal(fs.existsSync(path.join(root, "com.github.copilot", "agents")), false);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso-planner.agent.md"), "utf8"), /model: gpt-5\.6-terra/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "claude", "agents", "pulso-planner.agent.md"), "utf8"), /model: claude-sonnet-5/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "claude", "agents", "pulso.agent.md"), "utf8"), /model: claude-sonnet-5/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "claude", "agents", "pulso-explorer.agent.md"), "utf8"), /model: claude-haiku-4\.5/);
  const copilotPulso = fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso.agent.md"), "utf8");
  assert.doesNotMatch(copilotPulso, /gpt-5\.6-sol|claude-opus/);
  assert.match(copilotPulso, /"ask_user"/);
  assert.match(copilotPulso, /never call `task_complete`/);
  for (const profile of ["openai", "claude"]) {
    for (const name of fs.readdirSync(path.join(root, "copilot", "profiles", profile, "agents"))) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, "copilot", "profiles", profile, "agents", name), "utf8"), /gpt-5\.6-sol|claude-opus/);
    }
  }
  assert.doesNotMatch(fs.readFileSync(path.join(root, "opencode.example.jsonc"), "utf8"), /gpt-5\.6-sol|claude-opus/);
});

test("Copilot MCP exposes and executes the shared control plane", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-copilot-mcp-"));
  const secondDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-copilot-mcp-second-"));
  const dataHome = path.join(directory, "data");
  let client;
  let resumedClient;
  let noRootsClient;
  try {
    fs.writeFileSync(path.join(directory, "PULSO.md"), "---\nschema_version: 1\nartifacts: untracked\n---\n\n## Project Rules\n");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const { ListRootsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");
    let currentRoots = [directory];
    let rootsFailure = false;
    client = new Client({ name: "pulso-test", version: "1.0.0" }, { capabilities: { roots: { listChanged: true } } });
    client.setRequestHandler(ListRootsRequestSchema, async () => {
      if (rootsFailure) throw new Error("roots unavailable");
      return { roots: currentRoots.map((item) => ({ uri: pathToFileURL(item).href, name: path.basename(item) })) };
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "copilot", "dist", "pulso-mcp-server.mjs")],
      cwd: directory,
      env: { ...process.env, XDG_DATA_HOME: dataHome, COPILOT_BINARY: path.join(directory, "missing-copilot") },
      stderr: "pipe",
    });
    await client.connect(transport);
    const tools = await client.listTools();
    for (const name of ["pulso_route", "pulso_lease", "pulso_dashboard", "pulso_doctor", "pulso_experience_start", "pulso_experience_finalize", "pulso_memory_recall", "pulso_metrics"]) {
      assert.ok(tools.tools.some((item) => item.name === name), name);
    }
    const routed = await client.callTool({ name: "pulso_route", arguments: { objective: "Fix a bounded display defect" } });
    assert.equal(JSON.parse(routed.content[0].text).route, "fast");
    const firstDoctor = JSON.parse((await client.callTool({ name: "pulso_doctor", arguments: {} })).content[0].text);
    assert.equal(firstDoctor.project.directory, fs.realpathSync(directory));
    rootsFailure = true;
    assert.equal((await client.callTool({ name: "pulso_doctor", arguments: {} })).isError, true);
    rootsFailure = false;
    const lease = await client.callTool({ name: "pulso_lease", arguments: { action: "acquire", task_id: "PULSO-001" } });
    assert.equal(JSON.parse(lease.content[0].text).status, "active");
    await client.callTool({ name: "pulso_lease", arguments: { action: "release", task_id: "PULSO-001" } });
    const started = await client.callTool({ name: "pulso_experience_start", arguments: { action: "new", title: "Copilot identity test", reason: "This verifies stable Copilot session identity.", session_id: "copilot-session-stable" } });
    const objectiveID = started.content[0].text.match(/PULSO-OBJ-\d+/)?.[0];
    assert.ok(objectiveID);
    currentRoots = [directory, secondDirectory];
    const ambiguous = await client.callTool({ name: "pulso_doctor", arguments: {} });
    assert.equal(ambiguous.isError, true);
    const escaped = await client.callTool({ name: "pulso_doctor", arguments: { project_directory: os.tmpdir() } });
    assert.equal(escaped.isError, true);
    const secondDoctor = JSON.parse((await client.callTool({ name: "pulso_doctor", arguments: { project_directory: secondDirectory } })).content[0].text);
    assert.equal(secondDoctor.project.directory, fs.realpathSync(secondDirectory));
    assert.notEqual(secondDoctor.project.key, firstDoctor.project.key);
    const isolated = await client.callTool({ name: "pulso_metrics", arguments: { session_id: "copilot-session-stable", project_directory: secondDirectory } });
    assert.deepEqual(JSON.parse(isolated.content[0].text).objectives, []);
    const secondStarted = await client.callTool({ name: "pulso_experience_start", arguments: { action: "new", title: "Second Copilot project", reason: "This verifies repository-scoped Copilot sessions.", session_id: "copilot-session-stable", project_directory: secondDirectory } });
    assert.match(secondStarted.content[0].text, /created/);
    currentRoots = [directory];
    await client.close();

    resumedClient = new Client({ name: "pulso-resume-test", version: "1.0.0" }, { capabilities: { roots: { listChanged: true } } });
    resumedClient.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: [{ uri: pathToFileURL(directory).href, name: "current-project" }] }));
    const resumedTransport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "copilot", "dist", "pulso-mcp-server.mjs")],
      cwd: directory,
      env: { ...process.env, XDG_DATA_HOME: dataHome, COPILOT_BINARY: path.join(directory, "missing-copilot") },
      stderr: "pipe",
    });
    await resumedClient.connect(resumedTransport);
    const finalized = await resumedClient.callTool({ name: "pulso_experience_finalize", arguments: { title: "Copilot identity test", status: "failed", summary: "Stable session identity remained available across MCP processes.", evidence: ["MCP lifecycle test"], session_id: "copilot-session-stable" } });
    assert.equal(finalized.isError, undefined);
    assert.match(finalized.content[0].text, new RegExp(objectiveID));
    await resumedClient.close();

    noRootsClient = new Client({ name: "pulso-no-roots-test", version: "1.0.0" });
    const noRootsTransport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, "copilot", "dist", "pulso-mcp-server.mjs")],
      cwd: directory,
      env: { ...process.env, XDG_DATA_HOME: dataHome },
      stderr: "pipe",
    });
    await noRootsClient.connect(noRootsTransport);
    assert.equal((await noRootsClient.callTool({ name: "pulso_doctor", arguments: {} })).isError, true);
    const explicitDoctor = await noRootsClient.callTool({ name: "pulso_doctor", arguments: { project_directory: directory } });
    assert.equal(JSON.parse(explicitDoctor.content[0].text).project.directory, fs.realpathSync(directory));
    await noRootsClient.close();
  } finally {
    await noRootsClient?.close().catch(() => {});
    await resumedClient?.close().catch(() => {});
    await client?.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(secondDirectory, { recursive: true, force: true });
  }
});

test("Copilot hook injects PULSO.md and blocks writes on an open circuit", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-copilot-hook-"));
  try {
    fs.writeFileSync(path.join(directory, "PULSO.md"), "---\nartifacts: tracked\n---\n\n## Project Rules\n- Keep tests focused.\n");
    let result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "sessionStart"], {
      cwd: directory,
      input: JSON.stringify({ hookEventName: "sessionStart", cwd: directory }),
      encoding: "utf8",
    });
    assert.match(JSON.parse(result.stdout).additionalContext, /Keep tests focused/);

    fs.mkdirSync(path.join(directory, ".pulso", "leases"), { recursive: true });
    fs.mkdirSync(path.join(directory, ".pulso", "circuit-breakers"), { recursive: true });
    fs.writeFileSync(path.join(directory, ".pulso", "leases", "PULSO-001.json"), JSON.stringify({ task_id: "PULSO-001", status: "active", expires_at: new Date(Date.now() + 60000).toISOString(), heartbeat_at: new Date().toISOString() }));
    fs.writeFileSync(path.join(directory, ".pulso", "circuit-breakers", "PULSO-001.json"), JSON.stringify({ state: "open", trip_reason: "repeated validation failure" }));
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ toolName: "apply_patch", cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(result.stdout).permissionDecision, "deny");
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ toolName: "bash", toolArgs: { command: "git status" }, cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(result.stdout).permissionDecision, "deny");
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ toolName: "bash", toolArgs: { command: "npm test" }, cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(result.stdout).permissionDecision, undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("dual installer routes the Copilot target through its plugin marketplace", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-copilot-install-"));
  const binary = path.join(directory, "copilot-fixture");
  const log = path.join(directory, "calls.jsonl");
  try {
    fs.writeFileSync(binary, `#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(process.env.COPILOT_FIXTURE_LOG,JSON.stringify(process.argv.slice(2))+'\\n');const a=process.argv.slice(2).join(' ');if(a==='--version')console.log('GitHub Copilot CLI 1.0.83');else if(a==='plugin marketplace list')console.log('Included with GitHub Copilot:');else if(a==='plugin list')console.log('No plugins installed.');\n`);
    fs.chmodSync(binary, 0o700);
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "install", "--target", "copilot"], {
      cwd: root,
      env: { ...process.env, COPILOT_BINARY: binary, COPILOT_FIXTURE_LOG: log, COPILOT_HOME: path.join(directory, "home") },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(calls.some((args) => args.join(" ") === "plugin marketplace add " + root));
    assert.ok(calls.some((args) => args.join(" ") === "plugin install pulso@pulso"));
    assert.doesNotMatch(fs.readFileSync(path.join(root, "scripts", "install-copilot.mjs"), "utf8"), /build-copilot/);
    assert.match(fs.readFileSync(path.join(directory, "home", "agents", "pulso.agent.md"), "utf8"), /model: gpt-5\.6-terra/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "home", "pulso-profile.json"), "utf8")).profile, "openai");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("OpenCode installer applies the selected Claude profile", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-opencode-profile-"));
  try {
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "install", "--profile", "claude", "--set-default"], {
      cwd: root,
      env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"));
    assert.equal(config.agent.pulso.model, "github-copilot/claude-sonnet-5");
    assert.equal(config.agent["pulso-planner"].model, "github-copilot/claude-sonnet-5");
    assert.equal(config.agent["pulso-explorer"].model, "github-copilot/claude-haiku-4.5");
    assert.equal(JSON.parse(fs.readFileSync(path.join(configRoot, "pulso-profile.json"), "utf8")).profile, "claude");
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("installer reuses a persisted Copilot profile and protects customized agents", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-copilot-persisted-"));
  const home = path.join(directory, "home");
  const binary = path.join(directory, "copilot-fixture");
  const log = path.join(directory, "calls.jsonl");
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, "pulso-profile.json"), JSON.stringify({ schema_version: 1, profile: "claude", note: "user-owned" }));
    fs.writeFileSync(binary, `#!/usr/bin/env node\nconst fs=require('fs');fs.appendFileSync(process.env.COPILOT_FIXTURE_LOG,JSON.stringify(process.argv.slice(2))+'\\n');const a=process.argv.slice(2).join(' ');if(a==='--version')console.log('GitHub Copilot CLI 1.0.83');else if(a==='plugin marketplace list')console.log('Registered marketplaces:\\n  • pulso');\n`);
    fs.chmodSync(binary, 0o700);
    let result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "install", "--target", "copilot"], {
      cwd: root,
      env: { ...process.env, COPILOT_BINARY: binary, COPILOT_FIXTURE_LOG: log, COPILOT_HOME: home },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(path.join(home, "agents", "pulso.agent.md"), "utf8"), /model: claude-sonnet-5/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, "pulso-profile.json"), "utf8")).note, "user-owned");

    fs.writeFileSync(path.join(home, "agents", "pulso.agent.md"), "customized\n");
    fs.writeFileSync(log, "");
    result = spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "install", "--target", "copilot", "--profile", "openai"], {
      cwd: root,
      env: { ...process.env, COPILOT_BINARY: binary, COPILOT_FIXTURE_LOG: log, COPILOT_HOME: home },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(path.join(home, "agents", "pulso.agent.md"), "utf8"), "customized\n");
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(calls, [["--version"]]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("OpenCode installer protects customized Pulso model selections", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-opencode-custom-model-"));
  try {
    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), JSON.stringify({ agent: { pulso: { model: "custom/provider-model" } } }));
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "install", "--profile", "openai"], {
      cwd: root,
      env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8")).agent.pulso.model, "custom/provider-model");
    assert.equal(fs.existsSync(path.join(configRoot, "agents", "pulso.md")), false);
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("OpenCode uninstall preserves models it does not own", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-opencode-user-model-"));
  try {
    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), JSON.stringify({ agent: { pulso: { model: "github-copilot/gpt-5.6-terra" } } }));
    const result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "uninstall"], {
      cwd: root,
      env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8")).agent.pulso.model, "github-copilot/gpt-5.6-terra");
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});
