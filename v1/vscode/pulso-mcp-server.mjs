import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import control from "../lib/pulso-control-core.js";
import identity from "../lib/pulso-identity.js";
import stateFiles from "../lib/pulso-file-state.js";
import contacts from "../lib/pulso-agent-contacts.js";
import codegraph from "../lib/pulso-vscode-codegraph.js";
import { PulsoExperienceEnginePlugin } from "../plugins/pulso-experience-engine.mjs";

const server = new McpServer({ name: "pulso-control", version: "0.3.0" });
const directory = fs.realpathSync(process.cwd());
const session = process.env.VSCODE_SESSION_ID || `vscode-${process.pid}-${crypto.randomUUID()}`;
const engine = PulsoExperienceEnginePlugin({ directory, client: { session: { create: async () => ({ data: { id: "vscode-local" } }), prompt: async () => ({ data: {} }), messages: async () => ({ data: [] }), get: async () => ({ data: {} }) } } });
const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
const register = (name, schema, handler, annotations = {}) => server.registerTool(name, { description: `Pulso VS Code control-plane operation: ${name}.`, inputSchema: schema, annotations }, async (args) => text(await handler(args)));
const runtimeRoot = path.resolve(path.dirname(process.argv[1]));
const codegraphOptions = { runtime: "vscode", cwd: directory, home: process.env.HOME || os.homedir(), configFile: path.join(directory, ".vscode", "mcp.json") };
// Server startup is the only VS Code lifecycle boundary; diagnostic tools only inspect.
const codegraphState = codegraph.lifecycle(codegraphOptions);
const writeAtomic = (file, content) => { const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`); fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file); };
register("pulso_route", { objective: z.string().min(3), paths: z.array(z.string()).optional(), changed_files: z.number().int().min(0).optional(), signals: z.array(z.string()).optional() }, (args) => control.classifyRoute(args), { readOnlyHint: true });
register("pulso_skill_digest", { skills: z.array(z.string()).max(10) }, ({ skills }) => control.skillDigest([...new Set(skills)]), { readOnlyHint: true });
register("pulso_identity", {}, () => identity.resolveIdentity(), { readOnlyHint: true });
register("pulso_agent_contacts", { action: z.enum(["scan", "list", "register", "remove", "match"]), agent: z.string().regex(/^[A-Za-z0-9._-]+$/).optional(), digest: z.string().regex(/^[a-f0-9]{64}$/).optional(), description: z.string().max(500).optional(), use_when: z.array(z.string().max(120)).max(12).optional(), avoid_when: z.array(z.string().max(120)).max(12).optional(), capabilities: z.array(z.string().max(120)).max(12).optional(), mutation: z.enum(["read_only", "scoped"]).optional(), objective: z.string().max(2000).optional(), paths: z.array(z.string().max(500)).max(50).optional() }, (args) => {
  if (args.action === "scan") return { candidates: contacts.scan(directory) };
  if (args.action === "list") return { contacts: Object.values(contacts.readCatalog().contacts) };
  if (args.action === "remove") { if (!args.agent) throw new Error("agent is required for remove."); return { agent: args.agent, removed: contacts.remove(args.agent) }; }
  if (args.action === "match") { if (!args.objective) throw new Error("objective is required for match."); return { contacts: contacts.match(directory, args.objective, args.paths || []) }; }
  if (!args.agent || !args.digest || !args.description || !args.use_when?.length || !args.capabilities?.length || !args.mutation) throw new Error("register requires agent, digest, description, use_when, capabilities, and mutation.");
  return { status: "registered", contact: contacts.register(directory, { agent: args.agent, digest: args.digest, description: args.description, use_when: args.use_when, avoid_when: args.avoid_when || [], capabilities: args.capabilities, mutation: args.mutation }) };
});
register("pulso_capabilities", {}, () => ({
  runtime: "vscode-agent-host",
  specialists: ["pulso-executor", "pulso-planner", "pulso-contact-manager", "pulso-explorer", "pulso-verifier", "pulso-challenger", "pulso-integration-auditor", "pulso-security-auditor", "pulso-ui-auditor", "pulso-experience-curator", "pulso-delivery-reporter"],
  external_agent_contacts: "pulso-autointegrate via pulso-contact-manager",
  unsupported: ["pulso-configure", "pulso-dashboard", "pulso_metrics"],
  codegraph: { external: true, status: codegraph.inspect(codegraphOptions).status, fallback: "native read/search/LSP/terminal" },
}), { readOnlyHint: true });
register("pulso_status", {}, async (args) => (await engine).tool.pulso_status.execute(args, { directory, sessionID: session }), { readOnlyHint: true });
register("pulso_reconcile", { confirmed: z.boolean(), status: z.enum(["implemented", "partially_verified", "verified", "integrated", "blocked", "failed", "cancelled"]), summary: z.string().min(10), evidence: z.array(z.string()).min(1) }, async (args) => (await engine).tool.pulso_delivery.execute({ action: "reconcile", ...args }, { directory, sessionID: session }));
register("pulso_doctor", {}, () => {
  const home = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
  const required = [path.join(home, "agents", "pulso.agent.md"), path.join(home, "mcp-config.json"), process.argv[1]];
  const findings = required
    .filter((file) => !fs.existsSync(file))
    .map((file) => ({ severity: "error", code: "missing_plugin_component", detail: file }));
  const currentCodegraph = codegraph.inspect(codegraphOptions);
  findings.push({ severity: currentCodegraph.status === "ready" ? "info" : "warning", code: `codegraph_${currentCodegraph.status}`, detail: currentCodegraph });
  return { status: findings.some((finding) => finding.severity === "error") ? "unhealthy" : "healthy", runtime: "vscode-agent-host", findings };
}, { readOnlyHint: true });
register("pulso_lease", { action: z.enum(["acquire", "heartbeat", "release", "status", "recover"]), task_id: z.string().regex(/^PULSO-\d+$/), owner_session: z.string().min(1).optional(), ttl_minutes: z.number().int().min(5).max(240).default(30) }, ({ action, task_id, owner_session, ttl_minutes }) => {
  const file = path.join(stateFiles.safeDirectory(directory, [".pulso", "leases"]), `${task_id}.json`);
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  if (action === "status") return current || { task_id, status: "none" };
  const owner = owner_session || session;
  if (action === "acquire" && current?.status === "active" && !control.isExpired(current) && current.owner_session !== owner) throw new Error(`${task_id} is leased by another active session.`);
  const now = new Date(); const active = action === "release" ? false : true;
  const next = { ...(current || {}), schema_version: 1, task_id, status: active ? "active" : "released", owner_session: owner, heartbeat_at: now.toISOString(), expires_at: new Date(now.getTime() + ttl_minutes * 60000).toISOString(), ...(active ? {} : { released_at: now.toISOString() }) };
  stateFiles.writeAtomic(file, next); return next;
});
register("pulso_lease_diagnostic", { task_id: z.string().regex(/^PULSO-\d+$/) }, ({ task_id }) => ({ task_id, status: "diagnostic_available" }), { readOnlyHint: true });
register("pulso_contract", { task_id: z.string().regex(/^PULSO-\d+$/) }, ({ task_id }) => { const file = path.join(directory, ".pulso", "tasks", `${task_id}.json`); if (!fs.existsSync(file)) throw new Error("No active authorized task contract."); const task = JSON.parse(fs.readFileSync(file, "utf8")); return { outcome: task.objective || task.title, scope: task.scope, acceptance_criteria: task.acceptance_criteria, validation: task.validation, skills: task.skills }; }, { readOnlyHint: true });
register("pulso_delivery", { action: z.enum(["begin", "resume", "close"]), title: z.string().min(3).optional(), objective_id: z.string().optional(), task_id: z.string().optional(), allowed_paths: z.array(z.string()).optional(), excluded_paths: z.array(z.string()).optional(), acceptance_criteria: z.array(z.string()).optional(), validation: z.array(z.string()).optional(), skills: z.array(z.string()).optional(), signals: z.array(z.string()).optional(), status: z.enum(["implemented", "partially_verified", "verified", "integrated", "blocked", "failed", "cancelled"]).optional(), summary: z.string().optional(), evidence: z.array(z.string()).optional(), verification_gaps: z.array(z.string()).optional() }, async (args) => (await engine).tool.pulso_delivery.execute(args, { directory, sessionID: session }));
register("pulso_artifacts", { artifacts: z.enum(["tracked", "untracked"]) }, ({ artifacts }) => {
  const config = path.join(directory, "PULSO.md"); const gitDirectory = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: directory, encoding: "utf8" }).trim(); const exclude = path.resolve(directory, gitDirectory);
  const previous = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : ""; const body = previous.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "") || "# Pulso Project Configuration\n\n## Project Rules\n";
  writeAtomic(config, `---\nschema_version: 1\nartifacts: ${artifacts}\n---\n\n${body}`);
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : ""; const lines = current.split(/\r?\n/).filter((line) => line && line !== ".pulso/"); if (artifacts === "untracked") lines.push(".pulso/"); writeAtomic(exclude, `${[...new Set(lines)].join("\n")}\n`);
  return { artifacts, config_file: config, exclude_file: exclude };
});
for (const name of ["pulso_record_reporter_result", "pulso_record_curator_result"]) register(name, {}, () => ({ status: "recorded" }));

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
