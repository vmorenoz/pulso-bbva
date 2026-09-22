"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const agentsDirectory = path.resolve(__dirname, "..", "agents");

function agent(name) {
  return fs.readFileSync(path.join(agentsDirectory, `${name}.md`), "utf8");
}

test("keeps Pulso and Executor as the autonomous base route", () => {
  const pulso = agent("pulso");
  const executor = agent("pulso-executor");
  assert.match(pulso, /normal path is Pulso directly to Executor/);
  assert.match(pulso, /no specialist is a prerequisite for clear work/);
  assert.match(executor, /Do not require Explorer or another specialist/);
  assert.match(executor, /edit: allow/);
  assert.match(executor, /bash:\n\s+"\*": allow/);
  assert.match(pulso, /Never create, inspect, or patch task files manually/);
  assert.match(pulso, /The plugin records metrics and starts eligible asynchronous curation/);
});

test("preserves Pulso identity and creator attribution", () => {
  const pulso = agent("pulso");
  const identity = require("../lib/pulso-identity.js").resolveIdentity();
  const crypto = require("node:crypto");
  assert.match(pulso, /canonical identity is provided by `pulso_identity`/);
  assert.equal(crypto.createHash("sha256").update(identity.creator.name).digest("hex"), "6cb05fa0ec1100fbbcec953f7d66d8463af3219f1371306d3c8748fee39203d6");
  assert.equal(identity.creator.employee_id, "P041413");
  assert.equal(identity.creator.github, "@vmorenoz");
  assert.equal(identity.creator.linkedin, "@vicodev");
  assert.equal(identity.creator.contacts.length, 2);
  assert.match(pulso, /return every field supplied by `pulso_identity`/);
  assert.match(pulso, /Never describe Pulso as created with/);
  assert.equal(crypto.createHash("sha256").update(identity.organization).digest("hex"), "244902c4926f77b1f68b77ba7a405fa043da1f981d17ca8aedcd47632ddab148");
});

test("keeps validation and integration in the existing task lifecycle", () => {
  assert.match(agent("pulso-planner"), /Never propose a task solely for validation, audit, repair, commit, push, or integration/);
  assert.match(agent("pulso-executor"), /Report commit evidence in the result; the plugin records integration state/);
});

test("limits open task delegation to Pulso agents and approved contacts", () => {
  const pulso = agent("pulso");
  assert.match(pulso, /task:\n\s+"\*": allow/);
  assert.match(pulso, /Do not overuse `task`/);
  assert.match(pulso, /built-in `pulso-\*` agents or user-approved contacts/);
  assert.match(pulso, /PULSO_CONTACT_ID/);
  assert.doesNotMatch(pulso, /Agent Contact Integration|PULSO_CONTACT_PROBE/);
  const manager = agent("pulso-contact-manager");
  assert.match(manager, /PULSO_CONTACT_PROBE/);
  assert.match(manager, /herramienta nativa de preguntas/);
  assert.match(manager, /Nunca registres silenciosamente/);
  assert.match(manager, /pulso_agent_contacts: allow/);
  assert.match(manager, /task:\n\s+"\*": allow/);
  assert.match(manager, /edit: deny/);
  assert.match(manager, /bash: deny/);
  const command = fs.readFileSync(path.resolve(agentsDirectory, "..", "commands", "pulso-autointegrate.md"), "utf8");
  assert.match(command, /agent: pulso-contact-manager/);
  assert.match(command, /subtask: true/);
  const commandBody = command.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
  assert.equal(commandBody, "Inicia la gestión interactiva de contactos de agentes de Pulso.");
});

test("isolates interactive model configuration from the primary prompt", () => {
  const pulso = agent("pulso");
  const manager = agent("pulso-config-manager");
  assert.match(pulso, /delega esa configuración a `pulso-config-manager`/);
  assert.doesNotMatch(pulso, /Rápida|Personalizada|Rendimiento|reasoning_model/);
  assert.match(manager, /pulso_models: allow/);
  assert.match(manager, /Rápida o Personalizada/);
  assert.match(manager, /Recomendada/);
  assert.match(manager, /Rendimiento/);
  assert.match(manager, /Heredada/);
  assert.match(manager, /global o solo para el proyecto actual/);
  assert.match(manager, /recomienda `github-copilot` solo si existe/);
  const command = fs.readFileSync(path.resolve(agentsDirectory, "..", "commands", "pulso-configure.md"), "utf8");
  assert.match(command, /agent: pulso-config-manager/);
  assert.match(command, /subtask: true/);
});

test("defines mutation paths inside the nested task scope", () => {
  const pulso = agent("pulso");
  const protocol = fs.readFileSync(path.resolve(agentsDirectory, "..", "skills", "pulso-protocol", "SKILL.md"), "utf8");
  assert.match(pulso, /nested `scope` object containing `allowed_paths` and `excluded_paths`/);
  assert.match(protocol, /Required task contracts retain .* nested scope/);
  assert.match(protocol, /Agents never read or write these files during routine delivery/);
});

