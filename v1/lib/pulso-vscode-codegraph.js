"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const jsonc = require("./pulso-jsonc.js");
const { withFileLock } = require("./pulso-file-state.js");
const { isPulsoInitialized } = require("./pulso-contract-core.js");

const SERVER = "pulso-codegraph";
const TOOLS = ["codegraph_explore", "codegraph_search", "codegraph_node", "codegraph_callers", "codegraph_callees", "codegraph_impact", "codegraph_files", "codegraph_status"];
const TOOL_PROFILE = Object.freeze({ package: "@bbva-genai/codegraph", version: "1.0.0", tools: TOOLS });

function executable(name, env = process.env) {
  for (const directory of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try { if (fs.statSync(candidate).isFile()) { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } } catch {}
  }
  return null;
}

function version(cli, env = process.env) {
  try {
    const result = childProcess.spawnSync(cli, ["--version"], { env, encoding: "utf8", timeout: 5000, windowsHide: true });
    const match = `${result.stdout || ""}\n${result.stderr || ""}`.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
    return result.status === 0 && match ? { value: match[0], compatible: match[1] === "1" } : null;
  } catch { return null; }
}

function workspaceRoot(cwd, home = os.homedir()) {
  const directory = fs.realpathSync(cwd);
  let root = directory;
  try {
    const result = childProcess.spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8", timeout: 5000, windowsHide: true });
    if (result.status === 0 && result.stdout.trim()) root = fs.realpathSync(result.stdout.trim());
  } catch {}
  let resolvedHome;
  try { resolvedHome = fs.realpathSync(home); } catch { resolvedHome = path.resolve(home); }
  const filesystemRoot = path.parse(root).root;
  if (root === filesystemRoot || root === resolvedHome || resolvedHome.startsWith(`${root}${path.sep}`)) throw new Error("Unsafe CodeGraph workspace root.");
  return root;
}

function validIndex(root) {
  const file = path.join(root, ".codegraph", "codegraph.db");
  try { return fs.statSync(file).isFile() && fs.readFileSync(file).subarray(0, 16).equals(Buffer.from("SQLite format 3\0")); } catch { return false; }
}

function inspect({ cwd = process.cwd(), home = os.homedir(), env = process.env, runtime = "unknown" } = {}) {
  try {
    const root = workspaceRoot(cwd, home); const cli = executable("codegraph", env); const indexed = validIndex(root); const pulsoInitialized = isPulsoInitialized(root);
    if (!cli) return { runtime, workspace_root: root, status: "missing", available: false, compatible: false, indexed, pulso_initialized: pulsoInitialized };
    const detected = version(cli, env);
    if (!detected) return { runtime, workspace_root: root, status: "unavailable", available: true, compatible: false, indexed, pulso_initialized: pulsoInitialized };
    if (!detected.compatible) return { runtime, workspace_root: root, status: "incompatible", available: true, compatible: false, version: detected.value, indexed, pulso_initialized: pulsoInitialized };
    if (!pulsoInitialized) return { runtime, workspace_root: root, status: "not_initialized_with_pulso", available: false, compatible: true, version: detected.value, indexed, pulso_initialized: false, fallback: "native read/search/LSP/terminal" };
    return { runtime, workspace_root: root, status: indexed ? "ready" : "unindexed", available: true, compatible: true, version: detected.value, indexed, cli, pulso_initialized: true };
  } catch (error) { return { runtime, status: "error", detail: error.message }; }
}

function managedServer(cwd) {
  return { command: "codegraph", args: ["serve", "--mcp"], cwd, env: { CODEGRAPH_MCP_TOOLS: TOOLS.join(",") } };
}
function openCodeServer(cwd) {
  // OpenCode local MCPs do not support cwd. The wrapper makes the root explicit.
  return { type: "local", command: ["node", path.join(__dirname, "..", "bin", "pulso-codegraph-mcp.js"), cwd], environment: { CODEGRAPH_MCP_TOOLS: TOOLS.join(",") } };
}
function ownershipFile(configFile) { return `${configFile}.pulso-codegraph.json`; }
function sameServer(value, cwd, runtime) { return JSON.stringify(value) === JSON.stringify(runtime === "opencode" ? openCodeServer(cwd) : managedServer(cwd)); }
function workspaceConfigFile(cwd, runtime) { return path.join(cwd, runtime === "opencode" ? ".opencode/opencode.jsonc" : ".vscode/mcp.json"); }
function resolvedPath(value) { try { return fs.realpathSync(value); } catch { return path.resolve(value); } }
function readOwnership(configFile) {
  try {
    const owner = JSON.parse(fs.readFileSync(ownershipFile(configFile), "utf8"));
    if (owner?.managed_by !== "pulso" || owner.server !== SERVER || typeof owner.cwd !== "string" || !["opencode", "vscode"].includes(owner.runtime)) return null;
    const cwd = resolvedPath(owner.cwd);
    if (resolvedPath(configFile) !== workspaceConfigFile(cwd, owner.runtime) || !sameServer(owner.configuration, cwd, owner.runtime)) return null;
    return { ...owner, cwd };
  } catch { return null; }
}
function readConfig(configFile) {
  if (!fs.existsSync(configFile)) return null;
  const text = fs.readFileSync(configFile, "utf8"); const errors = []; const config = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== "object") throw new Error(`Cannot safely update invalid MCP configuration: ${configFile}`);
  return { text, config };
}
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" }); fs.renameSync(temporary, file);
}

