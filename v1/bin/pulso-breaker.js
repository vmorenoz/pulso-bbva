#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../lib/pulso-circuit-breaker-core.js");
const stateFiles = require("../lib/pulso-file-state.js");

const [command, taskID, ...args] = process.argv.slice(2);
if (!/^(status|reset)$/.test(command || "") || !/^PULSO-\d+$/.test(taskID || "")) {
  throw new Error("Usage: pulso-breaker <status|reset> PULSO-001 [--reason <text>]");
}

const file = path.join(stateFiles.safeDirectory(process.cwd(), [".pulso", "circuit-breakers"]), `${taskID}.json`);
if (!fs.existsSync(file)) throw new Error(`No circuit-breaker state exists for ${taskID}.`);
if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Unsafe circuit-breaker state symlink: ${file}`);
const state = JSON.parse(fs.readFileSync(file, "utf8"));

if (command === "status") {
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
  process.exit(0);
}

const reasonIndex = args.indexOf("--reason");
const reason = reasonIndex === -1 ? "human reset" : args.slice(reasonIndex + 1).join(" ").trim();
if (!reason) throw new Error("Reset requires a non-empty --reason.");
stateFiles.withFileLock(file, () => {
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  const reset = core.createState(taskID, current.safe_head, current.limits);
  reset.reset = { reason, previous_trip_reason: current.trip_reason, at: new Date().toISOString() };
  stateFiles.writeAtomic(file, reset);
});
process.stdout.write(`Circuit breaker reset for ${taskID}.\n`);
