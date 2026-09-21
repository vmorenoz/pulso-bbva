import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import core from "../lib/pulso-circuit-breaker-core.js";
import stateFiles from "../lib/pulso-file-state.js";
import contacts from "../lib/pulso-agent-contacts.js";
import leases from "../lib/pulso-lease-core.js";
import contracts from "../lib/pulso-contract-core.js";
import ownership from "../lib/pulso-ownership-core.js";

const TRACKED_AGENTS = new Set(["pulso-executor", "pulso-verifier"]);
const READ_ONLY_TOOLS = new Set(["read", "glob", "grep", "lsp"]);
const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "multi_edit"]);
const TASK_ID_PATTERN = /\bPULSO_TASK_ID=(PULSO-\d+)\b/;
const CONTACT_ID_PATTERN = /\bPULSO_CONTACT_ID=([A-Za-z0-9._-]+)\b/;
const CONTACT_PROBE_PATTERN = /\bPULSO_CONTACT_PROBE=([A-Za-z0-9._-]+)\b/;
const sessionTasks = new Map();
const primarySessions = new Set();
const ORPHAN_GRACE_MS = 5 * 60 * 1000;

function taskIDFromParts(parts) {
  for (const part of parts || []) {
    const match = TASK_ID_PATTERN.exec(part?.text || part?.prompt || "");
    if (match) return match[1];
  }
  return null;
}

function markerFromParts(parts, pattern) {
  for (const part of parts || []) {
    const match = pattern.exec(part?.text || part?.prompt || "");
    if (match) return match[1];
  }
  return null;
}

function statePath(directory, taskID) {
  return path.join(stateFiles.safeDirectory(directory, [".pulso", "circuit-breakers"]), `${taskID}.json`);
}

function readTaskAndLease(directory, taskID) {
  const taskFile = path.join(stateFiles.safeDirectory(directory, [".pulso", "tasks"]), `${taskID}.json`);
  const leaseFile = path.join(stateFiles.safeDirectory(directory, [".pulso", "leases"]), `${taskID}.json`);
  if (!fs.existsSync(taskFile)) throw new Error(`${taskID} has no task contract.`);
  if (!fs.existsSync(leaseFile)) throw new Error(`${taskID} has no active lease.`);
  return {
    task: JSON.parse(fs.readFileSync(taskFile, "utf8")),
    lease: JSON.parse(fs.readFileSync(leaseFile, "utf8")),
  };
}

function hasRunnableTask(directory, taskID) {
  if (!taskID) return false;
  const file = path.join(directory, ".pulso", "tasks", `${taskID}.json`);
  try {
    return ["ready", "in_progress"].includes(JSON.parse(fs.readFileSync(file, "utf8")).status);
  } catch {
    return false;
  }
}

function taskInstructions(directory, taskID) {
  const file = path.join(stateFiles.safeDirectory(directory, [".pulso", "tasks"]), `${taskID}.json`);
  if (!fs.existsSync(file)) return null;
  const task = JSON.parse(fs.readFileSync(file, "utf8"));
  const details = contracts.workerContract(task);
  return `\n\n[PULSO INTERNAL CONTRACT - do not mention in user-facing output]\n${JSON.stringify(details)}\n[/PULSO INTERNAL CONTRACT]`;
}

