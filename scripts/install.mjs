import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, modify, parse } from "jsonc-parser";
import stateFiles from "../lib/pulso-file-state.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"));
const configFile = fs.existsSync(path.join(configRoot, "opencode.jsonc"))
  ? path.join(configRoot, "opencode.jsonc")
  : (fs.existsSync(path.join(configRoot, "opencode.json"))
    ? path.join(configRoot, "opencode.json")
    : path.join(configRoot, "opencode.jsonc"));
const profileFile = path.join(configRoot, "pulso-profile.json");
const operation = process.argv[2];
const force = process.argv.includes("--force");
const setDefault = process.argv.includes("--set-default");
const profileIndex = process.argv.indexOf("--profile");
const profileName = profileIndex >= 0 ? process.argv[profileIndex + 1] : "openai";
const providerIndex = process.argv.indexOf("--provider");
const explicitProvider = providerIndex >= 0 ? process.argv[providerIndex + 1] : (process.argv.find((arg) => arg.startsWith("--provider="))?.slice(11) || null);
if (explicitProvider && !["openai", "github-copilot"].includes(explicitProvider.toLowerCase())) {
  throw new Error(`Invalid provider: ${explicitProvider}. Use openai or github-copilot.`);
}
const isDynamic = process.argv.includes("--dynamic");
const modelProfiles = JSON.parse(fs.readFileSync(path.join(projectRoot, "model-profiles.json"), "utf8"));
const selectedProfile = modelProfiles.profiles[profileName];
const managedModels = new Set([
  ...Object.values(modelProfiles.profiles).flatMap((profile) => Object.values(profile.models)).map((model) => `github-copilot/${model}`),
  ...Object.values(modelProfiles.profiles.openai.models).map((model) => `openai/${model}`),
]);
const legacyManagedAgents = ["pulso-code-auditor"];
const pluginPaths = [
  "./plugins/pulso-circuit-breaker.mjs",
  "./plugins/pulso-experience-engine.mjs",
];
const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };

if (!["install", "uninstall"].includes(operation)) {
  throw new Error("Usage: node scripts/install.mjs <install|uninstall> [--profile openai|claude] [--provider github-copilot|openai] [--set-default] [--force]");
}
if (operation === "install" && !selectedProfile) throw new Error(`Unknown model profile: ${profileName}.`);

function runSync(action) {
  const args = [path.join(projectRoot, "scripts", "sync.mjs"), action];
  if (force) args.push("--force");
  const result = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: "utf8", stdio: "inherit" });
  if (result.status !== 0) throw new Error(`OpenCode runtime sync failed with status ${result.status || 1}.`);
}

function resolveProvider(config, storedProfile) {
  if (profileName === "claude") return "github-copilot";
  if (explicitProvider) return explicitProvider.toLowerCase();
  if (storedProfile?.provider && ["openai", "github-copilot"].includes(storedProfile.provider)) {
    return storedProfile.provider;
  }
  let openaiCount = 0;
  let copilotCount = 0;
  if (typeof config?.model === "string") {
    if (config.model.startsWith("openai/")) openaiCount += 2;
    if (config.model.startsWith("github-copilot/")) copilotCount += 2;
  }
  if (config?.agent && typeof config.agent === "object") {
    for (const entry of Object.values(config.agent)) {
      const m = entry?.model;
      if (typeof m === "string") {
        if (m.startsWith("openai/")) openaiCount++;
        if (m.startsWith("github-copilot/")) copilotCount++;
      }
    }
  }
  return openaiCount > copilotCount ? "openai" : "github-copilot";
}

function updatedConfigText(storedProfile, managedProfile) {
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

  for (const agent of legacyManagedAgents) {
    if (managedModels.has(config.agent?.[agent]?.model)) {
      text = applyEdits(text, modify(text, ["agent", agent], undefined, { formattingOptions }));
    }
  }

  if (operation === "install" && setDefault) {
    text = applyEdits(text, modify(text, ["default_agent"], "pulso", { formattingOptions }));
  } else if (operation === "uninstall" && config.default_agent === "pulso") {
    text = applyEdits(text, modify(text, ["default_agent"], undefined, { formattingOptions }));
  }

  const activeProvider = resolveProvider(config, storedProfile);
  const desiredPrefix = `${activeProvider}/`;

  if (operation === "install" && isDynamic) {
    for (const agent of Object.keys(modelProfiles.agent_tiers)) {
      if (managedModels.has(config.agent?.[agent]?.model)) {
        text = applyEdits(text, modify(text, ["agent", agent, "model"], undefined, { formattingOptions }));
      }
    }
    return { text, activeProvider: "dynamic", desiredPrefix: "" };
  }

  if (operation === "install") {
    const conflicts = Object.entries(modelProfiles.agent_tiers).filter(([agent, tier]) => {
      const current = config.agent?.[agent]?.model;
      const desired = `${desiredPrefix}${selectedProfile.models[tier]}`;
      return current && current !== desired && !managedModels.has(current);
    }).map(([agent]) => agent);
    if (conflicts.length && !force) throw new Error(`Refusing to overwrite customized OpenCode agent models without --force:\n${conflicts.join("\n")}`);
  }
  for (const [agent, tier] of Object.entries(modelProfiles.agent_tiers)) {
    if (operation === "install") {
      text = applyEdits(text, modify(text, ["agent", agent, "model"], `${desiredPrefix}${selectedProfile.models[tier]}`, { formattingOptions }));
    } else if (managedProfile && storedProfile.models?.[agent] === config.agent?.[agent]?.model) {
      text = applyEdits(text, modify(text, ["agent", agent, "model"], undefined, { formattingOptions }));
    }
  }

  return { text, activeProvider, desiredPrefix };
}

fs.mkdirSync(configRoot, { recursive: true, mode: 0o700 });
stateFiles.withFileLock(configFile, () => {
  let storedProfile = null;
  try { storedProfile = JSON.parse(fs.readFileSync(profileFile, "utf8")); } catch {}
  const validProfile = storedProfile?.schema_version === 1 && Object.hasOwn(modelProfiles.profiles, storedProfile.profile);
  const managedProfile = validProfile && storedProfile.managed_by === "pulso";
  const preserveProfile = operation === "install" && validProfile && !managedProfile && storedProfile.profile === profileName && !force;
  if (operation === "install" && fs.existsSync(profileFile) && !managedProfile && !preserveProfile && !force) throw new Error(`Refusing to overwrite customized Pulso profile metadata without --force: ${profileFile}`);
  const { text, activeProvider, desiredPrefix } = updatedConfigText(storedProfile, managedProfile);
  runSync(operation);
  const temporary = `${configFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, configFile);
  if (operation === "install" && !preserveProfile) {
    const models = isDynamic
      ? {}
      : Object.fromEntries(Object.entries(modelProfiles.agent_tiers).map(([agent, tier]) => [agent, `${desiredPrefix}${selectedProfile.models[tier]}`]));
    stateFiles.writeAtomic(profileFile, { schema_version: 1, managed_by: "pulso", profile: profileName, provider: activeProvider, dynamic: isDynamic, models });
  }
  else if (managedProfile) fs.rmSync(profileFile, { force: true });
});

console.log(`${operation}: OpenCode configuration updated at ${configFile}`);
