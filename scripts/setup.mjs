import { spawnSync } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operation = process.argv[2];
if (!['install', 'uninstall'].includes(operation)) throw new Error("Usage: node scripts/setup.mjs <install|uninstall> [--target opencode|vscode] [--force] [--set-default] [--no-model-preset]");

function targetArgument() {
  const inline = process.argv.find((arg) => arg.startsWith("--target="));
  if (inline) return inline.slice("--target=".length);
  const index = process.argv.indexOf("--target");
  return index >= 0 ? process.argv[index + 1] : null;
}

const target = targetArgument() || "opencode";
if (!['opencode', 'vscode'].includes(target)) throw new Error(`Invalid target: ${target || "empty"}. Use opencode or vscode.`);
if (process.argv.some((arg) => arg === "--profile" || arg === "--provider" || arg.startsWith("--profile=") || arg.startsWith("--provider="))) {
  throw new Error("Model profile/provider installation flags were removed. Configure OpenCode models with /pulso-configure.");
}
const raw = process.argv.slice(3);
const passthrough = raw.filter((arg, index, args) => !arg.startsWith("--target=") && arg !== "--target" && args[index - 1] !== "--target");
const script = target === "opencode" ? "install.mjs" : "install-vscode.mjs";
const result = spawnSync(process.execPath, [path.join(root, "scripts", script), operation, ...passthrough], { cwd: root, stdio: "inherit", env: process.env });
if (result.status !== 0) process.exit(result.status || 1);
