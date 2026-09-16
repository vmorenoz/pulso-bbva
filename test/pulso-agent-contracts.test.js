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
  assert.match(pulso, /Never create an integration-only or validation-only follow-up task/);
  assert.match(pulso, /Record commit and push in that task's `integration` section/);
});

test("preserves Pulso identity and creator attribution", () => {
  const pulso = agent("pulso");
  const identity = require("../lib/pulso-identity.js").resolveIdentity();
  const crypto = require("node:crypto");
  assert.match(pulso, /canonical identity is provided by `pulso_identity`/);
  assert.equal(crypto.createHash("sha256").update(identity.creator).digest("hex"), "6b5a905fd6c4b2ac81897a012636a0c52e7bd7a44254f5ecbffe9484ac016d24");
  assert.equal(crypto.createHash("sha256").update(identity.organization).digest("hex"), "244902c4926f77b1f68b77ba7a405fa043da1f981d17ca8aedcd47632ddab148");
});

test("keeps validation and integration in the existing task lifecycle", () => {
  assert.match(agent("pulso-planner"), /Never create a task solely for validation, audit, repair, commit, push, or integration/);
  assert.match(agent("pulso-executor"), /Record commit evidence in `integration` and transition `implemented\|verified -> integrated`/);
});

test("limits open task delegation to Pulso agents and approved contacts", () => {
  const pulso = agent("pulso");
  assert.match(pulso, /task:\n\s+"\*": allow/);
  assert.match(pulso, /Do not overuse `task`/);
  assert.match(pulso, /built-in `pulso-\*` agents or user-approved contacts/);
  assert.match(pulso, /PULSO_CONTACT_ID/);
  const command = fs.readFileSync(path.resolve(agentsDirectory, "..", "commands", "pulso-autointegrate.md"), "utf8");
  assert.match(command, /agent: pulso/);
  assert.match(command, /PULSO_CONTACT_PROBE/);
  assert.match(command, /native question tool/);
});

test("defines mutation paths inside the nested task scope", () => {
  const pulso = agent("pulso");
  const protocol = fs.readFileSync(path.resolve(agentsDirectory, "..", "skills", "pulso-protocol", "SKILL.md"), "utf8");
  assert.match(pulso, /nested `scope` object containing `allowed_paths` and `excluded_paths`/);
  assert.match(protocol, /`scope: \{ allowed_paths: \[\.\.\.\], excluded_paths: \[\.\.\.\] \}`/);
  assert.match(protocol, /never write them at the task root/);
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

test("reserves task lease ownership for Executor", () => {
  assert.match(agent("pulso-executor"), /pulso_lease: allow/);
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
  assert.match(agent("pulso"), /pulso_experience_resume: allow/);
  assert.match(agent("pulso"), /pulso_experience_curate: allow/);
  assert.match(agent("pulso"), /pulso_experience_start: allow/);
  assert.match(agent("pulso"), /pulso_experience_repair: allow/);
  for (const name of fs.readdirSync(agentsDirectory).filter((name) => name.endsWith(".md") && name !== "pulso.md")) {
    const contents = fs.readFileSync(path.join(agentsDirectory, name), "utf8");
    assert.match(contents, /pulso_memory_review: deny/, name);
    assert.match(contents, /pulso_dashboard: deny/, name);
    assert.match(contents, /pulso_agent_contacts: deny/, name);
    assert.match(contents, /pulso_identity: deny/, name);
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
    assert.match(command, /Do not delegate this operation/);
  }
});

test("loads one-time project configuration without treating preferences as a dashboard request", () => {
  const pulso = agent("pulso");
  assert.match(pulso, /Read root `PULSO\.md` before starting delivery work/);
  assert.match(pulso, /ask exactly once whether `\.pulso\/\*\*` should be `tracked` or `untracked`/);
  assert.match(pulso, /include the compact digest plus the applicable `PULSO\.md` project rules/);
  assert.match(pulso, /Mentions of metrics, memories, preferences, configuration, or `PULSO\.md` are not dashboard requests/);
  assert.match(pulso, /"PULSO\.md": allow/);
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
  assert.match(pulso, /`question` in OpenCode or `ask_user` in GitHub Copilot CLI/);
});
