"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const experienceCore = require("../lib/pulso-experience-core.js");

test("isolates repeated objective ids by project and preserves metrics on finalize", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-experience-engine-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const firstDirectory = path.join(root, "first");
  const secondDirectory = path.join(root, "second");
  fs.mkdirSync(firstDirectory);
  fs.mkdirSync(secondDirectory);
  const client = {
    session: {
      create: async () => ({ data: { id: "curator-session" } }),
      prompt: async () => ({}),
    },
  };
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const first = await PulsoExperienceEnginePlugin({ directory: firstDirectory, client });
    const second = await PulsoExperienceEnginePlugin({ directory: secondDirectory, client });
    await first["chat.message"]({ agent: "pulso", sessionID: "first-run" }, { parts: [{ text: "First objective" }] });
    await second["chat.message"]({ agent: "pulso", sessionID: "second-run" }, { parts: [{ text: "Second objective" }] });
    await first.tool.pulso_experience_start.execute({ action: "new", title: "First objective", reason: "This is a distinct first project objective." }, { directory: firstDirectory, sessionID: "first-run" });
    await second.tool.pulso_experience_start.execute({ action: "new", title: "Second objective", reason: "This is a distinct second project objective." }, { directory: secondDirectory, sessionID: "second-run" });
    await first.event({ event: { type: "message.updated", properties: { info: {
      role: "assistant", sessionID: "first-run", tokens: { input: 5, output: 3, reasoning: 2 }, time: { completed: 1 },
    } } } });

    const firstMetrics = JSON.parse(await first.tool.pulso_metrics.execute({ objective_id: "PULSO-OBJ-001" }, { directory: firstDirectory }));
    const secondMetrics = JSON.parse(await second.tool.pulso_metrics.execute({ objective_id: "PULSO-OBJ-001" }, { directory: secondDirectory }));
    assert.equal(firstMetrics.objectives.length, 1);
    assert.equal(secondMetrics.objectives.length, 1);
    assert.notEqual(firstMetrics.objectives[0].objective_key, secondMetrics.objectives[0].objective_key);
    assert.equal(firstMetrics.objectives[0].tokens, 10);

    await first.tool.pulso_experience_finalize.execute({
      objective_id: "PULSO-OBJ-001",
      title: "Verified objective",
      status: "verified",
      summary: "The objective completed successfully.",
      evidence: ["test:1"],
      human_interventions: 1,
    }, { directory: firstDirectory, sessionID: "parent" });
    const finalized = JSON.parse(await first.tool.pulso_metrics.execute({ objective_id: "PULSO-OBJ-001" }, { directory: firstDirectory }));
    assert.equal(finalized.objectives[0].tokens, 10);
    assert.equal(finalized.objectives[0].human_interventions, 1);
    assert.equal(finalized.objectives[0].status, "verified");
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("migrates the legacy objective schema without losing metrics", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-experience-migration-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  const databaseDirectory = path.join(process.env.XDG_DATA_HOME, "opencode", "pulso");
  fs.mkdirSync(databaseDirectory, { recursive: true });
  const db = new DatabaseSync(path.join(databaseDirectory, "experience.sqlite"));
  const projectKey = experienceCore.projectKey(directory);
  db.exec(`CREATE TABLE objectives (
    id TEXT PRIMARY KEY, project_key TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, tokens INTEGER NOT NULL DEFAULT 0,
    human_interventions INTEGER NOT NULL DEFAULT 0, repair_cycles INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE agent_runs (
    id INTEGER PRIMARY KEY, objective_id TEXT NOT NULL, agent TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
    tokens INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT
  );`);
  db.prepare("INSERT INTO objectives VALUES (?, ?, ?, 'verified', ?, ?, 12, 1, 2)")
    .run("PULSO-009", projectKey, "Legacy objective", "2026-01-01", "2026-01-02");
  db.prepare("INSERT INTO agent_runs VALUES (1, ?, 'pulso-executor', 'legacy-session', 12, '2026-01-01', '2026-01-02')")
    .run("PULSO-009");
  db.close();
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const plugin = await PulsoExperienceEnginePlugin({ directory, client: {} });
    const metrics = JSON.parse(await plugin.tool.pulso_metrics.execute({ objective_id: "PULSO-009" }, { directory }));
    assert.equal(metrics.objectives[0].tokens, 12);
    assert.equal(metrics.objectives[0].repair_cycles, 2);
    assert.equal(metrics.agent_runs[0].tokens, 12);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("tracks and finalizes a primary Pulso session without a task id", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-primary-session-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  const client = {
    session: {
      create: async () => ({ data: { id: "primary-curator" } }),
      prompt: async () => ({}),
    },
  };
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const plugin = await PulsoExperienceEnginePlugin({ directory, client });
    await plugin["chat.message"]({ agent: "pulso", sessionID: "primary-session" }, { parts: [{ text: "Review this project" }] });
    await plugin.tool.pulso_experience_start.execute({ action: "new", title: "Review this project", reason: "This is a distinct project review." }, { directory, sessionID: "primary-session" });
    await plugin.event({ event: { type: "message.updated", properties: { info: {
      role: "assistant", sessionID: "primary-session", tokens: { input: 7, output: 2, reasoning: 1 }, time: { completed: 1 },
    } } } });
    const before = JSON.parse(await plugin.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(before.objectives[0].id, "PULSO-OBJ-001");
    assert.equal(before.objectives[0].title, "Review this project");
    assert.equal(before.objectives[0].tokens, 10);
    await plugin.tool.pulso_experience_finalize.execute({
      title: "Primary session review",
      status: "verified",
      summary: "The primary session completed with verified evidence.",
      evidence: ["test:primary-session"],
      human_interventions: 0,
    }, { directory, sessionID: "primary-session" });
    const after = JSON.parse(await plugin.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(after.objectives[0].status, "verified");
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("does not persist objectives before an explicit new or resume decision", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-objective-evaluation-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const plugin = await PulsoExperienceEnginePlugin({ directory, client: { session: { get: async () => ({ data: {} }) } } });
    await plugin["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Continue previous work" }] });
    await plugin["chat.message"]({ agent: "pulso-executor", sessionID: "orphan" }, { parts: [{ text: "PULSO_TASK_ID=PULSO-999 Validate it" }] });
    let metrics = JSON.parse(await plugin.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(metrics.objectives.length, 0);
    await plugin.tool.pulso_experience_start.execute({ action: "new", title: "Actual objective", reason: "No related incomplete objective or task exists." }, { directory, sessionID: "primary" });
    metrics = JSON.parse(await plugin.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(metrics.objectives.length, 1);
    assert.equal(metrics.objectives[0].title, "Actual objective");
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("attributes child Pulso agents to the primary session objective", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-parent-objective-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  const promptedAgents = [];
  const sessions = {
    "primary-session": { id: "primary-session" },
    "executor-session": { id: "executor-session", parentID: "primary-session" },
  };
  const client = {
    session: {
      get: async ({ path }) => ({ data: sessions[path.id] }),
      create: async ({ body }) => ({ data: { id: body.title.startsWith("Dashboard") ? "pulso-delivery-reporter-session" : "pulso-experience-curator-session" } }),
      prompt: async ({ body }) => { promptedAgents.push(body.agent); },
      messages: async ({ path }) => ({ data: path.id === "pulso-delivery-reporter-session" ? [{
        info: { role: "assistant" },
        parts: [{ type: "text", text: "```json\n{\"summary\":\"La captura manual quedó implementada; falta validarla en navegador.\",\"verification_gaps\":[\"No se pudo ejecutar la validación en navegador porque el entorno no proporciona window.\"],\"evidence\":[\"git diff --check finalizó correctamente.\"]}\n```" }],
      }] : [] }),
    },
  };
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const plugin = await PulsoExperienceEnginePlugin({ directory, client });
    await plugin["chat.message"]({ agent: "pulso", sessionID: "primary-session" }, { parts: [{ text: "Fix beneficiary modal" }] });
    await plugin.tool.pulso_experience_start.execute({ action: "new", title: "Fix beneficiary modal", reason: "This is a new bounded product change." }, { directory, sessionID: "primary-session" });
    await plugin["chat.message"]({ agent: "pulso-executor", sessionID: "executor-session" }, { parts: [{ text: "PULSO_TASK_ID=PULSO-013 Implement the fix" }] });
    for (const [sessionID, tokens] of [["primary-session", 10], ["executor-session", 20]]) {
      await plugin.event({ event: { type: "message.updated", properties: { info: {
        role: "assistant", sessionID, tokens: { total: tokens }, time: { completed: 1 },
      } } } });
    }

    const before = JSON.parse(await plugin.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(before.objectives.length, 1);
    assert.equal(before.objectives[0].id, "PULSO-OBJ-001");
    assert.equal(before.objectives[0].tokens, 30);

    await assert.rejects(() => plugin.tool.pulso_experience_finalize.execute({
      title: "Fix beneficiary modal",
      status: "partially_verified",
      summary: "The implementation still has an unspecified validation gap.",
      evidence: ["git diff --check passed"],
      human_interventions: 1,
    }, { directory, sessionID: "primary-session" }), /require at least one verification_gaps/);

    const result = await plugin.tool.pulso_experience_finalize.execute({
      title: "Fix beneficiary modal",
      status: "partially_verified",
      summary: "The implementation is complete but browser validation is unavailable.",
      evidence: ["git diff --check passed"],
      verification_gaps: ["Browser validation could not run because the test environment lacks window."],
      human_interventions: 1,
    }, { directory, sessionID: "primary-session" });
    assert.match(result, /curation skipped/);
    assert.deepEqual(promptedAgents, ["pulso-delivery-reporter"]);
    await plugin.event({ event: { type: "message.updated", properties: { info: {
      role: "assistant", sessionID: "pulso-delivery-reporter-session", time: { completed: 1 },
    } } } });
    const after = JSON.parse(await plugin.tool.pulso_metrics.execute({ objective_id: "PULSO-OBJ-001" }, { directory }));
    assert.equal(after.objectives[0].status, "partially_verified");
    assert.equal(after.objectives[0].summary, "La captura manual quedó implementada; falta validarla en navegador.");
    assert.deepEqual(JSON.parse(after.objectives[0].verification_gaps), ["No se pudo ejecutar la validación en navegador porque el entorno no proporciona window."]);
    assert.deepEqual(JSON.parse(after.objectives[0].evidence), ["git diff --check finalizó correctamente."]);
    assert.equal(after.agent_runs.length, 2);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reconciles active historical task objectives into their primary session", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-reconcile-objective-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(path.join(directory, ".pulso", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(directory, ".pulso", "tasks", "PULSO-013.json"), JSON.stringify({
    title: "Manual beneficiary entry",
    status: "implemented",
    execution: { updated_at: "2026-09-10T20:00:00Z" },
  }));
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const original = await PulsoExperienceEnginePlugin({ directory, client: { session: {} } });
    await original["chat.message"]({ agent: "pulso", sessionID: "primary-session" }, { parts: [{ text: "Start quickly" }] });
    await original.tool.pulso_experience_start.execute({ action: "new", title: "Start quickly", reason: "This is a new implementation objective." }, { directory, sessionID: "primary-session" });
    const file = path.join(process.env.XDG_DATA_HOME, "opencode", "pulso", "experience.sqlite");
    const legacy = new DatabaseSync(file);
    const projectKey = experienceCore.projectKey(directory);
    legacy.prepare("INSERT INTO objectives (objective_key, id, project_key, title, status, started_at) VALUES (?, 'PULSO-013', ?, 'Implement', 'active', '2026-09-10T19:00:00Z')").run(`${projectKey}:PULSO-013`, projectKey);
    legacy.prepare("INSERT INTO agent_runs (objective_key, objective_id, agent, session_id, started_at) VALUES (?, 'PULSO-013', 'pulso-executor', 'executor-session', '2026-09-10T19:00:00Z')").run(`${projectKey}:PULSO-013`);
    legacy.close();

    const client = { session: { get: async ({ path }) => ({ data: {
      id: path.id,
      ...(path.id === "executor-session" ? { parentID: "primary-session" } : {}),
    } }) } };
    const reconciled = await PulsoExperienceEnginePlugin({ directory, client });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const metrics = JSON.parse(await reconciled.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(metrics.objectives.length, 1);
    assert.equal(metrics.objectives[0].id, "PULSO-OBJ-001");
    assert.equal(metrics.objectives[0].title, "Manual beneficiary entry");
    assert.equal(metrics.objectives[0].status, "implemented");
    assert.equal(metrics.objectives[0].finished_at, "2026-09-10T20:00:00Z");
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("migrates internal SESSION ids to stable Pulso objective ids", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-session-id-migration-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const plugin = await PulsoExperienceEnginePlugin({ directory, client: { session: {} } });
    await plugin["chat.message"]({ agent: "pulso", sessionID: "primary-session" }, { parts: [{ text: "Legacy objective" }] });
    await plugin.tool.pulso_experience_start.execute({ action: "new", title: "Legacy objective", reason: "This creates the migration fixture." }, { directory, sessionID: "primary-session" });

    const file = path.join(process.env.XDG_DATA_HOME, "opencode", "pulso", "experience.sqlite");
    const db = new DatabaseSync(file);
    const key = experienceCore.projectKey(directory);
    const oldKey = `${key}:PULSO-OBJ-001`;
    const legacyKey = `${key}:SESSION-primary-session`;
    db.prepare("UPDATE objectives SET objective_key = ?, id = ? WHERE objective_key = ?").run(legacyKey, "SESSION-primary-session", oldKey);
    db.prepare("UPDATE agent_runs SET objective_key = ?, objective_id = ? WHERE objective_key = ?").run(legacyKey, "SESSION-primary-session", oldKey);
    db.close();

    const migrated = await PulsoExperienceEnginePlugin({ directory, client: { session: {} } });
    await new Promise((resolve) => setTimeout(resolve, 25));
    const metrics = JSON.parse(await migrated.tool.pulso_metrics.execute({ objective_id: "PULSO-OBJ-001" }, { directory }));
    assert.equal(metrics.objectives[0].id, "PULSO-OBJ-001");
    assert.equal(metrics.agent_runs[0].runs, 1);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("resumes an incomplete objective across primary sessions without leaving a duplicate", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-resume-objective-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  const sessions = {
    "first-primary": { id: "first-primary" },
    "second-primary": { id: "second-primary" },
    "follow-up-executor": { id: "follow-up-executor", parentID: "second-primary" },
  };
  const client = { session: {
    get: async ({ path }) => ({ data: sessions[path.id] }),
    create: async ({ body }) => ({ data: { id: `${body.title}-${Date.now()}` } }),
    prompt: async () => ({}),
  } };
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const plugin = await PulsoExperienceEnginePlugin({ directory, client });
    await plugin["chat.message"]({ agent: "pulso", sessionID: "first-primary" }, { parts: [{ text: "Implement the original change" }] });
    await plugin.tool.pulso_experience_start.execute({ action: "new", title: "Original change", reason: "This is the original deliverable." }, { directory, sessionID: "first-primary" });
    await plugin.tool.pulso_experience_finalize.execute({
      title: "Original change",
      status: "partially_verified",
      summary: "The original change needs one additional browser check.",
      evidence: ["Static checks passed."],
      verification_gaps: ["Browser validation remains pending."],
      human_interventions: 0,
    }, { directory, sessionID: "first-primary" });

    await plugin["chat.message"]({ agent: "pulso", sessionID: "second-primary" }, { parts: [{ text: "Continue PULSO-OBJ-001" }] });
    let metrics = JSON.parse(await plugin.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(metrics.objectives.length, 1);

    await plugin.tool.pulso_experience_start.execute({ action: "resume", title: "Original change", objective_id: "PULSO-OBJ-001", reason: "The user requested the pending browser validation." }, { directory, sessionID: "second-primary" });
    await plugin["chat.message"]({ agent: "pulso-executor", sessionID: "follow-up-executor" }, { parts: [{ text: "PULSO_TASK_ID=PULSO-016 Complete validation" }] });
    metrics = JSON.parse(await plugin.tool.pulso_metrics.execute({}, { directory }));
    assert.equal(metrics.objectives.length, 1);
    assert.equal(metrics.objectives[0].id, "PULSO-OBJ-001");
    assert.equal(metrics.objectives[0].status, "active");
    assert.equal(metrics.objectives[0].finished_at, null);
    const resumed = JSON.parse(await plugin.tool.pulso_metrics.execute({ objective_id: "PULSO-OBJ-001" }, { directory }));
    assert.equal(resumed.agent_runs.reduce((total, agent) => total + agent.runs, 0), 3);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("runs verified curation through the legacy plugin SDK shape and stores a memory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-curation-sdk-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  const calls = [];
  const client = { session: {
    create: async (request) => {
      calls.push(["create", request]);
      return { data: { id: request.body.title.startsWith("Dashboard") ? "reporter" : "curator" } };
    },
    prompt: async (request) => { calls.push(["prompt", request]); return {}; },
    messages: async ({ path }) => ({ data: path.id === "curator" ? [{
      info: { role: "assistant" },
      parts: [{ type: "text", text: "```json\n{\"result\":\"candidate_found\",\"memory_candidates\":[{\"context\":\"Validating browser component regressions\",\"trap\":\"A direct runner can fail before loading every browser test\",\"rule\":\"Confirm the supported browser runner imports tests before interpreting its assertions\",\"tags\":[\"browser\",\"testing\"],\"evidence\":[\"The verified runner completed after using its supported command\"]}],\"profile_candidates\":[]}\n```" }],
    }] : [] }),
  } };
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const plugin = await PulsoExperienceEnginePlugin({ directory, client });
    await plugin["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Verify browser runner" }] });
    await plugin.tool.pulso_experience_start.execute({ action: "new", title: "Verify browser runner", reason: "This is a new runner verification objective." }, { directory, sessionID: "primary" });
    await plugin.tool.pulso_experience_finalize.execute({
      title: "Verify browser runner",
      status: "verified",
      summary: "The supported browser validation completed successfully.",
      evidence: ["The supported browser runner completed all target tests."],
      human_interventions: 0,
    }, { directory, sessionID: "primary" });
    await new Promise((resolve) => setImmediate(resolve));
    const listed = JSON.parse(await plugin.tool.pulso_memory_list.execute({}, { directory }));
    assert.equal(listed.memories.length, 1);
    assert.equal(listed.memories[0].rule, "Confirm the supported browser runner imports tests before interpreting its assertions");
    const curatorCreate = calls.find(([name, request]) => name === "create" && request.body.title.startsWith("Experience"));
    assert.equal(curatorCreate[1].body.parentID, "primary");
    assert.equal(curatorCreate[1].query.directory, directory);
    const curatorPrompt = calls.find(([name, request]) => name === "prompt" && request.body.agent === "pulso-experience-curator");
    assert.equal(curatorPrompt[1].path.id, "curator");
    const metrics = JSON.parse(await plugin.tool.pulso_metrics.execute({ objective_id: "PULSO-OBJ-001" }, { directory }));
    assert.equal(metrics.objectives[0].curation_status, "completed");
    assert.match(metrics.objectives[0].curation_result, /Se guardaron 1 memorias/);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("does not block startup when historical session lookup hangs", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-startup-timeout-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const seed = await PulsoExperienceEnginePlugin({ directory, client: { session: {} } });
    await seed["chat.message"]({ agent: "pulso", sessionID: "primary" }, { parts: [{ text: "Historical objective" }] });
    await seed.tool.pulso_experience_start.execute({ action: "new", title: "Historical objective", reason: "This creates a historical active run." }, { directory, sessionID: "primary" });
    const file = path.join(process.env.XDG_DATA_HOME, "opencode", "pulso", "experience.sqlite");
    const db = new DatabaseSync(file);
    const key = experienceCore.projectKey(directory);
    db.prepare("UPDATE objectives SET id = 'PULSO-900', objective_key = ? WHERE project_key = ?").run(`${key}:PULSO-900`, key);
    db.prepare("UPDATE agent_runs SET objective_id = 'PULSO-900', objective_key = ? WHERE session_id = 'primary'").run(`${key}:PULSO-900`);
    db.close();

    const started = Date.now();
    const plugin = await PulsoExperienceEnginePlugin({ directory, client: { session: { get: async () => new Promise(() => {}) } } });
    assert.ok(Date.now() - started < 200);
    assert.ok(plugin.tool.pulso_metrics);
    await new Promise((resolve) => setTimeout(resolve, 450));
    const log = fs.readFileSync(path.join(process.env.XDG_DATA_HOME, "opencode", "pulso", "reconciliation.jsonl"), "utf8");
    assert.match(log, /"code":"lookup_timeout"/);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("skips circular historical session hierarchy without failing startup", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-startup-cycle-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const seed = await PulsoExperienceEnginePlugin({ directory, client: { session: {} } });
    await seed["chat.message"]({ agent: "pulso", sessionID: "cycle" }, { parts: [{ text: "Circular objective" }] });
    await seed.tool.pulso_experience_start.execute({ action: "new", title: "Circular objective", reason: "This creates a circular session fixture." }, { directory, sessionID: "cycle" });
    const plugin = await PulsoExperienceEnginePlugin({ directory, client: { session: { get: async ({ path }) => ({ data: { id: path.id, parentID: path.id, directory } }) } } });
    assert.ok(plugin.tool.pulso_metrics);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const log = fs.readFileSync(path.join(process.env.XDG_DATA_HOME, "opencode", "pulso", "reconciliation.jsonl"), "utf8");
    assert.match(log, /"code":"self_parent"/);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("skips historical sessions that belong to another project directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-foreign-session-"));
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const directory = path.join(root, "project");
  fs.mkdirSync(directory);
  try {
    const { PulsoExperienceEnginePlugin } = await import("../plugins/pulso-experience-engine.mjs");
    const seed = await PulsoExperienceEnginePlugin({ directory, client: { session: {} } });
    await seed["chat.message"]({ agent: "pulso", sessionID: "foreign" }, { parts: [{ text: "Foreign objective" }] });
    await seed.tool.pulso_experience_start.execute({ action: "new", title: "Foreign objective", reason: "This creates a foreign session fixture." }, { directory, sessionID: "foreign" });
    const plugin = await PulsoExperienceEnginePlugin({ directory, client: { session: { get: async ({ path }) => ({ data: { id: path.id, parentID: "other", directory: path.resolve?.("/tmp/other") || "/tmp/other" } }) } } });
    assert.ok(plugin.tool.pulso_metrics);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const log = fs.readFileSync(path.join(process.env.XDG_DATA_HOME, "opencode", "pulso", "reconciliation.jsonl"), "utf8");
    assert.match(log, /"code":"foreign_project_session"/);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
