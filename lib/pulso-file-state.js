"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function safeDirectory(root, segments) {
  const resolvedRoot = fs.realpathSync(root);
  let current = resolvedRoot;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Unsafe Pulso state symlink: ${current}`);
    } else {
      fs.mkdirSync(current, { recursive: false, mode: 0o700 });
    }
    const real = fs.realpathSync(current);
    if (!real.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Pulso state path escapes the workspace.");
    current = real;
  }
  return current;
}

function withFileLock(file, callback) {
  const lock = `${file}.lock`;
  const token = `${process.pid}-${crypto.randomUUID()}`;
  for (;;) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ token, pid: process.pid, created_at: Date.now() }), { mode: 0o600 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let owner = null;
      try { owner = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")); } catch {}
      const age = Date.now() - fs.statSync(lock).mtimeMs;
      let ownerAlive = false;
      if (Number.isInteger(owner?.pid)) {
        try { process.kill(owner.pid, 0); ownerAlive = true; } catch (signalError) { ownerAlive = signalError.code === "EPERM"; }
      }
      if (ownerAlive || age <= 30000) throw new Error(`Pulso state is busy: ${path.basename(file)}`);
      const quarantine = `${lock}.stale.${token}`;
      try {
        fs.renameSync(lock, quarantine);
      } catch (renameError) {
        if (["ENOENT", "EEXIST"].includes(renameError.code)) continue;
        throw renameError;
      }
      let movedOwner = null;
      try { movedOwner = JSON.parse(fs.readFileSync(path.join(quarantine, "owner.json"), "utf8")); } catch {}
      if (owner?.token && movedOwner?.token !== owner.token) {
        if (!fs.existsSync(lock)) fs.renameSync(quarantine, lock);
        throw new Error(`Pulso state is busy: ${path.basename(file)}`);
      }
      fs.rmSync(quarantine, { recursive: true, force: true });
    }
  }
  try {
    return callback();
  } finally {
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")); } catch {}
    if (owner?.token === token) fs.rmSync(lock, { recursive: true, force: true });
  }
}

function writeAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

module.exports = { safeDirectory, withFileLock, writeAtomic };
