"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
test("lease rejects another session and allows expired recovery", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-lease-"));
  try {
    const lease = (await import("../tools/pulso_lease.ts")).default;
    await lease.execute({ action: "acquire", task_id: "PULSO-001", ttl_minutes: 30 }, { directory, sessionID: "session-a" });
    await assert.rejects(() => lease.execute({ action: "acquire", task_id: "PULSO-001", ttl_minutes: 30 }, { directory, sessionID: "session-b" }), /leased by another/);
    const file = path.join(directory, ".pulso", "leases", "PULSO-001.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    state.expires_at = "2020-01-01T00:00:00.000Z";
    fs.writeFileSync(file, JSON.stringify(state));
    const recovered = JSON.parse(await lease.execute({ action: "acquire", task_id: "PULSO-001", ttl_minutes: 30 }, { directory, sessionID: "session-b" }));
    assert.equal(recovered.recovered_from, "session-a");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("lease applies its 30-minute TTL when the caller omits ttl_minutes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-lease-default-"));
  try {
    const lease = (await import("../tools/pulso_lease.ts")).default;
    const before = Date.now();
    const acquired = JSON.parse(await lease.execute({ action: "acquire", task_id: "PULSO-001" }, { directory, sessionID: "session-a" }));
    const duration = new Date(acquired.expires_at).getTime() - before;
    assert.ok(duration >= 29 * 60 * 1000 && duration <= 31 * 60 * 1000);
    const heartbeat = JSON.parse(await lease.execute({ action: "heartbeat", task_id: "PULSO-001" }, { directory, sessionID: "session-a" }));
    assert.equal(Number.isNaN(new Date(heartbeat.expires_at).getTime()), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("doctor reports a healthy configured control plane", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-doctor-"));
  const configRoot = path.join(directory, "config");
  const previousConfigRoot = process.env.OPENCODE_CONFIG_DIR;
  const previousDataHome = process.env.XDG_DATA_HOME;
  try {
    process.env.OPENCODE_CONFIG_DIR = configRoot;
    process.env.XDG_DATA_HOME = path.join(directory, "data");
    for (const agent of [
      "pulso", "pulso-planner", "pulso-challenger", "pulso-executor", "pulso-explorer", "pulso-verifier",
      "pulso-integration-auditor", "pulso-security-auditor", "pulso-ui-auditor", "pulso-experience-curator", "pulso-delivery-reporter",
    ]) {
      fs.mkdirSync(path.join(configRoot, "agents"), { recursive: true });
      fs.writeFileSync(path.join(configRoot, "agents", `${agent}.md`), "---\n---\n");
    }
    for (const plugin of ["pulso-circuit-breaker", "pulso-experience-engine"]) {
      fs.mkdirSync(path.join(configRoot, "plugins"), { recursive: true });
      fs.writeFileSync(path.join(configRoot, "plugins", `${plugin}.mjs`), "export default () => ({})\n");
    }
    for (const customTool of ["pulso_lease", "pulso_route", "pulso_skill_digest", "pulso_doctor", "pulso_dashboard"]) {
      fs.mkdirSync(path.join(configRoot, "tools"), { recursive: true });
      fs.writeFileSync(path.join(configRoot, "tools", `${customTool}.ts`), "export default {}\n");
    }
    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), JSON.stringify({
      plugin: ["./plugins/pulso-circuit-breaker.mjs", "./plugins/pulso-experience-engine.mjs"],
    }));
    const experienceDirectory = path.join(process.env.XDG_DATA_HOME, "opencode", "pulso");
    fs.mkdirSync(experienceDirectory, { recursive: true });
    fs.writeFileSync(path.join(experienceDirectory, "experience.sqlite"), "");
    const doctor = (await import("../tools/pulso_doctor.ts")).default;
    const result = JSON.parse(await doctor.execute({}, { directory }));
    assert.equal(result.status, "healthy");
  } finally {
    if (previousConfigRoot === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previousConfigRoot;
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("doctor reports skipped experience reconciliation rows", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-doctor-reconciliation-"));
  const configRoot = path.join(directory, "config");
  const dataHome = path.join(directory, "data");
  const previousConfigRoot = process.env.OPENCODE_CONFIG_DIR;
  const previousDataHome = process.env.XDG_DATA_HOME;
  try {
    process.env.OPENCODE_CONFIG_DIR = configRoot;
    process.env.XDG_DATA_HOME = dataHome;
    const agentNames = ["pulso", "pulso-planner", "pulso-challenger", "pulso-executor", "pulso-explorer", "pulso-verifier", "pulso-integration-auditor", "pulso-security-auditor", "pulso-ui-auditor", "pulso-experience-curator", "pulso-delivery-reporter"];
    fs.mkdirSync(path.join(configRoot, "agents"), { recursive: true });
    for (const name of agentNames) fs.writeFileSync(path.join(configRoot, "agents", `${name}.md`), "---\n---\n");
    fs.mkdirSync(path.join(configRoot, "plugins"), { recursive: true });
    for (const name of ["pulso-circuit-breaker", "pulso-experience-engine"]) fs.writeFileSync(path.join(configRoot, "plugins", `${name}.mjs`), "export default () => ({})\n");
    fs.mkdirSync(path.join(configRoot, "tools"), { recursive: true });
    for (const name of ["pulso_lease", "pulso_route", "pulso_skill_digest", "pulso_doctor", "pulso_dashboard"]) fs.writeFileSync(path.join(configRoot, "tools", `${name}.ts`), "export default {}\n");
    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), JSON.stringify({ plugin: ["./plugins/pulso-circuit-breaker.mjs", "./plugins/pulso-experience-engine.mjs"] }));
    const experienceDirectory = path.join(dataHome, "opencode", "pulso");
    fs.mkdirSync(experienceDirectory, { recursive: true });
    fs.writeFileSync(path.join(experienceDirectory, "experience.sqlite"), "");
    const crypto = require("node:crypto");
    const projectKey = crypto.createHash("sha256").update(String(directory)).digest("hex").slice(0, 24);
    fs.writeFileSync(path.join(experienceDirectory, "reconciliation.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), project_key: projectKey, code: "reconciliation_completed", skipped: 2 })}\n`);
    const doctor = (await import("../tools/pulso_doctor.ts")).default;
    const result = JSON.parse(await doctor.execute({}, { directory }));
    assert.equal(result.status, "warning");
    assert.equal(result.findings[0].code, "experience_reconciliation_issue");
  } finally {
    if (previousConfigRoot === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = previousConfigRoot;
    if (previousDataHome === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousDataHome;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
