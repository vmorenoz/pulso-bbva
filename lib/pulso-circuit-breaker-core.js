"use strict";

const crypto = require("crypto");

const DEFAULT_LIMITS = Object.freeze({
  maxRepairCycles: 3,
  maxRepeatedErrors: 2,
});

function createState(taskID, safeHead, limits = DEFAULT_LIMITS) {
  return {
    schema_version: 1,
    task_id: taskID,
    state: "closed",
    limits: { ...DEFAULT_LIMITS, ...limits },
    token_usage: 0,
    token_usage_by_session: {},
    repair_cycles: 0,
    validation_failures: 0,
    infrastructure_failures: 0,
    current_errors: {},
    repair_pending: false,
    last_error_hash: null,
    repeated_error_count: 0,
    active_sessions: [],
    safe_head: safeHead || null,
    trip_reason: null,
    last_validation: null,
    updated_at: new Date().toISOString(),
  };
}

function normalizeState(state) {
  state.limits = { ...DEFAULT_LIMITS, ...(state.limits || {}) };
  delete state.limits.maxTokens;
  if (state.state === "open" && state.trip_reason === "token_cap") {
    state.state = "closed";
    state.trip_reason = null;
  }
  state.active_sessions = Array.isArray(state.active_sessions) ? state.active_sessions : [];
  state.token_usage_by_session = state.token_usage_by_session && typeof state.token_usage_by_session === "object" ? state.token_usage_by_session : {};
  state.token_usage = Number(state.token_usage) || 0;
  state.validation_failures = Number(state.validation_failures) || 0;
  state.infrastructure_failures = Number(state.infrastructure_failures) || 0;
  state.current_errors = state.current_errors && typeof state.current_errors === "object" ? state.current_errors : {};
  state.repair_pending = Boolean(state.repair_pending);
  state.repair_cycles = Number(state.repair_cycles) || 0;
  state.repeated_error_count = Number(state.repeated_error_count) || 0;
  return state;
}

function normalizeOutput(output) {
  return String(output || "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b\d{4}-\d{2}-\d{2}[T ][\d:.+-]+Z?\b/g, "<timestamp>")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/g, "<duration>")
    .replace(/\/var\/folders\/[^\s:]+/g, "<temp-path>")
    .replace(/:\d+(?::\d+)?\b/g, ":<location>")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(command, output) {
  return crypto
    .createHash("sha256")
    .update(`${String(command || "").trim()}\n${normalizeOutput(output)}`)
    .digest("hex");
}

function isValidationCommand(command) {
  return /\b(test|tests|lint|eslint|typecheck|tsc|build|mvn|gradle|vitest|jest|mocha|pytest)\b/i.test(
    String(command || ""),
  );
}

function isInfrastructureFailure(output) {
  const text = normalizeOutput(output);
  return /\bstartup error\b|\bmissing dependency\b|failed to start (?:forks |threads )?worker|no project had a browser configuration|cannot find (?:package|dependency).*(?:happy-dom|jsdom)|could not resolve import "@vitest\/utils\/helpers"|executable (?:doesn't|does not) exist|browser .*failed to launch|failed to launch (?:the )?browser|\bcommand not found\b|\bpermission denied\b|\bEACCES\b|\bEADDRINUSE\b|address already in use|no tests? found/i.test(text);
}

function addSession(state, sessionID) {
  normalizeState(state);
  if (sessionID && !state.active_sessions.includes(sessionID)) state.active_sessions.push(sessionID);
  return state;
}

function recordTokens(state, tokens, sessionID) {
  normalizeState(state);
  const total = Number(tokens?.total) || Number(tokens?.input || 0) + Number(tokens?.output || 0) + Number(tokens?.reasoning || 0);
  if (sessionID) state.token_usage_by_session[sessionID] = Math.max(Number(state.token_usage_by_session[sessionID]) || 0, total);
  state.token_usage = sessionID
    ? Object.values(state.token_usage_by_session).reduce((sum, value) => sum + Number(value || 0), 0)
    : Math.max(state.token_usage, total);
  return state;
}

function errorAggregate(state) {
  const errors = Object.values(state.current_errors).sort();
  return errors.length ? crypto.createHash("sha256").update(errors.join("\n")).digest("hex") : null;
}

function recordRepairAction(state) {
  normalizeState(state);
  if (Object.keys(state.current_errors).length > 0) state.repair_pending = true;
  return state;
}

function recordValidation(state, command, output, failed) {
  normalizeState(state);
  if (!isValidationCommand(command)) return state;
  const commandKey = String(command).trim().replace(/\s+/g, " ");
  const errorHash = failed ? fingerprint(command, output) : null;
  const failureKind = failed && isInfrastructureFailure(output) ? "infrastructure" : failed ? "behavior" : null;
  state.last_validation = { command: String(command), failed: Boolean(failed), failure_kind: failureKind, error_hash: errorHash };
  if (!failed) {
    delete state.current_errors[commandKey];
    if (Object.keys(state.current_errors).length === 0) {
      state.validation_failures = 0;
      state.repair_cycles = 0;
      state.repeated_error_count = 0;
      state.last_error_hash = null;
      state.repair_pending = false;
    }
    return state;
  }

  if (failureKind === "infrastructure") {
    state.infrastructure_failures += 1;
    return state;
  }

  state.validation_failures += 1;
  state.current_errors[commandKey] = errorHash;
  const aggregate = errorAggregate(state);
  if (state.last_error_hash === null) {
    state.last_error_hash = aggregate;
    state.repeated_error_count = 1;
  } else if (state.repair_pending) {
    state.repair_cycles += 1;
    state.repeated_error_count = state.last_error_hash === aggregate ? state.repeated_error_count + 1 : 1;
    state.last_error_hash = aggregate;
    state.repair_pending = false;
    if (state.repeated_error_count >= state.limits.maxRepeatedErrors) trip(state, "repeated_validation_error");
    else if (state.repair_cycles >= state.limits.maxRepairCycles) trip(state, "repair_cycle_limit");
  }
  return state;
}

function trip(state, reason) {
  if (state.state === "open") return state;
  state.state = "open";
  state.trip_reason = reason;
  return state;
}

module.exports = { DEFAULT_LIMITS, addSession, createState, fingerprint, isInfrastructureFailure, isValidationCommand, normalizeState, recordRepairAction, recordTokens, recordValidation };
