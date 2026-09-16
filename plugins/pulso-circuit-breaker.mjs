import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import core from "../lib/pulso-circuit-breaker-core.js";
import stateFiles from "../lib/pulso-file-state.js";
import contacts from "../lib/pulso-agent-contacts.js";

const TRACKED_AGENTS = new Set(["pulso-executor", "pulso-verifier"]);
const READ_ONLY_TOOLS = new Set(["read", "glob", "grep", "lsp"]);
const MUTATING_TOOLS = new Set(["edit", "write", "apply_patch", "multi_edit"]);
const TASK_ID_PATTERN = /\bPULSO_TASK_ID=(PULSO-\d+)\b/;
const CONTACT_ID_PATTERN = /\bPULSO_CONTACT_ID=([A-Za-z0-9._-]+)\b/;
const CONTACT_PROBE_PATTERN = /\bPULSO_CONTACT_PROBE=([A-Za-z0-9._-]+)\b/;
const sessionTasks = new Map();
const primarySessions = new Set();

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

function mutationPaths(tool, args = {}) {
  if (tool === "apply_patch") {
    return [...String(args.patchText || "").matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim());
  }
  if (tool === "multi_edit") return (args.edits || []).map((edit) => edit.filePath || edit.path).filter(Boolean);
  return [args.filePath || args.path].filter(Boolean);
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
    stateFiles.withFileLock(file, () => {
      const lease = JSON.parse(fs.readFileSync(file, "utf8"));
      if (lease.status !== "active" || lease.owner_session !== sessionID) return;
      lease.status = "released";
      lease.released_at = new Date().toISOString();
      lease.release_reason = "session_terminal";
      stateFiles.writeAtomic(file, lease);
    });
  }
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
      if (event.agent === "pulso") {
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
      }
      const session = sessionTasks.get(event.sessionID);
      if (!session) return;
      if (session.probe) {
        throw new Error(`Pulso contact probe ${session.agent} cannot use tools.`);
      }
      const { taskID } = session;
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
    },
    "tool.execute.after": async (event, output) => {
      const session = sessionTasks.get(event.sessionID);
      if (!session) return;
      const { taskID } = session;
      if (["edit", "write", "apply_patch", "multi_edit"].includes(event.tool)) {
        await update(input.directory, taskID, (state) => core.recordRepairAction(state), input.client);
        return;
      }
      if (event.tool !== "bash") return;
      const command = event.args?.command;
      if (!core.isValidationCommand(command)) return;
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