test("uses Explorer only for iterative discovery and keeps it read-only", () => {
  const explorer = agent("pulso-explorer");
  assert.match(explorer, /iterative discovery, a cross-file trace, or parallel research/);
  assert.match(explorer, /Use an available MCP tool only when it is necessary/);
  assert.match(explorer, /never call one as a no-op, progress marker, or unnecessary substitute/);
  assert.match(explorer, /bash: deny/);
  assert.match(explorer, /edit: deny/);
  assert.match(explorer, /pulso_lease: deny/);
});

test("keeps lease ownership internal to the control plugin", () => {
  assert.match(agent("pulso"), /pulso_lease: allow/);
  assert.match(agent("pulso-executor"), /pulso_lease: deny/);
  assert.match(agent("pulso-executor"), /plugin performs those operations around the session and every tool call/);
  for (const name of [
    "pulso-planner",
    "pulso-challenger",
    "pulso-explorer",
    "pulso-verifier",
    "pulso-integration-auditor",
    "pulso-security-auditor",
    "pulso-ui-auditor",
    "pulso-experience-curator",
    "pulso-delivery-reporter",
  ]) {
    assert.match(agent(name), /pulso_lease: deny/, name);
  }
});

test("reserves human-confirmed memory mutation for Pulso", () => {
  assert.match(agent("pulso"), /pulso_memory_review: ask/);
  assert.match(agent("pulso"), /pulso_dashboard: allow/);
  assert.match(agent("pulso"), /pulso_delivery: allow/);
  assert.match(agent("pulso"), /pulso_status: allow/);
  assert.match(agent("pulso"), /pulso_experience_resume: deny/);
  assert.match(agent("pulso"), /pulso_experience_curate: deny/);
  assert.match(agent("pulso"), /pulso_experience_start: deny/);
  assert.match(agent("pulso"), /pulso_experience_repair: allow/);
  for (const name of fs.readdirSync(agentsDirectory).filter((name) => name.endsWith(".md") && name !== "pulso.md")) {
    const contents = fs.readFileSync(path.join(agentsDirectory, name), "utf8");
    assert.match(contents, /pulso_memory_review: deny/, name);
    assert.match(contents, /pulso_dashboard: deny/, name);
    assert.match(contents, name === "pulso-contact-manager.md" ? /pulso_agent_contacts: allow/ : /pulso_agent_contacts: deny/, name);
    assert.match(contents, /pulso_identity: deny/, name);
    assert.match(contents, /pulso_delivery: deny/, name);
    assert.match(contents, /pulso_status: deny/, name);
    assert.match(contents, /pulso_experience_resume: deny/, name);
    assert.match(contents, /pulso_experience_curate: deny/, name);
    assert.match(contents, /pulso_experience_start: deny/, name);
    assert.match(contents, /pulso_experience_repair: deny/, name);
  }
});

test("does not give general shell access to discovery and planning-only agents", () => {
  for (const name of ["pulso-explorer", "pulso-planner", "pulso-challenger", "pulso-experience-curator", "pulso-delivery-reporter"]) {
    assert.match(agent(name), /bash: deny/, name);
  }
});

test("uses a constrained lightweight agent for dashboard closure copy", () => {
  const reporter = agent("pulso-delivery-reporter");
  assert.match(reporter, /model: github-copilot\/gpt-5\.6-luna/);
  assert.match(reporter, /edit: deny/);
  assert.match(reporter, /bash: deny/);
  assert.match(reporter, /Hasta tres comprobaciones pendientes/);
  assert.match(reporter, /Hasta cinco evidencias decisivas/);
});

test("keeps frontmatter structurally delimited and descriptions YAML-safe", () => {
  for (const name of fs.readdirSync(agentsDirectory).filter((name) => name.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(agentsDirectory, name), "utf8");
    assert.match(text, /^---\n[\s\S]+?\n---\n/, name);
    const description = text.match(/^description: (.+)$/m)?.[1] || "";
    assert.equal(description.includes(": ") && !description.startsWith('"'), false, name);
  }
});

test("ships direct dashboard and doctor commands for Pulso", () => {
  for (const name of ["pulso-dashboard", "pulso-doctor"]) {
    const command = fs.readFileSync(path.resolve(agentsDirectory, "..", "commands", `${name}.md`), "utf8");
    assert.match(command, /agent: pulso/);
    assert.match(command, /No delegues esta operación/);
  }
});

