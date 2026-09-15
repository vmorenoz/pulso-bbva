import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operation = process.argv[2];
const binary = process.env.COPILOT_BINARY || "copilot";
if (!["install", "uninstall"].includes(operation)) throw new Error("Usage: node scripts/install-copilot.mjs <install|uninstall>");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8" });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

const version = run(binary, ["--version"]);
if (version.status !== 0) throw new Error("GitHub Copilot CLI is required for the Copilot target.");

if (operation === "install") {
  if (!path.isAbsolute(root)) throw new Error("Pulso plugin root must be absolute.");
  const marketplaces = run(binary, ["plugin", "marketplace", "list"]);
  if (marketplaces.status !== 0) process.exit(marketplaces.status || 1);
  if (!/^\s*\S?\s*pulso\b/im.test(marketplaces.stdout || "")) {
    const added = run(binary, ["plugin", "marketplace", "add", root]);
    if (added.status !== 0) process.exit(added.status || 1);
  }
  const result = run(binary, ["plugin", "install", "pulso@pulso"]);
  if (result.status !== 0) process.exit(result.status || 1);
  process.stdout.write("install: Pulso configured for GitHub Copilot CLI. Start with `copilot --agent pulso`.\n");
} else {
  const result = run(binary, ["plugin", "uninstall", "pulso"]);
  if (result.status !== 0 && !/not installed|not found/i.test(`${result.stdout}\n${result.stderr}`)) process.exit(result.status || 1);
  const marketplace = run(binary, ["plugin", "marketplace", "remove", "pulso"]);
  if (marketplace.status !== 0 && !/not found|not registered/i.test(`${marketplace.stdout}\n${marketplace.stderr}`)) process.exit(marketplace.status || 1);
  process.stdout.write("uninstall: Pulso removed from GitHub Copilot CLI.\n");
}
