"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../lib/pulso-experience-core.js");

test("validates an evidence-backed technical memory", () => {
  assert.equal(core.validMemory({
    context: "APX integration suite configuration",
    trap: "The transaction is not discovered by the suite automatically",
    rule: "Register the transaction explicitly in the suite configuration",
    evidence: ["SuiteTest.java:18"],
  }), true);
});

test("rejects generic or sensitive memories", () => {
  assert.equal(core.validMemory({ context: "Be careful", trap: "Tests fail", rule: "Run tests", evidence: ["x"] }), false);
  assert.equal(core.validMemory({ context: "APX configuration detail", trap: "Bearer secret leaked", rule: "Register suite safely", evidence: ["x"] }), false);
});

test("limits recall to three concise results", () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `EXP-${index}`, scope: "project", context: "Context long enough", trap: "Trap long enough", rule: "Rule long enough", tags: "[]", evidence: "[]",
  }));
  assert.equal(core.conciseResults(rows).length, 3);
});
