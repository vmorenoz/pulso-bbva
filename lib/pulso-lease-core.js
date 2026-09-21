"use strict";

const fs = require("fs");
const path = require("path");
const control = require("./pulso-control-core.js");
const stateFiles = require("./pulso-file-state.js");

function leasePath(directory, taskID) {
  return path.join(stateFiles.safeDirectory(directory, [".pulso", "leases"]), `${taskID}.json`);
}

function read(directory, taskID) {
  const file = leasePath(directory, taskID);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function activeLease(taskID, ownerSession, ttlMinutes, existing, reason) {
  const now = new Date();
  return {
    schema_version: 1,
    task_id: taskID,
    status: "active",
    owner_session: ownerSession,
    acquired_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMinutes * 60000).toISOString(),
    recovered_from: existing?.owner_session && existing.owner_session !== ownerSession ? existing.owner_session : null,
    ...(reason ? { recovery_reason: reason } : {}),
  };
}

function acquire(directory, taskID, ownerSession, ttlMinutes = 30, options = {}) {
  const file = leasePath(directory, taskID);
  return stateFiles.withFileLock(file, () => {
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    const occupied = existing?.status === "active" && !control.isExpired(existing) && existing.owner_session !== ownerSession;
    if (occupied && !options.recover) {
      throw new Error(`${taskID} is leased by another active session until ${existing.expires_at}.`);
    }
    const lease = activeLease(taskID, ownerSession, ttlMinutes, existing, options.reason);
    stateFiles.writeAtomic(file, lease);
    return lease;
  });
}

function heartbeat(directory, taskID, ownerSession, ttlMinutes = 30) {
  const file = leasePath(directory, taskID);
  return stateFiles.withFileLock(file, () => {
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    if (!existing || existing.status !== "active" || existing.owner_session !== ownerSession) {
      throw new Error(`${taskID} has no active lease owned by this session.`);
    }
    const now = new Date();
    existing.heartbeat_at = now.toISOString();
    existing.expires_at = new Date(now.getTime() + ttlMinutes * 60000).toISOString();
    stateFiles.writeAtomic(file, existing);
    return existing;
  });
}

function release(directory, taskID, options = {}) {
  const file = leasePath(directory, taskID);
  return stateFiles.withFileLock(file, () => {
    const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
    if (!existing || existing.status !== "active") return existing;
    if (options.expectedOwner && existing.owner_session !== options.expectedOwner) {
      throw new Error(`${taskID} lease owner changed during recovery.`);
    }
    if (options.expectedHeartbeat && existing.heartbeat_at !== options.expectedHeartbeat) {
      throw new Error(`${taskID} lease heartbeat changed during recovery.`);
    }
    if (!options.force && options.ownerSession && existing.owner_session !== options.ownerSession) {
      throw new Error(`${taskID} has no active lease owned by this session.`);
    }
    existing.status = "released";
    existing.released_at = new Date().toISOString();
    existing.released_by = options.releasedBy || options.ownerSession || "plugin";
    if (options.reason) existing.release_reason = options.reason;
    stateFiles.writeAtomic(file, existing);
    return existing;
  });
}

module.exports = { acquire, heartbeat, isExpired: control.isExpired, leasePath, read, release };
