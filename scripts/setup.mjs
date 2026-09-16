import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import process from "node:process";
import readline from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operation = process.argv[2];
if (!['install', 'uninstall'].includes(operation)) throw new Error("Usage: node scripts/setup.mjs <install|uninstall> [--target opencode|copilot|both] [--force] [--set-default]");

function targetArgument() {
  const inline = process.argv.find((arg) => arg.startsWith("--target="));
  if (inline) return inline.slice("--target=".length);
  const index = process.argv.indexOf("--target");
  return index >= 0 ? process.argv[index + 1] : null;
}

function option(name) {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function selectTarget() {
  const supplied = targetArgument();
  if (supplied) return supplied;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("No interactive terminal detected; defaulting to the backward-compatible OpenCode target.\n");
    return "opencode";
  }
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question("Install Pulso for: [1] OpenCode, [2] GitHub Copilot CLI, [3] both? ");
    return ({ "1": "opencode", "2": "copilot", "3": "both", opencode: "opencode", copilot: "copilot", both: "both" })[answer.trim().toLowerCase()];
  } finally {
    prompt.close();
  }
}

function persistedProfile(target) {
  const files = [];
  if (target === "opencode" || target === "both") files.push(path.join(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"), "pulso-profile.json"));
  if (target === "copilot" || target === "both") files.push(path.join(process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot"), "pulso-profile.json"));
  const values = files.flatMap((file) => {
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      return value.schema_version === 1 && ["openai", "claude"].includes(value.profile) ? [value.profile] : [];
    } catch { return []; }
  });
  const unique = [...new Set(values)];
  if (unique.length > 1) throw new Error("OpenCode and Copilot have different persisted Pulso profiles; rerun with --profile openai|claude.");
  return unique[0] || null;
}

const target = await selectTarget();
if (!["opencode", "copilot", "both"].includes(target)) throw new Error(`Invalid target: ${target || "empty"}. Use opencode, copilot, or both.`);
let profile = option("--profile");
let provider = option("--provider");
if (operation === "install" && !profile) {
  profile = persistedProfile(target);
  if (profile) {
    process.stdout.write(`Reusing the persisted ${profile} model profile.\n`);
  } else if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write("No interactive terminal detected; defaulting to the OpenAI model profile.\n");
    profile = "openai";
  } else {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await prompt.question("Use which Pulso model profile: [1] OpenAI (Terra/Luna), [2] Claude (Sonnet/Haiku)? ");
      profile = ({ "1": "openai", "2": "claude", openai: "openai", claude: "claude" })[answer.trim().toLowerCase()];
    } finally {
      prompt.close();
    }
  }
}
if (operation === "install" && !["openai", "claude"].includes(profile)) throw new Error(`Invalid profile: ${profile || "empty"}. Use openai or claude.`);
if (operation === "install" && profile === "openai" && !provider && (target === "opencode" || target === "both") && process.stdin.isTTY && process.stdout.isTTY) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question("OpenCode provider for OpenAI profile: [1] GitHub Copilot (github-copilot/), [2] OpenAI (openai/)? ");
    const mapped = ({ "1": "github-copilot", "2": "openai", copilot: "github-copilot", "github-copilot": "github-copilot", openai: "openai" })[answer.trim().toLowerCase()];
    if (mapped) provider = mapped;
  } finally {
    prompt.close();
  }
}
const raw = process.argv.slice(3);
const passthrough = raw.filter((arg, index, args) => !arg.startsWith("--target=") && !arg.startsWith("--profile=") && !arg.startsWith("--provider=") && !["--target", "--profile", "--provider"].includes(arg) && !["--target", "--profile", "--provider"].includes(args[index - 1]));
if (operation === "install") {
  passthrough.push("--profile", profile);
  if (provider) passthrough.push("--provider", provider);
}

function run(script) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), operation, ...passthrough], { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (target === "opencode" || target === "both") run("install.mjs");
if (target === "copilot" || target === "both") run("install-copilot.mjs");
