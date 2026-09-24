"use strict";

function stale(lease, now, graceMs) {
  const heartbeat = Date.parse(lease?.heartbeat_at || lease?.acquired_at);
  return !Number.isFinite(heartbeat) || heartbeat <= now - graceMs;
}

function decideLeaseAction({ lease, ownerActivity, now = Date.now(), graceMs }) {
  if (!lease || lease.status !== "active") return "acquire";
  if (["busy", "retry", "active"].includes(ownerActivity)) return "protect";
  if (["idle", "inactive", "missing"].includes(ownerActivity)) return "recover";
  return stale(lease, now, graceMs) ? "recover" : "protect";
}

module.exports = { decideLeaseAction };
