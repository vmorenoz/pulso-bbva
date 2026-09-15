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
  pulso: ["read", "search", "edit", "execute", "agent", "web", "todo", "pulso-control/*"],
  "pulso-planner": ["read", "search", "edit", "pulso-control/*"],
  "pulso-challenger": ["read", "search"],
  "pulso-executor": ["read", "search", "edit", "execute", "web", "pulso-control/*"],
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
    const preamble = name === "pulso"
      ? `You are running in GitHub Copilot CLI with the ${profile.label} Pulso profile. Pulso tools are provided by the \`pulso-control\` MCP server and may appear with a server prefix. Use Copilot custom agents for specialist delegation. Hooks supply the current project directory and Copilot session ID; include them as \`project_directory\` and \`session_id\` in experience operations, and use the session ID as \`owner_session\` in lease operations.`
      : `You are running as a GitHub Copilot CLI custom agent with the ${profile.label} Pulso profile. Follow the delegated Pulso contract and use Copilot tool aliases. Hooks supply the current project directory and Copilot session ID; include them as \`project_directory\` and \`session_id\` in experience operations, and use the session ID as \`owner_session\` in lease operations.`;
    const output = [
      "---",
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      `model: ${profile.models[tier]}`,
      `tools: ${JSON.stringify(tools)}`,
      "---",
      "",
      preamble,
      "",
      body,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(target, `${name}.agent.md`), output);
  }
}

generateAgents(targetAgents, "openai");
for (const profileName of Object.keys(modelProfiles.profiles)) generateAgents(path.join(root, "copilot", "profiles", profileName, "agents"), profileName);

fs.mkdirSync(targetCommands, { recursive: true });
for (const name of ["pulso-dashboard", "pulso-doctor"]) {
  const source = fs.readFileSync(path.join(root, "commands", `${name}.md`), "utf8");
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  fs.writeFileSync(path.join(targetCommands, `${name}.md`), `${body}\n`);
}

fs.mkdirSync(path.join(root, "copilot", "dist"), { recursive: true });
await build({
  entryPoints: [path.join(root, "copilot", "pulso-mcp-server.mjs")],
  outfile: path.join(root, "copilot", "dist", "pulso-mcp-server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});

console.log("build: Copilot plugin artifacts updated");
