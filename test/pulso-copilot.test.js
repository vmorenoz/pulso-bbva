"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("ships a valid Copilot plugin with every Pulso agent", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  const mcp = JSON.parse(fs.readFileSync(path.join(root, "mcp.json"), "utf8"));
  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name, "pulso");
  assert.equal(mcp.mcpServers["pulso-control"].type, "stdio");
  const sources = fs.readdirSync(path.join(root, "agents")).filter((name) => name.endsWith(".md")).sort();
  const generated = fs.readdirSync(path.join(root, "com.github.copilot", "agents")).filter((name) => name.endsWith(".agent.md")).map((name) => name.replace(".agent.md", ".md")).sort();
  assert.deepEqual(generated, sources);
});

test("Copilot MCP exposes and executes the shared control plane", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-copilot-mcp-"));
  const dataHome = path.join(directory, "data");
  try {
    fs.writeFileSync(path.join(directory, "PULSO.md"), "---\nschema_version: 1\nartifacts: untracked\n---\n\n## Project Rules\n");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const client = new Client({ name: "pulso-test", version: "1.0.0" });
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
    const lease = await client.callTool({ name: "pulso_lease", arguments: { action: "acquire", task_id: "PULSO-001" } });
    assert.equal(JSON.parse(lease.content[0].text).status, "active");
    await client.callTool({ name: "pulso_lease", arguments: { action: "release", task_id: "PULSO-001" } });
    const started = await client.callTool({ name: "pulso_experience_start", arguments: { action: "new", title: "Copilot identity test", reason: "This verifies stable Copilot session identity.", session_id: "copilot-session-stable" } });
    const objectiveID = started.content[0].text.match(/PULSO-OBJ-\d+/)?.[0];
    assert.ok(objectiveID);
    await client.close();

    const resumedClient = new Client({ name: "pulso-resume-test", version: "1.0.0" });
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
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
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
      env: { ...process.env, COPILOT_BINARY: binary, COPILOT_FIXTURE_LOG: log },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(calls.some((args) => args.join(" ") === "plugin marketplace add " + root));
    assert.ok(calls.some((args) => args.join(" ") === "plugin install pulso@pulso"));
    assert.doesNotMatch(fs.readFileSync(path.join(root, "scripts", "install-copilot.mjs"), "utf8"), /build-copilot/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
