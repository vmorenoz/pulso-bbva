import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import jsonc from "../lib/pulso-jsonc.js";
import codegraph from "../lib/pulso-vscode-codegraph.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operation = process.argv[2];
const force = process.argv.includes("--force");
const workspace = path.resolve(process.env.PULSO_WORKSPACE || process.cwd());
const home = path.resolve(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"));
const agentsRoot = path.join(home, "agents");
const skillsRoot = path.join(home, "skills");
const hooksRoot = path.join(home, "hooks");
const runtimeRoot = path.join(home, "pulso");
const manifest = path.join(runtimeRoot, "install-manifest.json");
const mcpFile = path.join(home, "mcp-config.json");
const legacyPluginRoot = path.resolve(process.env.VSCODE_EXTENSIONS_DIR || path.join(os.homedir(), ".vscode", "extensions"), "pulso-vscode-agent-plugin");
const settingsFile = path.resolve(process.env.VSCODE_USER_SETTINGS || path.join(os.homedir(), "Library", "Application Support", "Code", "User", "settings.json"));
const unsupportedHostAgents = new Set(["pulso-config-manager"]);
const agentNames = fs.readdirSync(path.join(root, "agents")).filter((file) => file.endsWith(".md")).map((file) => path.basename(file, ".md")).filter((name) => !unsupportedHostAgents.has(name));
const primaryAgents = new Set(["pulso"]);
const skillCommands = ["pulso-doctor", "pulso-autointegrate", "bbva-engineering", "bbva-cells", "bbva-cells-testing", "bbva-apx", "bbva-apx-testing"];
const retiredHostSkills = ["pulso-dashboard", "pulso-configure"];
const codegraphAgents = new Set(["pulso-executor", "pulso-planner", "pulso-explorer", "pulso-verifier", "pulso-challenger", "pulso-integration-auditor", "pulso-security-auditor"]);
const codegraphTools = ["codegraph_explore", "codegraph_search", "codegraph_node", "codegraph_callers", "codegraph_callees", "codegraph_impact", "codegraph_files", "codegraph_status"].map((tool) => `pulso-codegraph/${tool}`);

if (!['install', 'uninstall'].includes(operation)) throw new Error("Usage: node scripts/install-vscode.mjs <install|uninstall> [--force]");

function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function frontmatter(text) { return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ""); }
function description(text) { return text.match(/^description:\s*(.+)$/m)?.[1]?.trim() || "Especialista de Pulso."; }
function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.writeFileSync(file, content, { mode: 0o600 }); }
function hostAgent(name) {
  const source = fs.readFileSync(path.join(root, "agents", `${name}.md`), "utf8");
  const tools = name === "pulso" ? ["agent", "pulso-control/*", "read", "search", "terminal", "ask_user"]
    : name === "pulso-contact-manager" ? ["agent", "pulso-control/*", "read", "search", "ask_user"]
    : name === "pulso-executor" ? ["read", "search", "edit", "terminal", "pulso-control/*"]
      : ["read", "search", "terminal", "pulso-control/*"];
  if (codegraphAgents.has(name)) tools.push(...codegraphTools);
  const lines = ["---", `name: ${name}`, `description: ${description(source)}`, `user-invocable: ${primaryAgents.has(name)}`, `tools: ${JSON.stringify(tools)}`];
  if (name === "pulso") lines.push(`agents: ${JSON.stringify(agentNames.filter((agent) => agent !== "pulso"))}`);
  // Agent Host calls the native `agent` tool; OpenCode's contract calls it `task`.
  const body = frontmatter(source).replace(/`task`/g, "`agent`").replace(/`question`/g, "`ask_user`").replace(/`bash`/g, "`terminal`");
  const hostLimit = name === "pulso" ? "\n<runtime>En VS Code Agent Host no están disponibles `/pulso-configure`, métricas ni dashboard. No los anuncies ni intentes sustituirlos; explica que son capacidades exclusivas de OpenCode. `/pulso-autointegrate` solo descubre y registra agentes externos definidos por el usuario o el workspace; no gestiona agentes built-in del runtime. Nunca describas a Pulso como integrado mediante Copilot SDK o VS Code.</runtime>\n" : codegraphAgents.has(name) ? "\n<codegraph>Para investigación estructural multiarchivo, prefiere las consultas de solo lectura CodeGraph disponibles si son utilizables. No indexes, sincronices, edites, borres ni administres CodeGraph. Si no está disponible o falla, usa read, search, LSP o terminal nativos; no bloquees el trabajo.</codegraph>\n" : "";
  lines.push("---", "", body, hostLimit);
  return lines.join("\n");
}
function hostSkill(name) {
  if (name.startsWith("bbva-")) return fs.readFileSync(path.join(root, "skills", name, "SKILL.md"), "utf8");
  const source = fs.readFileSync(path.join(root, "commands", `${name}.md`), "utf8");
  const instruction = name === "pulso-doctor"
    ? "Invoca directamente `pulso_doctor` y devuelve el diagnóstico."
    : "Invoca `pulso-contact-manager` como subagente. Solo descubre y registra agentes externos definidos por el usuario o el workspace; no anuncia ni registra agentes built-in del runtime.";
  return `---\nname: ${name}\ndescription: ${description(source)}\ndisable-model-invocation: true\n---\n\n${frontmatter(source)}\n\n${instruction}`;
}
function updateMcp(enabled) {
  let text = fs.existsSync(mcpFile) ? fs.readFileSync(mcpFile, "utf8") : "{}\n";
  const errors = [];
  const config = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Cannot safely update invalid MCP configuration: ${mcpFile}`);
  const servers = { ...(config?.mcpServers || {}) };
  const legacyServers = { ...(config?.servers || {}) };
  delete legacyServers["pulso-control"];
  if (enabled) servers["pulso-control"] = { command: process.execPath, args: [path.join(runtimeRoot, "vscode", "pulso-mcp-server.cjs")] };
  else delete servers["pulso-control"];
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
  text = jsonc.applyEdits(text, jsonc.modify(text, ["mcpServers"], Object.keys(servers).length ? servers : undefined, { formattingOptions }));
  text = jsonc.applyEdits(text, jsonc.modify(text, ["servers"], Object.keys(legacyServers).length ? legacyServers : undefined, { formattingOptions }));
  write(mcpFile, text);
}
function removeLegacyRegistration() {
  if (fs.existsSync(legacyPluginRoot)) fs.rmSync(legacyPluginRoot, { recursive: true, force: true });
  if (!fs.existsSync(settingsFile)) return;
  const text = fs.readFileSync(settingsFile, "utf8"); const errors = []; const settings = jsonc.parse(text, errors, { allowTrailingComma: true });
  if (errors.length) return;
  const locations = { ...(settings?.["chat.pluginLocations"] || {}) }; delete locations[legacyPluginRoot];
  write(settingsFile, jsonc.applyEdits(text, jsonc.modify(text, ["chat.pluginLocations"], Object.keys(locations).length ? locations : undefined, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" } })));
}

if (operation === "install") {
  const previous = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : null;
  if (previous?.files && !force) for (const [file, digest] of Object.entries(previous.files)) if (fs.existsSync(file) && hash(file) !== digest) throw new Error(`Refusing to overwrite customized Pulso artifact: ${file}`);
  const files = [];
  for (const name of retiredHostSkills) {
    const directory = path.join(skillsRoot, name);
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
  for (const name of agentNames) { const file = path.join(agentsRoot, `${name}.agent.md`); write(file, hostAgent(name)); files.push(file); }
  for (const name of skillCommands) { const file = path.join(skillsRoot, name, "SKILL.md"); write(file, hostSkill(name)); files.push(file); }
  fs.cpSync(path.join(root, "vscode"), path.join(runtimeRoot, "vscode"), { recursive: true, dereference: false });
  for (const directory of ["lib", "plugins", "bin"]) fs.cpSync(path.join(root, directory), path.join(runtimeRoot, directory), { recursive: true, dereference: false });
  await build({ entryPoints: [path.join(root, "vscode", "pulso-mcp-server.mjs")], outfile: path.join(runtimeRoot, "vscode", "pulso-mcp-server.cjs"), bundle: true, platform: "node", format: "cjs", target: "node22" });
  files.push(path.join(runtimeRoot, "vscode", "pulso-mcp-server.cjs"));
  const hooks = JSON.parse(fs.readFileSync(path.join(root, "com.github.copilot", "hooks", "hooks.json"), "utf8"));
  for (const entries of Object.values(hooks.hooks)) for (const hook of entries) hook.command = `"${process.execPath}" "${path.join(runtimeRoot, "vscode", "pulso-hook.mjs")}" ${hook.command.match(/\s(\w+)"?$/)?.[1] || ""}`.trim();
  const hookFile = path.join(hooksRoot, "pulso.json"); write(hookFile, `${JSON.stringify(hooks, null, 2)}\n`); files.push(hookFile);
   updateMcp(true); removeLegacyRegistration();
  write(manifest, `${JSON.stringify({ schema_version: 2, managed_by: "pulso", files: Object.fromEntries(files.map((file) => [file, hash(file)])) }, null, 2)}\n`);
  process.stdout.write(`install: Pulso Agent Host customizations installed in ${home}. Restart the VS Code Agent Host.\n`);
} else {
  const previous = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) : null;
  for (const file of Object.keys(previous?.files || {})) if (fs.existsSync(file) && hash(file) === previous.files[file]) fs.rmSync(file, { force: true });
  for (const name of [...skillCommands, ...retiredHostSkills]) {
    const directory = path.join(skillsRoot, name);
    if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
  }
    updateMcp(false);
    codegraph.cleanupManagedRegistration({ configFile: path.join(workspace, ".vscode", "mcp.json") });
   if (fs.existsSync(runtimeRoot)) fs.rmSync(runtimeRoot, { recursive: true, force: true });
   removeLegacyRegistration();
  process.stdout.write("uninstall: managed Pulso Agent Host customizations removed.\n");
}
