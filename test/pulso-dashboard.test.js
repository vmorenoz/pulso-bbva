"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const dashboard = require("../lib/pulso-dashboard-core.js");
const experience = require("../lib/pulso-experience-core.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-dashboard-"));
  const project = path.join(root, "sample-project");
  const dataHome = path.join(root, "data");
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(dataHome, "opencode", "pulso"), { recursive: true });
  const file = path.join(dataHome, "opencode", "pulso", "experience.sqlite");
  const db = new DatabaseSync(file);
  const key = experience.projectKey(project);
  db.exec(`CREATE TABLE objectives (objective_key TEXT PRIMARY KEY, id TEXT, project_key TEXT, title TEXT, status TEXT, started_at TEXT, finished_at TEXT, tokens INTEGER, human_interventions INTEGER, repair_cycles INTEGER, summary TEXT, evidence TEXT, verification_gaps TEXT);
    CREATE TABLE agent_runs (id INTEGER PRIMARY KEY, objective_key TEXT, objective_id TEXT, agent TEXT, session_id TEXT, tokens INTEGER, started_at TEXT, finished_at TEXT);
    CREATE TABLE memories (id TEXT PRIMARY KEY, fingerprint TEXT, scope TEXT, project_key TEXT, status TEXT, context TEXT, trap TEXT, rule TEXT, tags TEXT, evidence TEXT, supersedes_id TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE profile_candidates (id TEXT PRIMARY KEY, project_key TEXT, status TEXT, observation TEXT, proposed_rule TEXT, evidence TEXT, created_at TEXT);`);
  db.prepare("INSERT INTO objectives VALUES (?, 'PULSO-001', ?, 'Dashboard objective', 'verified', '2026-01-01', '2026-01-02', 42, 1, 2, 'Dashboard completed', '[\"test:1\"]', '[]')").run(`${key}:PULSO-001`, key);
  db.prepare("INSERT INTO agent_runs VALUES (1, ?, 'PULSO-001', 'pulso-executor', 'session-1', 42, '2026-01-01', '2026-01-02')").run(`${key}:PULSO-001`);
  db.prepare("INSERT INTO memories VALUES ('EXP-1', 'fp', 'project', ?, 'active', 'Dashboard context', 'Dashboard trap', 'Dashboard rule', '[\"dashboard\"]', '[\"test:1\"]', NULL, '2026-01-01', '2026-01-02')").run(key);
  db.prepare("INSERT INTO profile_candidates VALUES ('PREF-1', ?, 'approved', 'Repeated dashboard request', 'Open the dashboard directly', '[\"test:2\"]', '2026-01-01')").run(key);
  db.close();
  return { root, project, dataHome };
}

