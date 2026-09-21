import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceAgents = path.join(root, "agents");
const targetAgents = path.join(root, "com.github.copilot", "agents");
const targetCommands = path.join(root, "com.github.copilot", "commands");
const modelProfiles = JSON.parse(fs.readFileSync(path.join(root, "model-profiles.json"), "utf8"));
const openCodeOnlyAgents = new Set(["pulso-contact-manager", "pulso-config-manager"]);

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

function adaptOpenCodeControlPlane(name, body) {
  if (name === "pulso") {
    const adapted = body
      .replace("- Treat `.pulso/` as plugin-owned internal state. Never read, edit, patch, narrate, or expose its contents during routine delivery.", "- Maintain `.pulso/` only for shared state, coordination, and durable resumption. Do not expose its contents in user communication.")
      .replace(/   A user message alone is never a delivery\.[^\n]+\n/, "   A user message alone is never a delivery. Before substantive work, inspect shared state and call `pulso_experience_start` exactly once with `new` or `resume`.\n")
       .replace("3. Use the route returned by `pulso_delivery` and the smallest effective route unless explicit user instructions or repository evidence require an override. The normal path is Pulso directly to Executor; no specialist is a prerequisite for clear work. Re-route only when new evidence materially changes scope, confidence, or risk:", "3. Call `pulso_route` after scope is known and use the smallest effective route unless explicit user instructions or repository evidence require an override. The normal path is Pulso directly to Executor; no specialist is a prerequisite for clear work. Re-route only when new evidence materially changes scope, confidence, or risk:")
      .replace(/   Reuse the task returned by `pulso_delivery`[^\n]+\n/, "   Reuse the latest relevant task for corrections, retries, validation, audit, commit, push, and integration; create task JSON only for a separately deliverable outcome.\n")
       .replace(/8\. For every executor or verifier dispatch,[^\n]+\n/, "8. For every executor or verifier dispatch, include `PULSO_TASK_ID=PULSO-xxx`. Diagnose and recover orphaned leases with `pulso_lease_diagnostic`; never wait passively for an aborted session lease.\n")
       .replace(/   If commit or push is requested after implementation, call `pulso_delivery\(action="resume", task_id="PULSO-xxx"\)` before delegating integration\.[^\n]+\n/, "   If commit or push is requested after implementation, reopen the same task through the Copilot control flow before delegating integration so Executor can acquire its lease; do not create another task.\n")
       .replace(/- If the user explicitly confirms that a displayed historical active delivery[^\n]+\n/, "- If the user explicitly confirms that a historical active delivery was already completed, resolve its identifiers through the Copilot control flow and reconcile every orphaned active delivery without requesting internal IDs. Titles are presentation only and never select state.\n")
      .replace(/9\. Before the final response[^\n]+\n/, "9. Before the final response for substantive delivery, call `pulso_experience_finalize` with the strongest honest status and compact evidence.\n")
      .replace(/10\. Include the applicable[^\n]+\n/, "10. Resolve skills with `pulso_skill_digest` and include compact constraints and project rules in specialist contracts.\n")
       .replace(/- Executor ownership is enforced by the plugin\.[^\n]+\n/, "- Require an Executor lease for edits. Recover an orphan through `pulso_lease_diagnostic` before retrying; never override a live owner.\n");
    if (adapted.includes("pulso_delivery")) throw new Error("Copilot Pulso instructions retain an OpenCode-only delivery facade.");
    return adapted;
  }
  if (name === "pulso-executor") {
    const adapted = body
      .replace("1. Read repository instructions and the internal task contract appended by the control plugin. Never read `.pulso/**` to reconstruct it.", "1. Read repository instructions and the bounded task contract supplied by Pulso. Read `.pulso/**` only through the authorized Copilot control flow when task state must be updated.")
      .replace("2. Confirm the delegated task contract matches the requested outcome. Lease ownership and task transition are enforced automatically by the plugin before tools become available. Use the supplied skill constraints and load full skills only where the protocol requires detailed stack rules.", "2. Confirm the task is ready and acquire or recover its lease with `pulso_lease` before editing. Use the supplied skill constraints and load full skills only where required.")
      .replace("- Do not acquire, heartbeat, recover, or release leases manually; the plugin performs those operations around the session and every tool call.", "- Heartbeat the lease before long validation or integration, and release it before every final return.")
      .replace("- Do not edit `.pulso/**`. The plugin records changed files, validation commands, results, timestamps, and terminal delivery state from execution events.", "- Update only the assigned task execution section and terminal status using the safe state protocol.")
       .replace("- Report commit evidence in the result; the plugin records integration state when Pulso closes the delivery. A commit failure or stale/failed validation blocks integration, not the completed implementation.", "- Record commit evidence in integration and transition the task to integrated. A commit failure or stale validation blocks integration.");
    if (adapted.includes("internal task contract appended")) throw new Error("Copilot Executor instructions retain OpenCode-only contract injection.");
    return adapted;
  }
  if (name === "pulso-planner") {
    return body
      .replace("You are Pulso's stateless, read-only planner. The control plugin owns task artifacts.", "You are Pulso's stateless planner, except for authorized plan sections and new task files.")
      .replace("- Never create or modify task JSON. Return the compact plan to Pulso so `pulso_delivery` can project it internally.", "- Create task JSON only when Pulso explicitly delegates planning; write only new tasks and plan sections.")
      .replace("- Use `fast` mode by default: at most three task proposals and no additional prose artifact.", "- Use fast mode by default: at most three tasks and no prose artifact beyond task JSON.");
  }
  return body;
}

