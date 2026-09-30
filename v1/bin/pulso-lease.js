#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const stateFiles = require("../lib/pulso-file-state.js");

const [command, taskID, ...args] = process.argv.slice(2);
if (!/^(status|release|reset)$/.test(command || "") || !/^PULSO-\d+$/.test(taskID || "")) {
  throw new Error("Usage: pulso-lease <status|release|reset> PULSO-001 [--reason <text>]");
}

const file = path.join(stateFiles.safeDirectory(process.cwd(), [".pulso", "leases"]), `${taskID}.json`);
if (!fs.existsSync(file)) {
  if (command === "status") {
    process.stdout.write(`${JSON.stringify({ task_id: taskID, status: "none" }, null, 2)}\n`);
    process.exit(0);
  }
  throw new Error(`No lease state exists for ${taskID}.`);
}
if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Unsafe lease state symlink: ${file}`);
const state = JSON.parse(fs.readFileSync(file, "utf8"));

if (command === "status") {
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exit(0);
}

const reasonIndex = args.indexOf("--reason");
const reason = reasonIndex === -1 ? "operator release" : args.slice(reasonIndex + 1).join(" ").trim();
if (!reason) throw new Error("Release requires a non-empty --reason.");

stateFiles.withFileLock(file, () => {
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  current.status = "released";
  current.released_at = new Date().toISOString();
  current.released_by = "operator";
  current.release_reason = reason;
  stateFiles.writeAtomic(file, current);
});
process.stdout.write(`Task lease released for ${taskID}.\n`);
