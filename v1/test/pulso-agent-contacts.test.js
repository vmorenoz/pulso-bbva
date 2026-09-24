"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const contacts = require("../lib/pulso-agent-contacts.js");

test("scans, registers, matches, invalidates, and removes agent contacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-agent-contacts-"));
  const previousConfig = process.env.OPENCODE_CONFIG_DIR;
  const previousData = process.env.XDG_DATA_HOME;
  try {
    process.env.OPENCODE_CONFIG_DIR = path.join(root, "config");
    process.env.XDG_DATA_HOME = path.join(root, "data");
    const project = path.join(root, "project");
    const globalAgents = path.join(process.env.OPENCODE_CONFIG_DIR, "agents");
    const projectAgents = path.join(project, ".opencode", "agents");
    fs.mkdirSync(globalAgents, { recursive: true });
    fs.mkdirSync(projectAgents, { recursive: true });
    fs.writeFileSync(path.join(globalAgents, "oracle-reviewer.md"), "---\ndescription: Reviews Oracle SQL and execution plans.\nmode: subagent\npermission:\n  edit: deny\n---\nReview SQL.\n");
    fs.writeFileSync(path.join(globalAgents, "pulso-executor.md"), "---\ndescription: Internal.\n---\n");
    fs.writeFileSync(path.join(projectAgents, "ui-reviewer.md"), "---\ndescription: Reviews frontend accessibility.\nmode: subagent\n---\nReview UI.\n");

    const scan = contacts.scan(project);
    assert.deepEqual(scan.map((item) => item.agent), ["oracle-reviewer", "ui-reviewer"]);
    assert.equal(scan[0].registration, "new");
    const registered = contacts.register(project, {
      agent: "oracle-reviewer",
      digest: scan[0].digest,
      description: "Oracle SQL specialist",
      use_when: ["Oracle queries", "execution plans"],
      avoid_when: ["frontend"],
      capabilities: ["SQL review"],
      mutation: "read_only",
    });
    assert.equal(registered.agent, "oracle-reviewer");
    assert.equal(contacts.match(project, "Review this Oracle execution plan")[0].agent, "oracle-reviewer");
    assert.equal(contacts.registeredContact(project, "oracle-reviewer").mutation, "read_only");

    fs.appendFileSync(path.join(globalAgents, "oracle-reviewer.md"), "Changed.\n");
    assert.equal(contacts.scan(project).find((item) => item.agent === "oracle-reviewer").registration, "changed");
    assert.equal(contacts.registeredContact(project, "oracle-reviewer"), null);
    assert.deepEqual(contacts.match(project, "Review this Oracle execution plan"), []);
    assert.equal(contacts.remove("oracle-reviewer"), true);
    assert.equal(contacts.remove("oracle-reviewer"), false);
  } finally {
    if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previousConfig;
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("exposes contact management through the OpenCode tool", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-agent-contact-tool-"));
  const previousConfig = process.env.OPENCODE_CONFIG_DIR;
  const previousData = process.env.XDG_DATA_HOME;
  try {
    process.env.OPENCODE_CONFIG_DIR = path.join(root, "config");
    process.env.XDG_DATA_HOME = path.join(root, "data");
    const project = path.join(root, "project");
    const agents = path.join(process.env.OPENCODE_CONFIG_DIR, "agents");
    fs.mkdirSync(agents, { recursive: true });
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(agents, "api-reviewer.md"), "---\ndescription: Reviews REST API contracts.\nmode: subagent\n---\nReview APIs.\n");
    fs.writeFileSync(path.join(agents, "primary-only.md"), "---\ndescription: Runs primary workflows.\nmode: primary\n---\nCoordinate.\n");
    const tool = (await import("../tools/pulso_agent_contacts.ts")).default;
    const scanned = JSON.parse(await tool.execute({ action: "scan" }, { directory: project }));
    assert.equal(scanned.candidates.length, 2);
    assert.equal(scanned.candidates.find((item) => item.agent === "primary-only").compatible, false);
    const candidate = scanned.candidates.find((item) => item.agent === "api-reviewer");
    await tool.execute({
      action: "register",
      agent: candidate.agent,
      digest: candidate.digest,
      description: "REST API reviewer",
      use_when: ["REST API contracts"],
      avoid_when: [],
      capabilities: ["review"],
      mutation: "read_only",
    }, { directory: project });
    const matched = JSON.parse(await tool.execute({ action: "match", objective: "Review the REST API contract", paths: [] }, { directory: project }));
    assert.equal(matched.contacts[0].agent, "api-reviewer");
    assert.deepEqual(matched.delegation.required_markers, ["PULSO_TASK_ID=PULSO-xxx", "PULSO_CONTACT_ID=<agent>"]);
  } finally {
    if (previousConfig === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previousConfig;
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
