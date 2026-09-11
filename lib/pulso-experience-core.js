"use strict";

const crypto = require("crypto");

const SENSITIVE = /(?:api[_-]?key|authorization|bearer\s+\S+|password|secret|token|customer|cliente|payload|\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b|\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b|\b(?:\+?\d[\s.-]?){8,15}\b)/i;

function projectKey(directory) {
  return crypto.createHash("sha256").update(String(directory)).digest("hex").slice(0, 24);
}

function objectiveKey(directory, objectiveID) {
  return `${projectKey(directory)}:${objectiveID}`;
}

function fingerprint(memory) {
  return crypto
    .createHash("sha256")
    .update([memory.scope, memory.scope === "project" ? memory.project_key || "" : "", memory.context, memory.trap, memory.rule].join("\n").toLowerCase().replace(/\s+/g, " "))
    .digest("hex");
}

function validMemory(candidate) {
  if (!candidate || typeof candidate !== "object") return false;
  if (![candidate.context, candidate.trap, candidate.rule].every((value) => typeof value === "string" && value.trim().length >= 12)) return false;
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) return false;
  return !SENSITIVE.test([candidate.context, candidate.trap, candidate.rule, ...candidate.evidence].join(" "));
}

function conciseResults(rows, limit = 3, maxCharacters = 1800) {
  const results = [];
  let used = 0;
  for (const row of rows) {
    const result = {
      id: row.id,
      scope: row.scope,
      context: row.context,
      trap: row.trap,
      rule: row.rule,
      tags: JSON.parse(row.tags),
      evidence: JSON.parse(row.evidence),
    };
    const length = JSON.stringify(result).length;
    if (results.length >= limit || used + length > maxCharacters) break;
    results.push(result);
    used += length;
  }
  return results;
}

module.exports = { SENSITIVE, conciseResults, fingerprint, objectiveKey, projectKey, validMemory };
