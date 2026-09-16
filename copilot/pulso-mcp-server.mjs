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
import identity from "../lib/pulso-identity.js";
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
  return startupDirectory;
}

function experienceFor(projectDirectory) {
  if (!experienceByDirectory.has(projectDirectory)) {
    if (experienceByDirectory.size >= MAX_EXPERIENCE_DIRECTORIES) experienceByDirectory.delete(experienceByDirectory.keys().next().value);
    experienceByDirectory.set(projectDirectory, PulsoExperienceEnginePlugin({ directory: projectDirectory, client: copilotClient() }));
  }
  return experienceByDirectory.get(projectDirectory);
}

function experienceSessionID(projectDirectory) {
  const project = crypto.createHash("sha256").update(projectDirectory).digest("hex").slice(0, 24);
  return `copilot:${project}:${sessionID}`;
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

register("pulso_identity", "Resolve Pulso's integrity-checked canonical identity.", {}, async () => JSON.stringify(identity.resolveIdentity()), { readOnlyHint: true });

register("pulso_lease", "Acquire, heartbeat, release, or inspect a recoverable Pulso task lease.", {
  action: z.enum(["acquire", "heartbeat", "release", "status"]),
  task_id: z.string().regex(/^PULSO-\d+$/),
  ttl_minutes: z.number().int().min(5).max(240).default(30),
  owner_session: z.string().min(1),
}, async ({ action, task_id, ttl_minutes = 30, owner_session }, projectDirectory) => {
  const leaseOwner = owner_session;
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

register("pulso_lease_diagnostic", "Inspect a lease or safely probe lease recovery for the primary Pulso agent.", {
  action: z.enum(["status", "probe"]),
  task_id: z.string().regex(/^PULSO-\d+$/),
}, async ({ action, task_id }, projectDirectory) => {
  const file = path.join(stateFiles.safeDirectory(projectDirectory, [".pulso", "leases"]), `${task_id}.json`);
  return stateFiles.withFileLock(file, () => {
    const prior = fs.existsSync(file) ? fs.readFileSync(file) : null;
    const existing = prior === null ? null : JSON.parse(prior.toString("utf8"));
    if (action === "status") return JSON.stringify(existing || { task_id, status: "none" });
    if (existing?.status === "active" && !control.isExpired(existing)) throw new Error(`${task_id} has an active lease and cannot be probed.`);
    const now = new Date().toISOString();
    const probe = { schema_version: 1, task_id, status: "released", owner_session: `copilot-probe-${crypto.randomUUID()}`, acquired_at: now, heartbeat_at: now, expires_at: now, released_at: now };
    try {
      stateFiles.writeAtomic(file, probe);
      return JSON.stringify({ task_id, status: "healthy", probe: "acquired_and_released" });
    } finally {
      if (prior === null) fs.rmSync(file, { force: true });
      else {
        const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.restore`;
        fs.writeFileSync(temporary, prior, { mode: 0o600 });
        fs.renameSync(temporary, file);
      }
    }
  });
}, { readOnlyHint: false });

function primaryPath(projectDirectory, relative) {
  if (typeof relative !== "string" || !relative) throw new Error("path is required.");
  const resolved = path.resolve(projectDirectory, relative);
  const normalized = path.relative(projectDirectory, resolved).split(path.sep).join("/");
  if (normalized !== "PULSO.md" && !normalized.startsWith(".pulso/")) throw new Error("Primary writes are limited to PULSO.md and .pulso/**.");
  const segments = normalized.split("/");
  let current = projectDirectory;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Refusing a primary write through a symbolic link.");
  }
  return { resolved, normalized };
}

function digest(content) { return crypto.createHash("sha256").update(content).digest("hex"); }

function stateConflict() { throw new Error("state_conflict: expected revision, digest, or absence does not match current file."); }

function safeGitMetadataPath(commonDirectory, file) {
  const common = fs.realpathSync(commonDirectory);
  const relative = path.relative(common, file);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Git exclude path is outside the local repository metadata.");
  let current = common;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Refusing a symbolic Git metadata path.");
  }
}

register("pulso_primary_metadata", "Return a primary-owned file's CAS metadata without exposing its content.", {
  path: z.string().min(1),
}, async ({ path: relative }, projectDirectory) => {
  const { resolved, normalized } = primaryPath(projectDirectory, relative);
  if (!fs.existsSync(resolved)) return JSON.stringify({ path: normalized, exists: false });
  const content = fs.readFileSync(resolved, "utf8");
  let revision;
  if (normalized.startsWith(".pulso/") && path.extname(resolved) === ".json") {
    try {
      const parsed = JSON.parse(content);
      if (Number.isInteger(parsed.revision)) revision = parsed.revision;
    } catch {}
  }
  return JSON.stringify({ path: normalized, exists: true, digest: digest(content), ...(revision === undefined ? {} : { revision }) });
}, { readOnlyHint: true });

register("pulso_primary_write", "Write primary-owned Pulso configuration or state without unrestricted filesystem access.", {
  path: z.string().min(1),
  content: z.string(),
  expected_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  expected_revision: z.number().int().min(0).optional(),
  expected_absent: z.literal(true).optional(),
}, async ({ path: relative, content, expected_digest, expected_revision, expected_absent }, projectDirectory) => {
  const { resolved, normalized } = primaryPath(projectDirectory, relative);
  const parent = normalized === "PULSO.md" ? projectDirectory : stateFiles.safeDirectory(projectDirectory, normalized.split("/").slice(0, -1));
  const json = normalized.startsWith(".pulso/") && path.extname(resolved) === ".json";
  if (json) JSON.parse(content);
  stateFiles.withFileLock(resolved, () => {
    const check = () => {
      primaryPath(projectDirectory, relative);
      const existing = fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf8") : null;
      if (existing === null) {
        if (!expected_absent) stateConflict();
        return;
      }
      if (expected_absent || (expected_digest && digest(existing) !== expected_digest)) stateConflict();
      if (json) {
        let parsed;
        try { parsed = JSON.parse(existing); } catch { stateConflict(); }
        if (Number.isInteger(parsed.revision)) {
          const next = JSON.parse(content);
          if (expected_revision === undefined || parsed.revision !== expected_revision || next.revision !== expected_revision + 1) stateConflict();
        } else if (!expected_digest) stateConflict();
      } else if (!expected_digest) stateConflict();
    };
    check();
    const temporary = path.join(parent, `.${path.basename(resolved)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
      check();
      fs.renameSync(temporary, resolved);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  });
  return JSON.stringify({ path: relative, status: "written" });
});

register("pulso_primary_artifacts", "Set Pulso artifact tracking without editing versioned ignore files.", {
  artifacts: z.enum(["tracked", "untracked"]),
}, async ({ artifacts }, projectDirectory) => {
  const { stdout } = await executeFile("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: projectDirectory });
  const commonDirectory = (await executeFile("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: projectDirectory })).stdout.trim();
  const file = path.resolve(projectDirectory, stdout.trim());
  if (path.relative(fs.realpathSync(commonDirectory), file) !== path.join("info", "exclude")) throw new Error("Git exclude path is outside the local repository metadata.");
  safeGitMetadataPath(commonDirectory, file);
  if (!fs.existsSync(file) && artifacts === "tracked") return JSON.stringify({ artifacts, status: "configured" });
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  stateFiles.withFileLock(file, () => {
    const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    const lines = previous.split(/\r?\n/).filter((line) => line !== ".pulso/");
    while (lines.length && lines.at(-1) === "") lines.pop();
    if (artifacts === "untracked") lines.push(".pulso/");
    const next = `${lines.filter((line, index) => line || index < lines.length - 1).join("\n")}\n`;
    if (next === previous) return;
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, next, { mode: 0o600, flag: "wx" });
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  });
  return JSON.stringify({ artifacts, status: "configured" });
});

register("pulso_primary_git", "Read Git status, log, show, or HEAD metadata for primary orchestration.", {
  action: z.enum(["status", "log", "show", "rev_parse"]),
  revision: z.string().max(200).optional(),
}, async ({ action, revision }, projectDirectory) => {
  if (revision && (!/^(?:HEAD|[0-9a-fA-F]{7,64}|[A-Za-z][A-Za-z0-9_.-]{0,63}(?:~[0-9]{1,4}|\^[0-9]?)?)$/.test(revision) || revision.startsWith("-") || /[\s\x00-\x1f:\\/@{}]/.test(revision))) throw new Error("Invalid Git revision.");
  const args = action === "status" ? ["status", "--short"]
    : action === "log" ? ["log", "--oneline", "-10"]
      : action === "show" ? ["show", "--no-ext-diff", "--format=fuller", "--end-of-options", revision || "HEAD"]
        : ["rev-parse", "--verify", "--end-of-options", revision || "HEAD"];
  const { stdout } = await executeFile("git", args, { cwd: projectDirectory, maxBuffer: 1024 * 1024 });
  return JSON.stringify({ action, output: stdout.trim() });
}, { readOnlyHint: true });

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
  findings.push({ severity: "info", code: "token_tracking_unavailable", detail: "Copilot MCP exposes tools, not stable model token events." });
  return JSON.stringify({ status: findings.some((item) => item.severity === "error") ? "unhealthy" : findings.some((item) => item.severity === "warning") ? "warning" : "healthy", runtime: "copilot", token_tracking: "unavailable", project: { directory: projectDirectory, key: projectKey }, findings });
}, { readOnlyHint: true });

const experienceSchemas = {
    pulso_experience_start: { action: z.enum(["new", "resume"]), title: z.string().min(3), objective_id: z.string().regex(/^PULSO-OBJ-\d+$/).optional(), reason: z.string().min(10) },
    pulso_experience_repair: {},
    pulso_memory_recall: { query: z.string().min(3), tags: z.array(z.string()).optional() },
    pulso_experience_finalize: { objective_id: z.string().regex(/^(?:PULSO-\d+|PULSO-OBJ-\d+)$/), title: z.string().min(3), status: z.enum(["implemented", "partially_verified", "verified", "integrated", "blocked", "failed", "cancelled"]), summary: z.string().min(10), evidence: z.array(z.string()).min(1), verification_gaps: z.array(z.string().min(3)).default([]), human_interventions: z.number().int().min(0).default(0) },
    pulso_experience_curate: { objective_id: z.string().regex(/^PULSO-OBJ-\d+$|^PULSO-\d+$/) },
    pulso_experience_resume: { objective_id: z.string().regex(/^PULSO-OBJ-\d+$/) },
    pulso_memory_list: {},
    pulso_memory_review: { action: z.enum(["retire", "approve_preference", "reject_preference", "promote_global"]), id: z.string(), reason: z.string().min(1) },
    pulso_profile_recall: {},
    pulso_metrics: { objective_id: z.string().regex(/^(?:PULSO-\d+|PULSO-OBJ-\d+)$/).optional() },
};

for (const [name, baseSchema] of Object.entries(experienceSchemas)) {
  register(name, `Pulso experience operation: ${name}.`, baseSchema, async (args, projectDirectory) => {
    const experience = await experienceFor(projectDirectory);
    const result = await experience.tool[name].execute(args, { directory: projectDirectory, sessionID: experienceSessionID(projectDirectory) });
    if (name !== "pulso_metrics") return result;
    const metrics = JSON.parse(result);
    return JSON.stringify({ ...metrics, token_tracking: "unavailable", objectives: metrics.objectives.map((objective) => ({ ...objective, tokens: null, token_tracking: "unavailable" })), agent_runs: metrics.agent_runs.map((run) => ({ ...run, tokens: null, token_tracking: "unavailable" })) });
  }, ["pulso_memory_recall", "pulso_memory_list", "pulso_profile_recall", "pulso_metrics"].includes(name) ? { readOnlyHint: true } : {});
}

await server.connect(new StdioServerTransport());