function mutationPaths(tool, args = {}) {
  if (tool === "apply_patch") {
    return [...String(args.patchText || "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
  }
  if (tool === "multi_edit") return (args.edits || []).map((edit) => edit.filePath || edit.path).filter(Boolean);
  return [args.filePath || args.path].filter(Boolean);
}

function isGitMutationCommand(command) {
  return /\bgit\s+(?:add|commit|push|merge|rebase|cherry-pick|reset|restore|clean|stash)\b/i.test(String(command || ""));
}

function relativePath(directory, candidate) {
  const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(directory, candidate);
  const relative = path.relative(directory, absolute).split(path.sep).join("/");
  if (!relative || relative === ".." || relative.startsWith("../")) throw new Error(`Mutation path escapes the workspace: ${candidate}`);
  return relative;
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

function enforceMutation(directory, sessionID, taskID, tool, args, allowTaskState = true) {
  const { task, lease } = readTaskAndLease(directory, taskID);
  if (!["ready", "in_progress"].includes(task.status)) throw new Error(`${taskID} cannot be mutated while status is ${task.status}.`);
  const leaseExpiry = Date.parse(lease.expires_at);
  if (lease.status !== "active" || !Number.isFinite(leaseExpiry) || leaseExpiry <= Date.now() || lease.owner_session !== sessionID) {
    throw new Error(`${taskID} requires an active lease owned by this session before editing.`);
  }
  const candidates = mutationPaths(tool, args);
  if (candidates.length === 0) throw new Error(`Cannot determine mutation paths for ${tool}.`);
  const { allowed, excluded } = mutationScope(task);
  for (const raw of candidates) {
    const candidate = relativePath(directory, raw);
    const ownState = allowTaskState && candidate === `.pulso/tasks/${taskID}.json`;
    if (!ownState && (!allowed.some((rule) => matchesScope(candidate, rule)) || excluded.some((rule) => matchesScope(candidate, rule)))) {
      throw new Error(`Mutation outside ${taskID} scope: ${candidate}`);
    }
  }
}

function enforceGitMutation(directory, sessionID, taskID) {
  const { task, lease } = readTaskAndLease(directory, taskID);
  if (!['ready', 'in_progress'].includes(task.status)) throw new Error(`${taskID} must be resumed before Git integration.`);
  if (lease.status !== "active" || lease.owner_session !== sessionID || leases.isExpired(lease)) {
    throw new Error(`${taskID} requires an active lease owned by this session before Git integration.`);
  }
}

function safeHead(directory) {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function readState(directory, taskID) {
  const file = statePath(directory, taskID);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return core.createState(taskID, safeHead(directory));
  }
}

function writeState(directory, state) {
  const file = statePath(directory, state.task_id);
  state.updated_at = new Date().toISOString();
  stateFiles.writeAtomic(file, state);
}

function releaseSessionLeases(directory, sessionID) {
  const leasesDirectory = path.join(directory, ".pulso", "leases");
  if (!fs.existsSync(leasesDirectory)) return;
  const safeLeasesDirectory = stateFiles.safeDirectory(directory, [".pulso", "leases"]);
  for (const name of fs.readdirSync(safeLeasesDirectory)) {
    if (!/^PULSO-\d+\.json$/.test(name)) continue;
    const file = path.join(safeLeasesDirectory, name);
    const lease = JSON.parse(fs.readFileSync(file, "utf8"));
    if (lease.status !== "active" || lease.owner_session !== sessionID) continue;
    leases.release(directory, lease.task_id, { ownerSession: sessionID, releasedBy: "plugin", reason: "session_terminal" });
  }
}

function updateTaskStatus(directory, taskID, status) {
  const file = path.join(stateFiles.safeDirectory(directory, [".pulso", "tasks"]), `${taskID}.json`);
  if (!fs.existsSync(file)) return;
  stateFiles.withFileLock(file, () => {
    const task = JSON.parse(fs.readFileSync(file, "utf8"));
    task.revision = Math.max(0, Number(task.revision) || 0) + 1;
    task.status = status;
    task.execution = { ...(task.execution || {}), updated_at: new Date().toISOString() };
    stateFiles.writeAtomic(file, task);
  });
}

function updateTaskExecution(directory, taskID, mutator) {
  const file = path.join(stateFiles.safeDirectory(directory, [".pulso", "tasks"]), `${taskID}.json`);
  if (!fs.existsSync(file)) return;
  stateFiles.withFileLock(file, () => {
    const task = JSON.parse(fs.readFileSync(file, "utf8"));
    const execution = { ...(task.execution || {}) };
    mutator(execution);
    execution.updated_at = new Date().toISOString();
    task.revision = Math.max(0, Number(task.revision) || 0) + 1;
    task.execution = execution;
    task.updated_at = execution.updated_at;
    stateFiles.writeAtomic(file, task);
  });
}

function recordTaskMutation(directory, taskID, tool, args) {
  const paths = mutationPaths(tool, args).map((candidate) => relativePath(directory, candidate));
  updateTaskExecution(directory, taskID, (execution) => {
    execution.changed_files = [...new Set([...(execution.changed_files || []), ...paths])];
  });
}

function recordTaskValidation(directory, taskID, command, output, failed) {
  updateTaskExecution(directory, taskID, (execution) => {
    execution.commands = [...(execution.commands || []), command].slice(-20);
    const result = `${failed ? "failed" : "passed"}: ${String(output || "").trim().slice(0, 500) || "no output"}`;
    execution.results = [...(execution.results || []), result].slice(-20);
    execution.validation_confidence = failed ? "unverified" : "verified";
  });
}

function responseData(response) {
  return response?.data || response;
}

async function ownerActivity(input, ownerSession) {
  if (!input.client?.session?.status) return "unknown";
  try {
    const statuses = responseData(await input.client.session.status({ query: { directory: input.directory } })) || {};
    const status = statuses[ownerSession];
    if (!status || status.type === "idle") return "inactive";
    return ["busy", "retry"].includes(status.type) ? "active" : "unknown";
  } catch {
    return "unknown";
  }
}

async function releaseOrphanedLease(input, taskID) {
  const lease = leases.read(input.directory, taskID);
  if (!lease || lease.status !== "active") return false;
  const activity = await ownerActivity(input, lease.owner_session);
  if (ownership.decideLeaseAction({ lease, ownerActivity: activity, graceMs: ORPHAN_GRACE_MS }) !== "recover") return false;
  try {
    leases.release(input.directory, taskID, {
      force: true,
      expectedOwner: lease.owner_session,
      expectedHeartbeat: lease.heartbeat_at,
      releasedBy: "plugin",
      reason: activity === "inactive" ? "owner_session_inactive" : "owner_session_unreachable",
    });
    return true;
  } catch {
    return false;
  }
}

async function acquireExecutorLease(input, taskID, sessionID) {
  const current = leases.read(input.directory, taskID);
  if (current?.status === "active" && current.owner_session !== sessionID) {
    await releaseOrphanedLease(input, taskID);
  }
  const remaining = leases.read(input.directory, taskID);
  if (remaining?.status === "active" && remaining.owner_session !== sessionID) {
    throw new Error(`${taskID} still has an active executor; overlapping mutation is blocked.`);
  }
  return leases.acquire(input.directory, taskID, sessionID, 30);
}

function commandFailed(output) {
  const metadata = output.metadata || {};
  if (typeof metadata.exitCode === "number") return metadata.exitCode !== 0;
  return /\b(command failed|build failure|error:|(?:tests?|failures?):\s*[1-9]\d*\s+failed)\b/i.test(output.output || "");
}

async function update(directory, taskID, mutator, client) {
  const file = statePath(directory, taskID);
  return stateFiles.withFileLock(file, () => {
    const state = readState(directory, taskID);
    mutator(state);
    writeState(directory, state);
    return state;
  });
}

function migrateLegacyTokenCaps(directory) {
  const pulsoDirectory = path.join(directory, ".pulso");
  const breakersDirectory = path.join(pulsoDirectory, "circuit-breakers");
  if (!fs.existsSync(breakersDirectory)) return;
  const safeBreakersDirectory = stateFiles.safeDirectory(directory, [".pulso", "circuit-breakers"]);
  for (const name of fs.readdirSync(safeBreakersDirectory)) {
    if (!/^PULSO-\d+\.json$/.test(name)) continue;
    const file = path.join(safeBreakersDirectory, name);
    stateFiles.withFileLock(file, () => {
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      if (state.state !== "open" || state.trip_reason !== "token_cap") return;
      core.normalizeState(state);
      writeState(directory, state);
    });
  }
}

export async function PulsoCircuitBreakerPlugin(input) {
  let migrated = false;
  return {
    "chat.message": async (event, output) => {
      if (["pulso", "pulso-contact-manager"].includes(event.agent)) {
        primarySessions.add(event.sessionID);
        return;
      }
      const probe = markerFromParts(output.parts, CONTACT_PROBE_PATTERN);
      const contactID = markerFromParts(output.parts, CONTACT_ID_PATTERN);
      const external = probe || contactID;
      let registeredContact = null;
      if (external) {
        if (external !== event.agent) throw new Error(`Pulso contact marker ${external} does not match delegated agent ${event.agent}.`);
        if (probe) {
          if (!contacts.discoverAgents(input.directory).some((candidate) => candidate.agent === probe)) throw new Error(`Pulso contact probe references unavailable agent ${probe}.`);
          sessionTasks.set(event.sessionID, { agent: event.agent, contact: true, probe: true });
          return;
        }
        registeredContact = contacts.registeredContact(input.directory, contactID);
        if (!registeredContact) throw new Error(`Pulso contact ${contactID} is not registered or changed after registration.`);
      }
      if (!TRACKED_AGENTS.has(event.agent || "") && !external) return;
      const taskID = taskIDFromParts(output.parts);
      if (!taskID) throw new Error(`${event.agent} requires PULSO_TASK_ID=PULSO-xxx for circuit-breaker enforcement.`);
      if (!migrated) {
        migrateLegacyTokenCaps(input.directory);
        migrated = true;
      }
      sessionTasks.set(event.sessionID, { taskID, agent: event.agent, contact: Boolean(external), mutation: registeredContact?.mutation });
      // The parent task call stays compact; only the worker receives the full contract.
      const instructions = taskInstructions(input.directory, taskID);
      if (instructions) output.parts = [...(output.parts || []), { type: "text", text: instructions }];
      if (event.agent === "pulso-executor" || registeredContact?.mutation === "scoped") {
        if (hasRunnableTask(input.directory, taskID)) {
          await acquireExecutorLease(input, taskID, event.sessionID);
          updateTaskStatus(input.directory, taskID, "in_progress");
        }
      }
      const state = await update(input.directory, taskID, (current) => {
        core.addSession(current, event.sessionID);
      }, input.client);
      if (state.state === "open") return;
    },
    "tool.execute.before": async (event, output) => {
      if (event.tool === "task" && primarySessions.has(event.sessionID)) {
        const agent = output.args?.subagent_type || output.args?.agent;
        if (agent && !agent.startsWith("pulso-")) {
          const parts = [{ text: output.args?.prompt || "" }];
          const probe = markerFromParts(parts, CONTACT_PROBE_PATTERN);
          const contactID = markerFromParts(parts, CONTACT_ID_PATTERN);
          const validProbe = probe === agent && contacts.discoverAgents(input.directory).some((candidate) => candidate.agent === agent);
          const taskID = taskIDFromParts(parts);
          const validContact = contactID === agent && hasRunnableTask(input.directory, taskID) && contacts.registeredContact(input.directory, agent);
          if (!validProbe && !validContact) throw new Error(`External agent ${agent} must be an available Pulso contact with the required delegation markers.`);
        }
        const taskID = taskIDFromParts([{ text: output.args?.prompt || "" }]);
        const mutatingDispatch = agent === "pulso-executor" || contacts.registeredContact(input.directory, agent)?.mutation === "scoped";
        if (taskID && mutatingDispatch) {
          const current = leases.read(input.directory, taskID);
          if (current?.status === "active") {
            const released = await releaseOrphanedLease(input, taskID);
            if (!released) throw new Error(`${taskID} still has an active executor; overlapping mutation is blocked.`);
          }
        }
      }
      const session = sessionTasks.get(event.sessionID);
      if (!session) return;
      if (session.probe) {
        throw new Error(`Pulso contact probe ${session.agent} cannot use tools.`);
      }
      const { taskID } = session;
      if (session.agent === "pulso-executor" || session.mutation === "scoped") {
        const lease = leases.read(input.directory, taskID);
        if (lease?.status === "active" && lease.owner_session === event.sessionID) {
          leases.heartbeat(input.directory, taskID, event.sessionID, 30);
        }
      }
      if (session.contact) {
        if (["bash", "task"].includes(event.tool)) throw new Error(`Pulso contact ${session.agent} cannot use ${event.tool}.`);
        if (event.tool.startsWith("pulso_") && event.tool !== "pulso_lease") throw new Error(`Pulso contact ${session.agent} cannot operate Pulso control tool ${event.tool}.`);
        if (session.mutation !== "scoped" && MUTATING_TOOLS.has(event.tool)) throw new Error(`Pulso contact ${session.agent} is registered as read-only.`);
      }
      const state = readState(input.directory, taskID);
      const leaseAction = event.tool === "pulso_lease" ? output.args?.action : null;
      const diagnosticValidation = event.tool === "bash" && core.isValidationCommand(output.args?.command);
      const allowedWhileOpen = READ_ONLY_TOOLS.has(event.tool) || diagnosticValidation || ["status", "release"].includes(leaseAction);
      if (state.state === "open" && !allowedWhileOpen) {
        throw new Error(`CIRCUIT BREAKER OPEN for ${taskID}: ${state.trip_reason}. Mutating execution blocked; read-only diagnosis remains available.`);
      }
      if (MUTATING_TOOLS.has(event.tool)) enforceMutation(input.directory, event.sessionID, taskID, event.tool, output.args, !session.contact);
      if (event.tool === "bash" && isGitMutationCommand(output.args?.command)) enforceGitMutation(input.directory, event.sessionID, taskID);
    },
    "tool.execute.after": async (event, output) => {
      const session = sessionTasks.get(event.sessionID);
      if (!session) return;
      const { taskID } = session;
      if (["edit", "write", "apply_patch", "multi_edit"].includes(event.tool)) {
        recordTaskMutation(input.directory, taskID, event.tool, event.args);
        await update(input.directory, taskID, (state) => core.recordRepairAction(state), input.client);
        return;
      }
      if (event.tool !== "bash") return;
      const command = event.args?.command;
      if (!core.isValidationCommand(command)) return;
      recordTaskValidation(input.directory, taskID, command, output.output, commandFailed(output));
      await update(input.directory, taskID, (state) => core.recordValidation(state, command, output.output, commandFailed(output)), input.client);
    },
    event: async ({ event }) => {
      const terminalStatus = event.type === "session.status" && event.properties?.status?.type === "idle";
      if (/^session\.(?:deleted|ended|closed|idle|error)$/.test(event.type || "") || terminalStatus) {
        const sessionID = event.properties?.info?.id || event.properties?.sessionID || event.properties?.session_id;
        if (sessionID) {
          releaseSessionLeases(input.directory, sessionID);
          sessionTasks.delete(sessionID);
          primarySessions.delete(sessionID);
        }
        return;
      }
      if (event.type !== "message.updated") return;
      const message = event.properties?.info;
      if (message?.role !== "assistant") return;
      const session = sessionTasks.get(message.sessionID);
      if (!session) return;
      const { taskID } = session;
      await update(input.directory, taskID, (state) => core.recordTokens(state, message.tokens, message.sessionID), input.client);
    },
  };
}
