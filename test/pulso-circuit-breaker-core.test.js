"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const core = require("../lib/pulso-circuit-breaker-core.js");

test("opens after two identical validation errors", () => {
  const state = core.createState("PULSO-001");
  core.recordValidation(state, "npm test", "Error at src/a.ts:10:2", true);
  core.recordRepairAction(state);
  core.recordValidation(state, "npm test", "Error at src/a.ts:10:2", true);
  assert.equal(state.state, "open");
  assert.equal(state.trip_reason, "repeated_validation_error");
});

test("opens after three failed repair cycles", () => {
  const state = core.createState("PULSO-001");
  core.recordValidation(state, "npm test", "first error", true);
  core.recordRepairAction(state);
  core.recordValidation(state, "npm test", "second error", true);
  core.recordRepairAction(state);
  core.recordValidation(state, "npm test", "third error", true);
  core.recordRepairAction(state);
  core.recordValidation(state, "npm test", "fourth error", true);
  assert.equal(state.state, "open");
  assert.equal(state.trip_reason, "repair_cycle_limit");
});

test("successful validation resets failure counters", () => {
  const state = core.createState("PULSO-001");
  core.recordValidation(state, "npm test", "failure", true);
  core.recordValidation(state, "npm test", "all tests passed", false);
  assert.equal(state.repair_cycles, 0);
  assert.equal(state.repeated_error_count, 0);
});

test("records runner infrastructure failures without opening the circuit", () => {
  const state = core.createState("PULSO-001");
  core.recordValidation(state, "pnpm exec vitest run", "Startup Error: no project had a browser configuration", true);
  core.recordRepairAction(state);
  core.recordValidation(state, "pnpm exec vitest run", "Startup Error: no project had a browser configuration", true);
  assert.equal(state.state, "closed");
  assert.equal(state.infrastructure_failures, 2);
  assert.equal(state.validation_failures, 0);
  assert.equal(state.last_validation.failure_kind, "infrastructure");
});

test("recognizes missing browser executables as infrastructure failures", () => {
  const state = core.createState("PULSO-001");
  core.recordValidation(state, "pnpm exec vitest run --browser", "browserType.launch: Executable doesn't exist at /tmp/chromium", true);
  core.recordRepairAction(state);
  core.recordValidation(state, "pnpm exec vitest run --browser", "browserType.launch: Executable doesn't exist at /tmp/chromium", true);
  assert.equal(state.state, "closed");
  assert.equal(state.infrastructure_failures, 2);
});

test("recognizes runner process and port startup failures as infrastructure", () => {
  assert.equal(core.isInfrastructureFailure("sh: vitest: command not found"), true);
  assert.equal(core.isInfrastructureFailure("Error: listen EADDRINUSE: address already in use"), true);
  assert.equal(core.isInfrastructureFailure("Expected refreshed persisted TSEC"), false);
});

test("multiple failed commands in one attempt do not count as repair cycles", () => {
  const state = core.createState("PULSO-001");
  core.recordValidation(state, "npm test", "test failure", true);
  core.recordValidation(state, "npm run lint", "lint failure", true);
  assert.equal(state.repair_cycles, 0);
  core.recordRepairAction(state);
  assert.equal(state.repair_cycles, 0);
  assert.equal(state.state, "closed");
});

test("a different successful command does not erase an unresolved failure", () => {
  const state = core.createState("PULSO-001");
  core.recordValidation(state, "npm test", "test failure", true);
  core.recordValidation(state, "npm run lint", "lint passed", false);
  core.recordRepairAction(state);
  core.recordValidation(state, "npm test", "different failure", true);
  assert.equal(state.repair_cycles, 1);
});

test("hydrates legacy state before recording metrics", () => {
  const state = { task_id: "PULSO-001", state: "closed" };
  core.recordTokens(state, { input: 2, output: 3, reasoning: 1 }, "session-a");
  core.addSession(state, "session-a");
  assert.equal(state.token_usage, 6);
  assert.deepEqual(state.active_sessions, ["session-a"]);
  assert.equal(state.limits.maxRepairCycles, 3);
});

