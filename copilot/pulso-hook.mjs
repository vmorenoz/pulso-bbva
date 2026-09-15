import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import crypto from "node:crypto";
import control from "../lib/pulso-control-core.js";
import breakerCore from "../lib/pulso-circuit-breaker-core.js";
import stateFiles from "../lib/pulso-file-state.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = input ? JSON.parse(input) : {};
const cwd = path.resolve(event.cwd || process.cwd());
const hook = process.argv[2] || event.hookEventName || event.hook_event_name || "";
const eventSession = event.sessionId || event.session_id || null;
const uid = typeof process.getuid === "function" ? String(process.getuid()) : "unknown";
const activationDirectory = path.join(os.tmpdir(), `pulso-copilot-activations-${uid}`);

function safeActivationDirectory() {
  if (fs.existsSync(activationDirectory)) {
    const stat = fs.lstatSync(activationDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (typeof process.getuid === "function" && stat.uid !== process.getuid()) || (stat.mode & 0o077)) throw new Error("Unsafe Copilot activation directory.");
  } else fs.mkdirSync(activationDirectory, { mode: 0o700 });
  fs.chmodSync(activationDirectory, 0o700);
}

function pruneActivations() {
  safeActivationDirectory();
  const valid = [];
  for (const name of fs.readdirSync(activationDirectory)) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const file = path.join(activationDirectory, name);
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || Date.now() - stat.mtimeMs > 4 * 60 * 60 * 1000) fs.rmSync(file, { force: true });
      else valid.push({ file, mtimeMs: stat.mtimeMs });
    } catch {}
  }
  for (const entry of valid.sort((left, right) => left.mtimeMs - right.mtimeMs).slice(0, Math.max(0, valid.length - 256))) {
    try { if (fs.lstatSync(entry.file).isFile()) fs.rmSync(entry.file, { force: true }); } catch {}
  }
}

function activationFile(sessionID) {
  return path.join(activationDirectory, `${crypto.createHash("sha256").update(`${cwd}\0${sessionID}`).digest("hex")}.json`);
}

function activeAgent(sessionID) {
  if (!sessionID) return null;
  try {
    const file = activationFile(sessionID);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) return null;
    const activation = JSON.parse(fs.readFileSync(file, "utf8"));
    if (activation.cwd !== cwd || Date.now() - activation.updated_at > 4 * 60 * 60 * 1000) {
      fs.rmSync(file, { force: true });
      return null;
    }
    return activation.agent;
  } catch { return null; }
}

function activate(sessionID, agent) {
  pruneActivations();
  const target = activationFile(sessionID);
  if (fs.existsSync(target) && !fs.lstatSync(target).isFile()) throw new Error("Unsafe Copilot activation file.");
  const temporary = path.join(activationDirectory, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify({ cwd, agent, updated_at: Date.now() }), { mode: 0o600, flag: "wx" });
    if (fs.lstatSync(temporary).isSymbolicLink()) throw new Error("Unsafe Copilot activation temporary file.");
    fs.renameSync(temporary, target);
  } finally { fs.rmSync(temporary, { force: true }); }
}

function deactivate(sessionID) {
  if (sessionID) fs.rmSync(activationFile(sessionID), { force: true });
}

function output(value = {}) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (hook === "subagentStart") {
  const agent = event.agentName || event.agent_name || "";
  if (["pulso-planner", "pulso-executor"].includes(agent) && eventSession) activate(eventSession, agent);
  output(agent === "pulso-executor" && eventSession
    ? { additionalContext: `Use ${eventSession} as owner_session in every pulso_lease call.` }
    : {});
  process.exit(0);
}

try { pruneActivations(); } catch { output(); process.exit(0); }

if (hook === "subagentStop" || hook === "sessionEnd") {
  deactivate(eventSession);
  output();
  process.exit(0);
}

if (!eventSession) {
  output();
  process.exit(0);
}

