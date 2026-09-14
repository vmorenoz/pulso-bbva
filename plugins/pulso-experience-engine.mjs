import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import core from "../lib/pulso-experience-core.js";

const CURATOR = "pulso-experience-curator";
const REPORTER = "pulso-delivery-reporter";
const curatorSessions = new Map();
const reporterSessions = new Map();
const pendingPrimarySessions = new Map();
const SESSION_LOOKUP_TIMEOUT_MS = 350;
const RECONCILIATION_BUDGET_MS = 900;
const RECONCILIATION_RUN_LIMIT = 100;
const RECONCILIATION_LOG_LIMIT = 256 * 1024;
let SQLiteDatabase;

function reconciliationLogPath() {
  return path.join(path.dirname(databasePath()), "reconciliation.jsonl");
}

function logExperienceFinding(directory, stage, code, detail = {}) {
  try {
    const file = reconciliationLogPath();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (fs.existsSync(file) && fs.statSync(file).size > RECONCILIATION_LOG_LIMIT) {
      const content = fs.readFileSync(file, "utf8");
      fs.writeFileSync(file, content.slice(-Math.floor(RECONCILIATION_LOG_LIMIT / 2)), { mode: 0o600 });
    }
    fs.appendFileSync(file, `${JSON.stringify({
      timestamp: new Date().toISOString(), project_key: core.projectKey(directory), stage, code, ...detail,
    })}\n`, { mode: 0o600 });
  } catch {
    // Diagnostics must never interfere with OpenCode startup.
  }
}

function withTimeout(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function sessionGet(client, sessionID, directory) {
  return client.session.get({ path: { id: sessionID }, query: { directory } });
}

function sessionMessages(client, sessionID, directory, limit = 10) {
  return client.session.messages({ path: { id: sessionID }, query: { directory, limit } });
}

function sessionCreate(client, directory, parentID, title) {
  return client.session.create({ body: { parentID, title }, query: { directory } });
}

function sessionPrompt(client, sessionID, directory, agent, text) {
  return client.session.prompt({
    path: { id: sessionID },
    query: { directory },
    body: { agent, parts: [{ type: "text", text }] },
  });
}

async function loadSQLite() {
  if (SQLiteDatabase) return;
  const specifier = typeof Bun === "undefined" ? "node:sqlite" : "bun:sqlite";
  const sqlite = await import(specifier);
  SQLiteDatabase = sqlite.DatabaseSync || sqlite.Database;
  if (!SQLiteDatabase) throw new Error(`Pulso experience cannot find a SQLite database constructor in ${specifier}.`);
}

function databasePath() {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode", "pulso", "experience.sqlite");
}

function database() {
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(file), 0o700);
  if (!SQLiteDatabase) throw new Error("Pulso experience SQLite is not initialized.");
  const db = new SQLiteDatabase(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  migrateSchema(db);
  fs.chmodSync(file, 0o600);
  for (const suffix of ["-wal", "-shm"]) if (fs.existsSync(`${file}${suffix}`)) fs.chmodSync(`${file}${suffix}`, 0o600);
  return db;
}

function createObjectiveTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS objectives (
    objective_key TEXT PRIMARY KEY, id TEXT NOT NULL, project_key TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
    started_at TEXT NOT NULL, finished_at TEXT, tokens INTEGER NOT NULL DEFAULT 0,
    human_interventions INTEGER NOT NULL DEFAULT 0, repair_cycles INTEGER NOT NULL DEFAULT 0,
    summary TEXT, evidence TEXT NOT NULL DEFAULT '[]', verification_gaps TEXT NOT NULL DEFAULT '[]',
    curation_status TEXT NOT NULL DEFAULT 'not_requested', curation_result TEXT
  );
  CREATE TABLE IF NOT EXISTS agent_runs (
    id INTEGER PRIMARY KEY, objective_key TEXT NOT NULL, objective_id TEXT NOT NULL, agent TEXT NOT NULL, session_id TEXT NOT NULL UNIQUE,
    tokens INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, finished_at TEXT
  );`);
}

function migrateSchema(db) {
  const hasObjectives = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'objectives'").get();
  if (hasObjectives) {
    const columns = db.prepare("PRAGMA table_info(objectives)").all().map((column) => column.name);
    if (!columns.includes("objective_key")) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(`ALTER TABLE objectives RENAME TO objectives_legacy;
          ALTER TABLE agent_runs RENAME TO agent_runs_legacy;`);
        createObjectiveTables(db);
        db.exec(`INSERT INTO objectives (objective_key, id, project_key, title, status, started_at, finished_at, tokens, human_interventions, repair_cycles)
          SELECT project_key || ':' || id, id, project_key, title, status, started_at, finished_at, tokens, human_interventions, repair_cycles FROM objectives_legacy;
          INSERT INTO agent_runs (id, objective_key, objective_id, agent, session_id, tokens, started_at, finished_at)
          SELECT r.id, COALESCE((SELECT o.project_key || ':' || o.id FROM objectives_legacy o WHERE o.id = r.objective_id LIMIT 1), 'legacy:' || r.objective_id),
            r.objective_id, r.agent, r.session_id, r.tokens, r.started_at, r.finished_at FROM agent_runs_legacy r;
          DROP TABLE agent_runs_legacy;
          DROP TABLE objectives_legacy;`);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } else {
    createObjectiveTables(db);
  }
  const objectiveColumns = db.prepare("PRAGMA table_info(objectives)").all().map((column) => column.name);
  if (!objectiveColumns.includes("summary")) db.exec("ALTER TABLE objectives ADD COLUMN summary TEXT");
  if (!objectiveColumns.includes("evidence")) db.exec("ALTER TABLE objectives ADD COLUMN evidence TEXT NOT NULL DEFAULT '[]'");
  if (!objectiveColumns.includes("verification_gaps")) db.exec("ALTER TABLE objectives ADD COLUMN verification_gaps TEXT NOT NULL DEFAULT '[]'");
  if (!objectiveColumns.includes("curation_status")) db.exec("ALTER TABLE objectives ADD COLUMN curation_status TEXT NOT NULL DEFAULT 'not_requested'");
  if (!objectiveColumns.includes("curation_result")) db.exec("ALTER TABLE objectives ADD COLUMN curation_result TEXT");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO schema_meta (key, value) VALUES ('schema_version', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value;
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, scope TEXT NOT NULL CHECK(scope IN ('project', 'global')),
    project_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active', 'superseded', 'retired')),
    context TEXT NOT NULL, trap TEXT NOT NULL, rule TEXT NOT NULL, tags TEXT NOT NULL, evidence TEXT NOT NULL,
    supersedes_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, context, trap, rule, tags);
  CREATE TABLE IF NOT EXISTS profile_candidates (
    id TEXT PRIMARY KEY, project_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('proposed', 'approved', 'rejected', 'superseded')),
    observation TEXT NOT NULL, proposed_rule TEXT NOT NULL, evidence TEXT NOT NULL, created_at TEXT NOT NULL
  );`);
}