function generateAgents(target, profileName) {
  const profile = modelProfiles.profiles[profileName];
  if (!profile) throw new Error(`Unknown model profile ${profileName}.`);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(sourceAgents).filter((name) => name.endsWith(".md"))) {
    const name = entry.slice(0, -3);
    if (openCodeOnlyAgents.has(name)) continue;
    const tools = toolsets[name];
    const tier = modelProfiles.agent_tiers[name];
    if (!tools || !tier || !profile.models[tier]) throw new Error(`Incomplete Copilot mapping for ${name}.`);
    const { description, body } = parseAgent(path.join(sourceAgents, entry));
    const compatibleBody = adaptOpenCodeControlPlane(name, body);
    const runtimeBody = name === "pulso"
      ? compatibleBody.replace("omit `objective_id`", "pass the `objective_id` returned by `pulso_experience_start`")
        .replace(/native `question` tool/g, "native `ask_user` tool")
        .replace(/^- If you need a specialist not covered by your built-in agents, query `pulso_agent_contacts`.*\n/m, "")
        .replace(/^- Do not overuse `task`:.*`pulso_agent_contacts`.*\n/m, "")
        .replace(/^- Cuando el usuario pida configurar modelos de Pulso,.*\n/m, "")
        .replace(/Run repository and Git commands directly through `bash`\./g, "Use `pulso_primary_git` for repository and Git metadata.")
        .replace(/Reading `git status`, `git log`, `git show`, and `git rev-parse` for orchestration metadata is allowed directly and is not delegated discovery\./g, "Use `pulso_primary_git` for `git status`, `git log`, `git show`, and `git rev-parse` orchestration metadata.")
        .replace(/For `untracked`, add `\.pulso\/` only to the repository's local Git exclude resolved by `git rev-parse --git-path info\/exclude`; for `tracked`, remove only that Pulso-managed local exclude entry/g, "Use `pulso_primary_artifacts` to add or remove only Pulso's local `.pulso/` exclude entry")
        .replace(/persist it with `pulso_artifacts`/g, "persist `PULSO.md` with `pulso_primary_write` and apply the choice with `pulso_primary_artifacts`")
        .trim()
        .replace(/If a task was blocked solely by unavailable or invalid lease infrastructure, first verify `pulso_lease\(action="status"\)` and a disposable acquire\/release probe\./g, "If a task was blocked solely by unavailable or invalid lease infrastructure, use `pulso_lease_diagnostic(action=\"status\")` and `pulso_lease_diagnostic(action=\"probe\")`.")
      : compatibleBody;
    const preamble = name === "pulso"
      ? `GitHub Copilot CLI uses the ${profile.label} Pulso profile. Delegate through Copilot custom agents. Let \`pulso-control\` resolve runtime context; it uses its startup workspace when roots are unavailable, and requires \`project_directory\` only for multiple roots. Use \`pulso_primary_write\` only for \`.pulso/**\` and \`PULSO.md\`, \`pulso_primary_artifacts\` for artifact preference, and \`pulso_primary_git\` for read-only Git metadata. Before a CAS write, read then call \`pulso_primary_metadata\` for its digest or revision. Do not use bash or edit: these tools are unavailable to the primary. Call \`pulso_lease_diagnostic(action="status")\` before recovering uncertain ownership; only Executor uses \`pulso_lease\` with its startup-supplied \`owner_session\`. Retain the ID from \`pulso_experience_start\` and pass it as \`objective_id\` when finalizing. In interactive mode, respond directly and never call \`task_complete\`; that tool is only for autopilot.`
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

// jsonc-parser is bundled here (no external deps) because tools/pulso_models.ts and
// scripts/install.mjs are copied verbatim into ~/.config/opencode, which has no
// node_modules of its own to resolve a bare "jsonc-parser" import from.
const jsoncBundle = path.join(root, "lib", "pulso-jsonc.js");
await build({
  entryPoints: [path.join(root, "node_modules", "jsonc-parser", "lib", "esm", "main.js")],
  outfile: jsoncBundle,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
});
fs.writeFileSync(jsoncBundle, fs.readFileSync(jsoncBundle, "utf8").replace(/[ \t]+$/gm, ""));

console.log("build: Copilot plugin artifacts updated");