const agent = activeAgent(eventSession);
if (!agent) {
  output();
  process.exit(0);
}
const tool = event.toolName || event.tool_name || "";
const mutating = /^(apply_patch|edit|str_replace_editor|create|write)$/i.test(tool);
const shell = /^(bash|powershell|execute|shell)$/i.test(tool);
const toolArgs = event.toolArgs || event.tool_input || {};
function mutationPaths(args = {}) {
  if (/^apply_patch$/i.test(tool)) return [...String(args.patchText || args.patch_text || "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
  return [args.filePath || args.file_path || args.path].filter(Boolean);
}
function relativeMutationPath(candidate) {
  const relative = path.relative(cwd, path.resolve(cwd, candidate)).split(path.sep).join("/");
  return !relative || relative === ".." || relative.startsWith("../") ? null : relative;
}
if (hook === "preToolUse" && agent === "pulso-planner" && mutating) {
  const candidates = mutationPaths(toolArgs);
  const invalid = candidates.length === 0 || candidates.some((raw) => {
    const relative = relativeMutationPath(raw);
    if (!relative) return true;
    return relative !== ".pulso" && !relative.startsWith(".pulso/");
  });
  if (invalid) output({ permissionDecision: "deny", permissionDecisionReason: "Pulso Planner may mutate only .pulso artifacts." });
  else output();
  process.exit(0);
}
const leases = path.join(cwd, ".pulso", "leases");
const active = fs.existsSync(leases) ? fs.readdirSync(leases).filter((name) => name.endsWith(".json")).map((name) => {
  try { return JSON.parse(fs.readFileSync(path.join(leases, name), "utf8")); } catch { return null; }
}).filter((lease) => lease?.status === "active" && !control.isExpired(lease) && lease.owner_session === eventSession).sort((a, b) => String(b.heartbeat_at).localeCompare(String(a.heartbeat_at)))[0] : null;

if (!active) {
  if (hook === "preToolUse" && agent === "pulso-executor" && (mutating || shell)) {
    output({ permissionDecision: "deny", permissionDecisionReason: "Pulso Executor must acquire a matching task lease before mutation or shell execution." });
  } else output();
  process.exit(0);
}

const breakerFile = path.join(cwd, ".pulso", "circuit-breakers", `${active.task_id}.json`);
let breaker = null;
try { breaker = JSON.parse(fs.readFileSync(breakerFile, "utf8")); } catch {}
const command = toolArgs.command || toolArgs.cmd || "";

function safeHead() {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

function updateBreaker(mutator) {
  const folder = stateFiles.safeDirectory(cwd, [".pulso", "circuit-breakers"]);
  const file = path.join(folder, `${active.task_id}.json`);
  return stateFiles.withFileLock(file, () => {
    let state;
    try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch { state = breakerCore.createState(active.task_id, safeHead()); }
    mutator(state);
    state.updated_at = new Date().toISOString();
    stateFiles.writeAtomic(file, state);
    return state;
  });
}


function matchesScope(candidate, rule) {
  const normalized = String(rule || "").replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalized) return false;
  if (!normalized.includes("*")) return candidate === normalized || candidate.startsWith(`${normalized}/`);
  const pattern = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*");
  return new RegExp(`^${pattern}$`).test(candidate);
}

function mutationScope(task) {
  // Contracts created before scope was documented as nested stored these at the root.
  const scope = task.scope && typeof task.scope === "object" ? task.scope : task;
  return {
    allowed: Array.isArray(scope.allowed_paths) ? scope.allowed_paths : [],
    excluded: Array.isArray(scope.excluded_paths) ? scope.excluded_paths : [],
  };
}

if (hook === "preToolUse" && mutating && breaker?.state === "open") {
  output({ permissionDecision: "deny", permissionDecisionReason: `Pulso circuit breaker is open for ${active.task_id}: ${breaker.trip_reason || "repeated failure"}.` });
  process.exit(0);
}

if (hook === "preToolUse" && shell && breaker?.state === "open" && !breakerCore.isValidationCommand(command)) {
  output({ permissionDecision: "deny", permissionDecisionReason: `Pulso circuit breaker is open for ${active.task_id}; only diagnostic validation commands remain available.` });
  process.exit(0);
}

if (hook === "preToolUse" && mutating) {
  const taskFile = path.join(cwd, ".pulso", "tasks", `${active.task_id}.json`);
  let task;
  try { task = JSON.parse(fs.readFileSync(taskFile, "utf8")); } catch { output({ permissionDecision: "deny", permissionDecisionReason: `${active.task_id} has no readable task contract.` }); process.exit(0); }
  const candidates = mutationPaths(toolArgs);
  if (!["ready", "in_progress"].includes(task.status)) {
    output({ permissionDecision: "deny", permissionDecisionReason: `${active.task_id} cannot be mutated while status is ${task.status}.` });
    process.exit(0);
  }
  if (candidates.length === 0) {
    output({ permissionDecision: "deny", permissionDecisionReason: `Cannot determine mutation paths for ${tool}.` });
    process.exit(0);
  }
  const { allowed, excluded } = mutationScope(task);
  for (const raw of candidates) {
    const relative = relativeMutationPath(raw);
    if (!relative) {
      output({ permissionDecision: "deny", permissionDecisionReason: `Mutation path escapes the workspace: ${raw}` });
      process.exit(0);
    }
    const ownState = relative === `.pulso/tasks/${active.task_id}.json`;
    if (!ownState && (!allowed.some((rule) => matchesScope(relative, rule)) || excluded.some((rule) => matchesScope(relative, rule)))) {
      output({ permissionDecision: "deny", permissionDecisionReason: `Mutation outside ${active.task_id} scope: ${relative}` });
      process.exit(0);
    }
  }
}

if (hook === "postToolUse" && mutating) updateBreaker((state) => breakerCore.recordRepairAction(state));
if ((hook === "postToolUse" || hook === "postToolUseFailure") && shell) {
  const result = event.toolResult?.textResultForLlm || event.tool_result?.text_result_for_llm || event.error || "";
  if (breakerCore.isValidationCommand(command)) updateBreaker((state) => breakerCore.recordValidation(state, command, result, hook === "postToolUseFailure"));
}
output();
