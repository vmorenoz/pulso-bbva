"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../lib/pulso-control-core.js");

test("routes a bounded change directly to executor", () => {
  assert.deepEqual(core.classifyRoute({ objective: "Rename one local variable", paths: ["src/a.js"] }).specialists, ["pulso-executor"]);
});

test("routes authentication work through sensitive specialists", () => {
  const result = core.classifyRoute({ objective: "Change authentication token validation", paths: ["src/auth.js"] });
  assert.equal(result.route, "sensitive");
  assert.ok(result.specialists.includes("pulso-security-auditor"));
  assert.deepEqual(result.specialists, ["pulso-executor", "pulso-security-auditor"]);
});

test("routes clear cross-layer work through execution and verification", () => {
  const route = core.classifyRoute({ objective: "Connect form to mapper", signals: ["cross_layer"] });
  assert.equal(route.route, "normal");
  assert.deepEqual(route.specialists, ["pulso-executor", "pulso-verifier"]);
});

test("does not mistake repository maintenance for persistence", () => {
  assert.equal(core.classifyRoute({ objective: "Update repository README typo", paths: ["README.md"] }).route, "fast");
});

test("detects sensitive objectives written in Spanish", () => {
  const result = core.classifyRoute({ objective: "Cambiar autenticación y datos personales", paths: ["src/auth.js"] });
  assert.equal(result.route, "sensitive");
  assert.ok(result.specialists.includes("pulso-security-auditor"));
});

test("does not require planning solely because a clear change touches many files", () => {
  assert.equal(core.classifyRoute({ objective: "Apply the same clear rename", changed_files: 12 }).route, "fast");
});

test("does not inflate a bounded fix route solely because the user requests a push", () => {
  const result = core.classifyRoute({ objective: "Fix one unit test and push the branch", paths: ["test/unit/example.test.js"] });
  assert.equal(result.route, "fast");
});

test("reroutes contradictory validation evidence through independent verification", () => {
  const result = core.classifyRoute({ objective: "Fix failing browser test", signals: ["contradictory_evidence"] });
  assert.equal(result.route, "normal");
  assert.deepEqual(result.specialists, ["pulso-executor", "pulso-verifier"]);
});

test("does not treat inspected paths as changed files", () => {
  const paths = Array.from({ length: 10 }, (_, index) => `src/file-${index}.js`);
  assert.equal(core.classifyRoute({ objective: "Locate one faulty state transition", paths }).route, "fast");
});

test("detects expired active leases", () => {
  assert.equal(core.isExpired({ status: "active", expires_at: "2020-01-01T00:00:00.000Z" }), true);
  assert.equal(core.isExpired({ status: "released", expires_at: "2020-01-01T00:00:00.000Z" }), false);
});

test("creates compact known skill digests", () => {
  const [digest] = core.skillDigest(["bbva-apx"]);
  assert.equal(digest.name, "bbva-apx");
  assert.equal(digest.rules.length, 2);
  assert.equal(digest.full_skill_required, false);
});
