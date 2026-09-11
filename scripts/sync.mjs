import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configRoot = path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"));
const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, "pulso.manifest.json"), "utf8"));
const operation = process.argv[2];
const force = process.argv.includes("--force");

if (!["export", "install", "uninstall"].includes(operation)) {
  throw new Error("Usage: node scripts/sync.mjs <export|install|uninstall> [--force]");
}

const sourceRoot = operation === "export" ? configRoot : projectRoot;
const targetRoot = operation === "export" ? projectRoot : configRoot;
const selectedFiles = manifest.install;
const conflicts = [];
let copied = 0;
let removed = 0;

if (!fs.existsSync(targetRoot)) fs.mkdirSync(targetRoot, { recursive: true, mode: 0o700 });

function safePath(root, relativePath) {
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error(`Unsafe symlink root: ${root}`);
  let current = root;
  for (const segment of relativePath.split(path.sep)) {
    current = path.join(current, segment);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Unsafe symlink path: ${current}`);
  }
  const resolved = path.resolve(current);
  if (resolved !== path.resolve(root) && !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Path escapes root: ${relativePath}`);
  return current;
}

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const operations = [];
for (const relativePath of selectedFiles) {
  const normalized = path.normalize(relativePath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error(`Unsafe manifest path: ${relativePath}`);
  }

  const source = safePath(sourceRoot, normalized);
  const target = safePath(targetRoot, normalized);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing source file: ${source}`);
  }

  if (operation === "uninstall") {
    if (!fs.existsSync(target)) continue;
    const sameFile = fs.statSync(target).isFile() && digest(source) === digest(target);
    if (!sameFile && !force) {
      conflicts.push(relativePath);
      continue;
    }
    operations.push({ type: "remove", target });
    continue;
  }

  if (fs.existsSync(target) && digest(source) === digest(target)) continue;
  if (fs.existsSync(target) && !force) {
    conflicts.push(relativePath);
    continue;
  }

  operations.push({ type: "copy", source, target });
}

if (conflicts.length) {
  throw new Error(`Refusing to overwrite changed files without --force:\n${conflicts.join("\n")}`);
}

for (const item of operations) {
  if (item.type === "remove") {
    fs.rmSync(item.target, { force: true });
    removed += 1;
    continue;
  }
  fs.mkdirSync(path.dirname(item.target), { recursive: true, mode: 0o700 });
  const temporary = `${item.target}.${process.pid}.tmp`;
  fs.copyFileSync(item.source, temporary);
  fs.renameSync(temporary, item.target);
  copied += 1;
}

if (operation === "uninstall") {
  console.log(`uninstall: ${removed} file(s) removed; ${selectedFiles.length - removed} absent`);
} else {
  console.log(`${operation}: ${copied} file(s) copied; ${selectedFiles.length - copied} unchanged`);
}