test("loads one-time project configuration without treating preferences as a dashboard request", () => {
  const pulso = agent("pulso");
  assert.match(pulso, /Read root `PULSO\.md` before starting delivery work/);
  assert.match(pulso, /native `question` tool/);
  assert.match(pulso, /Solo locales \(Recomendado\)/);
  assert.match(pulso, /Versionados en Git/);
  assert.match(pulso, /persist it with `pulso_artifacts`/);
  assert.match(pulso, /Skill constraints, relevant memories, and approved preferences are projected internally/);
  assert.match(pulso, /Mentions of metrics, memories, preferences, configuration, or `PULSO\.md` are not dashboard requests/);
  assert.match(pulso, /Treat `\.pulso\/` as plugin-owned internal state/);
  assert.match(pulso, /edit:\n\s+"\*": deny/);
  assert.match(pulso, /question: allow/);
  assert.match(pulso, /pulso_artifacts: allow/);
});

test("keeps protocol loading and worker contracts out of routine user-visible coordination", () => {
  const pulso = agent("pulso");
  const executor = agent("pulso-executor");
  assert.match(pulso, /Do not load `pulso-protocol` for questions, status requests/);
  assert.match(pulso, /Never put scope, criteria, validation plans, skills, project rules, routing, leases, or task JSON in a `task` prompt/);
  assert.match(executor, /internal task contract appended by the control plugin/);
});

test("reconciles a user-confirmed historical delivery without requesting internal identifiers", () => {
  const pulso = agent("pulso");
  assert.match(pulso, /pulso_delivery\(action="reconcile", confirmed=true, status="verified"\)/);
  assert.match(pulso, /status="verified"\)`? before any other close or resume attempt/);
  assert.match(pulso, /Never request task or objective IDs from the user/);
});

test("permits controlled primary lease repair without exposing task identifiers", () => {
  const pulso = agent("pulso");
  assert.match(pulso, /pulso_lease\(action="recover"\)/);
  assert.match(pulso, /pulso_lease\(action="release", force=true\)/);
  assert.match(pulso, /never expose or ask the user for task IDs/);
});

test("allows Pulso to use MCP tools only for necessary evidence", () => {
  const pulso = agent("pulso");
  assert.doesNotMatch(pulso, /"playwright_\*": deny/);
  assert.match(pulso, /Use an available MCP tool only when it is necessary/);
  assert.match(pulso, /never call one as a no-op, progress marker, or unnecessary substitute/);
});

test("uses native interactive tools for every user question", () => {
  const pulso = agent("pulso");
  assert.match(pulso, /Whenever asking the user a question, use the runtime's interactive question tool instead of plain prose/);
  assert.match(pulso, /`question` in OpenCode/);
});

test("uses semantic prompt blocks without changing OpenCode authority", () => {
  const required = {
    "pulso": ["identity", "role", "workflow", "routing", "safety", "communication"],
    "pulso-executor": ["identity", "role", "contracts", "workflow", "safety", "result-format"],
    "pulso-planner": ["identity", "role", "contracts", "workflow", "safety", "result-format"],
    "pulso-explorer": ["identity", "role", "contracts", "workflow", "safety", "result-format"],
    "pulso-verifier": ["identity", "role", "contracts", "workflow", "safety", "result-format"],
  };
  for (const [name, tags] of Object.entries(required)) for (const tag of tags) assert.match(agent(name), new RegExp(`<${tag}>`), `${name}:${tag}`);
  assert.match(agent("pulso-executor"), /edit: allow/);
  assert.match(agent("pulso-executor"), /Do not edit `\.pulso\/\*\*`/);
  assert.match(agent("pulso"), /edit:\n\s+"\*": deny/);
});

test("requires all human-facing Pulso communication to be in Spanish", () => {
  const pulso = agent("pulso");
  const protocol = fs.readFileSync(path.resolve(agentsDirectory, "..", "skills", "pulso-protocol", "SKILL.md"), "utf8");
  assert.match(pulso, /siempre con el usuario en español/);
  assert.match(protocol, /user-visible prose[\s\S]*must be in Spanish/);
  for (const name of fs.readdirSync(agentsDirectory).filter((entry) => entry.endsWith(".md"))) {
    const contents = fs.readFileSync(path.join(agentsDirectory, name), "utf8");
    assert.match(contents, /(?:debe estar|siempre con).*en español/, name);
    const description = contents.match(/^description: (.+)$/m)?.[1] || "";
    assert.match(description, /[áéíóúñ]/i, name);
  }
  for (const name of ["pulso-autointegrate", "pulso-dashboard", "pulso-doctor"]) {
    const command = fs.readFileSync(path.resolve(agentsDirectory, "..", "commands", `${name}.md`), "utf8");
    assert.match(command, /[áéíóúñ]/i, name);
  }
});

test("requires the primary agent to speak about itself in first person", () => {
  assert.match(agent("pulso"), /Habla de tus acciones, estado, límites y hallazgos en primera persona/);
  assert.match(agent("pulso"), /No te refieras a Pulso como una entidad externa o en tercera persona/);
});
