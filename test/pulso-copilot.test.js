"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("keeps Pulso opt-in in package installation commands", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts;
  for (const name of ["install:local", "install:local:force", "install:opencode", "install:both"]) {
    assert.doesNotMatch(scripts[name], /--set-default/, name);
  }
});

test("ships a valid Copilot plugin with every Pulso agent", () => {
  const plugin = JSON.parse(fs.readFileSync(path.join(root, "plugin.json"), "utf8"));
  const hooks = JSON.parse(fs.readFileSync(path.join(root, "com.github.copilot", "hooks", "hooks.json"), "utf8"));
  assert.equal(plugin.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(plugin.name, "pulso");
  assert.equal(fs.existsSync(path.join(root, "mcp.json")), false);
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["postToolUse", "postToolUseFailure", "preToolUse", "sessionEnd", "subagentStart", "subagentStop"]);
  for (const entries of [hooks.hooks.preToolUse, hooks.hooks.postToolUse, hooks.hooks.postToolUseFailure]) {
    assert.match(entries[0].matcher, /apply_patch/);
    assert.match(entries[0].matcher, /bash/);
  }
  assert.equal(hooks.hooks.subagentStart[0].matcher, "pulso-planner|pulso-executor");
  const sources = fs.readdirSync(path.join(root, "agents")).filter((name) => name.endsWith(".md") && name !== "pulso-contact-manager.md").sort();
  const generated = fs.readdirSync(path.join(root, "copilot", "profiles", "openai", "agents")).filter((name) => name.endsWith(".agent.md")).map((name) => name.replace(".agent.md", ".md")).sort();
  assert.deepEqual(generated, sources);
  assert.equal(generated.includes("pulso-contact-manager.md"), false);
  assert.equal(fs.existsSync(path.join(root, "com.github.copilot", "agents")), false);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso-planner.agent.md"), "utf8"), /model: gpt-5\.6-terra/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "claude", "agents", "pulso-planner.agent.md"), "utf8"), /model: claude-sonnet-5/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "claude", "agents", "pulso.agent.md"), "utf8"), /model: claude-sonnet-5/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "claude", "agents", "pulso-explorer.agent.md"), "utf8"), /model: claude-haiku-4\.5/);
  const copilotPulso = fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso.agent.md"), "utf8");
  assert.doesNotMatch(copilotPulso, /gpt-5\.6-sol|claude-opus/);
  assert.match(copilotPulso, /"ask_user"/);
  assert.match(copilotPulso, /never call `task_complete`/);
  assert.match(copilotPulso, /canonical identity is provided by `pulso_identity`/);
  assert.equal(copilotPulso.includes(require("../lib/pulso-identity.js").resolveIdentity().creator), false);
  assert.doesNotMatch(copilotPulso, /pulso_agent_contacts|PULSO_CONTACT_ID/);
  assert.doesNotMatch(copilotPulso, /omit `objective_id`/);
  assert.doesNotMatch(copilotPulso, /Hooks supply/);
  const tools = (name) => JSON.parse(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", `${name}.agent.md`), "utf8").match(/^tools: (.+)$/m)[1]);
  assert.equal(tools("pulso").includes("pulso-control/pulso_lease"), false);
  assert.equal(tools("pulso").includes("pulso-control/pulso_lease_diagnostic"), true);
  assert.equal(tools("pulso").filter((name) => name.startsWith("pulso-control/")).length, 20);
  assert.equal(tools("pulso-planner").some((name) => name.startsWith("pulso-control/")), false);
  assert.deepEqual(tools("pulso-executor").filter((name) => name.startsWith("pulso-control/")), ["pulso-control/pulso_lease"]);
  assert.match(copilotPulso, /mcp-servers:\n  pulso-control:/);
  assert.match(copilotPulso, /user-invocable: true/);
  assert.match(copilotPulso, /pulso_primary_write/);
  assert.match(copilotPulso, /pulso_primary_metadata/);
  assert.match(copilotPulso, /pulso_primary_artifacts/);
  assert.doesNotMatch(copilotPulso, /"edit"|"execute"/);
  assert.doesNotMatch(copilotPulso, /Run repository and Git commands directly through `bash`/);
  assert.match(copilotPulso, /Do not use bash or edit/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso-executor.agent.md"), "utf8"), /mcp-servers:\n  pulso-control:/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso-planner.agent.md"), "utf8"), /mcp-servers:/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso-executor.agent.md"), "utf8"), /owner_session/);
  assert.match(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso-executor.agent.md"), "utf8"), /user-invocable: false/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, "copilot", "profiles", "openai", "agents", "pulso-explorer.agent.md"), "utf8"), /GitHub Copilot CLI custom agent/);
  for (const profile of ["openai", "claude"]) {
    for (const name of fs.readdirSync(path.join(root, "copilot", "profiles", profile, "agents"))) {
      const agent = fs.readFileSync(path.join(root, "copilot", "profiles", profile, "agents", name), "utf8");
      assert.doesNotMatch(agent, /gpt-5\.6-sol|claude-opus/);
       assert.match(agent, /user-invocable: (?:true|false)/);
       if (name === "pulso.agent.md") {
         assert.doesNotMatch(agent, /Run repository and Git commands directly through `bash`/);
         assert.doesNotMatch(agent, /for `untracked`, add `\.pulso\//);
         assert.doesNotMatch(agent, /pulso_lease\(action="status"\)/);
         assert.match(agent, /pulso_lease_diagnostic\(action="status"\)/);
         assert.match(agent, /pulso_primary_artifacts/);
       }
       if (name === "pulso-executor.agent.md") assert.match(agent, /pulso_lease/);
      if (!/^(pulso|pulso-executor)\.agent\.md$/.test(name)) assert.doesNotMatch(agent, /mcp-servers:/);
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
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: directory }).status, 0);
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
    for (const name of ["pulso_route", "pulso_lease", "pulso_lease_diagnostic", "pulso_identity", "pulso_primary_metadata", "pulso_primary_write", "pulso_primary_artifacts", "pulso_primary_git", "pulso_dashboard", "pulso_doctor", "pulso_experience_start", "pulso_experience_finalize", "pulso_memory_recall", "pulso_metrics"]) {
      assert.ok(tools.tools.some((item) => item.name === name), name);
    }
    for (const item of tools.tools.filter((tool) => tool.name.startsWith("pulso_experience_") || tool.name.startsWith("pulso_memory_") || tool.name === "pulso_profile_recall" || tool.name === "pulso_metrics")) {
      assert.equal(Object.hasOwn(item.inputSchema.properties, "session_id"), false, item.name);
    }
    assert.ok(tools.tools.find((item) => item.name === "pulso_experience_finalize").inputSchema.required.includes("objective_id"));
    const routed = await client.callTool({ name: "pulso_route", arguments: { objective: "Fix a bounded display defect" } });
    assert.equal(JSON.parse(routed.content[0].text).route, "fast");
    const canonicalIdentity = JSON.parse((await client.callTool({ name: "pulso_identity", arguments: {} })).content[0].text);
    assert.equal(crypto.createHash("sha256").update(canonicalIdentity.creator).digest("hex"), "6b5a905fd6c4b2ac81897a012636a0c52e7bd7a44254f5ecbffe9484ac016d24");
    const firstDoctor = JSON.parse((await client.callTool({ name: "pulso_doctor", arguments: {} })).content[0].text);
    assert.equal(firstDoctor.project.directory, fs.realpathSync(directory));
    assert.equal(firstDoctor.token_tracking, "unavailable");
    assert.equal(firstDoctor.status, "healthy");
    const pulsoMetadata = JSON.parse((await client.callTool({ name: "pulso_primary_metadata", arguments: { path: "PULSO.md" } })).content[0].text);
    assert.equal(pulsoMetadata.exists, true);
    assert.match(pulsoMetadata.digest, /^[a-f0-9]{64}$/);
    const updatedPulso = await client.callTool({ name: "pulso_primary_write", arguments: { path: "PULSO.md", content: "---\nschema_version: 1\nartifacts: tracked\n---\n\n## Project Rules\n", expected_digest: pulsoMetadata.digest } });
    assert.equal(updatedPulso.isError, undefined);
    assert.equal((await client.callTool({ name: "pulso_primary_metadata", arguments: { path: "../escape" } })).isError, true);
    const initialState = JSON.stringify({ revision: 1, value: "before" });
    const created = await client.callTool({ name: "pulso_primary_write", arguments: { path: ".pulso/state.json", content: initialState, expected_absent: true } });
    assert.equal(created.isError, undefined);
    const competing = await Promise.all([
      client.callTool({ name: "pulso_primary_write", arguments: { path: ".pulso/state.json", content: JSON.stringify({ revision: 2, value: "first" }), expected_revision: 1 } }),
      client.callTool({ name: "pulso_primary_write", arguments: { path: ".pulso/state.json", content: JSON.stringify({ revision: 2, value: "second" }), expected_revision: 1 } }),
    ]);
    assert.equal(competing.filter((result) => !result.isError).length, 1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory, ".pulso", "state.json"), "utf8")).revision, 2);
    const stale = await client.callTool({ name: "pulso_primary_write", arguments: { path: ".pulso/state.json", content: JSON.stringify({ revision: 2 }), expected_revision: 0 } });
    assert.equal(stale.isError, true);
    const malformed = await client.callTool({ name: "pulso_primary_write", arguments: { path: ".pulso/state.json", content: "{", expected_revision: 1 } });
    assert.equal(malformed.isError, true);
    const escapedWrite = await client.callTool({ name: "pulso_primary_write", arguments: { path: "../escape", content: "x", expected_absent: true } });
    assert.equal(escapedWrite.isError, true);
    fs.symlinkSync(os.tmpdir(), path.join(directory, ".pulso", "linked"));
    assert.equal((await client.callTool({ name: "pulso_primary_metadata", arguments: { path: ".pulso/linked/state.json" } })).isError, true);
    const linkedWrite = await client.callTool({ name: "pulso_primary_write", arguments: { path: ".pulso/linked/state.json", content: "{}", expected_absent: true } });
    assert.equal(linkedWrite.isError, true);
    const originalLease = Buffer.from('{"legacy":true}\r\n', "utf8");
    fs.mkdirSync(path.join(directory, ".pulso", "leases"), { recursive: true });
    fs.writeFileSync(path.join(directory, ".pulso", "leases", "PULSO-777.json"), originalLease);
    const probe = await client.callTool({ name: "pulso_lease_diagnostic", arguments: { action: "probe", task_id: "PULSO-777" } });
    assert.equal(probe.isError, undefined);
    assert.deepEqual(fs.readFileSync(path.join(directory, ".pulso", "leases", "PULSO-777.json")), originalLease);
    const cleanProbe = await client.callTool({ name: "pulso_lease_diagnostic", arguments: { action: "probe", task_id: "PULSO-778" } });
    assert.equal(cleanProbe.isError, undefined);
    assert.equal(fs.existsSync(path.join(directory, ".pulso", "leases", "PULSO-778.json")), false);
    const badRevision = await client.callTool({ name: "pulso_primary_git", arguments: { action: "show", revision: "--output=/tmp/x" } });
    assert.equal(badRevision.isError, true);
    const malformedRevision = await client.callTool({ name: "pulso_primary_git", arguments: { action: "rev_parse", revision: "HEAD:path" } });
    assert.equal(malformedRevision.isError, true);
    fs.writeFileSync(path.join(directory, ".git", "info", "exclude"), "custom\n.pulso/\nother\n");
    assert.equal((await client.callTool({ name: "pulso_primary_artifacts", arguments: { artifacts: "tracked" } })).isError, undefined);
    assert.equal(fs.readFileSync(path.join(directory, ".git", "info", "exclude"), "utf8"), "custom\nother\n");
    assert.equal((await client.callTool({ name: "pulso_primary_artifacts", arguments: { artifacts: "untracked" } })).isError, undefined);
    assert.equal(fs.readFileSync(path.join(directory, ".git", "info", "exclude"), "utf8"), "custom\nother\n.pulso/\n");
    assert.equal((await client.callTool({ name: "pulso_primary_artifacts", arguments: { artifacts: "untracked" } })).isError, undefined);
    assert.equal(fs.readFileSync(path.join(directory, ".git", "info", "exclude"), "utf8"), "custom\nother\n.pulso/\n");
    fs.rmSync(path.join(directory, ".git", "info", "exclude"));
    assert.equal((await client.callTool({ name: "pulso_primary_artifacts", arguments: { artifacts: "tracked" } })).isError, undefined);
    assert.equal(fs.existsSync(path.join(directory, ".git", "info", "exclude")), false);
    rootsFailure = true;
    assert.equal((await client.callTool({ name: "pulso_doctor", arguments: {} })).isError, true);
    rootsFailure = false;
    fs.mkdirSync(path.join(directory, ".pulso", "tasks"), { recursive: true });
    fs.writeFileSync(path.join(directory, ".pulso", "tasks", "PULSO-001.json"), JSON.stringify({ id: "PULSO-001", status: "ready", scope: { allowed_paths: ["src/**"], excluded_paths: [] } }));
    const activated = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "subagentStart"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "copilot-session", agentName: "pulso-executor", cwd: directory }),
      encoding: "utf8",
    });
    assert.match(JSON.parse(activated.stdout).additionalContext, /copilot-session/);
    const lease = await client.callTool({ name: "pulso_lease", arguments: { action: "acquire", task_id: "PULSO-001", owner_session: "copilot-session" } });
    assert.equal(JSON.parse(lease.content[0].text).status, "active");
    const inScope = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "copilot-session", toolName: "apply_patch", toolArgs: { patchText: "*** Add File: src/allowed.js\n+x" }, cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(inScope.stdout).permissionDecision, undefined);
    fs.writeFileSync(path.join(directory, ".pulso", "tasks", "PULSO-001.json"), JSON.stringify({ id: "PULSO-001", status: "ready", allowed_paths: ["src/**"], excluded_paths: [] }));
    const legacyInScope = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "copilot-session", toolName: "apply_patch", toolArgs: { patchText: "*** Add File: src/legacy-allowed.js\n+x" }, cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(legacyInScope.stdout).permissionDecision, undefined);
    fs.writeFileSync(path.join(directory, ".pulso", "tasks", "PULSO-001.json"), JSON.stringify({ id: "PULSO-001", status: "ready", scope: { allowed_paths: ["**/*"], excluded_paths: [] } }));
    const escapedScope = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "copilot-session", toolName: "apply_patch", toolArgs: { patchText: "*** Add File: ../escaped.js\n+x" }, cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(escapedScope.stdout).permissionDecision, "deny");
    assert.match(JSON.parse(escapedScope.stdout).permissionDecisionReason, /escapes the workspace/);
    fs.writeFileSync(path.join(directory, ".pulso", "tasks", "PULSO-001.json"), JSON.stringify({ id: "PULSO-001", status: "ready", allowed_paths: ["src/**"], excluded_paths: [] }));
    const outOfScope = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "copilot-session", toolName: "apply_patch", toolArgs: { patchText: "*** Add File: other.js\n+x" }, cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(outOfScope.stdout).permissionDecision, "deny");
    await client.callTool({ name: "pulso_lease", arguments: { action: "release", task_id: "PULSO-001", owner_session: "copilot-session" } });
    const stopped = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "subagentStop"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "copilot-session", agentName: "pulso-executor", cwd: directory }),
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(stopped.stdout), {});
    const started = await client.callTool({ name: "pulso_experience_start", arguments: { action: "new", title: "Copilot identity test", reason: "This verifies explicit Copilot objective identity." } });
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
    const isolated = await client.callTool({ name: "pulso_metrics", arguments: { project_directory: secondDirectory } });
    assert.equal(JSON.parse(isolated.content[0].text).token_tracking, "unavailable");
    const secondStarted = await client.callTool({ name: "pulso_experience_start", arguments: { action: "new", title: "Second Copilot project", reason: "This verifies repository-scoped Copilot sessions.", project_directory: secondDirectory } });
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
    const finalized = await resumedClient.callTool({ name: "pulso_experience_finalize", arguments: { objective_id: objectiveID, title: "Copilot identity test", status: "failed", summary: "Explicit objective identity remained available across MCP processes.", evidence: ["MCP lifecycle test"] } });
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
    assert.equal((await noRootsClient.callTool({ name: "pulso_doctor", arguments: {} })).isError, undefined);
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

test("Copilot hook stays dormant without a lease and enforces an active Pulso task", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-copilot-hook-"));
  try {
    fs.writeFileSync(path.join(directory, "PULSO.md"), "---\nartifacts: tracked\n---\n\n## Project Rules\n- Keep tests focused.\n");
    let result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "sessionStart"], {
      cwd: directory,
      input: JSON.stringify({ hookEventName: "sessionStart", cwd: directory }),
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(result.stdout), {});
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "subagentStart"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "pulso-session", agentName: "pulso-executor", cwd: directory }),
      encoding: "utf8",
    });
    assert.match(JSON.parse(result.stdout).additionalContext, /pulso-session/);
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "subagentStart"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "ordinary-session", agentName: "explore", cwd: directory }),
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(result.stdout), {});
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "ordinary-session", toolName: "apply_patch", cwd: directory }),
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(result.stdout), {});

    fs.mkdirSync(path.join(directory, ".pulso", "leases"), { recursive: true });
    fs.mkdirSync(path.join(directory, ".pulso", "circuit-breakers"), { recursive: true });
    fs.writeFileSync(path.join(directory, ".pulso", "leases", "PULSO-001.json"), JSON.stringify({ task_id: "PULSO-001", status: "active", owner_session: "pulso-session", expires_at: new Date(Date.now() + 60000).toISOString(), heartbeat_at: new Date().toISOString() }));
    fs.writeFileSync(path.join(directory, ".pulso", "circuit-breakers", "PULSO-001.json"), JSON.stringify({ state: "open", trip_reason: "repeated validation failure" }));
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ toolName: "apply_patch", cwd: directory }),
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(result.stdout), {});
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "ordinary-session", toolName: "apply_patch", cwd: directory }),
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(result.stdout), {});
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "pulso-session", toolName: "apply_patch", cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(result.stdout).permissionDecision, "deny");
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "pulso-session", toolName: "bash", toolArgs: { command: "git status" }, cwd: directory }),
      encoding: "utf8",
    });
    assert.equal(JSON.parse(result.stdout).permissionDecision, "deny");
    result = spawnSync(process.execPath, [path.join(root, "copilot", "pulso-hook.mjs"), "preToolUse"], {
      cwd: directory,
      input: JSON.stringify({ sessionId: "pulso-session", toolName: "bash", toolArgs: { command: "npm test" }, cwd: directory }),
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
    const installedPulso = fs.readFileSync(path.join(directory, "home", "agents", "pulso.agent.md"), "utf8");
    assert.ok(installedPulso.includes(path.join(root, "copilot", "dist", "pulso-mcp-server.mjs")));
    assert.doesNotMatch(installedPulso, /__PULSO_MCP_SERVER__/);
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

test("OpenCode migrates only managed legacy Pulso agent models", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-opencode-legacy-model-"));
  try {
    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), JSON.stringify({ agent: {
      "pulso-code-auditor": { model: "github-copilot/gpt-5.6-terra" },
      "pulso-unknown-auditor": { model: "github-copilot/gpt-5.6-terra" },
    } }));
    let result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "install", "--profile", "openai"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    let config = JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"));
    assert.equal(config.agent["pulso-code-auditor"], undefined);
    assert.equal(config.agent["pulso-unknown-auditor"].model, "github-copilot/gpt-5.6-terra");
    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), JSON.stringify({ agent: { "pulso-code-auditor": { model: "custom/auditor" } } }));
    result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "uninstall"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    config = JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"));
    assert.equal(config.agent["pulso-code-auditor"].model, "custom/auditor");
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("OpenCode installer uses versatile openai provider and enforces copilot provider for claude", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-opencode-provider-"));
  try {
    // 1. Explicit --provider openai
    let result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "install", "--profile", "openai", "--provider", "openai"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    let config = JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"));
    assert.equal(config.agent.pulso.model, "openai/gpt-5.6-terra");
    assert.equal(config.agent["pulso-explorer"].model, "openai/gpt-5.6-luna");
    assert.equal(JSON.parse(fs.readFileSync(path.join(configRoot, "pulso-profile.json"), "utf8")).provider, "openai");

    // 2. Auto-detection when existing config uses openai/ models
    result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "install", "--profile", "openai"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    config = JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"));
    assert.equal(config.agent.pulso.model, "openai/gpt-5.6-terra");

    // 3. Claude profile always enforces github-copilot provider
    result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "install", "--profile", "claude", "--provider", "openai"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    config = JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"));
    assert.equal(config.agent.pulso.model, "github-copilot/claude-sonnet-5");
    assert.equal(config.agent["pulso-explorer"].model, "github-copilot/claude-haiku-4.5");
    assert.equal(JSON.parse(fs.readFileSync(path.join(configRoot, "pulso-profile.json"), "utf8")).provider, "github-copilot");

    // 4. Dynamic mode unpins agent models so they inherit whichever session model is active
    result = spawnSync(process.execPath, [path.join(root, "scripts", "install.mjs"), "install", "--dynamic", "--force"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    config = JSON.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"));
    assert.equal(config.agent.pulso?.model, undefined);
    assert.equal(config.agent["pulso-executor"]?.model, undefined);
    assert.equal(JSON.parse(fs.readFileSync(path.join(configRoot, "pulso-profile.json"), "utf8")).dynamic, true);
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});
