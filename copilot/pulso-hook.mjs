import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import control from "../lib/pulso-control-core.js";
import breakerCore from "../lib/pulso-circuit-breaker-core.js";
import stateFiles from "../lib/pulso-file-state.js";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const event = input ? JSON.parse(input) : {};
const cwd = path.resolve(event.cwd || process.cwd());
const hook = process.argv[2] || event.hookEventName || event.hook_event_name || "";
const eventSession = event.sessionId || event.session_id || null;

function output(value = {}) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (hook === "sessionStart" || hook === "SessionStart") {
  const config = path.join(cwd, "PULSO.md");
  const sessionContext = `${eventSession ? ` The current Copilot session ID is ${eventSession}; pass it as session_id to Pulso experience calls and as owner_session to every pulso_lease call.` : ""} Pass ${cwd} as project_directory to every pulso-control MCP call.`;
  if (!fs.existsSync(config)) output({ additionalContext: `Pulso is installed. Before delivery work, ask once whether .pulso artifacts should be tracked and create root PULSO.md using the pulso-protocol skill.${sessionContext}` });
  else output({ additionalContext: `Apply this repository's Pulso configuration and project rules.${sessionContext}\n\n${fs.readFileSync(config, "utf8").slice(0, 20000)}` });
  process.exit(0);
}

if (hook === "subagentStart") {
  output({ additionalContext: `${eventSession ? `Use ${eventSession} as session_id in Pulso experience calls and as owner_session in every pulso_lease call. ` : ""}Pass ${cwd} as project_directory to every pulso-control MCP call.` });
  process.exit(0);
}

if (hook === "userPromptSubmitted") {
  output({ additionalContext: `The current project directory is ${cwd}; pass it as project_directory to every pulso-control MCP call.` });
  process.exit(0);
}

const leases = path.join(cwd, ".pulso", "leases");
const active = fs.existsSync(leases) ? fs.readdirSync(leases).filter((name) => name.endsWith(".json")).map((name) => {
  try { return JSON.parse(fs.readFileSync(path.join(leases, name), "utf8")); } catch { return null; }
}).filter((lease) => lease?.status === "active" && !control.isExpired(lease) && (!eventSession || lease.owner_session === eventSession)).sort((a, b) => String(b.heartbeat_at).localeCompare(String(a.heartbeat_at)))[0] : null;

if (!active) {
  output();
  process.exit(0);
}

const breakerFile = path.join(cwd, ".pulso", "circuit-breakers", `${active.task_id}.json`);
let breaker = null;
try { breaker = JSON.parse(fs.readFileSync(breakerFile, "utf8")); } catch {}
const tool = event.toolName || event.tool_name || "";
const mutating = /^(apply_patch|edit|create|write)$/i.test(tool);
const shell = /^(bash|execute|shell)$/i.test(tool);
const toolArgs = event.toolArgs || event.tool_input || {};
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

function mutationPaths(args = {}) {
  if (/^apply_patch$/i.test(tool)) return [...String(args.patchText || args.patch_text || "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
  return [args.filePath || args.file_path || args.path].filter(Boolean);
}

function matchesScope(candidate, rule) {
  const normalized = String(rule || "").replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/$/, "");
  if (!normalized) return false;
  if (!normalized.includes("*")) return candidate === normalized || candidate.startsWith(`${normalized}/`);
  const pattern = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*");
  return new RegExp(`^${pattern}$`).test(candidate);
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
  const allowed = task.scope?.allowed_paths || [];
  const excluded = task.scope?.excluded_paths || [];
  for (const raw of candidates) {
    const relative = path.relative(cwd, path.resolve(cwd, raw)).split(path.sep).join("/");
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