function updateMcpRegistration({ configFile, cwd, enabled, runtime = "vscode" }) {
  if (enabled) fs.mkdirSync(path.dirname(configFile), { recursive: true, mode: 0o700 });
  return withFileLock(configFile, () => {
    if (!enabled && !fs.existsSync(configFile) && !fs.existsSync(ownershipFile(configFile))) return { managed: false, registered: false, reload_required: false };
    const loaded = readConfig(configFile); let text = loaded?.text || "{}\n"; const config = loaded?.config || {};
    const section = runtime === "opencode" ? "mcp" : "mcpServers";
    const servers = { ...(config[section] || {}) }; const owner = ownershipFile(configFile);
    const managedCwd = resolvedPath(cwd); const recorded = readOwnership(configFile); let managed = Boolean(recorded && recorded.cwd === managedCwd && recorded.runtime === runtime && sameServer(servers[SERVER], recorded.cwd, runtime));
    if (fs.existsSync(owner) && !managed && recorded) fs.rmSync(owner, { force: true });
    if (enabled && !servers[SERVER]) {
      const configuration = runtime === "opencode" ? openCodeServer(managedCwd) : managedServer(managedCwd);
      servers[SERVER] = configuration;
      atomicWrite(owner, { managed_by: "pulso", server: SERVER, cwd: managedCwd, runtime, configuration });
      managed = true;
    }
    if (!enabled && managed) { delete servers[SERVER]; fs.rmSync(owner, { force: true }); managed = false; }
    if (!enabled && recorded && !sameServer(servers[SERVER], recorded.cwd, runtime)) fs.rmSync(owner, { force: true });
    const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
    text = jsonc.applyEdits(text, jsonc.modify(text, [section], Object.keys(servers).length ? servers : undefined, { formattingOptions }));
    fs.writeFileSync(configFile, text, { mode: 0o600 });
    return { managed, registered: Boolean(servers[SERVER]), reload_required: enabled && managed };
  });
}

function cleanupManagedRegistration({ configFile } = {}) {
  try {
    if (!configFile || !fs.existsSync(ownershipFile(configFile))) return { managed: false, registered: false, reload_required: false };
    const owner = readOwnership(configFile);
    if (!owner) return { managed: false, registered: false, reload_required: false };
    return updateMcpRegistration({ configFile, cwd: owner.cwd, runtime: owner.runtime, enabled: false });
  } catch {
    // Preserve user-edited configuration and ownership evidence when cleanup is unsafe.
    return { managed: false, registered: false, reload_required: false, status: "unavailable", cleanup_failure: "configuration_unavailable" };
  }
}

function lifecycle({ configFile, ...options } = {}) {
  const current = inspect(options);
  if (!current.compatible || !current.pulso_initialized) return { ...current, mcp: cleanupManagedRegistration({ configFile }) };
  try {
    return withFileLock(path.join(current.workspace_root, ".pulso-codegraph-init"), () => {
      let indexed = validIndex(current.workspace_root);
      if (!indexed) {
        const init = childProcess.spawnSync(current.cli, ["init", current.workspace_root, "--agents=none"], { cwd: current.workspace_root, env: options.env || process.env, encoding: "utf8", timeout: 120000, windowsHide: true });
        indexed = init.status === 0 && validIndex(current.workspace_root);
        if (!indexed) return { ...current, indexed: false, status: "init_failed", mcp: cleanupManagedRegistration({ configFile }) };
      }
      const mcp = updateMcpRegistration({ configFile, cwd: current.workspace_root, enabled: true, runtime: options.runtime });
      return { ...current, indexed: true, status: "ready", mcp };
    });
  } catch (error) { return { ...current, status: "busy_or_error", detail: error.message }; }
}

module.exports = { SERVER, TOOLS, TOOL_PROFILE, executable, version, workspaceRoot, validIndex, inspect, lifecycle, updateMcpRegistration, cleanupManagedRegistration, managedServer, openCodeServer };
