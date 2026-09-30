"use strict";

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const codegraph = require("../lib/pulso-vscode-codegraph.js");

const root = path.resolve(__dirname, "..");

function openCodeBinary() {
  const probe = childProcess.spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 5000 });
  return probe.status === 0 ? "opencode" : null;
}

function readCalls(file) {
  return fs.existsSync(file)
    ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
}

test("OpenCode 1.18.2/Bun initializes CodeGraph and registers workspace MCP on the first Pulso session", {
  skip: !openCodeBinary() && "OpenCode binary is unavailable on PATH; cannot exercise the OpenCode Bun runtime."
}, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-opencode-codegraph-"));
  const home = path.join(directory, "home"); const config = path.join(home, ".config", "opencode"); const workspace = path.join(directory, "workspace");
  const bin = path.join(directory, "bin"); const calls = path.join(directory, "codegraph.calls.jsonl");
  try {
    const detected = childProcess.spawnSync("opencode", ["--version"], { encoding: "utf8", timeout: 5000 });
    assert.equal(detected.status, 0, detected.stderr);
    assert.match(detected.stdout, /1\.18\.2/);
    fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(bin); fs.mkdirSync(config, { recursive: true });
    fs.writeFileSync(path.join(workspace, "PULSO.md"), "---\nschema_version: 1\nartifacts: untracked\n---\n");
    childProcess.execFileSync("git", ["init", "-q"], { cwd: workspace });
    fs.writeFileSync(path.join(bin, "codegraph"), `#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path");
fs.appendFileSync(process.env.CODEGRAPH_LOG,JSON.stringify(process.argv.slice(2))+"\\n");
if(process.argv[2]==="--version"){console.log("1.0.0");process.exit(0)}
if(process.argv[2]==="init"){fs.mkdirSync(path.join(process.argv[3],".codegraph"),{recursive:true});fs.writeFileSync(path.join(process.argv[3],".codegraph","codegraph.db"),"SQLite format 3\\0");process.exit(0)}
process.exit(0);
`, { mode: 0o755 });
    const environment = { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), XDG_DATA_HOME: path.join(home, ".local", "share"), XDG_STATE_HOME: path.join(home, ".local", "state"), OPENCODE_CONFIG_DIR: config, CODEGRAPH_LOG: calls, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    const install = childProcess.spawnSync(process.execPath, [path.join(root, "scripts", "setup.mjs"), "install", "--target", "opencode", "--no-model-preset"], { cwd: workspace, env: environment, encoding: "utf8", timeout: 30000 });
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const run = childProcess.spawnSync("opencode", ["run", "--dir", workspace, "--format", "json", "--print-logs", "--log-level", "DEBUG", "--agent", "pulso", "initialize codegraph"], { cwd: directory, env: environment, encoding: "utf8", timeout: 30000 });
    assert.notEqual(run.error?.code, "ENOENT", run.error?.message);
    assert.ok(!run.error || run.error.code === "ETIMEDOUT", run.error?.message);
    assert.deepEqual(readCalls(calls).slice(0, 2), [["--version"], ["init", fs.realpathSync(workspace), "--agents=none"]], `${run.stdout}\n${run.stderr}`);
    assert.deepEqual(readCalls(calls)[2], ["serve", "--mcp"]);
    const configFile = path.join(workspace, ".opencode", "opencode.jsonc");
    assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).mcp[codegraph.SERVER], {
      type: "local",
      command: ["node", fs.realpathSync(path.join(config, "bin", "pulso-codegraph-mcp.js")), fs.realpathSync(workspace)],
      environment: { CODEGRAPH_MCP_TOOLS: codegraph.TOOLS.join(",") }
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
