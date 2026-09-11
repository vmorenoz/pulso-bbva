"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const stateFiles = require("../lib/pulso-file-state.js");

test("serializes access with a per-file lock", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-lock-"));
  try {
    const file = path.join(directory, "state.json");
    stateFiles.withFileLock(file, () => {
      assert.throws(() => stateFiles.withFileLock(file, () => {}), /state is busy/);
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects symlinked state directories", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-safe-"));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-target-"));
  try {
    fs.symlinkSync(target, path.join(directory, ".pulso"));
    assert.throws(() => stateFiles.safeDirectory(directory, [".pulso", "leases"]), /state symlink/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test("recovers a stale lock owned by a dead process", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pulso-stale-lock-"));
  try {
    const file = path.join(directory, "state.json");
    const lock = `${file}.lock`;
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ token: "stale", pid: 999999, created_at: 0 }));
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(lock, old, old);
    let acquired = false;
    stateFiles.withFileLock(file, () => { acquired = true; });
    assert.equal(acquired, true);
    assert.equal(fs.existsSync(lock), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
