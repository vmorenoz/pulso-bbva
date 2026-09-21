"use strict";

const SENSITIVE_PATTERNS = [
  ["authentication", /\b(auth|authentication|authorization|oauth|token|session|autenticaci[oó]n|autorizaci[oó]n|sesi[oó]n)\b/i],
  ["persistence", /\b(database|schema|migration|table|persistence|base de datos|esquema|migraci[oó]n|tabla|persistencia)\b/i],
  ["public_contract", /\b(public api|contract|dto|endpoint|event schema|breaking change|api p[uú]blica|contrato|esquema de evento|cambio incompatible)\b/i],
  ["sensitive_data", /\b(secret|credential|customer data|personal data|pii|secreto|credencial|datos? (?:de cliente|personales?|sensibles?))\b/i],
  ["remote_operation", /\b(deploy|production|remote infrastructure|despliegue|producci[oó]n|infraestructura remota)\b/i],
];

function classifyRoute(input) {
  const text = [input.objective, ...(input.paths || [])].join(" ");
  const reasons = [];
  for (const [reason, pattern] of SENSITIVE_PATTERNS) if (pattern.test(text)) reasons.push(reason);
  for (const signal of input.signals || []) if (!reasons.includes(signal)) reasons.push(signal);
  const files = Number.isInteger(input.changed_files) ? input.changed_files : 0;
  const sensitive = reasons.some((reason) => ["authentication", "persistence", "public_contract", "sensitive_data", "remote_operation", "destructive"].includes(reason));
  // A bounded UI-to-mapper change can cross layers without requiring an architectural plan.
  const needsPlan = reasons.some((reason) => ["ambiguous", "dependencies", "new_dependency"].includes(reason));

  if (sensitive) {
    const planning = needsPlan ? ["pulso-planner"] : [];
    const auditors = [];
    const verification = reasons.some((reason) => ["validation_gap", "contradictory_evidence"].includes(reason)) ? ["pulso-verifier"] : [];
    if (reasons.some((reason) => ["authentication", "sensitive_data", "remote_operation", "destructive"].includes(reason))) auditors.push("pulso-security-auditor");
    if (reasons.some((reason) => ["public_contract", "cross_layer", "persistence"].includes(reason))) auditors.push("pulso-integration-auditor");
    return { route: "sensitive", specialists: [...planning, "pulso-executor", ...verification, ...auditors], reasons };
  }
  if (needsPlan) return { route: "planned", specialists: ["pulso-planner", "pulso-executor"], reasons };
  if (reasons.some((reason) => ["cross_layer", "validation_gap", "contradictory_evidence"].includes(reason))) {
    return { route: "normal", specialists: ["pulso-executor", "pulso-verifier"], reasons };
  }
  return { route: "fast", specialists: ["pulso-executor"], reasons: files > 8 ? ["large_but_clear_change"] : ["bounded_change"] };
}

function isExpired(lease, now = Date.now()) {
  if (lease?.status !== "active") return false;
  const expiresAt = Date.parse(lease.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

const SKILL_DIGESTS = Object.freeze({
  "bbva-engineering": ["Preserve repository patterns and module boundaries.", "Do not expose sensitive data or operate on external environments without approval."],
  "bbva-apx": ["Respect APX deployment-unit structure and transaction/DTO/library contracts.", "Use repository Maven modules and existing APX conventions as authority."],
  "bbva-apx-testing": ["Use the established APX test suite and module-scoped Maven commands.", "Do not weaken assertions, suites, coverage, or framework configuration to pass."],
  "bbva-cells": ["Preserve Lit/Cells lifecycle, event, data-manager, and declarative-page patterns.", "Do not introduce a foreign frontend framework or bypass existing components."],
  "bbva-cells-testing": ["Use the repository's Vitest/Open Web Components patterns and existing fixtures.", "Cover observable component states and events without replacing real contracts with loose mocks."],
});

function skillDigest(skills) {
  return (skills || []).map((name) => ({ name, rules: SKILL_DIGESTS[name] || [], full_skill_required: !SKILL_DIGESTS[name] }));
}

module.exports = { classifyRoute, isExpired, skillDigest };