function responseData(response) {
  return response?.data || response;
}

function objectiveTitle(parts, objectiveID) {
  const text = (parts || [])
    .map((part) => part?.text || part?.prompt || "")
    .join("\n")
    .replace(/\bPULSO_TASK_ID=PULSO-\d+\b/g, "")
    .trim();
  if (!text) return objectiveID;
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || objectiveID;
}

function nextObjectiveID(db, projectKey) {
  const rows = db.prepare("SELECT id FROM objectives WHERE project_key = ? AND id LIKE 'PULSO-OBJ-%'").all(projectKey);
  const next = rows.reduce((maximum, row) => {
    const match = String(row.id).match(/^PULSO-OBJ-(\d+)$/);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0) + 1;
  return `PULSO-OBJ-${String(next).padStart(3, "0")}`;
}

function migrateSessionObjectiveIDs(db, directory) {
  const key = core.projectKey(directory);
  const rows = db.prepare("SELECT objective_key, id FROM objectives WHERE project_key = ? AND id LIKE 'SESSION-%' ORDER BY started_at, objective_key").all(key);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const id = nextObjectiveID(db, key);
      const objectiveKey = core.objectiveKey(directory, id);
      db.prepare("UPDATE objectives SET objective_key = ?, id = ?, title = CASE WHEN title = ? THEN 'Pulso objective' ELSE title END WHERE objective_key = ?")
        .run(objectiveKey, id, row.id, row.objective_key);
      db.prepare("UPDATE agent_runs SET objective_key = ?, objective_id = ? WHERE objective_key = ?").run(objectiveKey, id, row.objective_key);
    }
    db.prepare("UPDATE objectives SET title = 'Pulso objective' WHERE project_key = ? AND title LIKE 'SESSION-%'").run(key);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

async function parentObjective(input, sessionID, deadline = Date.now() + RECONCILIATION_BUDGET_MS) {
  let currentID = sessionID;
  const visited = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { issue: "budget_exhausted" };
      if (visited.has(currentID)) {
        logExperienceFinding(input.directory, "session_hierarchy", "cycle_detected", { session_id: currentID });
        return null;
      }
      visited.add(currentID);
      const session = responseData(await withTimeout(
        sessionGet(input.client, currentID, input.directory), Math.min(SESSION_LOOKUP_TIMEOUT_MS, remaining), "session lookup timeout",
      ));
      if (session?.directory && path.resolve(session.directory) !== path.resolve(input.directory)) {
        logExperienceFinding(input.directory, "session_hierarchy", "foreign_project_session", { session_id: currentID });
        return null;
      }
      if (depth > 0) {
        const db = database();
        let run;
        try {
          run = db.prepare("SELECT objective_key, objective_id FROM agent_runs WHERE session_id = ?").get(currentID);
        } finally {
          db.close();
        }
        if (run) return run;
      }
      if (!session?.parentID) return null;
      if (session.parentID === currentID) {
        logExperienceFinding(input.directory, "session_hierarchy", "self_parent", { session_id: currentID });
        return { issue: "self_parent" };
      }
      currentID = session.parentID;
    } catch (error) {
      const issue = error?.message === "session lookup timeout" ? "lookup_timeout" : "lookup_failed";
      logExperienceFinding(input.directory, "session_hierarchy", issue, { session_id: currentID });
      return { issue };
    }
  }
  logExperienceFinding(input.directory, "session_hierarchy", "depth_limit", { session_id: sessionID });
  return { issue: "depth_limit" };
}

