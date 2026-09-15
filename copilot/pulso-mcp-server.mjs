import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import control from "../lib/pulso-control-core.js";
import stateFiles from "../lib/pulso-file-state.js";
import { PulsoExperienceEnginePlugin } from "../plugins/pulso-experience-engine.mjs";

const executeFile = promisify(execFile);
const directory = process.cwd();
const sessionID = process.env.COPILOT_SESSION_ID || `copilot-${process.pid}-${crypto.randomUUID()}`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const spawnedSessions = new Map();

function text(value) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] };
}

function copilotClient() {
  return {
    session: {
      async create({ body }) {
        const id = `copilot-child-${crypto.randomUUID()}`;
        spawnedSessions.set(id, { title: body.title, messages: [] });
        return { data: { id } };
      },
      async prompt({ path: itemPath, query, body }) {
        const item = spawnedSessions.get(itemPath.id);
        if (!item) throw new Error(`Unknown Copilot child session ${itemPath.id}.`);
        const prompt = (body.parts || []).map((part) => part.text || "").join("\n");
        const binary = process.env.COPILOT_BINARY || "copilot";
        const { stdout } = await executeFile(binary, [
          "--agent", body.agent,
          "--prompt", prompt,
          "--silent",
          "--no-remote",
          "--disable-mcp-server", "pulso-control",
        ], { cwd: query.directory, maxBuffer: 1024 * 1024 });
        item.messages.push({ info: { role: "assistant" }, parts: [{ type: "text", text: stdout.trim() }] });
        return { data: item.messages.at(-1) };
      },
      async messages({ path: itemPath }) {
        return { data: spawnedSessions.get(itemPath.id)?.messages || [] };
      },
      async get({ path: itemPath }) {
        const item = spawnedSessions.get(itemPath.id);
        if (!item) throw new Error(`Unknown Copilot session ${itemPath.id}.`);
        return { data: { id: itemPath.id, title: item.title } };
      },
    },
  };
}

const server = new McpServer({ name: "pulso-control", version: "0.2.0" });
const context = { directory, sessionID };
const experience = await PulsoExperienceEnginePlugin({ directory, client: copilotClient() });

function register(name, description, inputSchema, handler, annotations = {}) {
  server.registerTool(name, { description, inputSchema, annotations }, async (args) => text(await handler(args)));
}

register("pulso_route", "Select the smallest Pulso delivery route using deterministic risk signals.", {
  objective: z.string().min(3),
  paths: z.array(z.string()).optional(),
  changed_files: z.number().int().min(0).optional(),
  signals: z.array(z.enum(["ambiguous", "dependencies", "cross_layer", "new_dependency", "authentication", "persistence", "public_contract", "sensitive_data", "remote_operation", "destructive", "validation_gap", "contradictory_evidence"])).optional(),
}, async (args) => JSON.stringify(control.classifyRoute(args)), { readOnlyHint: true });

register("pulso_skill_digest", "Resolve compact Pulso skill constraints once per objective.", {
  skills: z.array(z.string()).max(10),
}, async ({ skills }) => JSON.stringify(control.skillDigest([...new Set(skills)])), { readOnlyHint: true });

register("pulso_lease", "Acquire, heartbeat, release, or inspect a recoverable Pulso task lease.", {
  action: z.enum(["acquire", "heartbeat", "release", "status"]),
  task_id: z.string().regex(/^PULSO-\d+$/),
  ttl_minutes: z.number().int().min(5).max(240).default(30),
  owner_session: z.string().min(1).optional(),
}, async ({ action, task_id, ttl_minutes = 30, owner_session }) => {
  const leaseOwner = owner_session || sessionID;
  const file = path.join(stateFiles.safeDirectory(directory, [".pulso", "leases"]), `${task_id}.json`);
  return stateFiles.withFileLock(file, () => {
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    if (action === "status") return JSON.stringify(existing || { task_id, status: "none" });
    const now = new Date();
    if (action === "acquire") {
      if (existing?.status === "active" && !control.isExpired(existing) && existing.owner_session !== leaseOwner) throw new Error(`${task_id} is leased by another active session until ${existing.expires_at}.`);
      const lease = { schema_version: 1, task_id, status: "active", owner_session: leaseOwner, acquired_at: now.toISOString(), heartbeat_at: now.toISOString(), expires_at: new Date(now.getTime() + ttl_minutes * 60000).toISOString(), recovered_from: control.isExpired(existing) ? existing.owner_session : null };
      stateFiles.writeAtomic(file, lease);
      return JSON.stringify(lease);
    }
    if (!existing || existing.owner_session !== leaseOwner || existing.status !== "active") throw new Error(`${task_id} has no active lease owned by this session.`);
    if (action === "heartbeat") {
      existing.heartbeat_at = now.toISOString();
      existing.expires_at = new Date(now.getTime() + ttl_minutes * 60000).toISOString();
    } else {
      existing.status = "released";
      existing.released_at = now.toISOString();
    }
    stateFiles.writeAtomic(file, existing);
    return JSON.stringify(existing);
  });
});

