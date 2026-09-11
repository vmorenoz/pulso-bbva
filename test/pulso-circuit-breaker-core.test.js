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

test("migrates a persisted legacy token-cap circuit when the plugin starts", async () => {
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
    await PulsoCircuitBreakerPlugin({ directory, client: {} });
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(state.state, "closed");
    assert.equal(state.trip_reason, null);
    assert.equal(state.limits.maxTokens, undefined);
    assert.equal(state.token_usage, 105414);
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
    await hooks["chat.message"](
      { agent: "pulso-executor", sessionID: "session-b" },
      { parts: [{ text: "PULSO_TASK_ID=PULSO-001" }] },
    );
    await assert.rejects(
      () => hooks["tool.execute.before"](
        { sessionID: "session-b", tool: "edit" },
        { args: { filePath: "src/app.js" } },
      ),
      /active lease owned by this session/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
