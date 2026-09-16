import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceAgents = path.join(root, "agents");
const targetAgents = path.join(root, "com.github.copilot", "agents");
const targetCommands = path.join(root, "com.github.copilot", "commands");
const modelProfiles = JSON.parse(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8"));

const toolsets = {
  pulso: ["read", "search", "agent", "ask_user", "web", "todo", "pulso-control/pulso_route", "pulso-control/pulso_skill_digest", "pulso-control/pulso_identity", "pulso-control/pulso_dashboard", "pulso-control/pulso_doctor", "pulso-control/pulso_experience_start", "pulso-control/pulso_experience_repair", "pulso-control/pulso_memory_recall", "pulso-control/pulso_experience_finalize", "pulso-control/pulso_experience_curate", "pulso-control/pulso_experience_resume", "pulso-control/pulso_memory_list", "pulso-control/pulso_memory_review", "pulso-control/pulso_profile_recall", "pulso-control/pulso_metrics", "pulso-control/pulso_lease_diagnostic", "pulso-control/pulso_primary_metadata", "pulso-control/pulso_primary_write", "pulso-control/pulso_primary_artifacts", "pulso-control/pulso_primary_git"],
  "pulso-planner": ["read", "search", "edit"],
  "pulso-challenger": ["read", "search"],
  "pulso-executor": ["read", "search", "edit", "execute", "web", "pulso-control/pulso_lease"],
  "pulso-explorer": ["read", "search", "web"],
  "pulso-verifier": ["read", "search", "execute", "web"],
  "pulso-integration-auditor": ["read", "search", "execute", "web"],
  "pulso-security-auditor": ["read", "search", "execute", "web"],
  "pulso-ui-auditor": ["read", "search", "execute", "web", "playwright/*"],
  "pulso-experience-curator": [],
  "pulso-delivery-reporter": [],
};

function parseAgent(file) {
  const text = fs.readFileSync(file, "utf8");
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Invalid agent frontmatter: ${file}`);
  const description = match[1].match(/^description:\s*(.+)$/m)?.[1]?.replace(/^"|"$/g, "");
  if (!description) throw new Error(`Missing agent description: ${file}`);
  return { description, body: match[2].trim() };
}

function generateAgents(target, profileName) {
  const profile = modelProfiles.profiles[profileName];
  if (!profile) throw new Error(`Unknown model profile ${profileName}.`);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(sourceAgents).filter((name) => name.endsWith(".md"))) {
    const name = entry.slice(0, -3);
    const tools = toolsets[name];
    const tier = modelProfiles.agent_tiers[name];
    if (!tools || !tier || !profile.models[tier]) throw new Error(`Incomplete Copilot mapping for ${name}.`);
    const { description, body } = parseAgent(path.join(sourceAgents, entry));
    const runtimeBody = name === "pulso"
      ? body.replace("omit `objective_id`", "pass the `objective_id` returned by `pulso_experience_start`")
        .replace(/native `question` tool/g, "native `ask_user` tool")
        .replace(/^- If you need a specialist not covered by your built-in agents, query `pulso_agent_contacts`.*\n/m, "")
        .replace(/^- Do not overuse `task`:.*`pulso_agent_contacts`.*\n/m, "")
        .replace(/Run repository and Git commands directly through `bash`\./g, "Use `pulso_primary_git` for repository and Git metadata.")
        .replace(/Reading `git status`, `git log`, `git show`, and `git rev-parse` for orchestration metadata is allowed directly and is not delegated discovery\./g, "Use `pulso_primary_git` for `git status`, `git log`, `git show`, and `git rev-parse` orchestration metadata.")
        .replace(/For `untracked`, add `\.pulso\/` only to the repository's local Git exclude resolved by `git rev-parse --git-path info\/exclude`; for `tracked`, remove only that Pulso-managed local exclude entry/g, "Use `pulso_primary_artifacts` to add or remove only Pulso's local `.pulso/` exclude entry")
        .replace(/persist it with `pulso_artifacts`/g, "persist `PULSO.md` with `pulso_primary_write` and apply the choice with `pulso_primary_artifacts`")
        .replace(/If a task was blocked solely by unavailable or invalid lease infrastructure, first verify `pulso_lease\(action="status"\)` and a disposable acquire\/release probe\./g, "If a task was blocked solely by unavailable or invalid lease infrastructure, use `pulso_lease_diagnostic(action=\"status\")` and `pulso_lease_diagnostic(action=\"probe\")`.")
      : body;
    const preamble = name === "pulso"
      ? `GitHub Copilot CLI uses the ${profile.label} Pulso profile. Delegate through Copilot custom agents. Let \`pulso-control\` resolve runtime context; it uses its startup workspace when roots are unavailable, and requires \`project_directory\` only for multiple roots. Use \`pulso_primary_write\` only for \`.pulso/**\` and \`PULSO.md\`, \`pulso_primary_artifacts\` for artifact preference, and \`pulso_primary_git\` for read-only Git metadata. Before a CAS write, read then call \`pulso_primary_metadata\` for its digest or revision. Do not use bash or edit: these tools are unavailable to the primary. Use \`pulso_lease_diagnostic\` for primary lease status or a disposable recovery probe; only Executor uses \`pulso_lease\` with its startup-supplied \`owner_session\`. Retain the ID from \`pulso_experience_start\` and pass it as \`objective_id\` when finalizing. In interactive mode, respond directly and never call \`task_complete\`; that tool is only for autopilot.`
      : name === "pulso-executor"
        ? "In GitHub Copilot CLI, use the `pulso-control` lease tool and pass the session ID supplied at startup as `owner_session`."
        : "";
    const mcpServer = ["pulso", "pulso-executor"].includes(name) ? [
      "mcp-servers:",
      "  pulso-control:",
      "    type: stdio",
      "    command: node",
      "    args: [\"__PULSO_MCP_SERVER__\"]",
      "    tools: [\"*\"]",
    ] : [];
    const output = [
      "---",
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      `user-invocable: ${name === "pulso" ? "true" : "false"}`,
      `model: ${profile.models[tier]}`,
      `tools: ${JSON.stringify(tools)}`,
      ...mcpServer,
      "---",
      "",
      ...(preamble ? [preamble, ""] : []),
      runtimeBody,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(target, `${name}.agent.md`), output);
  }
}

fs.rmSync(targetAgents, { recursive: true, force: true });
for (const profileName of Object.keys(modelProfiles.profiles)) generateAgents(path.join(root, "copilot", "profiles", profileName, "agents"), profileName);

fs.mkdirSync(targetCommands, { recursive: true });
for (const name of ["pulso-dashboard", "pulso-doctor"]) {
  const source = fs.readFileSync(path.join(root, "commands", `${name}.md`), "utf8");
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  fs.writeFileSync(path.join(targetCommands, `${name}.md`), `${body}\n`);
}

fs.mkdirSync(path.join(root, "copilot", "dist"), { recursive: true });
const mcpBundle = path.join(root, "copilot", "dist", "pulso-mcp-server.mjs");
await build({
  entryPoints: [path.join(root, "copilot", "pulso-mcp-server.mjs")],
  outfile: mcpBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
fs.writeFileSync(mcpBundle, fs.readFileSync(mcpBundle, "utf8").replace(/[ \t]+$/gm, ""));

console.log("build: Copilot plugin artifacts updated");
