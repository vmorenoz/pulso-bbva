import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecutablePlan } from "../../orchestration/src/adaptive/types";
import type { CapabilitiesRuntime } from "../src/bootstrap";
import { ArtifactService } from "../src/opencode/artifact-service";
import type { NativeDelegation } from "../src/opencode/native-journal";

const inventory = {
  protocol: "pulso-inventory/1" as const,
  complete: true,
  universe: ["src/a.ts"],
  exclusions: [],
  entries: [
    {
      target: "src/a.ts",
      specs: [],
      evidenceLevel: "reviewed" as const,
      behaviors: ["returns a value"],
      evidence: [{ kind: "file" as const, ref: "src/a.ts" }],
    },
  ],
  limitations: [],
};

const readyPlan = (
  path: string,
  existence: "existing" | "new" = "existing",
): ExecutablePlan => ({
  protocol: "pulso-plan/1",
  status: "ready",
  title: "filesystem plan",
  inventoryComplete: true,
  targets: [
    {
      path,
      existence,
      evidence: [
        {
          kind: "file",
          ref: existence === "new" ? path : path,
          ...(existence === "new" ? { note: "Create new file" } : {}),
        },
      ],
      behaviors: ["Expected behavior"],
    },
  ],
  graph: {
    protocol: "pulso-graph/1",
    revision: 1,
    branches: [
      {
        key: "tests",
        objective: "Test behavior",
        deliverable: "Test",
        allowedEffects: ["read", "artifact"],
        criteria: [
          { key: "done", description: "Covered", evidenceRequired: true },
        ],
      },
    ],
    nodes: [
      {
        key: "plan",
        branch: "tests",
        specialist: "planner",
        objective: "Plan tests",
        dependsOn: [],
        effects: ["read", "artifact"],
        resources: [{ path: "tests", coverage: "subtree", access: "read" }],
        mode: "read",
        criteria: [
          { key: "done", description: "Covered", evidenceRequired: true },
        ],
        requiredCapabilities: [],
      },
    ],
  },
  unresolved: [],
});

function harness(
  root: string,
  specialist: "explorer" | "planner" = "explorer",
) {
  let delegation: NativeDelegation = {
    delegationId: "delegation-1",
    workspaceId: "workspace-1",
    parentSessionId: "parent-1",
    requestMessageId: "message-1",
    requestHash: "request-hash",
    workId: "work-1",
    workItemId: "item-1",
    specialist,
    taskWire: "wire",
    taskHash: "task-hash",
    preparedAt: "now",
    preparationExpiresAt: "later",
    transportPhase: "claimed",
    ownerInstanceId: "owner",
    parentCallId: "call",
    bindingId: "binding-1",
    sideEffectsMayContinue: false,
    receiptPhase: "none",
    version: 1,
  };
  let bindingStatus = "active";
  const artifacts: Array<{
    id: string;
    workId: string;
    itemId: string;
    type: string;
    uri: string;
    description: string;
  }> = [];
  let artifactCalls = 0;
  const runtime = {
    workspaceId: "workspace-1",
    runtimeBindings: {
      get: async () => ({
        bindingId: "binding-1",
        workId: "work-1",
        workItemId: "item-1",
        executorId: specialist,
        assigneeId: specialist,
        managedBy: "opencode-native",
        runtime: { provider: "opencode", executionId: "delegation-1" },
        status: bindingStatus,
      }),
    },
    work: {
      snapshot: async () => ({ items: [{ id: "item-1" }], artifacts }),
      artifact: async (input: Omit<(typeof artifacts)[number], "id">) => {
        artifactCalls++;
        const saved = { id: `artifact-${artifactCalls}`, ...input };
        artifacts.push(saved);
        return saved;
      },
    },
  } as unknown as CapabilitiesRuntime;
  const journal = {
    get: async (id: string) =>
      id === delegation.delegationId ? delegation : undefined,
    ownsWork: async (
      workspaceId: string,
      parentSessionId: string,
      workId: string,
    ) =>
      workspaceId === delegation.workspaceId &&
      parentSessionId === delegation.parentSessionId &&
      workId === delegation.workId,
  };
  return {
    service: () => new ArtifactService(runtime, root, journal),
    setAcceptedReceipt: () => {
      const result = {
        delegationId: "delegation-1",
        workId: "work-1",
        workItemId: "item-1",
      };
      delegation = {
        ...delegation,
        transportPhase: "closed",
        receiptPhase: "applied",
        resultHash: "result-hash",
        receiptHash: "accepted-hash",
        receiptJson: JSON.stringify({
          protocol: "pulso-receipt/1",
          accepted: true,
          delegationId: "delegation-1",
          resultHash: "result-hash",
          receiptHash: "accepted-hash",
          result: { ...result, specialist: "explorer" },
        }),
      };
      bindingStatus = "completed";
    },
    setRejectedReceipt: () => {
      delegation = {
        ...delegation,
        transportPhase: "closed",
        receiptPhase: "rejected",
        receiptHash: "rejected-hash",
        receiptJson: JSON.stringify({
          delegationId: "delegation-1",
          stage: "protocol_schema",
          code: "RESULT_REJECTED",
          rawResultHash: "raw",
          receiptHash: "rejected-hash",
          ids: {
            delegationId: "delegation-1",
            specialist: "explorer",
            workId: "work-1",
            workItemId: "item-1",
          },
        }),
      };
      bindingStatus = "failed";
    },
    artifactCount: () => artifactCalls,
    artifacts,
  };
}

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

