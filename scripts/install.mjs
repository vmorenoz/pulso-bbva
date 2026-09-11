import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, modify, parse } from "jsonc-parser";
import stateFiles from "../lib/pulso-file-state.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"));
const configFile = path.join(configRoot, "opencode.jsonc");
const operation = process.argv[2];
const force = process.argv.includes("--force");
const setDefault = process.argv.includes("--set-default");
const pluginPaths = [
  "./plugins/pulso-circuit-breaker.mjs",
  "./plugins/pulso-experience-engine.mjs",
];
const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };

if (!["install", "uninstall"].includes(operation)) {
  throw new Error("Usage: node scripts/install.mjs <install|uninstall> [--set-default] [--force]");
}

function runSync(action) {
  const args = [path.join(projectRoot, "scripts", "sync.mjs"), action];
  if (force) args.push("--force");
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

function updatedConfigText() {
  fs.mkdirSync(configRoot, { recursive: true });
  let text = fs.existsSync(configFile)
    ? fs.readFileSync(configFile, "utf8")
    : '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
  const errors = [];
  const config = parse(text, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Cannot safely update invalid JSONC: ${configFile}`);

  const currentPlugins = Array.isArray(config.plugin) ? config.plugin : [];
  const nextPlugins = operation === "install"
    ? [...currentPlugins, ...pluginPaths.filter(plugin => !currentPlugins.includes(plugin))]
    : currentPlugins.filter(plugin => !pluginPaths.includes(plugin));
  text = applyEdits(text, modify(text, ["plugin"], nextPlugins, { formattingOptions }));

  if (operation === "install" && setDefault) {
    text = applyEdits(text, modify(text, ["default_agent"], "pulso", { formattingOptions }));
  } else if (operation === "uninstall" && config.default_agent === "pulso") {
    text = applyEdits(text, modify(text, ["default_agent"], undefined, { formattingOptions }));
  }

  return text;
}

fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
stateFiles.withFileLock(configFile, () => {
  const text = updatedConfigText();
  runSync(operation);
  const temporary = `${configFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, configFile);
});

console.log(`${operation}: OpenCode configuration updated at ${configFile}`);
