import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CapabilityCatalog,
  type CapabilityDescriptor,
  loadCapabilityDescriptors,
  permissionsForAgent,
  writeCapabilityDescriptors,
} from "../src/opencode/capability-catalog";

const approved = (
  overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor => ({
  id: "mcp:search",
  effects: ["read"],
  agents: ["explorer"],
  approvalSource: "explicit-user-approval",
  approved: true,
  ...overrides,
});

test("capability axes are observations; use is recorded only by observed call", () => {
  let now = Date.parse("2026-01-01T00:00:00Z");
  const catalog = new CapabilityCatalog(() => now);
  catalog.observe({
    id: "mcp:search",
    source: "mcp",
    configured: true,
    discovered: true,
    permitted: "allow",
    health: "unprobed",
    used: false,
    observedAt: new Date(now).toISOString(),
    evidence: "listed by host",
  });
  expect(catalog.list()).toHaveLength(1);
  expect(catalog.list()[0]).toMatchObject({
    configured: true,
    discovered: true,
    permitted: "allow",
    health: "unprobed",
    used: false,
  });
  catalog.recordCall(
    "mcp:search",
    new Date(now).toISOString(),
    "tool call observed",
  );
  expect(catalog.list()[0]).toMatchObject({ used: true, health: "unprobed" });
  now += 60_001;
  expect(catalog.list()).toEqual([]);
  expect(catalog.list({ forceRefresh: true })).toHaveLength(1);
});

test("unknown and skill-documented capabilities never grant permissions or install", () => {
  const catalog = new CapabilityCatalog();
  catalog.observe({
    id: "skill:imaginary-tool",
    source: "skill",
    configured: false,
    discovered: false,
    permitted: "unknown",
    health: "unprobed",
    used: false,
    observedAt: new Date().toISOString(),
    evidence: "skill mentions it",
  });
  expect(catalog.descriptor("skill:imaginary-tool")).toBeUndefined();
  expect(catalog.isAuthorized("skill:imaginary-tool", "explorer")).toBe(false);
  expect(permissionsForAgent([], "explorer")).toEqual({});
  catalog.addApprovedDescriptor({
    id: "mcp:search",
    effects: ["read"],
    agents: ["explorer"],
    approvalSource: "explicit-admin-approval",
    approved: true,
  });
  expect(catalog.isAuthorized("mcp:search", "explorer")).toBe(false);
  catalog.observe({
    id: "mcp:search",
    source: "mcp",
    configured: true,
    discovered: true,
    permitted: "allow",
    health: "ok",
    used: false,
    observedAt: new Date().toISOString(),
  });
  expect(catalog.isAuthorized("mcp:search", "explorer")).toBe(true);
  expect(catalog.isAuthorized("mcp:search", "verifier")).toBe(false);
  const descriptor = catalog.descriptor("mcp:search");
  expect(descriptor).toBeDefined();
  expect(
    permissionsForAgent(
      descriptor ? [descriptor] : [],
      "explorer",
      catalog.list({ forceRefresh: true }),
    ),
  ).toEqual({ "mcp:search": "allow" });
});

test("capabilities.json round-trips explicit approvals with owner-only mode and absent means empty", () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-capabilities-"));
  const path = join(root, "capabilities.json");
  try {
    expect(loadCapabilityDescriptors(path)).toEqual([]);
    writeCapabilityDescriptors(path, [
      approved({
        agents: ["explorer", "planner"],
        effects: ["read", "search"],
      }),
    ]);
    const loaded = loadCapabilityDescriptors(path);
    expect(loaded).toEqual([
      approved({
        agents: ["explorer", "planner"],
        effects: ["read", "search"],
      }),
    ]);
    expect(readFileSync(path, "utf8")).toContain('"version": 1');
    const catalog = new CapabilityCatalog();
    expect(catalog.loadApprovedDescriptors(path)).toEqual(loaded);
    expect(catalog.isAuthorized("mcp:search", "explorer")).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("unknown, malformed, unapproved, deny, ask, and skill-only entries never allow", () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-capabilities-invalid-"));
  const path = join(root, "capabilities.json");
  const catalog = new CapabilityCatalog();
  try {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        descriptors: [
          { ...approved(), approved: false },
          { ...approved({ id: "mcp:malformed" }), agents: "explorer" },
          approved({ id: "mcp:valid" }),
        ],
      }),
    );
    chmodSync(path, 0o600);
    expect(catalog.loadApprovedDescriptors(path).map(({ id }) => id)).toEqual([
      "mcp:valid",
    ]);
    for (const permitted of ["deny", "ask", "unknown"] as const) {
      catalog.observe({
        id: "mcp:valid",
        source: "mcp",
        configured: true,
        discovered: true,
        permitted,
        health: "ok",
        used: false,
        observedAt: new Date().toISOString(),
      });
      expect(catalog.isAuthorized("mcp:valid", "explorer")).toBe(false);
      expect(catalog.permissionsForAgent("explorer")).toEqual({});
    }
    catalog.observe({
      id: "skill:mentioned-tool",
      source: "skill",
      configured: false,
      discovered: true,
      permitted: "allow",
      health: "ok",
      used: false,
      observedAt: new Date().toISOString(),
    });
    expect(catalog.isAuthorized("skill:mentioned-tool", "explorer")).toBe(
      false,
    );
    expect(catalog.isAuthorized("mcp:unlisted", "explorer")).toBe(false);
    writeFileSync(path, "{ malformed json");
    chmodSync(path, 0o600);
    expect(loadCapabilityDescriptors(path)).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("permission mapping is exact to approved agent scope and observed allow", () => {
  const descriptors = [
    approved(),
    approved({ id: "plugin:build", agents: ["executor"], effects: ["write"] }),
  ];
  const observations = [
    {
      id: "mcp:search",
      source: "mcp" as const,
      configured: true,
      discovered: true,
      permitted: "allow" as const,
      health: "ok" as const,
      used: false,
      observedAt: new Date().toISOString(),
    },
    {
      id: "plugin:build",
      source: "plugin" as const,
      configured: true,
      discovered: true,
      permitted: "ask" as const,
      health: "ok" as const,
      used: false,
      observedAt: new Date().toISOString(),
    },
  ];
  expect(permissionsForAgent(descriptors, "explorer", observations)).toEqual({
    "mcp:search": "allow",
  });
  expect(permissionsForAgent(descriptors, "executor", observations)).toEqual(
    {},
  );
  expect(permissionsForAgent(descriptors, "verifier", observations)).toEqual(
    {},
  );
});
