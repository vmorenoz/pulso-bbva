import { spawnSync } from "node:child_process";
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

const target = await selectTarget();
if (!["opencode", "copilot", "both"].includes(target)) throw new Error(`Invalid target: ${target || "empty"}. Use opencode, copilot, or both.`);
if (process.argv.some((arg) => arg === "--profile" || arg === "--provider" || arg.startsWith("--profile=") || arg.startsWith("--provider="))) {
  throw new Error("Model profile/provider installation flags were removed. Configure OpenCode models with /pulso-configure.");
}
const raw = process.argv.slice(3);
const passthrough = raw.filter((arg, index, args) => !arg.startsWith("--target=") && arg !== "--target" && args[index - 1] !== "--target");

function run(script, extra = []) {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", script), operation, ...passthrough, ...extra], { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

if (target === "opencode" || target === "both") run("install.mjs");
if (target === "copilot" || target === "both") run("install-copilot.mjs");