test("records tokens without opening the circuit", () => {
  const state = core.createState("PULSO-001");
  core.recordTokens(state, { input: 4, output: 4, reasoning: 3 }, "session-a");
  assert.equal(state.token_usage, 11);
  assert.equal(state.state, "closed");
});

test("closes legacy token-cap circuits because tokens are observational", () => {
  const state = {
    ...core.createState("PULSO-001"),
    state: "open",
    limits: { maxRepairCycles: 3, maxRepeatedErrors: 2, maxTokens: 80000 },
    token_usage: 105414,
    trip_reason: "token_cap",
  };
  core.addSession(state, "session-new");
  assert.equal(state.state, "closed");
  assert.equal(state.trip_reason, null);
  assert.equal(state.limits.maxTokens, undefined);
  assert.equal(state.token_usage, 105414);
});

test("defers legacy circuit migration until a Pulso task session starts", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-breaker-"));
  const breakersDirectory = path.join(directory, ".pulso", "circuit-breakers");
  fs.mkdirSync(breakersDirectory, { recursive: true });
  const file = path.join(breakersDirectory, "PULSO-001.json");
  fs.writeFileSync(file, JSON.stringify({
    ...core.createState("PULSO-001"),
    state: "open",
    limits: { maxRepairCycles: 3, maxRepeatedErrors: 2, maxTokens: 80000 },
    token_usage: 105414,
    trip_reason: "token_cap",
  }));
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: {} });
    let state = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(state.state, "open");
    assert.equal(state.limits.maxTokens, 80000);
    await hooks["chat.message"](
      { agent: "build", sessionID: "ordinary-session" },
      { parts: [{ text: "Ordinary work" }] },
    );
    state = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(state.state, "open");
    await hooks["chat.message"](
      { agent: "pulso-executor", sessionID: "pulso-session" },
      { parts: [{ text: "PULSO_TASK_ID=PULSO-001" }] },
    );
    state = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(state.state, "closed");
    assert.equal(state.trip_reason, null);
    assert.equal(state.limits.maxTokens, undefined);
    assert.equal(state.token_usage, 105414);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("releases active leases when their owner session becomes idle", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-session-lease-"));
  const leasesDirectory = path.join(directory, ".pulso", "leases");
  fs.mkdirSync(leasesDirectory, { recursive: true });
  const file = path.join(leasesDirectory, "PULSO-009.json");
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 1,
    task_id: "PULSO-009",
    status: "active",
    owner_session: "failed-explorer-session",
    expires_at: "2999-01-01T00:00:00.000Z",
  }));
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: {} });
    await hooks.event({
      event: {
        type: "session.idle",
        properties: { sessionID: "failed-explorer-session" },
      },
    });
    const lease = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(lease.status, "released");
    assert.equal(lease.release_reason, "session_terminal");
    assert.equal(typeof lease.released_at, "string");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("recovers an orphaned executor lease before redispatch and transfers ownership", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const leases = require("../lib/pulso-lease-core.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-orphan-recovery-"));
  fs.mkdirSync(path.join(directory, ".pulso", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".pulso", "tasks", "PULSO-010.json"), JSON.stringify({
    schema_version: 1,
    revision: 1,
    id: "PULSO-010",
    status: "ready",
    scope: { allowed_paths: ["src/**"], excluded_paths: [] },
  }));
  leases.acquire(directory, "PULSO-010", "dead-session", 30);
  const client = { session: { status: async () => ({ data: {} }) } };
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client });
    await hooks["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Continue" }] });
    await hooks["tool.execute.before"](
      { sessionID: "primary", tool: "task" },
      { args: { subagent_type: "pulso-executor", prompt: "PULSO_TASK_ID=PULSO-010 Continue implementation" } },
    );
    assert.equal(leases.read(directory, "PULSO-010").status, "released");
    assert.equal(leases.read(directory, "PULSO-010").release_reason, "owner_session_inactive");

    await hooks["chat.message"](
      { agent: "pulso-executor", sessionID: "replacement-session" },
      { parts: [{ text: "PULSO_TASK_ID=PULSO-010 Continue implementation" }] },
    );
    const transferred = leases.read(directory, "PULSO-010");
    assert.equal(transferred.status, "active");
    assert.equal(transferred.owner_session, "replacement-session");

    await hooks.event({ event: { type: "session.error", properties: { sessionID: "replacement-session" } } });
    assert.equal(leases.read(directory, "PULSO-010").status, "released");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("injects the internal contract into the worker message without expanding the parent prompt", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-worker-contract-"));
  const taskDirectory = path.join(directory, ".pulso", "tasks");
  fs.mkdirSync(taskDirectory, { recursive: true });
  fs.writeFileSync(path.join(taskDirectory, "PULSO-013.json"), JSON.stringify({
    id: "PULSO-013",
    status: "ready",
    objective: "Implement the scoped change",
    scope: { allowed_paths: ["src/app.js"], excluded_paths: ["package.json"] },
    acceptance_criteria: ["The behavior is observable."],
    validation: ["npm test -- app"],
    skills: ["bbva-engineering"],
    project_rules: "- Keep tests focused.",
  }));
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: {} });
    const output = { parts: [{ type: "text", text: "PULSO_TASK_ID=PULSO-013\nImplement the assigned change." }] };
    await hooks["chat.message"]({ agent: "pulso-executor", sessionID: "worker" }, output);
    assert.equal(output.parts.length, 2);
    assert.equal(output.parts[0].text, "PULSO_TASK_ID=PULSO-013\nImplement the assigned change.");
    assert.match(output.parts[1].text, /PULSO INTERNAL CONTRACT/);
    assert.match(output.parts[1].text, /src\/app\.js/);
    assert.match(output.parts[1].text, /npm test -- app/);
    assert.match(output.parts[1].text, /Keep tests focused/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("refuses redispatch while the current executor remains busy", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const leases = require("../lib/pulso-lease-core.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-live-lease-"));
  leases.acquire(directory, "PULSO-011", "busy-session", 30);
  const client = { session: { status: async () => ({ data: { "busy-session": { type: "busy" } } }) } };
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client });
    await hooks["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Continue" }] });
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "primary", tool: "task" },
        { args: { subagent_type: "pulso-executor", prompt: "PULSO_TASK_ID=PULSO-011 Continue implementation" } },
      ),
      /still has an active executor/,
    );
    assert.equal(leases.read(directory, "PULSO-011").owner_session, "busy-session");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("protects an expired lease while its owner session is still busy", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const leases = require("../lib/pulso-lease-core.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-expired-busy-"));
  const lease = leases.acquire(directory, "PULSO-014", "busy-session", 30);
  lease.expires_at = "2020-01-01T00:00:00.000Z";
  fs.writeFileSync(leases.leasePath(directory, "PULSO-014"), JSON.stringify(lease));
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: { session: { status: async () => ({ data: { "busy-session": { type: "busy" } } }) } } });
    await hooks["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Continue" }] });
    await assert.rejects(() => hooks["tool.execute.before"](
      { sessionID: "primary", tool: "task" },
      { args: { subagent_type: "pulso-executor", prompt: "PULSO_TASK_ID=PULSO-014 Continue" } },
    ), /still has an active executor/);
    assert.equal(leases.read(directory, "PULSO-014").owner_session, "busy-session");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("recovers a stale orphan when session status is temporarily unavailable", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const leases = require("../lib/pulso-lease-core.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-stale-orphan-"));
  const lease = leases.acquire(directory, "PULSO-012", "lost-session", 30);
  lease.heartbeat_at = "2020-01-01T00:00:00.000Z";
  fs.writeFileSync(leases.leasePath(directory, "PULSO-012"), JSON.stringify(lease));
  const client = { session: { status: async () => { throw new Error("server unavailable"); } } };
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client });
    await hooks["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Continue" }] });
    await hooks["tool.execute.before"](
      { sessionID: "primary", tool: "task" },
      { args: { subagent_type: "pulso-executor", prompt: "PULSO_TASK_ID=PULSO-012 Continue implementation" } },
    );
    const recovered = leases.read(directory, "PULSO-012");
    assert.equal(recovered.status, "released");
    assert.equal(recovered.release_reason, "owner_session_unreachable");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps an open-breaker session available for read-only diagnosis", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-breaker-diagnosis-"));
  let abortCalls = 0;
  const client = { session: { abort: async () => { abortCalls += 1; } } };
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client });
    await hooks["chat.message"](
      { agent: "pulso-executor", sessionID: "session-a" },
      { parts: [{ text: "PULSO_TASK_ID=PULSO-001" }] },
    );
    await hooks["tool.execute.after"](
      { sessionID: "session-a", tool: "bash", args: { command: "npm test" } },
      { metadata: { exitCode: 1 }, output: "Expected value A" },
    );
    await hooks["tool.execute.after"]({ sessionID: "session-a", tool: "apply_patch", args: {} }, { output: "ok" });
    await hooks["tool.execute.after"](
      { sessionID: "session-a", tool: "bash", args: { command: "npm test" } },
      { metadata: { exitCode: 1 }, output: "Expected value A" },
    );

    await hooks["tool.execute.before"]({ sessionID: "session-a", tool: "read" }, { args: {} });
    await hooks["tool.execute.before"]({ sessionID: "session-a", tool: "pulso_lease" }, { args: { action: "status" } });
    await hooks["tool.execute.before"]({ sessionID: "session-a", tool: "pulso_lease" }, { args: { action: "release" } });
    await assert.rejects(
      () => hooks["tool.execute.before"]({ sessionID: "session-a", tool: "pulso_lease" }, { args: { action: "acquire" } }),
      /Mutating execution blocked/,
    );
    await assert.rejects(
      () => hooks["tool.execute.before"]({ sessionID: "session-a", tool: "apply_patch" }, { args: {} }),
      /Mutating execution blocked/,
    );
    assert.equal(abortCalls, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("aggregates token usage across task sessions", () => {
  const state = core.createState("PULSO-001");
  core.recordTokens(state, { input: 10, output: 0, reasoning: 0 }, "session-a");
  core.recordTokens(state, { input: 11, output: 0, reasoning: 0 }, "session-b");
  assert.equal(state.token_usage, 21);
  assert.equal(state.state, "closed");
});

test("requires an owned lease and enforces direct mutation scope", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-breaker-scope-"));
  try {
    const taskDirectory = path.join(directory, ".pulso", "tasks");
    const leaseDirectory = path.join(directory, ".pulso", "leases");
    fs.mkdirSync(taskDirectory, { recursive: true });
    fs.mkdirSync(leaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(taskDirectory, "PULSO-001.json"), JSON.stringify({
      id: "PULSO-001", status: "ready", scope: { allowed_paths: ["src/**"], excluded_paths: ["src/generated/**"] },
    }));
    fs.writeFileSync(path.join(leaseDirectory, "PULSO-001.json"), JSON.stringify({
      task_id: "PULSO-001", status: "active", owner_session: "session-a", expires_at: "2999-01-01T00:00:00.000Z",
    }));
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: {} });
    await hooks["chat.message"](
      { agent: "pulso-executor", sessionID: "session-a" },
      { parts: [{ text: "PULSO_TASK_ID=PULSO-001" }] },
    );
    await hooks["tool.execute.before"](
      { sessionID: "session-a", tool: "apply_patch" },
      { args: { patchText: "*** Begin Patch\n*** Update File: src/app.js\n*** End Patch" } },
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "session-a", tool: "apply_patch" },
        { args: { patchText: "*** Begin Patch\n*** Update File: README.md\n*** End Patch" } },
      ),
      /outside PULSO-001 scope/,
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "session-a", tool: "write" },
        { args: { filePath: "src/generated/client.js" } },
      ),
      /outside PULSO-001 scope/,
    );
    await assert.rejects(
      () => hooks["chat.message"](
        { agent: "pulso-executor", sessionID: "session-b" },
        { parts: [{ text: "PULSO_TASK_ID=PULSO-001" }] },
      ),
      /still has an active executor/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("blocks Git integration unless the task is active and leased", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-git-lifecycle-"));
  const taskDirectory = path.join(directory, ".pulso", "tasks");
  fs.mkdirSync(taskDirectory, { recursive: true });
  fs.writeFileSync(path.join(taskDirectory, "PULSO-015.json"), JSON.stringify({
    id: "PULSO-015", status: "implemented", scope: { allowed_paths: ["src/**"], excluded_paths: [] },
  }));
  require("../lib/pulso-lease-core.js").acquire(directory, "PULSO-015", "executor", 30);
  try {
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: {} });
    await hooks["chat.message"]({ agent: "pulso-executor", sessionID: "executor" }, { parts: [{ text: "PULSO_TASK_ID=PULSO-015" }] });
    await assert.rejects(() => hooks["tool.execute.before"](
      { sessionID: "executor", tool: "bash" }, { args: { command: "git commit -m test" } },
    ), /must be resumed before Git integration/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("supports legacy task contracts with mutation scope at the root", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-breaker-legacy-scope-"));
  try {
    const taskDirectory = path.join(directory, ".pulso", "tasks");
    const leaseDirectory = path.join(directory, ".pulso", "leases");
    fs.mkdirSync(taskDirectory, { recursive: true });
    fs.mkdirSync(leaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(taskDirectory, "PULSO-001.json"), JSON.stringify({
      id: "PULSO-001",
      status: "ready",
      allowed_paths: ["PISDR600IMPL/src/main/resources/sql-PISDR600IMPL.properties"],
      excluded_paths: ["**/*"],
    }));
    fs.writeFileSync(path.join(leaseDirectory, "PULSO-001.json"), JSON.stringify({
      task_id: "PULSO-001", status: "active", owner_session: "session-a", expires_at: "2999-01-01T00:00:00.000Z",
    }));
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: {} });
    await hooks["chat.message"](
      { agent: "pulso-executor", sessionID: "session-a" },
      { parts: [{ text: "PULSO_TASK_ID=PULSO-001" }] },
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "session-a", tool: "apply_patch" },
        { args: { patchText: "*** Begin Patch\n*** Update File: PISDR600IMPL/src/main/resources/sql-PISDR600IMPL.properties\n*** End Patch" } },
      ),
      /outside PULSO-001 scope/,
    );
    fs.writeFileSync(path.join(taskDirectory, "PULSO-001.json"), JSON.stringify({
      id: "PULSO-001",
      status: "ready",
      allowed_paths: ["PISDR600IMPL/src/main/resources/sql-PISDR600IMPL.properties"],
      excluded_paths: [],
    }));
    await hooks["tool.execute.before"](
      { sessionID: "session-a", tool: "apply_patch" },
      { args: { patchText: "*** Begin Patch\n*** Update File: PISDR600IMPL/src/main/resources/sql-PISDR600IMPL.properties\n*** End Patch" } },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("allows only discovered probes and registered contacts through native task delegation", async () => {
  const { PulsoCircuitBreakerPlugin } = await import("../plugins/pulso-circuit-breaker.mjs");
  const contacts = require("../lib/pulso-agent-contacts.js");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-contact-guard-"));
  const previousConfig = process.env.OPENCODE_CONFIG_DIR;
  const previousData = process.env.XDG_DATA_HOME;
  try {
    process.env.OPENCODE_CONFIG_DIR = path.join(directory, "config");
    process.env.XDG_DATA_HOME = path.join(directory, "data");
    const agents = path.join(process.env.OPENCODE_CONFIG_DIR, "agents");
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, "oracle-reviewer.md"), "---\ndescription: Reviews Oracle SQL.\nmode: subagent\n---\nReview SQL.\n");
    const candidate = contacts.scan(directory)[0];
    const hooks = await PulsoCircuitBreakerPlugin({ directory, client: {} });
    await hooks["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Coordinate work" }] });

    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "primary", tool: "task" },
        { args: { subagent_type: "oracle-reviewer", prompt: "No markers" } },
      ),
      /required delegation markers/,
    );
    await hooks["tool.execute.before"](
      { sessionID: "primary", tool: "task" },
      { args: { subagent_type: "oracle-reviewer", prompt: "PULSO_CONTACT_PROBE=oracle-reviewer" } },
    );
    await hooks["chat.message"](
      { agent: "oracle-reviewer", sessionID: "probe" },
      { parts: [{ text: "PULSO_CONTACT_PROBE=oracle-reviewer" }] },
    );
    await assert.rejects(
      () => hooks["tool.execute.before"]({ sessionID: "probe", tool: "write" }, { args: { filePath: "profile.txt" } }),
      /probe oracle-reviewer cannot use tools/,
    );

    contacts.register(directory, {
      agent: "oracle-reviewer",
      digest: candidate.digest,
      description: "Oracle SQL specialist",
      use_when: ["Oracle SQL"],
      avoid_when: [],
      capabilities: ["review"],
      mutation: "scoped",
    });
    const prompt = "PULSO_TASK_ID=PULSO-001\nPULSO_CONTACT_ID=oracle-reviewer";
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "primary", tool: "task" },
        { args: { subagent_type: "oracle-reviewer", prompt } },
      ),
      /required delegation markers/,
    );
    const taskDirectory = path.join(directory, ".pulso", "tasks");
    const leaseDirectory = path.join(directory, ".pulso", "leases");
    fs.mkdirSync(taskDirectory, { recursive: true });
    fs.mkdirSync(leaseDirectory, { recursive: true });
    fs.writeFileSync(path.join(taskDirectory, "PULSO-001.json"), JSON.stringify({
      id: "PULSO-001", status: "ready", scope: { allowed_paths: ["src/**"], excluded_paths: [] },
    }));
    fs.writeFileSync(path.join(leaseDirectory, "PULSO-001.json"), JSON.stringify({
      task_id: "PULSO-001", status: "active", owner_session: "contact", expires_at: "2999-01-01T00:00:00.000Z",
    }));
    await hooks["tool.execute.before"](
      { sessionID: "primary", tool: "task" },
      { args: { subagent_type: "oracle-reviewer", prompt } },
    );
    await hooks["chat.message"](
      { agent: "oracle-reviewer", sessionID: "contact" },
      { parts: [{ text: prompt }] },
    );
    await hooks["tool.execute.before"](
      { sessionID: "contact", tool: "write" },
      { args: { filePath: "src/query.sql" } },
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "contact", tool: "bash" },
        { args: { command: "npm test" } },
      ),
      /cannot use bash/,
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "contact", tool: "task" },
        { args: { subagent_type: "general", prompt: "Delegate" } },
      ),
      /cannot use task/,
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "contact", tool: "write" },
        { args: { filePath: ".pulso/tasks/PULSO-001.json" } },
      ),
      /outside PULSO-001 scope/,
    );
    contacts.register(directory, {
      agent: "oracle-reviewer",
      digest: candidate.digest,
      description: "Oracle SQL specialist",
      use_when: ["Oracle SQL"],
      avoid_when: [],
      capabilities: ["review"],
      mutation: "read_only",
    });
    await hooks["chat.message"](
      { agent: "oracle-reviewer", sessionID: "read-only-contact" },
      { parts: [{ text: prompt }] },
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "read-only-contact", tool: "write" },
        { args: { filePath: "src/query.sql" } },
      ),
      /registered as read-only/,
    );
  } finally {
    if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previousConfig;
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