register("pulso_dashboard", "Start a temporary local read-only Pulso dashboard.", {
  open: z.boolean().default(false),
  timeout_minutes: z.number().int().min(5).max(240).default(30),
}, async ({ open = false, timeout_minutes = 30 }) => {
  const script = path.join(pluginRoot, "bin", "pulso-dashboard.js");
  const args = [script, "--project", directory, "--port", "0", "--timeout", String(timeout_minutes)];
  if (open) args.push("--open");
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("Pulso dashboard did not start within 5 seconds.")), 5000);
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      const match = output.match(/PULSO_DASHBOARD_URL=(\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    child.once("error", reject);
    child.once("exit", (code) => { if (!output.includes("PULSO_DASHBOARD_URL=")) reject(new Error(`Pulso dashboard exited with status ${code}.`)); });
  });
  child.stdout.destroy();
  child.stderr.destroy();
  child.unref();
  return JSON.stringify({ status: "started", url, expires_after_minutes: timeout_minutes });
});

register("pulso_doctor", "Run a read-only Copilot Pulso health check.", {}, async () => {
  const findings = [];
  if (!fs.existsSync(path.join(pluginRoot, "plugin.json"))) findings.push({ severity: "error", code: "missing_plugin_manifest" });
  if (!fs.existsSync(path.join(directory, "PULSO.md"))) findings.push({ severity: "warning", code: "missing_project_config" });
  for (const folder of ["tasks", "leases", "circuit-breakers"]) {
    const target = path.join(directory, ".pulso", folder);
    if (!fs.existsSync(target)) continue;
    for (const name of fs.readdirSync(target).filter((entry) => entry.endsWith(".json"))) {
      try { JSON.parse(fs.readFileSync(path.join(target, name), "utf8")); } catch { findings.push({ severity: "error", code: `invalid_${folder}_json`, detail: name }); }
    }
  }
  return JSON.stringify({ status: findings.some((item) => item.severity === "error") ? "unhealthy" : findings.length ? "warning" : "healthy", runtime: "copilot", findings });
}, { readOnlyHint: true });

for (const [name, definition] of Object.entries(experience.tool)) {
  const baseSchemas = {
    pulso_experience_start: { action: z.enum(["new", "resume"]), title: z.string().min(3), objective_id: z.string().regex(/^PULSO-OBJ-\d+$/).optional(), reason: z.string().min(10) },
    pulso_experience_repair: {},
    pulso_memory_recall: { query: z.string().min(3), tags: z.array(z.string()).optional() },
    pulso_experience_finalize: { objective_id: z.string().regex(/^(?:PULSO-\d+|PULSO-OBJ-\d+)$/).optional(), title: z.string().min(3), status: z.enum(["implemented", "partially_verified", "verified", "integrated", "blocked", "failed", "cancelled"]), summary: z.string().min(10), evidence: z.array(z.string()).min(1), verification_gaps: z.array(z.string().min(3)).default([]), human_interventions: z.number().int().min(0).default(0) },
    pulso_experience_curate: { objective_id: z.string().regex(/^PULSO-OBJ-\d+$|^PULSO-\d+$/) },
    pulso_experience_resume: { objective_id: z.string().regex(/^PULSO-OBJ-\d+$/) },
    pulso_memory_list: {},
    pulso_memory_review: { action: z.enum(["retire", "approve_preference", "reject_preference", "promote_global"]), id: z.string(), reason: z.string().min(1) },
    pulso_profile_recall: {},
    pulso_metrics: { objective_id: z.string().regex(/^(?:PULSO-\d+|PULSO-OBJ-\d+)$/).optional() },
  };
  const schema = { ...baseSchemas[name], session_id: z.string().min(1).optional() };
  register(name, definition.description || name, schema, ({ session_id, ...args }) => definition.execute(args, { directory, sessionID: session_id || sessionID }), ["pulso_memory_recall", "pulso_memory_list", "pulso_profile_recall", "pulso_metrics"].includes(name) ? { readOnlyHint: true } : {});
}

await server.connect(new StdioServerTransport());
