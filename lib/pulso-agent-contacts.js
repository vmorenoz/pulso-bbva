"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const stateFiles = require("./pulso-file-state.js");

const MAX_AGENTS = 500;

function catalogPath() {
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode", "pulso", "agent-contacts.json");
}

function emptyCatalog() {
  return { schema_version: 1, contacts: {} };
}

function readCatalog() {
  const file = catalogPath();
  try {
    const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
    if (catalog?.schema_version !== 1 || !catalog.contacts || Array.isArray(catalog.contacts)) throw new Error("Invalid Pulso agent contact catalog.");
    return catalog;
  } catch (error) {
    if (error.code === "ENOENT") return emptyCatalog();
    throw error;
  }
}

function frontmatterValue(text, key) {
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || "";
  const value = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
  return value?.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2") || "";
}

function agentRoots(directory) {
  const config = path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"));
  return [
    { root: path.join(config, "agent"), scope: "global" },
    { root: path.join(config, "agents"), scope: "global" },
    { root: path.join(directory, ".opencode", "agent"), scope: "project" },
    { root: path.join(directory, ".opencode", "agents"), scope: "project" },
    { root: path.join(os.homedir(), ".copilot", "agents"), scope: "global" },
    { root: path.join(directory, ".github", "agents"), scope: "project" },
  ];
}

function discoverAgents(directory) {
  const found = new Map();
  for (const { root, scope } of agentRoots(directory)) {
    if (!fs.existsSync(root) || fs.lstatSync(root).isSymbolicLink()) continue;
    const pending = [root];
    while (pending.length && found.size < MAX_AGENTS) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const file = path.join(current, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          pending.push(file);
          continue;
        }
        if (!entry.isFile() || path.extname(entry.name) !== ".md") continue;
        const agent = path.basename(entry.name, ".md").replace(/\.agent$/, "");
        if (!/^[A-Za-z0-9._-]+$/.test(agent) || agent === "pulso" || agent.startsWith("pulso-")) continue;
        const content = fs.readFileSync(file, "utf8");
        const description = frontmatterValue(content, "description").slice(0, 500);
        if (!description) continue;
        const permissionBlock = content.match(/^permission:\s*\r?\n([\s\S]*?)(?=^[A-Za-z_][\w-]*:|^---$)/m)?.[1] || "";
        const mutationHint = /\b(?:edit|bash):\s*allow\b/m.test(permissionBlock) || /\b(?:edit|bash):\s*\r?\n(?:\s+.+\r?\n)*?\s+"?\*"?:\s*allow\b/m.test(permissionBlock);
        const mode = frontmatterValue(content, "mode") || "subagent";
        found.set(agent, {
          agent,
          description,
          mode,
          compatible: mode !== "primary",
          scope,
          source: file,
          digest: crypto.createHash("sha256").update(content).digest("hex"),
          mutation_hint: mutationHint ? "scoped" : "read_only",
        });
      }
    }
  }
  return [...found.values()].sort((left, right) => left.agent.localeCompare(right.agent));
}

function scan(directory) {
  const catalog = readCatalog();
  return discoverAgents(directory).map((candidate) => ({
    ...candidate,
    registration: !catalog.contacts[candidate.agent] ? "new" : catalog.contacts[candidate.agent].digest === candidate.digest ? "current" : "changed",
  }));
}

function writeCatalog(mutator) {
  const file = catalogPath();
  const parent = path.dirname(file);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(parent).isSymbolicLink()) throw new Error("Unsafe Pulso agent contact directory.");
  return stateFiles.withFileLock(file, () => {
    const catalog = readCatalog();
    const result = mutator(catalog);
    stateFiles.writeAtomic(file, catalog);
    return result;
  });
}

function register(directory, input) {
  const candidate = discoverAgents(directory).find((item) => item.agent === input.agent);
  if (!candidate) throw new Error(`Agent ${input.agent} is not available in the current OpenCode installation.`);
  if (!candidate.compatible) throw new Error(`Agent ${input.agent} is primary-only and cannot be delegated through task.`);
  if (candidate.digest !== input.digest) throw new Error(`Agent ${input.agent} changed after scanning; scan it again before registration.`);
  return writeCatalog((catalog) => {
    const contact = {
      agent: candidate.agent,
      source: candidate.source,
      digest: candidate.digest,
      description: input.description.trim(),
      use_when: [...new Set(input.use_when.map((item) => item.trim()).filter(Boolean))],
      avoid_when: [...new Set(input.avoid_when.map((item) => item.trim()).filter(Boolean))],
      capabilities: [...new Set(input.capabilities.map((item) => item.trim()).filter(Boolean))],
      mutation: input.mutation,
      enabled: true,
      updated_at: new Date().toISOString(),
    };
    catalog.contacts[candidate.agent] = contact;
    return contact;
  });
}

function remove(agent) {
  return writeCatalog((catalog) => {
    if (!catalog.contacts[agent]) return false;
    delete catalog.contacts[agent];
    return true;
  });
}

function tokens(value) {
  return new Set(String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9][a-z0-9_.+-]{1,}/g) || []);
}

function registeredContact(directory, agent) {
  const contact = readCatalog().contacts[agent];
  if (!contact || contact.enabled === false) return null;
  const candidate = discoverAgents(directory).find((item) => item.agent === agent);
  return candidate?.digest === contact.digest ? contact : null;
}

function match(directory, objective, paths = [], limit = 3) {
  const query = tokens([objective, ...paths].join(" "));
  const available = Object.keys(readCatalog().contacts).map((agent) => registeredContact(directory, agent)).filter(Boolean);
  return available.map((contact) => {
    const positive = tokens([contact.agent, contact.description, ...contact.use_when, ...contact.capabilities].join(" "));
    const negative = tokens(contact.avoid_when.join(" "));
    let score = 0;
    for (const term of query) {
      if (positive.has(term)) score += 1;
      if (negative.has(term)) score -= 2;
    }
    return { ...contact, score };
  }).filter((contact) => contact.score > 0).sort((left, right) => right.score - left.score || left.agent.localeCompare(right.agent)).slice(0, limit);
}

module.exports = { catalogPath, discoverAgents, match, readCatalog, register, registeredContact, remove, scan };
