import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jsonc from "../lib/pulso-jsonc.js";
import stateFiles from "../lib/pulso-file-state.js";

const { applyEdits, modify, parse } = jsonc;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"));
const configFile = fs.existsSync(path.join(configRoot, "opencode.jsonc"))
  ? path.join(configRoot, "opencode.jsonc")
  : (fs.existsSync(path.join(configRoot, "opencode.json"))
    ? path.join(configRoot, "opencode.json")
    : path.join(configRoot, "opencode.jsonc"));
const legacyProfileFile = path.join(configRoot, "pulso-profile.json");
const operation = process.argv[2];
const force = process.argv.includes("--force");
const setDefault = process.argv.includes("--set-default");
if (process.argv.some((arg) => arg === "--profile" || arg === "--provider" || arg === "--dynamic" || arg.startsWith("--profile=") || arg.startsWith("--provider="))) {
  throw new Error("Model profile/provider installation flags were removed. Configure Pulso models with /pulso-configure.");
}
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
  if (result.status !== 0) throw new Error(`OpenCode runtime sync failed with status ${result.status || 1}.`);
}

function migrateLegacyRuntime() {
  // Retired profile metadata was the only pre-manifest OpenCode artifact owned by Pulso.
  if (!fs.existsSync(legacyProfileFile)) return null;
  try {
    const profile = JSON.parse(fs.readFileSync(legacyProfileFile, "utf8"));
    return profile?.managed_by === "pulso" ? profile : null;
  } catch {
    return null;
  }
}

function updatedConfigText(legacyProfile) {
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

  if (legacyProfile?.managed_by === "pulso" && legacyProfile.models && typeof legacyProfile.models === "object") {
    for (const [agent, model] of Object.entries(legacyProfile.models)) {
      if (config.agent?.[agent]?.model === model) {
        text = applyEdits(text, modify(text, ["agent", agent, "model"], undefined, { formattingOptions }));
      }
    }
  }

  if (operation === "install" && setDefault) {
    text = applyEdits(text, modify(text, ["default_agent"], "pulso", { formattingOptions }));
  } else if (operation === "uninstall" && config.default_agent === "pulso") {
    text = applyEdits(text, modify(text, ["default_agent"], undefined, { formattingOptions }));
  }

  return text;
}

fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
stateFiles.withFileLock(configFile, () => {
  const legacyProfile = migrateLegacyRuntime();
  const text = updatedConfigText(legacyProfile);
  runSync(operation);
  const temporary = `${configFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, configFile);
  try {
    if (legacyProfile?.managed_by === "pulso") fs.rmSync(legacyProfileFile, { force: true });
  } catch {}
});

console.log(`${operation}: OpenCode configuration updated at ${configFile}`);
