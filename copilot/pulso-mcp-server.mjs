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
const startupDirectory = fs.realpathSync(process.cwd());
const sessionID = process.env.COPILOT_SESSION_ID || `copilot-${process.pid}-${crypto.randomUUID()}`;
const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const spawnedSessions = new Map();
const experienceByDirectory = new Map();
const MAX_EXPERIENCE_DIRECTORIES = 8;

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

async function resolveDirectory(explicit) {
  let roots = [];
  const supportsRoots = Boolean(server.server.getClientCapabilities()?.roots);
  if (supportsRoots) {
    let result;
    try {
      result = await Promise.race([
        server.server.listRoots(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("roots timeout")), 1000)),
      ]);
    } catch (error) {
      throw new Error(`Unable to resolve the active Copilot workspace root: ${error.message}`);
    }
    roots = result.roots.filter((item) => item.uri.startsWith("file://")).map((item) => fs.realpathSync(fileURLToPath(item.uri)));
    if (roots.length === 0) throw new Error("Copilot exposed roots capability without a file workspace root.");
  }
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw new Error("project_directory must be an absolute Copilot workspace root.");
    const candidate = fs.realpathSync(explicit);
    if (roots.length && !roots.includes(candidate)) throw new Error(`project_directory is not an active Copilot workspace root: ${candidate}`);
    if (!supportsRoots && candidate !== startupDirectory) throw new Error("Copilot did not expose workspace roots; refusing a project_directory outside the MCP startup workspace.");
    return candidate;
  }
  if (roots.length === 1) return roots[0];
  if (roots.length > 1) throw new Error("Multiple Copilot workspace roots are active; pass project_directory explicitly.");
  throw new Error("The MCP client did not expose workspace roots; pass project_directory explicitly.");
}

function experienceFor(projectDirectory) {
  if (!experienceByDirectory.has(projectDirectory)) {
    if (experienceByDirectory.size >= MAX_EXPERIENCE_DIRECTORIES) experienceByDirectory.delete(experienceByDirectory.keys().next().value);
    experienceByDirectory.set(projectDirectory, PulsoExperienceEnginePlugin({ directory: projectDirectory, client: copilotClient() }));
  }
  return experienceByDirectory.get(projectDirectory);
}

function experienceSessionID(projectDirectory, supplied) {
  const project = crypto.createHash("sha256").update(projectDirectory).digest("hex").slice(0, 24);
  return `copilot:${project}:${supplied || sessionID}`;
}

function register(name, description, inputSchema, handler, annotations = {}) {
  server.registerTool(name, { description, inputSchema: { ...inputSchema, project_directory: z.string().min(1).optional() }, annotations }, async ({ project_directory, ...args }) => {
    const projectDirectory = await resolveDirectory(project_directory);
    return text(await handler(args, projectDirectory));
  });
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
}, async ({ action, task_id, ttl_minutes = 30, owner_session }, projectDirectory) => {
  const leaseOwner = owner_session || sessionID;
  const file = path.join(stateFiles.safeDirectory(projectDirectory, [".pulso", "leases"]), `${task_id}.json`);
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
}, async ({ open = false, timeout_minutes = 30 }, projectDirectory) => {
  const script = path.join(pluginRoot, "bin", "pulso-dashboard.js");
  const args = [script, "--project", projectDirectory, "--port", "0", "--timeout", String(timeout_minutes)];
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

register("pulso_doctor", "Run a read-only Copilot Pulso health check.", {}, async (_, projectDirectory) => {
  const findings = [];
  if (!fs.existsSync(path.join(pluginRoot, "plugin.json"))) findings.push({ severity: "error", code: "missing_plugin_manifest" });
  if (!fs.existsSync(path.join(projectDirectory, "PULSO.md"))) findings.push({ severity: "warning", code: "missing_project_config" });
  for (const folder of ["tasks", "leases", "circuit-breakers"]) {
    const target = path.join(projectDirectory, ".pulso", folder);
    if (!fs.existsSync(target)) continue;
    for (const name of fs.readdirSync(target).filter((entry) => entry.endsWith(".json"))) {
      try { JSON.parse(fs.readFileSync(path.join(target, name), "utf8")); } catch { findings.push({ severity: "error", code: `invalid_${folder}_json`, detail: name }); }
    }
  }
  const projectKey = crypto.createHash("sha256").update(projectDirectory).digest("hex").slice(0, 24);
  return JSON.stringify({ status: findings.some((item) => item.severity === "error") ? "unhealthy" : findings.length ? "warning" : "healthy", runtime: "copilot", project: { directory: projectDirectory, key: projectKey }, findings });
}, { readOnlyHint: true });

const experienceSchemas = {
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

for (const [name, baseSchema] of Object.entries(experienceSchemas)) {
  const schema = { ...baseSchema, session_id: z.string().min(1).optional() };
  register(name, `Pulso experience operation: ${name}.`, schema, async ({ session_id, ...args }, projectDirectory) => {
    const experience = await experienceFor(projectDirectory);
    return experience.tool[name].execute(args, { directory: projectDirectory, sessionID: experienceSessionID(projectDirectory, session_id) });
  }, ["pulso_memory_recall", "pulso_memory_list", "pulso_profile_recall", "pulso_metrics"].includes(name) ? { readOnlyHint: true } : {});
}

await server.connect(new StdioServerTransport());
