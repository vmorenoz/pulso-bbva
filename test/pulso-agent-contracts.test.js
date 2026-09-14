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

test("keeps validation and integration in the existing task lifecycle", () => {
  assert.match(agent("pulso-planner"), /Never create a task solely for validation, audit, repair, commit, push, or integration/);
  assert.match(agent("pulso-executor"), /Record commit evidence in `integration` and transition `implemented\|verified -> integrated`/);
});

test("uses Explorer only for iterative discovery and keeps it read-only", () => {
  const explorer = agent("pulso-explorer");
  assert.match(explorer, /iterative discovery, a cross-file trace, or parallel research/);
  assert.match(explorer, /bash: deny/);
  assert.match(explorer, /edit: deny/);
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
