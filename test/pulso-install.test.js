"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const sync = path.join(root, "scripts", "sync.mjs");
const install = path.join(root, "scripts", "install.mjs");
const setup = path.join(root, "scripts", "setup.mjs");
const jsonc = require(path.join(root, "lib", "pulso-jsonc.js"));
const reasoningAgents = [
  "pulso",
  "pulso-planner",
  "pulso-challenger",
  "pulso-verifier",
  "pulso-integration-auditor",
  "pulso-security-auditor",
  "pulso-ui-auditor",
];
const nonReasoningAgents = [
  "pulso-executor",
  "pulso-contact-manager",
  "pulso-config-manager",
  "pulso-explorer",
  "pulso-experience-curator",
  "pulso-delivery-reporter",
];

function readConfig(configRoot) {
  const errors = [];
  const config = jsonc.parse(fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8"), errors, { allowTrailingComma: true });
  assert.deepEqual(errors, []);
  return config;
}

test("preflight prevents a late conflict from leaving a partial installation", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-sync-conflict-"));
  try {
    const conflict = path.join(configRoot, "bin", "pulso-breaker.js");
    fs.mkdirSync(path.dirname(conflict), { recursive: true });
    fs.writeFileSync(conflict, "divergent\n");
    const result = spawnSync(process.execPath, [sync, "install"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(configRoot, "agents", "pulso.md")), false);
    assert.equal(fs.readFileSync(conflict, "utf8"), "divergent\n");
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("installation rejects a symlinked destination component", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-sync-link-"));
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-sync-external-"));
  try {
    fs.symlinkSync(external, path.join(configRoot, "agents"));
    const result = spawnSync(process.execPath, [sync, "install"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(external, "pulso.md")), false);
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test("failed OpenCode synchronization releases its configuration lock", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-install-lock-"));
  try {
    const conflict = path.join(configRoot, "agents", "pulso.md");
    fs.mkdirSync(path.dirname(conflict), { recursive: true });
    fs.writeFileSync(conflict, "customized\n");
    const result = spawnSync(process.execPath, [install, "install"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(path.join(configRoot, "opencode.jsonc.lock")), false);
    assert.equal(fs.readFileSync(conflict, "utf8"), "customized\n");
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("OpenCode install applies the recommended model preset without changing JSONC settings or existing assignments", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-install-models-"));
  try {
    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), `{
  // Retain unrelated user configuration.
  "theme": "custom",
  "agent": {
    "custom-agent": { "model": "vendor/pinned", "temperature": 0.2 },
    "pulso-executor": { "temperature": 0.4 }
  }
}\n`);
    const result = spawnSync(process.execPath, [install, "install"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const text = fs.readFileSync(path.join(configRoot, "opencode.jsonc"), "utf8");
    const config = readConfig(configRoot);
    assert.match(text, /Retain unrelated user configuration/);
    assert.equal(config.theme, "custom");
    assert.equal(config.agent["custom-agent"].model, "vendor/pinned");
    assert.equal(config.agent["custom-agent"].temperature, 0.2);
    for (const agent of reasoningAgents) {
      assert.equal(config.agent[agent].model, "github-copilot/gpt-5.6-terra");
    }
    for (const agent of nonReasoningAgents) {
      assert.equal(config.agent[agent].model, "github-copilot/gpt-5.6-luna");
    }
    assert.equal(config.agent["pulso-executor"].temperature, 0.4);
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("OpenCode installer can skip the model preset and uninstall preserves model assignments", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-install-no-models-"));
  try {
    let result = spawnSync(process.execPath, [setup, "install", "--no-model-preset"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readConfig(configRoot).agent, undefined);

    fs.writeFileSync(path.join(configRoot, "opencode.jsonc"), `{
  "agent": { "pulso": { "model": "vendor/pinned" } }
}\n`);

    result = spawnSync(process.execPath, [install, "uninstall"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readConfig(configRoot).agent.pulso.model, "vendor/pinned");
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("OpenCode install replaces prior managed files and removes retired managed artifacts", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-sync-upgrade-"));
  try {
    const retired = path.join(configRoot, "agents", "pulso-code-auditor.md");
    fs.mkdirSync(path.dirname(retired), { recursive: true });
    fs.writeFileSync(retired, "retired managed agent\n");
    const digest = require("node:crypto").createHash("sha256").update(fs.readFileSync(retired)).digest("hex");
    fs.writeFileSync(path.join(configRoot, ".pulso-install.json"), JSON.stringify({
      schema_version: 1, managed_by: "pulso", files: { "agents/pulso-code-auditor.md": digest },
    }));
    const result = spawnSync(process.execPath, [sync, "install"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(retired), false);
    const state = JSON.parse(fs.readFileSync(path.join(configRoot, ".pulso-install.json"), "utf8"));
    assert.equal(state.managed_by, "pulso");
    assert.ok(state.files["agents/pulso.md"]);
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});

test("OpenCode install preserves a modified retired managed artifact without force", () => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-sync-retired-conflict-"));
  try {
    const retired = path.join(configRoot, "agents", "pulso-code-auditor.md");
    fs.mkdirSync(path.dirname(retired), { recursive: true });
    fs.writeFileSync(retired, "user customization\n");
    fs.writeFileSync(path.join(configRoot, ".pulso-install.json"), JSON.stringify({
      schema_version: 1, managed_by: "pulso", files: { "agents/pulso-code-auditor.md": "old-managed-digest" },
    }));
    const result = spawnSync(process.execPath, [sync, "install"], {
      cwd: root, env: { ...process.env, OPENCODE_CONFIG_DIR: configRoot }, encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(retired, "utf8"), "user customization\n");
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
});
