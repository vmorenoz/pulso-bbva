import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityCatalog } from "../src/opencode/capability-catalog";
import {
  PreferenceConflictError,
  PreferenceService,
} from "../src/opencode/preference-service";
import {
  buildSessionContext,
  compactSessionContext,
  loadPulsoRules,
} from "../src/opencode/session-context";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test("project preferences use trusted message provenance, CAS revisions, and tombstones", () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-preferences-"));
  const service = new PreferenceService(join(root, "preferences.db"));
  try {
    const provenance = { messageId: "host-message-1", role: "user" as const };
    const saved = service.set({
      workspaceId: "project-a",
      key: "search",
      value: { preferred: "tool-fake", fallback: "native" },
      expectedRevision: 0,
      provenance,
    });
    expect(saved).toMatchObject({
      revision: 1,
      sourceMessageId: "host-message-1",
      scope: "project",
      status: "active",
    });
    expect(() =>
      service.set({
        workspaceId: "project-a",
        key: "search",
        value: "bad",
        expectedRevision: 0,
        provenance,
      }),
    ).toThrow(PreferenceConflictError);
    expect(() =>
      service.set({
        workspaceId: "project-a",
        key: "other",
        value: "x",
        expectedRevision: 0,
        provenance: { messageId: "forged", role: "assistant" } as never,
      }),
    ).toThrow("TRUSTED_USER_MESSAGE_REQUIRED");
    service.set({
      workspaceId: "project-a",
      key: "global-choice",
      value: "explicit",
      expectedRevision: 0,
      scope: "global",
      provenance,
    });
    service.propose({
      workspaceId: "project-a",
      key: "inferred",
      value: "candidate",
      reason: "Repeated request",
      expectedRevision: 0,
    });
    expect(service.get("project-a", "inferred")?.status).toBe("proposed");
    expect(
      service
        .list("project-a")
        .some((item) => item.key === "inferred" && item.status === "active"),
    ).toBe(false);
    const removed = service.remove({
      workspaceId: "project-a",
      key: "search",
      expectedRevision: 1,
      provenance: { messageId: "host-message-2", role: "user" },
    });
    expect(removed).toMatchObject({ revision: 2, status: "removed" });
    expect(service.get("project-a", "search")).toBeUndefined();
    expect(service.get("project-b", "search")).toBeUndefined();
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC25: explicit PULSO.md loader supports absent file, session reload, and compact continuity", () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-ac25-"));
  const service = new PreferenceService(join(root, "data", "preferences.db"));
  try {
    writeFileSync(join(root, "PULSO.md"), "Use concise answers.\n");
    const saved = service.set({
      workspaceId: "project",
      key: "style",
      value: "concise",
      expectedRevision: 0,
      provenance: { messageId: "m1", role: "user" },
    });
    const make = (sessionId: string) =>
      buildSessionContext({
        identity: { workspaceId: "project", workspaceRoot: root, sessionId },
        preferences: service,
        capabilities: new CapabilityCatalog(),
      });
    const first = make("session-one");
    const next = make("session-two");
    expect(first?.rules).toMatchObject({
      hash: sha("Use concise answers.\n"),
      content: "Use concise answers.\n",
    });
    expect(next?.preferences).toContainEqual(
      expect.objectContaining({ key: "style", revision: saved.revision }),
    );
    expect(
      compactSessionContext({
        pendingBranches: ["branch-a"],
        decisions: ["hold"],
        preferenceRevision: 1,
        rulesHash: first?.rules?.hash,
      }),
    ).toMatchObject({ preferenceRevision: 1, rulesHash: first?.rules?.hash });
    rmSync(join(root, "PULSO.md"));
    expect(loadPulsoRules(root)).toEqual({ status: "absent" });
    expect(make("session-without-rules")).toMatchObject({
      rulesStatus: "absent",
      preferences: [expect.objectContaining({ key: "style" })],
    });
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(false);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("AC26: foreign instruction files remain byte-identical and are not loaded or imported", () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-ac26-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  const agents = "external agents bytes\n",
    claude = "external claude bytes\n",
    pulso = "Pulso-owned rule\n";
  writeFileSync(join(repo, "AGENTS.md"), agents);
  writeFileSync(join(repo, "CLAUDE.md"), claude);
  writeFileSync(join(repo, "PULSO.md"), pulso);
  const service = new PreferenceService(join(root, "preferences.db"));
  try {
    const rules = loadPulsoRules(repo);
    expect(rules).toMatchObject({
      status: "loaded",
      content: pulso,
      hash: sha(pulso),
    });
    expect(service.list("project")).toEqual([]);
    service.set({
      workspaceId: "project",
      key: "explicit",
      value: true,
      expectedRevision: 0,
      provenance: { messageId: "trusted", role: "user" },
    });
    expect(readFileSync(join(repo, "AGENTS.md"), "utf8")).toBe(agents);
    expect(readFileSync(join(repo, "CLAUDE.md"), "utf8")).toBe(claude);
    expect(service.list("project").map((item) => item.key)).toEqual([
      "explicit",
    ]);
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("unverified session identity gets no project snapshot", () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-identity-"));
  const service = new PreferenceService(join(root, "preferences.db"));
  try {
    expect(
      buildSessionContext({
        preferences: service,
        capabilities: new CapabilityCatalog(),
      }),
    ).toBeUndefined();
  } finally {
    service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
