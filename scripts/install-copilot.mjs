import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operation = process.argv[2];
const binary = process.env.COPILOT_BINARY || "copilot";
const force = process.argv.includes("--force");
const profileIndex = process.argv.indexOf("--profile");
const profiles = JSON.parse(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8")).profiles;
const copilotHome = path.resolve(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"));
const agentsDirectory = path.join(copilotHome, "agents");
const profileFile = path.join(copilotHome, "pulso-profile.json");
const mcpServer = path.join(root, "copilot", "dist", "pulso-mcp-server.mjs");
let persistedProfile = null;
try { persistedProfile = JSON.parse(fs.readFileSync(profileFile, "utf8")); } catch {}
const profileName = profileIndex >= 0
  ? process.argv[profileIndex + 1]
  : (persistedProfile?.schema_version === 1 && Object.hasOwn(profiles, persistedProfile.profile) ? persistedProfile.profile : "openai");
if (!["install", "uninstall"].includes(operation)) throw new Error("Usage: node scripts/install-copilot.mjs <install|uninstall>");
if (operation === "install" && !profiles[profileName]) throw new Error(`Unknown model profile: ${profileName}.`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function renderedAgent(directory, name) {
  return fs.readFileSync(path.join(directory, name), "utf8")
    .replace(JSON.stringify("__PULSO_MCP_SERVER__"), JSON.stringify(mcpServer));
}

function renderedDigest(directory, name) {
  return crypto.createHash("sha256").update(renderedAgent(directory, name)).digest("hex");
}

const profileDirectories = Object.keys(profiles).map((name) => path.join(root, "copilot", "profiles", name, "agents"));
const agentNames = fs.readdirSync(profileDirectories[0]).filter((name) => name.endsWith(".agent.md"));

function syncAgents() {
  const sourceDirectory = path.join(root, "copilot", "profiles", profileName, "agents");
  fs.mkdirSync(agentsDirectory, { recursive: true, mode: 0o700 });
  for (const name of agentNames) {
    const target = path.join(agentsDirectory, name);
    const content = renderedAgent(sourceDirectory, name);
    const desired = crypto.createHash("sha256").update(content).digest("hex");
    if (fs.existsSync(target) && digest(target) === desired) continue;
    fs.writeFileSync(`${target}.${process.pid}.tmp`, content, { mode: 0o600 });
    fs.renameSync(`${target}.${process.pid}.tmp`, target);
  }
  let storedProfile = null;
  try { storedProfile = JSON.parse(fs.readFileSync(profileFile, "utf8")); } catch {}
  const preserveProfile = storedProfile?.schema_version === 1 && Object.hasOwn(profiles, storedProfile.profile) && storedProfile.managed_by !== "pulso" && storedProfile.profile === profileName && !force;
  if (!preserveProfile) {
    const files = Object.fromEntries(agentNames.map((name) => [name, renderedDigest(sourceDirectory, name)]));
    fs.writeFileSync(profileFile, `${JSON.stringify({ schema_version: 1, managed_by: "pulso", profile: profileName, files }, null, 2)}\n`, { mode: 0o600 });
  }
}

function preflightAgents() {
  const sourceDirectory = path.join(root, "copilot", "profiles", profileName, "agents");
  const conflicts = [];
  let storedProfile = null;
  try { storedProfile = JSON.parse(fs.readFileSync(profileFile, "utf8")); } catch {}
  for (const name of agentNames) {
    const target = path.join(agentsDirectory, name);
    if (!fs.existsSync(target) || digest(target) === renderedDigest(sourceDirectory, name)) continue;
    const managed = profileDirectories.some((directory) => digest(target) === renderedDigest(directory, name)) || storedProfile?.files?.[name] === digest(target);
    if (!managed && !force) conflicts.push(name);
  }
  const validProfile = storedProfile?.schema_version === 1 && Object.hasOwn(profiles, storedProfile.profile);
  const managedProfile = validProfile && storedProfile.managed_by === "pulso";
  const preserveProfile = validProfile && !managedProfile && storedProfile.profile === profileName && !force;
  if (fs.existsSync(profileFile) && !managedProfile && !preserveProfile && !force) conflicts.push(path.basename(profileFile));
  if (conflicts.length) throw new Error(`Refusing to overwrite customized Copilot configuration without --force:\n${conflicts.join("\n")}`);
}

function removeAgents() {
  let storedProfile = null;
  try { storedProfile = JSON.parse(fs.readFileSync(profileFile, "utf8")); } catch {}
  for (const name of agentNames) {
    const target = path.join(agentsDirectory, name);
    if (!fs.existsSync(target)) continue;
    const managed = profileDirectories.some((directory) => digest(target) === renderedDigest(directory, name)) || storedProfile?.files?.[name] === digest(target);
    if (managed) fs.rmSync(target, { force: true });
  }
  if (storedProfile?.schema_version === 1 && storedProfile.managed_by === "pulso" && Object.hasOwn(profiles, storedProfile.profile)) fs.rmSync(profileFile, { force: true });
}

const version = run(binary, ["--version"]);
if (version.status !== 0) throw new Error("GitHub Copilot CLI is required for the Copilot target.");

if (operation === "install") {
  if (!path.isAbsolute(root)) throw new Error("Pulso plugin root must be absolute.");
  preflightAgents();
  const marketplaces = run(binary, ["plugin", "marketplace", "list"]);
  if (marketplaces.status !== 0) process.exit(marketplaces.status || 1);
  if (!/^\s*\S?\s*pulso\b/im.test(marketplaces.stdout || "")) {
    const added = run(binary, ["plugin", "marketplace", "add", root]);
    if (added.status !== 0) process.exit(added.status || 1);
  }
  const result = run(binary, ["plugin", "install", "pulso@pulso"]);
  if (result.status !== 0) process.exit(result.status || 1);
  syncAgents();
  process.stdout.write(`install: Pulso configured for GitHub Copilot CLI with the ${profiles[profileName].label} profile. Start with \`copilot --agent pulso\`.\n`);
} else {
  removeAgents();
  const result = run(binary, ["plugin", "uninstall", "pulso"]);
  if (result.status !== 0 && !/not installed|not found/i.test(`${result.stdout}\n${result.stderr}`)) process.exit(result.status || 1);
  const marketplace = run(binary, ["plugin", "marketplace", "remove", "pulso"]);
  if (marketplace.status !== 0 && !/not found|not registered/i.test(`${marketplace.stdout}\n${marketplace.stderr}`)) process.exit(marketplace.status || 1);
  process.stdout.write("uninstall: Pulso removed from GitHub Copilot CLI.\n");
}
