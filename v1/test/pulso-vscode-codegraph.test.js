"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const test = require("node:test");
const core = require("../lib/pulso-vscode-codegraph.js");

function nextTurn() { return new Promise((resolve) => setImmediate(resolve)); }

function fixture({ version = "1.2.3", init = true, git = true, pulso = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-codegraph-"));
  const home = path.join(directory, "home"); const workspace = path.join(directory, "workspace"); const nested = path.join(workspace, "src", "nested"); const bin = path.join(directory, "bin"); const log = path.join(directory, "calls.jsonl");
  fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(home); fs.mkdirSync(bin); if (git) execFileSync("git", ["init", "-q"], { cwd: workspace }); if (pulso) fs.writeFileSync(path.join(workspace, "PULSO.md"), "---\nschema_version: 1\nartifacts: untracked\n---\n");
  fs.writeFileSync(path.join(bin, "codegraph"), `#!/usr/bin/env node\nconst fs=require('fs'),path=require('path');fs.appendFileSync(process.env.CODEGRAPH_LOG,JSON.stringify(process.argv.slice(2))+'\\n');if(process.argv[2]==='--version'){console.log('${version}');process.exit(0)}if(process.argv[2]==='init'){${init ? "fs.mkdirSync(path.join(process.argv[3],'.codegraph'),{recursive:true});fs.writeFileSync(path.join(process.argv[3],'.codegraph','codegraph.db'),'SQLite format 3\\0');process.exit(0)" : "process.exit(2)"}}process.exit(0);\n`, { mode: 0o755 });
  return { directory, home, workspace, nested, log, configFile: path.join(workspace, ".vscode", "mcp.json"), env: { ...process.env, CODEGRAPH_LOG: log, PATH: `${bin}${path.delimiter}${process.env.PATH}` } };
}
function calls(value) { return fs.existsSync(value.log) ? fs.readFileSync(value.log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : []; }
function cleanup(value) { fs.rmSync(value.directory, { recursive: true, force: true }); }

test("executable accepts Bun's null accessSync result and still rejects non-files", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-codegraph-executable-"));
  const file = path.join(directory, "codegraph"); const nested = path.join(directory, "nested");
  const originalAccessSync = fs.accessSync;
  try {
    fs.writeFileSync(file, ""); fs.mkdirSync(nested);
    fs.accessSync = () => null;
    assert.equal(core.executable("codegraph", { PATH: directory }), file);
    assert.equal(core.executable("nested", { PATH: directory }), null);
  } finally {
    fs.accessSync = originalAccessSync;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("inspection is side-effect-free for missing, incompatible, and doctor/status use", () => {
  const value = fixture(); const incompatible = fixture({ version: "2.0.0" });
  try {
    const missing = core.inspect({ cwd: value.workspace, home: value.home, env: { ...value.env, PATH: "" }, runtime: "vscode" });
    assert.equal(missing.status, "missing"); assert.equal(fs.existsSync(path.join(value.workspace, ".codegraph")), false); assert.equal(fs.existsSync(value.configFile), false);
    const result = core.inspect({ cwd: incompatible.workspace, home: incompatible.home, env: incompatible.env });
    assert.equal(result.status, "incompatible"); assert.deepEqual(calls(incompatible), [["--version"]]);
  } finally { cleanup(value); cleanup(incompatible); }
});

test("lifecycle initializes a nested Git root once with exact non-shell arguments", () => {
  const value = fixture();
  try {
    const result = core.lifecycle({ runtime: "vscode", cwd: value.nested, home: value.home, env: value.env, configFile: value.configFile });
    assert.equal(result.status, "ready"); assert.equal(result.workspace_root, fs.realpathSync(value.workspace));
    assert.deepEqual(calls(value), [["--version"], ["init", fs.realpathSync(value.workspace), "--agents=none"]]);
    assert.deepEqual(JSON.parse(fs.readFileSync(value.configFile, "utf8")).mcpServers[core.SERVER], core.managedServer(fs.realpathSync(value.workspace)));
    core.lifecycle({ cwd: value.nested, home: value.home, env: value.env, configFile: value.configFile });
    assert.equal(calls(value).filter((args) => args[0] === "init").length, 1);
  } finally { cleanup(value); }
});

test("compatible CodeGraph is unavailable until the workspace has valid Pulso configuration", () => {
  for (const runtime of ["vscode", "opencode"]) {
    for (const configuration of [null, "---\nschema_version: 2\nartifacts: untracked\n---\n", "---\nschema_version: 1\nartifacts: local\n---\n"]) {
      const value = fixture({ pulso: false }); const configFile = runtime === "vscode" ? value.configFile : path.join(value.workspace, ".opencode", "opencode.jsonc");
      try {
        if (configuration) fs.writeFileSync(path.join(value.workspace, "PULSO.md"), configuration);
        fs.mkdirSync(path.join(value.workspace, ".pulso"), { recursive: true });
        fs.mkdirSync(path.join(value.workspace, ".codegraph")); fs.writeFileSync(path.join(value.workspace, ".codegraph", "codegraph.db"), "SQLite format 3\0");
        fs.mkdirSync(path.dirname(configFile), { recursive: true }); fs.writeFileSync(configFile, "{}\n");
        fs.writeFileSync(`${configFile}.pulso-codegraph.json`, JSON.stringify({ managed_by: "pulso" }));
        const result = core.lifecycle({ runtime, cwd: value.workspace, home: value.home, env: value.env, configFile });
        assert.equal(result.status, "not_initialized_with_pulso"); assert.equal(result.available, false); assert.equal(result.fallback, "native read/search/LSP/terminal");
        assert.deepEqual(calls(value), [["--version"]]);
        assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8")).mcpServers || JSON.parse(fs.readFileSync(configFile, "utf8")).mcp, undefined);
        assert.equal(fs.existsSync(`${configFile}.pulso-codegraph.json`), true);
      } finally { cleanup(value); }
    }
  }
});

test("lifecycle handles failed and existing indexes and supports non-Git workspaces", () => {
  const failed = fixture({ init: false }); const indexed = fixture({ git: false });
  try {
    assert.equal(core.lifecycle({ cwd: failed.workspace, home: failed.home, env: failed.env, configFile: failed.configFile }).status, "init_failed");
    fs.mkdirSync(path.join(indexed.workspace, ".codegraph")); fs.writeFileSync(path.join(indexed.workspace, ".codegraph", "codegraph.db"), "SQLite format 3\0");
    const result = core.lifecycle({ runtime: "opencode", cwd: indexed.workspace, home: indexed.home, env: indexed.env, configFile: path.join(indexed.workspace, ".opencode", "opencode.jsonc") });
    assert.equal(result.status, "ready"); assert.equal(result.runtime, "opencode"); assert.equal(calls(indexed).filter((args) => args[0] === "init").length, 0);
  } finally { cleanup(failed); cleanup(indexed); }
});

test("lifecycle is concurrent-safe when another initializer owns the workspace lock", () => {
  const value = fixture();
  try {
    fs.mkdirSync(path.join(value.workspace, ".pulso-codegraph-init.lock"));
    const result = core.lifecycle({ cwd: value.workspace, home: value.home, env: value.env, configFile: value.configFile });
    assert.equal(result.status, "busy_or_error"); assert.equal(calls(value).filter((args) => args[0] === "init").length, 0);
  } finally { cleanup(value); }
});

test("rejects unsafe filesystem, home, and home ancestor roots", () => {
  const value = fixture();
  try {
    assert.throws(() => core.workspaceRoot(path.parse(value.workspace).root, value.home));
    assert.throws(() => core.workspaceRoot(value.home, value.home));
    assert.throws(() => core.workspaceRoot(value.directory, path.join(value.directory, "home")));
  } finally { cleanup(value); }
});

test("workspace JSONC registration preserves comments and removes only an owned matching entry", () => {
  const value = fixture();
  try {
    fs.mkdirSync(path.dirname(value.configFile), { recursive: true }); fs.writeFileSync(value.configFile, '{\n  // keep me\n  "mcpServers": { "other": { "command": "x" } }\n}\n');
    core.updateMcpRegistration({ configFile: value.configFile, cwd: value.workspace, enabled: true });
    const parse = (text) => require("../lib/pulso-jsonc.js").parse(text, [], { allowTrailingComma: true });
    assert.match(fs.readFileSync(value.configFile, "utf8"), /keep me/); assert.ok(parse(fs.readFileSync(value.configFile, "utf8")).mcpServers[core.SERVER]);
    core.updateMcpRegistration({ configFile: value.configFile, cwd: value.workspace, enabled: false });
    assert.deepEqual(parse(fs.readFileSync(value.configFile, "utf8")).mcpServers, { other: { command: "x" } });
    fs.writeFileSync(value.configFile, JSON.stringify({ mcpServers: { [core.SERVER]: { command: "user-codegraph", args: [] } } }));
    core.updateMcpRegistration({ configFile: value.configFile, cwd: value.workspace, enabled: false });
    assert.equal(JSON.parse(fs.readFileSync(value.configFile, "utf8")).mcpServers[core.SERVER].command, "user-codegraph");
  } finally { cleanup(value); }
});

test("lifecycle removes only its exact managed registration after CodeGraph becomes unavailable", () => {
  for (const runtime of ["vscode", "opencode"]) {
    const value = fixture(); const configFile = runtime === "vscode" ? value.configFile : path.join(value.workspace, ".opencode", "opencode.jsonc");
    try {
      core.lifecycle({ runtime, cwd: value.workspace, home: value.home, env: value.env, configFile });
      const missing = core.lifecycle({ runtime, cwd: value.workspace, home: value.home, env: { ...value.env, PATH: "" }, configFile });
      const section = runtime === "vscode" ? "mcpServers" : "mcp";
      assert.equal(missing.status, "missing"); assert.equal(JSON.parse(fs.readFileSync(configFile, "utf8"))[section], undefined);
      assert.equal(fs.existsSync(`${configFile}.pulso-codegraph.json`), false);
    } finally { cleanup(value); }
  }
});

test("unavailable CodeGraph preserves an invalid user-edited workspace configuration and valid ownership sidecar", () => {
  for (const runtime of ["vscode", "opencode"]) {
    for (const unavailable of [
      { name: "missing", fixture: () => fixture(), options: (value) => ({ ...value.env, PATH: "" }) },
      { name: "incompatible", fixture: () => fixture({ version: "2.0.0" }), options: (value) => value.env },
      { name: "init_failed", fixture: () => fixture({ init: false }), options: (value) => value.env }
    ]) {
      const value = unavailable.fixture(); const configFile = runtime === "vscode" ? value.configFile : path.join(value.workspace, ".opencode", "opencode.jsonc");
      try {
        core.updateMcpRegistration({ runtime, configFile, cwd: value.workspace, enabled: true });
        const ownership = fs.readFileSync(`${configFile}.pulso-codegraph.json`, "utf8"); const invalid = "{ invalid JSONC";
        fs.writeFileSync(configFile, invalid);
        const result = core.lifecycle({ runtime, cwd: value.workspace, home: value.home, env: unavailable.options(value), configFile });
        assert.equal(result.status, unavailable.name, `${runtime} ${unavailable.name}`);
        assert.equal(result.mcp.status, "unavailable"); assert.equal(result.mcp.cleanup_failure, "configuration_unavailable");
        assert.equal(fs.readFileSync(configFile, "utf8"), invalid);
        assert.equal(fs.readFileSync(`${configFile}.pulso-codegraph.json`, "utf8"), ownership);
      } finally { cleanup(value); }
    }
  }
});

test("cleanup preserves modified registrations, user registrations, and unrelated workspace content", () => {
  const value = fixture(); const opencode = path.join(value.workspace, ".opencode", "opencode.jsonc");
  try {
    core.updateMcpRegistration({ configFile: value.configFile, cwd: value.workspace, enabled: true });
    const config = JSON.parse(fs.readFileSync(value.configFile, "utf8"));
    config.mcpServers[core.SERVER].command = "user-codegraph"; config.mcpServers.other = { command: "x" };
    fs.writeFileSync(value.configFile, JSON.stringify(config));
    const result = core.cleanupManagedRegistration({ configFile: value.configFile });
    assert.equal(result.managed, false); assert.equal(JSON.parse(fs.readFileSync(value.configFile, "utf8")).mcpServers[core.SERVER].command, "user-codegraph");
    assert.equal(fs.existsSync(`${value.configFile}.pulso-codegraph.json`), false);
    fs.mkdirSync(path.dirname(opencode), { recursive: true }); fs.writeFileSync(opencode, JSON.stringify({ mcp: { [core.SERVER]: { type: "local", command: ["user"], cwd: value.workspace } }, other: true }));
    fs.writeFileSync(`${opencode}.pulso-codegraph.json`, JSON.stringify({ managed_by: "pulso", server: core.SERVER, cwd: value.workspace, runtime: "opencode", configuration: core.openCodeServer(value.workspace) }));
    core.cleanupManagedRegistration({ configFile: opencode });
    assert.equal(JSON.parse(fs.readFileSync(opencode, "utf8")).mcp[core.SERVER].command[0], "user");
    assert.equal(fs.existsSync(path.dirname(opencode)), true);
  } finally { cleanup(value); }
});

test("failed initialization and incompatible CodeGraph clean a matching prior registration", () => {
  const failed = fixture({ init: false }); const incompatible = fixture({ version: "2.0.0" });
  try {
    for (const value of [failed, incompatible]) core.updateMcpRegistration({ configFile: value.configFile, cwd: value.workspace, enabled: true });
    assert.equal(core.lifecycle({ cwd: failed.workspace, home: failed.home, env: failed.env, configFile: failed.configFile }).status, "init_failed");
    assert.equal(core.lifecycle({ cwd: incompatible.workspace, home: incompatible.home, env: incompatible.env, configFile: incompatible.configFile }).status, "incompatible");
    for (const value of [failed, incompatible]) {
      assert.equal(JSON.parse(fs.readFileSync(value.configFile, "utf8")).mcpServers, undefined);
      assert.equal(fs.existsSync(`${value.configFile}.pulso-codegraph.json`), false);
    }
  } finally { cleanup(failed); cleanup(incompatible); }
});

test("uses the pinned, verified read-only MCP protocol and identity remains verified", () => {
  const server = core.managedServer("/workspace");
  assert.deepEqual(server.args, ["serve", "--mcp"]); assert.deepEqual(server.env.CODEGRAPH_MCP_TOOLS.split(","), core.TOOLS);
  assert.equal(core.TOOLS.every((name) => name.startsWith("codegraph_") && !/(init|sync|edit|delete|admin)/.test(name)), true);
  assert.deepEqual(core.TOOL_PROFILE, { package: "@bbva-genai/codegraph", version: "1.0.0", tools: core.TOOLS });
  const identity = require("../lib/pulso-identity.js").resolveIdentity(); assert.equal(identity.creator.role, "Ingeniero");
});

test("the MCP profile gives a child only the exact verified tool allowlist", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-codegraph-mcp-profile-"));
  try {
    const child = path.join(directory, "mock-mcp.js");
    fs.writeFileSync(child, `const expected=JSON.parse(process.argv[2]);const actual=(process.env.CODEGRAPH_MCP_TOOLS||'').split(',').filter(Boolean);if(JSON.stringify(actual)!==JSON.stringify(expected))process.exit(2);process.stdout.write(JSON.stringify({tools:actual})+'\\n');`);
    const result = spawnSync(process.execPath, [child, JSON.stringify(core.TOOLS)], { env: { ...process.env, ...core.managedServer("/workspace").env }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(JSON.parse(result.stdout).tools, core.TOOLS);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("the OpenCode MCP wrapper overwrites a caller-supplied CodeGraph tool profile", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-codegraph-mcp-wrapper-"));
  try {
    const bin = path.join(directory, "bin"); const workspace = path.join(directory, "workspace"); const received = path.join(directory, "received");
    fs.mkdirSync(bin); fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(bin, "codegraph"), `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(process.env.CODEGRAPH_RECEIVED,process.env.CODEGRAPH_MCP_TOOLS||'');\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [path.join(__dirname, "..", "bin", "pulso-codegraph-mcp.js"), workspace], {
      env: { ...process.env, CODEGRAPH_MCP_TOOLS: "codegraph_delete,codegraph_admin", CODEGRAPH_RECEIVED: received, PATH: `${bin}${path.delimiter}${process.env.PATH}` }, encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(received, "utf8"), core.TOOLS.join(","));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("OpenCode local MCP configuration uses the workspace-root wrapper, not unsupported cwd", () => {
  const server = core.openCodeServer("/workspace");
  assert.deepEqual(server.command.slice(0, 2), ["node", path.join(__dirname, "..", "bin", "pulso-codegraph-mcp.js")]);
  assert.equal(server.command[2], "/workspace");
  assert.equal(Object.hasOwn(server, "cwd"), false);
});

test("OpenCode plugin awaits one primary chat activation before tool resolution", async () => {
  const pluginModule = await import("../plugins/pulso-codegraph.mjs");
  assert.equal(pluginModule.default, pluginModule.PulsoCodeGraphPlugin);
  const original = { workspaceRoot: core.workspaceRoot, lifecycle: core.lifecycle, openCodeServer: core.openCodeServer };
  const root = "/safe/workspace"; const lifecycleCalls = []; const additions = [];
  let resolveLifecycle; let resolveAdd;
  core.workspaceRoot = () => root;
  core.lifecycle = (options) => {
    lifecycleCalls.push(options);
    return new Promise((resolve) => { resolveLifecycle = () => resolve({ status: "ready", mcp: { registered: true } }); });
  };
  core.openCodeServer = (cwd) => ({ type: "local", command: ["node", "wrapper", cwd], environment: {} });
  try {
    const plugin = await pluginModule.default({ directory: "/safe/workspace/nested", client: { mcp: { add: (options) => {
      additions.push(options);
      return new Promise((resolve) => { resolveAdd = resolve; });
    } } } });
    assert.equal(lifecycleCalls.length, 0, "construction must not run lifecycle");
    await plugin["chat.message"]({ agent: "pulso-executor", sessionID: "subagent" }, {});
    assert.equal(lifecycleCalls.length, 0, "subagents must not activate CodeGraph");
    const first = plugin["chat.message"]({ agent: "pulso", sessionID: "primary" }, {});
    const second = plugin["chat.message"]({ agent: "pulso", sessionID: "primary" }, {});
    await nextTurn();
    assert.equal(lifecycleCalls.length, 1, "concurrent primary messages share lifecycle work");
    assert.equal(additions.length, 0, "the hook waits for lifecycle before adding MCP");
    resolveLifecycle();
    await nextTurn();
    assert.equal(additions.length, 1, "the hook waits for MCP registration");
    let settled = false;
    void first.then(() => { settled = true; });
    await nextTurn();
    assert.equal(settled, false, "chat.message must not resolve before mcp.add");
    resolveAdd();
    await Promise.all([first, second]);
    assert.deepEqual(lifecycleCalls, [{ runtime: "opencode", cwd: root, home: process.env.HOME, configFile: path.join(root, ".opencode", "opencode.jsonc") }]);
    assert.deepEqual(additions, [{ query: { directory: root }, body: { name: core.SERVER, config: core.openCodeServer(root) } }]);
    await plugin["chat.message"]({ agent: "pulso-executor", sessionID: "delegated" }, {});
    assert.equal(lifecycleCalls.length, 1, "delegation reuses the primary instance's CodeGraph registration");
    assert.equal(plugin["chat.params"], undefined);
    assert.equal(plugin.event, undefined);
  } finally {
    Object.assign(core, original);
  }
});

test("OpenCode plugin fails open and only dynamically adds ready CodeGraph", async () => {
  const { default: pluginFactory } = await import("../plugins/pulso-codegraph.mjs");
  const original = { workspaceRoot: core.workspaceRoot, lifecycle: core.lifecycle, openCodeServer: core.openCodeServer };
  const root = "/safe/workspace"; const additions = [];
  core.workspaceRoot = () => root;
  core.openCodeServer = () => ({ type: "local", command: ["node", "wrapper", root] });
  try {
    for (const result of [
      { status: "missing", mcp: { registered: false } },
      { status: "incompatible", mcp: { registered: false } },
      { status: "not_initialized_with_pulso", mcp: { registered: false } },
      { status: "init_failed", mcp: { registered: false } },
      { status: "busy_or_error" },
      { status: "ready", mcp: { registered: false } }
    ]) {
      core.lifecycle = () => result;
      const plugin = await pluginFactory({ directory: root, client: { mcp: { add: async (options) => additions.push(options) } } });
      await assert.doesNotReject(plugin["chat.message"]({ agent: "pulso", sessionID: result.status }, {}));
      assert.deepEqual(plugin.codegraphDiagnostic(result.status), { status: result.status });
    }
    core.lifecycle = () => { throw new Error("unavailable"); };
    const plugin = await pluginFactory({ directory: root, client: { mcp: { add: async (options) => additions.push(options) } } });
    await assert.doesNotReject(plugin["chat.message"]({ agent: "pulso", sessionID: "error" }, {}));
    assert.deepEqual(plugin.codegraphDiagnostic("error"), { status: "unavailable" });
    core.lifecycle = () => ({ status: "ready", mcp: { registered: true } });
    const rejectedAdd = await pluginFactory({ directory: root, client: { mcp: { add: async () => { throw new Error("unavailable"); } } } });
    await assert.doesNotReject(rejectedAdd["chat.message"]({ agent: "pulso", sessionID: "mcp-error" }, {}));
    assert.deepEqual(rejectedAdd.codegraphDiagnostic("mcp-error"), { status: "mcp_add_failed" });
    assert.equal(additions.length, 0);
  } finally {
    Object.assign(core, original);
  }
});