test("restart restores staged artifact, reconciles durable accepted receipt, and replay registers once", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-artifacts-"));
  try {
    const h = harness(root);
    const staged = await h.service().publish("binding-1", inventory);
    expect(staged.state).toBe("staged");
    const restarted = h.service();
    const read = await restarted.read(staged.reference, "parent-1");
    expect(read.artifact.hash).toBe(staged.hash);
    expect(read.document).toEqual(inventory);
    await expect(
      restarted.read(staged.reference, "other-parent"),
    ).rejects.toThrow("ARTIFACT_OWNERSHIP_INVALID");
    h.setAcceptedReceipt();
    await expect(
      restarted.reconcileReceipt("delegation-1"),
    ).resolves.toMatchObject([
      {
        state: "accepted",
        receiptHash: "accepted-hash",
        artifactId: "artifact-1",
      },
    ]);
    await expect(
      h.service().reconcileReceipt("delegation-1"),
    ).resolves.toMatchObject([{ state: "accepted", artifactId: "artifact-1" }]);
    expect(h.artifactCount()).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects caller-forged receipt claims and durably rejects only a journal rejection", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-artifacts-receipt-"));
  try {
    const h = harness(root);
    const service = h.service();
    const staged = await service.publish("binding-1", inventory);
    await expect(
      service.applyDelegationReceipt({
        delegationId: "delegation-1",
        accepted: true,
        receiptHash: "forged",
      }),
    ).rejects.toThrow("ARTIFACT_RECEIPT_NOT_ACCEPTED");
    h.setRejectedReceipt();
    await expect(
      service.reconcileReceipt("delegation-1"),
    ).resolves.toMatchObject([
      { state: "rejected", receiptHash: "rejected-hash" },
    ]);
    await expect(
      h.service().read(staged.reference, "parent-1"),
    ).rejects.toThrow("ARTIFACT_NOT_FOUND");
    expect(h.artifactCount()).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a colliding preexisting artifact directory survives failed publication unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-artifacts-collision-"));
  try {
    const hash = createHash("sha256")
      .update(canonical(inventory))
      .digest("hex");
    const destination = join(
      root,
      ".pulso",
      "artifacts",
      "work-1",
      `inventory-r1-${hash.slice(0, 12)}`,
    );
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "keep.txt"), "preexisting bytes");
    await expect(
      harness(root).service().publish("binding-1", inventory),
    ).rejects.toThrow();
    await expect(readFile(join(destination, "keep.txt"), "utf8")).resolves.toBe(
      "preexisting bytes",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ready-plan filesystem gate verifies existing, missing, new, case and symlink targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "pulso-plan-fs-"));
  const outside = await mkdtemp(join(tmpdir(), "pulso-plan-outside-"));
  try {
    await mkdir(join(root, "src"));
    await mkdir(join(outside, "nested"));
    await writeFile(join(root, "src", "existing.test.ts"), "test");
    await writeFile(join(outside, "outside.test.ts"), "outside");
    await symlink(
      join(outside, "outside.test.ts"),
      join(root, "src", "linked.test.ts"),
    );
    await symlink(join(outside, "nested"), join(root, "linked-dir"));
    const service = harness(root).service();

    await expect(
      service.validatePlanReadiness(readyPlan("src/existing.test.ts")),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      harness(root, "planner")
        .service()
        .publish("binding-1", readyPlan("src/existing.test.ts")),
    ).resolves.toMatchObject({ kind: "plan", state: "staged" });
    await expect(
      service.validatePlanReadiness(readyPlan("src/missing.test.ts")),
    ).rejects.toThrow("PLAN_TARGET_NOT_FOUND");
    await expect(
      service.validatePlanReadiness(readyPlan("src/new.test.ts", "new")),
    ).resolves.toMatchObject({ status: "ready" });
    await expect(
      service.validatePlanReadiness(readyPlan("src/existing.test.ts", "new")),
    ).rejects.toThrow("PLAN_NEW_TARGET_EXISTS");
    await expect(
      service.validatePlanReadiness(readyPlan("../outside.test.ts")),
    ).rejects.toThrow("RESOURCE_PATH_INVALID");
    await expect(
      service.validatePlanReadiness(readyPlan("src/linked.test.ts")),
    ).rejects.toThrow("PLAN_TARGET_OUTSIDE_WORKSPACE");
    await expect(
      service.validatePlanReadiness(readyPlan("linked-dir/new.test.ts", "new")),
    ).rejects.toThrow("PLAN_TARGET_OUTSIDE_WORKSPACE");
    await expect(
      service.validatePlanReadiness(readyPlan("src/Existing.test.ts")),
    ).rejects.toThrow("PLAN_TARGET_CASE_MISMATCH");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