test("loads project metrics and experience without modifying SQLite", () => {
  const item = fixture();
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = item.dataHome;
  try {
    const file = dashboard.databasePath();
    const before = fs.statSync(file).mtimeMs;
    const data = dashboard.loadDashboardData(item.project);
    assert.equal(data.objectives[0].tokens, 42);
    assert.equal(data.objectives[0].duration_ms, 86400000);
    assert.equal(data.objectives[0].run_count, 1);
    assert.equal(data.objectives[0].agent_count, 1);
    assert.equal(data.objectives[0].agents[0].duration_ms, 86400000);
    assert.equal(data.objectives[0].summary, "Dashboard completed");
    assert.deepEqual(data.objectives[0].evidence, ["test:1"]);
    assert.deepEqual(data.objectives[0].verification_gaps, []);
    assert.equal(data.agent_runs[0].agent, "pulso-executor");
    assert.equal(data.summary.objectives, 1);
    assert.equal(data.summary.active, 0);
    assert.equal(data.summary.runs, 1);
    assert.equal(data.summary.average_duration_ms, 86400000);
    assert.equal(data.summary.verified_rate, 100);
    assert.deepEqual(data.memories[0].tags, ["dashboard"]);
    assert.equal(data.preferences[0].status, "approved");
    assert.equal(fs.statSync(file).mtimeMs, before);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("uses a readable fallback when a legacy objective title equals its id", () => {
  const item = fixture();
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = item.dataHome;
  try {
    const file = dashboard.databasePath();
    const db = new DatabaseSync(file);
    const key = experience.projectKey(item.project);
    db.prepare("UPDATE objectives SET id = ?, objective_key = ?, title = ?").run("SESSION-legacy", `${key}:SESSION-legacy`, "SESSION-legacy");
    db.close();
    const data = dashboard.loadDashboardData(item.project);
    assert.equal(data.objectives[0].title, "Pulso session");
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("uses the real task title instead of a historical delegated prompt", () => {
  const item = fixture();
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = item.dataHome;
  fs.mkdirSync(path.join(item.project, ".pulso", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(item.project, ".pulso", "tasks", "PULSO-001.json"), JSON.stringify({
    id: "PULSO-001",
    title: "Real task title",
    objective: "Complete the real task safely.",
    execution: {
      results: ["Static validation passed.", "Browser validation could not run."],
      deviations: ["Browser validation remains unverified."],
    },
  }));
  try {
    const db = new DatabaseSync(dashboard.databasePath());
    db.prepare("UPDATE objectives SET status = 'partially_verified', summary = NULL, evidence = '[]', verification_gaps = '[]'").run();
    db.close();
    const data = dashboard.loadDashboardData(item.project);
    assert.equal(data.objectives[0].title, "Real task title");
    assert.equal(data.objectives[0].summary, "Complete the real task safely.");
    assert.deepEqual(data.objectives[0].evidence, ["Static validation passed.", "Browser validation could not run."]);
    assert.deepEqual(data.objectives[0].verification_gaps, ["Browser validation remains unverified."]);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("recovers verification gaps from tasks executed during a historical objective", () => {
  const item = fixture();
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = item.dataHome;
  fs.mkdirSync(path.join(item.project, ".pulso", "tasks"), { recursive: true });
  fs.writeFileSync(path.join(item.project, ".pulso", "tasks", "PULSO-002.json"), JSON.stringify({
    id: "PULSO-002",
    title: "Related task",
    execution: {
      updated_at: "2026-01-01T12:00:00Z",
      results: ["Static validation passed."],
      deviations: ["Browser validation remains unverified."],
    },
  }));
  try {
    const db = new DatabaseSync(dashboard.databasePath());
    db.prepare("UPDATE objectives SET id = 'PULSO-OBJ-001', title = 'Combined objective', status = 'partially_verified', summary = NULL, evidence = '[]', verification_gaps = '[]'").run();
    db.close();
    const data = dashboard.loadDashboardData(item.project);
    assert.deepEqual(data.objectives[0].evidence, ["Static validation passed."]);
    assert.deepEqual(data.objectives[0].verification_gaps, ["Browser validation remains unverified."]);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("serves a token-protected localhost dashboard and stops cleanly", async () => {
  const item = fixture();
  const token = "a".repeat(48);
  const child = spawn(process.execPath, [path.resolve(__dirname, "..", "bin", "pulso-dashboard.js"), "--project", item.project, "--port", "0", "--token", token, "--timeout", "5"], {
    env: { ...process.env, XDG_DATA_HOME: item.dataHome }, stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Dashboard did not start")), 5000);
      child.stdout.on("data", (chunk) => {
        const match = String(chunk).match(/PULSO_DASHBOARD_URL=(\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
      child.once("exit", (code) => { if (code) reject(new Error(`Dashboard exited with ${code}`)); });
    });
    const base = new URL(url);
    const forbidden = await fetch(`${base.origin}/api/data`);
    assert.equal(forbidden.status, 403);
    const page = await fetch(url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /nonce-/);
    const html = await page.text();
    assert.match(html, /<title>Pulso Bbva<\/title>/);
    assert.match(html, /Tasa verificada/);
    assert.match(html, /id="objective-detail"/);
    assert.match(html, /Verificación parcial/);
    assert.match(html, /Qué falta verificar/);
    assert.match(html, /Resultado de curación/);
    const response = await fetch(`${base.origin}/api/data?token=${token}`);
    const data = await response.json();
    assert.equal(data.project.name, "sample-project");
    assert.equal(data.objectives.length, 1);
    const stopped = await fetch(`${base.origin}/api/stop?token=${token}`, { method: "POST" });
    assert.equal(stopped.status, 202);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("dashboard tool returns a live ephemeral URL", async () => {
  const item = fixture();
  const previousDataHome = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = item.dataHome;
  try {
    const tool = (await import("../tools/pulso_dashboard.ts")).default;
    const result = JSON.parse(await tool.execute({ open: false, timeout_minutes: 5 }, { directory: item.project }));
    const response = await fetch(result.url);
    assert.equal(response.status, 200);
    const url = new URL(result.url);
    const stopped = await fetch(`${url.origin}/api/stop?token=${url.searchParams.get("token")}`, { method: "POST" });
    assert.equal(stopped.status, 202);
  } finally {
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("dashboard tool reports a missing Node launcher clearly", async () => {
  const previous = process.env.PULSO_NODE_BINARY;
  process.env.PULSO_NODE_BINARY = path.join(os.tmpdir(), "missing-pulso-node");
  try {
    const tool = (await import("../tools/pulso_dashboard.ts")).default;
    await assert.rejects(
      () => tool.execute({ open: false, timeout_minutes: 5 }, { directory: process.cwd() }),
      /Unable to launch Node for the Pulso dashboard/,
    );
  } finally {
    if (previous === undefined) delete process.env.PULSO_NODE_BINARY;
    else process.env.PULSO_NODE_BINARY = previous;
  }
});