function mergeObjectiveRuns(db, sourceKey, targetKey, targetID) {
  if (!sourceKey || sourceKey === targetKey) return;
  const source = db.prepare("SELECT repair_cycles, human_interventions FROM objectives WHERE objective_key = ?").get(sourceKey);
  db.prepare("UPDATE agent_runs SET objective_key = ?, objective_id = ? WHERE objective_key = ?").run(targetKey, targetID, sourceKey);
  db.prepare(`UPDATE objectives SET
      tokens = (SELECT COALESCE(SUM(tokens), 0) FROM agent_runs WHERE objective_key = ?),
      repair_cycles = MAX(repair_cycles, ?), human_interventions = MAX(human_interventions, ?)
    WHERE objective_key = ?`).run(targetKey, Number(source?.repair_cycles) || 0, Number(source?.human_interventions) || 0, targetKey);
  db.prepare("DELETE FROM objectives WHERE objective_key = ? AND NOT EXISTS (SELECT 1 FROM agent_runs WHERE objective_key = ?)").run(sourceKey, sourceKey);
}

async function reconcileActiveTaskObjectives(input) {
  if (!input.client?.session?.get) return;
  const key = core.projectKey(input.directory);
  const snapshot = database();
  let runs;
  try {
    runs = snapshot.prepare(`SELECT r.session_id, r.objective_key, r.objective_id, r.finished_at, o.title, o.started_at AS objective_started_at
      FROM agent_runs r JOIN objectives o ON o.objective_key = r.objective_key
      WHERE o.project_key = ? AND o.status = 'active' AND o.id LIKE 'PULSO-%'
      ORDER BY o.started_at DESC LIMIT ?`).all(key, RECONCILIATION_RUN_LIMIT);
  } finally {
    snapshot.close();
  }
  const closures = new Map();
  const reopens = new Map();
  let reassigned = 0;
  let skipped = 0;
  const deadline = Date.now() + RECONCILIATION_BUDGET_MS;
  const resolved = await Promise.all(runs.map(async (run) => ({ run, parent: await parentObjective(input, run.session_id, deadline) })));
  for (const { run, parent } of resolved) {
    try {
      if (parent?.issue) {
        skipped += 1;
        logExperienceFinding(input.directory, "reconcile_row", parent.issue, { objective_id: run.objective_id, session_id: run.session_id });
        continue;
      }
      if (!parent || parent.objective_key === run.objective_key) continue;
      const db = database();
      try {
        const update = db.prepare("UPDATE agent_runs SET objective_key = ?, objective_id = ? WHERE session_id = ? AND objective_key = ?")
          .run(parent.objective_key, parent.objective_id, run.session_id, run.objective_key);
        reassigned += Number(update.changes) || 0;
      } finally {
        db.close();
      }
      const task = JSON.parse(fs.readFileSync(path.join(input.directory, ".pulso", "tasks", `${run.objective_id}.json`), "utf8"));
      if (["implemented", "verified", "integrated", "blocked", "failed", "cancelled"].includes(task.status)) {
        const previous = closures.get(parent.objective_key);
        if (!previous || String(run.objective_started_at) > String(previous.started_at)) {
          closures.set(parent.objective_key, {
            title: task.title || run.title,
            status: task.status,
            finished_at: task.execution?.updated_at || run.finished_at || new Date().toISOString(),
            started_at: run.objective_started_at,
          });
        }
      } else if (["draft", "ready", "in_progress"].includes(task.status)) {
        const previous = reopens.get(parent.objective_key);
        if (!previous || String(run.objective_started_at) > String(previous)) reopens.set(parent.objective_key, run.objective_started_at);
      }
    } catch (error) {
      skipped += 1;
      logExperienceFinding(input.directory, "reconcile_row", "row_skipped", { objective_id: run.objective_id, session_id: run.session_id });
      // Historical task state is optional; one bad row must not stop reconciliation.
    }
  }
  const db = database();
  db.prepare(`DELETE FROM objectives WHERE project_key = ? AND status = 'active' AND id LIKE 'PULSO-%'
    AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.objective_key = objectives.objective_key)`).run(key);
  db.prepare(`UPDATE objectives SET tokens = (SELECT COALESCE(SUM(r.tokens), 0) FROM agent_runs r WHERE r.objective_key = objectives.objective_key)
    WHERE project_key = ?`).run(key);
  for (const [objectiveKey, closure] of closures) {
    if (String(reopens.get(objectiveKey) || "") > String(closure.started_at)) continue;
    const latestRun = db.prepare("SELECT MAX(finished_at) AS finished_at FROM agent_runs WHERE objective_key = ?").get(objectiveKey);
    db.prepare("UPDATE objectives SET title = ?, status = ?, finished_at = ? WHERE objective_key = ?")
      .run(closure.title, closure.status, latestRun?.finished_at || closure.finished_at, objectiveKey);
  }
  for (const [objectiveKey, startedAt] of reopens) {
    const closure = closures.get(objectiveKey);
    if (!closure || String(startedAt) > String(closure.started_at)) {
      db.prepare("UPDATE objectives SET status = 'active', finished_at = NULL WHERE objective_key = ?").run(objectiveKey);
    }
  }
  db.prepare(`UPDATE objectives SET finished_at = COALESCE(
      (SELECT MAX(r.finished_at) FROM agent_runs r WHERE r.objective_key = objectives.objective_key), finished_at)
    WHERE project_key = ? AND status = 'implemented'`).run(key);
  db.close();
  logExperienceFinding(input.directory, "active_objective_reconciliation", "reconciliation_completed", { rows: runs.length, reassigned, skipped });
  return { rows: runs.length, reassigned, skipped };
}

