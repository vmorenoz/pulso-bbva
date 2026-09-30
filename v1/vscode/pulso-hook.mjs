import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import control from "../lib/pulso-control-core.js";
import breakerCore from "../lib/pulso-circuit-breaker-core.js";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const event = raw ? JSON.parse(raw) : {};
const hook = process.argv[2] || event.hookEventName || "";
const cwd = path.resolve(event.cwd || process.cwd());
const session = event.sessionId || event.session_id;
const agent = event.agentName || event.agent_name || event.agent || "";
const stateDirectory = path.join(os.tmpdir(), "pulso-vscode-hooks");
const stateFile = session ? path.join(stateDirectory, `${crypto.createHash("sha256").update(`${cwd}\0${session}`).digest("hex")}.json`) : null;
const output = (value = {}) => process.stdout.write(`${JSON.stringify(value)}\n`);
const deny = (reason) => output({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
const readState = () => { try { return JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { return null; } };
const writeState = (value) => { fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 }); fs.writeFileSync(stateFile, JSON.stringify(value), { mode: 0o600 }); };
const release = () => { const item = readState(); if (!item?.task_id) return; const lease = path.join(cwd, ".pulso", "leases", `${item.task_id}.json`); try { const value = JSON.parse(fs.readFileSync(lease, "utf8")); if (value.owner_session === session && value.status === "active") { value.status = "released"; value.released_at = new Date().toISOString(); fs.writeFileSync(lease, JSON.stringify(value)); } } catch {} };

if (hook === "SubagentStart" && session) { writeState({ agent, updated_at: Date.now() }); output(); process.exit(0); }
if (["SubagentStop", "Stop"].includes(hook)) { release(); if (stateFile) fs.rmSync(stateFile, { force: true }); output(); process.exit(0); }
const state = readState();
const tool = event.tool_name || event.toolName || "";
const input = event.tool_input || event.toolArgs || {};
const mutating = /^(apply_patch|edit|create|write|str_replace_editor|create_file|write_file|replace_string_in_file|editFiles)$/i.test(tool);
const shell = /^(bash|powershell|execute|shell|terminal|runTerminalCommand)$/i.test(tool);
if (hook !== "PreToolUse" || !state) { output(); process.exit(0); }
if (["pulso-planner", "pulso-explorer", "pulso-verifier", "pulso-challenger", "pulso-integration-auditor", "pulso-security-auditor", "pulso-ui-auditor", "pulso-experience-curator", "pulso-delivery-reporter"].includes(state.agent) && (mutating || shell)) { deny("This Pulso specialist is read-only."); process.exit(0); }
if (state.agent !== "pulso-executor" || (!mutating && !shell)) { output(); process.exit(0); }
const leases = path.join(cwd, ".pulso", "leases");
const lease = fs.existsSync(leases) && fs.readdirSync(leases).map((name) => { try { return JSON.parse(fs.readFileSync(path.join(leases, name), "utf8")); } catch { return null; } }).find((item) => item?.status === "active" && item.owner_session === session && !control.isExpired(item));
if (!lease) { deny("Pulso Executor must acquire a matching task lease before mutation or shell execution."); process.exit(0); }
const task = (() => { try { return JSON.parse(fs.readFileSync(path.join(cwd, ".pulso", "tasks", `${lease.task_id}.json`), "utf8")); } catch { return null; } })();
if (!task || !["ready", "in_progress"].includes(task.status)) { deny("The active task is not resumable."); process.exit(0); }
const mutationPaths = () => tool === "apply_patch" ? [...String(input.patchText || input.patch_text || "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim()) : [input.filePath || input.file_path || input.path].filter(Boolean);
const matches = (candidate, rule) => { const normalized = String(rule || "").replace(/^\.\//, "").replace(/\\/g, "/").replace(/\/$/, ""); const pattern = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*"); return new RegExp(`^${pattern}$`).test(candidate) || candidate.startsWith(`${normalized}/`); };
if (mutating) {
  const scope = task.scope || task;
  const allowed = scope.allowed_paths || [];
  const excluded = scope.excluded_paths || [];
  for (const rawPath of mutationPaths()) {
    const relative = path.relative(cwd, path.resolve(cwd, rawPath)).split(path.sep).join("/");
    if (!relative || relative === ".." || relative.startsWith("../") || !allowed.some((rule) => matches(relative, rule)) || excluded.some((rule) => matches(relative, rule))) {
      deny(`Mutation outside ${lease.task_id} scope: ${rawPath}`);
      process.exit(0);
    }
  }
}
const breaker = (() => { try { return JSON.parse(fs.readFileSync(path.join(cwd, ".pulso", "circuit-breakers", `${lease.task_id}.json`), "utf8")); } catch { return null; } })();
if (breaker?.state === "open" && (mutating || !breakerCore.isValidationCommand(input.command || ""))) { deny("Pulso circuit breaker is open; only diagnostic validation remains available."); process.exit(0); }
if (shell && /\bgit\s+(?:add|commit|push)\b/.test(input.command || "") && task.status !== "in_progress") { deny("Git mutation requires the resumed delivery lifecycle."); process.exit(0); }
output();