async function runExperienceMaintenance(input) {
  const result = { migrated: false, reconciliation: null, errors: [] };
  try {
    const db = database();
    try {
      migrateSessionObjectiveIDs(db, input.directory);
      result.migrated = true;
    } finally {
      db.close();
    }
  } catch {
    result.errors.push("objective_id_migration");
    logExperienceFinding(input.directory, "objective_id_migration", "migration_failed");
  }
  try {
    result.reconciliation = await reconcileActiveTaskObjectives(input);
  } catch {
    result.errors.push("active_objective_reconciliation");
    logExperienceFinding(input.directory, "active_objective_reconciliation", "reconciliation_failed");
  }
  return result;
}

function remember(db, candidate, projectKey) {
  if (!core.validMemory(candidate)) return false;
  const scope = candidate.scope === "global" ? "global" : "project";
  if (scope === "global") return false;
  const memory = { ...candidate, scope, project_key: projectKey };
  const hash = core.fingerprint(memory);
  const exists = db.prepare("SELECT 1 FROM memories WHERE fingerprint = ?").get(hash);
  if (exists) return false;
  const id = `EXP-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO memories VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL, ?, ?)")
    .run(id, hash, scope, projectKey, memory.context.trim(), memory.trap.trim(), memory.rule.trim(), JSON.stringify(memory.tags || []), JSON.stringify(memory.evidence), now, now);
  db.prepare("INSERT INTO memories_fts VALUES (?, ?, ?, ?, ?)")
    .run(id, memory.context.trim(), memory.trap.trim(), memory.rule.trim(), (memory.tags || []).join(" "));
  return true;
}

function profileCandidate(db, candidate, projectKey) {
  if (!candidate || typeof candidate.observation !== "string" || typeof candidate.proposed_rule !== "string" || !Array.isArray(candidate.evidence)) return false;
  if (candidate.observation.length < 20 || candidate.proposed_rule.length < 20 || core.SENSITIVE.test(JSON.stringify(candidate))) return false;
  const id = `PREF-${crypto.randomUUID()}`;
  db.prepare("INSERT INTO profile_candidates VALUES (?, ?, 'proposed', ?, ?, ?, ?)")
    .run(id, projectKey, candidate.observation.trim(), candidate.proposed_rule.trim(), JSON.stringify(candidate.evidence), new Date().toISOString());
  return true;
}

async function processCuratorResult(input, sessionID) {
  const metadata = curatorSessions.get(sessionID);
  if (!metadata) return;
  try {
    const result = responseData(await sessionMessages(input.client, sessionID, input.directory));
    const messages = Array.isArray(result) ? result : result.messages || [];
    const assistant = [...messages].reverse().find((message) => message.info?.role === "assistant" || message.role === "assistant");
    const parts = assistant?.parts || [];
    const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const match = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (!match) return;
    const proposal = JSON.parse(match[1]);
    const db = database();
    db.exec("BEGIN IMMEDIATE");
    try {
      let created = 0;
      for (const candidate of proposal.memory_candidates || []) if (remember(db, candidate, metadata.projectKey)) created += 1;
      for (const candidate of proposal.profile_candidates || []) profileCandidate(db, candidate, metadata.projectKey);
      const status = created > 0 ? "completed" : "no_candidate";
      const message = created > 0 ? `Se guardaron ${created} memorias reutilizables.` : "No se encontró una lección verificada, reutilizable y suficientemente específica para guardar.";
      db.prepare("UPDATE objectives SET curation_status = ?, curation_result = ? WHERE objective_key = ?")
        .run(status, message, metadata.objectiveKey);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    } finally {
      db.close();
    }
  } catch {
    try {
      const db = database();
      db.prepare("UPDATE objectives SET curation_status = 'failed', curation_result = ? WHERE objective_key = ?")
        .run("No se pudo procesar el resultado de la curación.", metadata.objectiveKey);
      db.close();
    } catch {}
    // Experience curation is observational and must never block delivery.
  } finally {
    curatorSessions.delete(sessionID);
  }
}

async function processReporterResult(input, sessionID) {
  const metadata = reporterSessions.get(sessionID);
  if (!metadata) return;
  try {
    const result = responseData(await sessionMessages(input.client, sessionID, input.directory));
    const messages = Array.isArray(result) ? result : result.messages || [];
    const assistant = [...messages].reverse().find((message) => message.info?.role === "assistant" || message.role === "assistant");
    const text = (assistant?.parts || []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
    const match = text.match(/```json\s*([\s\S]*?)\s*```/i);
    if (!match) return;
    const report = JSON.parse(match[1]);
    const summary = typeof report.summary === "string" ? report.summary.trim().slice(0, 500) : "";
    const strings = (value, limit) => Array.isArray(value)
      ? [...new Set(value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, limit)
      : [];
    const gaps = strings(report.verification_gaps, 3);
    const evidence = strings(report.evidence, 5);
    if (summary.length < 10 || (metadata.status === "partially_verified" && gaps.length === 0) || evidence.length === 0) return;
    const db = database();
    db.prepare("UPDATE objectives SET summary = ?, verification_gaps = ?, evidence = ? WHERE objective_key = ? AND project_key = ?")
      .run(summary, JSON.stringify(gaps), JSON.stringify(evidence), metadata.objectiveKey, metadata.projectKey);
    db.close();
  } catch {
    // Report formatting is best-effort and must never alter delivery status.
  } finally {
    reporterSessions.delete(sessionID);
  }
}

async function startDeliveryReporter(input, context, objectiveID, projectKey, args) {
  try {
    const created = responseData(await sessionCreate(input.client, context.directory, context.sessionID, `Dashboard report ${objectiveID}`));
    reporterSessions.set(created.id, { projectKey, objectiveKey: core.objectiveKey(context.directory, objectiveID), status: args.status });
    const reportPackage = {
      title: args.title,
      status: args.status,
      summary: args.summary,
      verification_gaps: args.verification_gaps || [],
      evidence: args.evidence,
    };
    void sessionPrompt(input.client, created.id, context.directory, REPORTER, JSON.stringify(reportPackage))
      .then(() => processReporterResult(input, created.id))
      .catch(() => reporterSessions.delete(created.id));
    return true;
  } catch {
    return false;
  }
}

async function startExperienceCurator(input, context, objectiveID, projectKey, args) {
  const objectiveKey = core.objectiveKey(context.directory, objectiveID);
  const db = database();
  db.prepare("UPDATE objectives SET curation_status = 'pending', curation_result = NULL WHERE objective_key = ?").run(objectiveKey);
  db.close();
  try {
    const packageForCurator = { objective: { ...args, objective_id: objectiveID }, project_key: projectKey, instruction: "Return only a fenced JSON object matching the curator contract. Do not include chat transcripts, secrets, payloads, customer data, or generic advice." };
    const created = responseData(await sessionCreate(input.client, context.directory, context.sessionID, `Experience curation ${objectiveID}`));
    curatorSessions.set(created.id, { projectKey, objectiveKey });
    void sessionPrompt(input.client, created.id, context.directory, CURATOR, JSON.stringify(packageForCurator))
      .then(() => processCuratorResult(input, created.id))
      .catch(() => {
        curatorSessions.delete(created.id);
        const failed = database();
        failed.prepare("UPDATE objectives SET curation_status = 'failed', curation_result = ? WHERE objective_key = ?")
          .run("No se pudo iniciar el curador de experiencia.", objectiveKey);
        failed.close();
      });
    return true;
  } catch {
    const failed = database();
    failed.prepare("UPDATE objectives SET curation_status = 'failed', curation_result = ? WHERE objective_key = ?")
      .run("No se pudo iniciar el curador de experiencia.", objectiveKey);
    failed.close();
    return false;
  }
}

function repairCycles(directory, objectiveID) {
  const file = path.join(directory, ".pulso", "circuit-breakers", `${objectiveID}.json`);
  try {
    if (fs.lstatSync(file).isSymbolicLink()) return 0;
    return Math.max(0, Number(JSON.parse(fs.readFileSync(file, "utf8")).repair_cycles) || 0);
  } catch {
    return 0;
  }
}

export async function PulsoExperienceEnginePlugin(input) {
  const { tool } = await import("@opencode-ai/plugin");
  try {
    await loadSQLite();
    setTimeout(() => { void runExperienceMaintenance(input); }, 0);
  } catch {
    logExperienceFinding(input.directory, "sqlite_bootstrap", "sqlite_unavailable");
  }
  return {
    "chat.message": async (event, output) => {
      const match = (output.parts || []).map((part) => part.text || part.prompt || "").join("\n").match(/\bPULSO_TASK_ID=(PULSO-\d+)\b/);
      const pulsoSession = event.agent === "pulso";
      if (!pulsoSession && (!match || !event.agent?.startsWith("pulso-"))) return;
      const db = database();
      const key = core.projectKey(input.directory);
      const current = db.prepare("SELECT objective_key, objective_id FROM agent_runs WHERE session_id = ?").get(event.sessionID);
      if (pulsoSession && !current) {
        pendingPrimarySessions.set(event.sessionID, objectiveTitle(output.parts, "Pulso objective"));
        db.close();
        return;
      }
      db.close();
      const parent = pulsoSession ? null : await parentObjective(input, event.sessionID);
      const objectiveID = current?.objective_id || parent?.objective_id;
      if (!objectiveID) {
        return;
      }
      const tracked = database();
      const objectiveKey = core.objectiveKey(input.directory, objectiveID);
      const title = objectiveTitle(output.parts, objectiveID);
      const now = new Date().toISOString();
      tracked.prepare(`INSERT INTO objectives (objective_key, id, project_key, title, status, started_at)
        VALUES (?, ?, ?, ?, 'active', ?)
        ON CONFLICT(objective_key) DO UPDATE SET
          title = CASE WHEN objectives.title = objectives.id THEN excluded.title ELSE objectives.title END`)
        .run(objectiveKey, objectiveID, key, title, now);
      tracked.prepare("INSERT OR IGNORE INTO agent_runs (objective_key, objective_id, agent, session_id, started_at) VALUES (?, ?, ?, ?, ?)").run(objectiveKey, objectiveID, event.agent, event.sessionID, now);
      tracked.close();
    },
    tool: {
      pulso_experience_start: tool({
        description: "Persist a Pulso objective only after explicitly deciding whether the current work is new or resumes an incomplete objective.",
        args: {
          action: z.enum(["new", "resume"]),
          title: z.string().min(3),
          objective_id: z.string().regex(/^PULSO-OBJ-\d+$/).optional(),
          reason: z.string().min(10),
        },
        execute: async ({ action, title, objective_id, reason }, context) => {
          if (!context.sessionID) throw new Error("Objective evaluation requires the current Pulso session.");
          const db = database();
          const key = core.projectKey(context.directory);
          const current = db.prepare("SELECT objective_id FROM agent_runs WHERE session_id = ?").get(context.sessionID);
          if (current) {
            db.close();
            return `Current session already belongs to ${current.objective_id}; no objective created.`;
          }
          if (action === "resume" && !objective_id) {
            db.close();
            throw new Error("resume requires objective_id.");
          }
          if (action === "new" && objective_id) {
            db.close();
            throw new Error("new must not provide objective_id.");
          }
          const objectiveID = action === "new" ? nextObjectiveID(db, key) : objective_id;
          const objectiveKey = core.objectiveKey(context.directory, objectiveID);
          if (action === "resume") {
            const target = db.prepare("SELECT status FROM objectives WHERE objective_key = ? AND project_key = ?").get(objectiveKey, key);
            if (!target) {
              db.close();
              throw new Error(`Cannot resume missing objective ${objectiveID}.`);
            }
            if (!["active", "implemented", "partially_verified", "blocked", "failed"].includes(target.status)) {
              db.close();
              throw new Error(`Objective ${objectiveID} is ${target.status} and cannot be resumed.`);
            }
            db.prepare("UPDATE objectives SET status = 'active', finished_at = NULL WHERE objective_key = ?").run(objectiveKey);
          } else {
            const now = new Date().toISOString();
            db.prepare("INSERT INTO objectives (objective_key, id, project_key, title, status, started_at) VALUES (?, ?, ?, ?, 'active', ?)")
              .run(objectiveKey, objectiveID, key, title.trim(), now);
          }
          db.prepare("INSERT INTO agent_runs (objective_key, objective_id, agent, session_id, started_at) VALUES (?, ?, 'pulso', ?, ?)")
            .run(objectiveKey, objectiveID, context.sessionID, new Date().toISOString());
          db.close();
          pendingPrimarySessions.delete(context.sessionID);
          return `${objectiveID} ${action === "new" ? "created" : "resumed"}: ${reason.trim()}`;
        },
      }),
      pulso_experience_repair: tool({
        description: "Retry bounded fail-open Pulso experience maintenance for the current project and report skipped historical rows.",
        args: {},
        execute: async () => JSON.stringify(await runExperienceMaintenance(input)),
      }),
      pulso_memory_recall: tool({
        description: "Retrieve at most three relevant verified Pulso lessons for the current project.",
        args: { query: z.string().min(3), tags: z.array(z.string()).optional() },
        execute: async ({ query, tags }, context) => {
          const db = database();
          const key = core.projectKey(context.directory);
          const terms = [query, ...(tags || [])].join(" ").replace(/[^\p{L}\p{N}_-]+/gu, " ").trim();
          const rows = db.prepare(`SELECT m.* FROM memories_fts f JOIN memories m ON m.id = f.id
            WHERE memories_fts MATCH ? AND m.status = 'active' AND (m.project_key = ? OR m.scope = 'global')
            ORDER BY CASE WHEN m.project_key = ? THEN 0 ELSE 1 END, bm25(memories_fts) LIMIT 12`).all(terms, key, key);
          db.close();
          return JSON.stringify(core.conciseResults(rows));
        },
      }),
      pulso_experience_finalize: tool({
        description: "Close a substantive Pulso delivery and record metrics; verified outcomes also start selective asynchronous curation.",
        args: { objective_id: z.string().regex(/^(?:PULSO-\d+|PULSO-OBJ-\d+)$/).optional(), title: z.string().min(3), status: z.enum(["implemented", "partially_verified", "verified", "integrated", "blocked", "failed", "cancelled"]), summary: z.string().min(10), evidence: z.array(z.string()).min(1), verification_gaps: z.array(z.string().min(3)).default([]), human_interventions: z.number().int().min(0).default(0) },
        execute: async (args, context) => {
          const verificationGaps = args.verification_gaps || [];
          if (args.status === "partially_verified" && verificationGaps.length === 0) {
            throw new Error("partially_verified objectives require at least one verification_gaps entry.");
          }
          const db = database();
          const key = core.projectKey(context.directory);
          const currentRun = context.sessionID
            ? db.prepare("SELECT objective_key, objective_id FROM agent_runs WHERE session_id = ?").get(context.sessionID)
            : null;
          const objectiveID = args.objective_id || currentRun?.objective_id;
          if (!objectiveID) {
            db.close();
            throw new Error("No tracked Pulso objective exists for this session. Provide objective_id explicitly.");
          }
          const objectiveKey = core.objectiveKey(context.directory, objectiveID);
          if (args.objective_id && currentRun?.objective_key && currentRun.objective_key !== objectiveKey) {
            const target = db.prepare("SELECT 1 FROM objectives WHERE objective_key = ? AND project_key = ?").get(objectiveKey, key);
            if (!target) {
              db.close();
              throw new Error(`Cannot continue missing objective ${objectiveID}.`);
            }
            db.exec("BEGIN IMMEDIATE");
            try {
              mergeObjectiveRuns(db, currentRun.objective_key, objectiveKey, objectiveID);
              db.exec("COMMIT");
            } catch (error) {
              db.exec("ROLLBACK");
              db.close();
              throw error;
            }
          }
          const now = new Date().toISOString();
          db.prepare(`INSERT INTO objectives (objective_key, id, project_key, title, status, started_at, finished_at, human_interventions, repair_cycles, summary, evidence, verification_gaps)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(objective_key) DO UPDATE SET title = excluded.title, status = excluded.status,
              finished_at = excluded.finished_at, human_interventions = excluded.human_interventions,
              repair_cycles = MAX(objectives.repair_cycles, excluded.repair_cycles), summary = excluded.summary,
              evidence = excluded.evidence, verification_gaps = excluded.verification_gaps`)
            .run(objectiveKey, objectiveID, key, args.title, args.status, now, now, args.human_interventions, repairCycles(context.directory, objectiveID), args.summary, JSON.stringify(args.evidence), JSON.stringify(verificationGaps));
          db.close();
          await startDeliveryReporter(input, context, objectiveID, key, { ...args, verification_gaps: verificationGaps });
          if (!['verified', 'integrated'].includes(args.status)) {
            return `Experience metrics finalized for ${objectiveID}; dashboard copy requested and memory curation skipped because status is ${args.status}.`;
          }
          await startExperienceCurator(input, context, objectiveID, key, { ...args, verification_gaps: verificationGaps });
          return `Experience curation started asynchronously for ${objectiveID}.`;
        },
      }),
      pulso_experience_curate: tool({
        description: "Retry selective memory curation for a verified or integrated Pulso objective whose prior curation failed.",
        args: { objective_id: z.string().regex(/^PULSO-OBJ-\d+$|^PULSO-\d+$/) },
        execute: async ({ objective_id }, context) => {
          const db = database();
          const key = core.projectKey(context.directory);
          const objectiveKey = core.objectiveKey(context.directory, objective_id);
          const objective = db.prepare("SELECT title, status, summary, evidence, verification_gaps, curation_status FROM objectives WHERE objective_key = ? AND project_key = ?").get(objectiveKey, key);
          db.close();
          if (!objective) throw new Error(`Cannot curate missing objective ${objective_id}.`);
          if (!["verified", "integrated"].includes(objective.status)) throw new Error(`Objective ${objective_id} is ${objective.status}; only verified or integrated objectives can be curated.`);
          if (objective.curation_status === "pending") throw new Error(`Curation is already pending for ${objective_id}.`);
          const evidence = JSON.parse(objective.evidence || "[]");
          if (!objective.summary || !Array.isArray(evidence) || evidence.length === 0) throw new Error(`Objective ${objective_id} lacks a structured closure package for curation.`);
          const started = await startExperienceCurator(input, context, objective_id, key, {
            title: objective.title,
            status: objective.status,
            summary: objective.summary,
            evidence,
            verification_gaps: JSON.parse(objective.verification_gaps || "[]"),
          });
          if (!started) throw new Error(`Experience curation could not be started for ${objective_id}.`);
          return `Experience curation restarted asynchronously for ${objective_id}.`;
        },
      }),
      pulso_experience_resume: tool({
        description: "Resume an existing incomplete Pulso objective in the current primary session without creating a duplicate objective.",
        args: { objective_id: z.string().regex(/^PULSO-OBJ-\d+$/) },
        execute: async ({ objective_id }, context) => {
          const db = database();
          const key = core.projectKey(context.directory);
          const targetKey = core.objectiveKey(context.directory, objective_id);
          const target = db.prepare("SELECT status FROM objectives WHERE objective_key = ? AND project_key = ?").get(targetKey, key);
          if (!target) {
            db.close();
            throw new Error(`Cannot resume missing objective ${objective_id}.`);
          }
          if (!["active", "implemented", "partially_verified", "blocked", "failed"].includes(target.status)) {
            db.close();
            throw new Error(`Objective ${objective_id} is ${target.status} and cannot be resumed.`);
          }
          const current = context.sessionID
            ? db.prepare("SELECT objective_key FROM agent_runs WHERE session_id = ?").get(context.sessionID)
            : null;
          if (!current) {
            db.close();
            throw new Error("No tracked objective exists for the current Pulso session.");
          }
          db.exec("BEGIN IMMEDIATE");
          try {
            mergeObjectiveRuns(db, current.objective_key, targetKey, objective_id);
            db.prepare("UPDATE objectives SET status = 'active', finished_at = NULL WHERE objective_key = ?").run(targetKey);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            db.close();
            throw error;
          }
          db.close();
          return `${objective_id} resumed in the current session.`;
        },
      }),
      pulso_memory_list: tool({
        description: "List current-project Pulso memories and proposed profile preferences without modifying them.",
        args: {},
        execute: async (_, context) => {
          const db = database();
          const key = core.projectKey(context.directory);
          const memories = db.prepare("SELECT id, status, context, trap, rule, tags FROM memories WHERE project_key = ? ORDER BY created_at DESC LIMIT 20").all(key);
          const preferences = db.prepare("SELECT id, status, observation, proposed_rule, evidence FROM profile_candidates WHERE project_key = ? ORDER BY created_at DESC LIMIT 20").all(key);
          db.close();
          return JSON.stringify({ memories, preferences });
        },
      }),
      pulso_memory_review: tool({
        description: "Human-confirmed retirement, preference decision, or global promotion for Pulso experience.",
        args: { action: z.enum(["retire", "approve_preference", "reject_preference", "promote_global"]), id: z.string(), reason: z.string().min(1) },
        execute: async ({ action, id, reason }, context) => {
          const db = database();
          const key = core.projectKey(context.directory);
          if (action === "retire") db.prepare("UPDATE memories SET status = 'retired', updated_at = ? WHERE id = ? AND project_key = ?").run(new Date().toISOString(), id, key);
          if (action === "approve_preference" || action === "reject_preference") db.prepare("UPDATE profile_candidates SET status = ? WHERE id = ? AND project_key = ?").run(action === "approve_preference" ? "approved" : "rejected", id, key);
          if (action === "promote_global") {
            const memory = db.prepare("SELECT context, trap, rule, evidence FROM memories WHERE id = ? AND project_key = ?").get(id, key);
            if (!memory || core.SENSITIVE.test(JSON.stringify(memory))) throw new Error("Memory is missing or contains sensitive content.");
            db.prepare("UPDATE memories SET scope = 'global', updated_at = ? WHERE id = ? AND project_key = ?").run(new Date().toISOString(), id, key);
          }
          db.close();
          return `${action} completed for ${id}: ${reason.trim()}`;
        },
      }),
      pulso_profile_recall: tool({
        description: "Retrieve approved global user preferences for Pulso planning or execution."
        ,args: {},
        execute: async () => {
          const db = database();
          const rules = db.prepare("SELECT id, proposed_rule, evidence FROM profile_candidates WHERE status = 'approved' ORDER BY created_at DESC LIMIT 5").all();
          db.close();
          return JSON.stringify(rules);
        },
      }),
      pulso_metrics: tool({
        description: "Retrieve objective-level Pulso delivery metrics without conversation content.",
        args: { objective_id: z.string().regex(/^(?:PULSO-\d+|PULSO-OBJ-\d+)$/).optional() },
        execute: async ({ objective_id }, context) => {
          const db = database();
          const key = core.projectKey(context.directory);
          const objectiveKey = objective_id ? core.objectiveKey(context.directory, objective_id) : null;
          const objectives = objective_id
            ? db.prepare("SELECT * FROM objectives WHERE objective_key = ?").all(objectiveKey)
            : db.prepare("SELECT * FROM objectives WHERE project_key = ? ORDER BY started_at DESC LIMIT 20").all(key);
          const agentRuns = objective_id
            ? db.prepare("SELECT agent, SUM(tokens) AS tokens, COUNT(*) AS runs, MIN(started_at) AS started_at, MAX(finished_at) AS finished_at FROM agent_runs WHERE objective_key = ? GROUP BY agent").all(objectiveKey)
            : [];
          db.close();
          return JSON.stringify({ objectives, agent_runs: agentRuns });
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type === "message.updated") {
        const info = event.properties?.info;
        if (info?.role === "assistant" && info.sessionID) {
          const db = database();
            const run = db.prepare("SELECT objective_key FROM agent_runs WHERE session_id = ?").get(info.sessionID);
          if (run) {
            const tokens = Number(info.tokens?.total) || Number(info.tokens?.input || 0) + Number(info.tokens?.output || 0) + Number(info.tokens?.reasoning || 0);
              db.prepare("UPDATE agent_runs SET tokens = MAX(tokens, ?), finished_at = CASE WHEN ? THEN ? ELSE finished_at END WHERE session_id = ?").run(tokens, info.time?.completed ? 1 : 0, new Date().toISOString(), info.sessionID);
              db.prepare("UPDATE objectives SET tokens = (SELECT COALESCE(SUM(tokens), 0) FROM agent_runs WHERE objective_key = ?) WHERE objective_key = ?").run(run.objective_key, run.objective_key);
          }
          db.close();
        }
      }
      if (event.type === "message.updated" && curatorSessions.has(event.properties?.sessionID || event.properties?.info?.sessionID)) {
        const info = event.properties?.info;
        if (info?.role === "assistant" && info.time?.completed) await processCuratorResult(input, info.sessionID);
      }
      if (event.type === "message.updated" && reporterSessions.has(event.properties?.sessionID || event.properties?.info?.sessionID)) {
        const info = event.properties?.info;
        if (info?.role === "assistant" && info.time?.completed) await processReporterResult(input, info.sessionID);
      }
    },
  };
}
