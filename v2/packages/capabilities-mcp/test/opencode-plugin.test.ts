import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NativeJournal,
  rejectedNativeReceiptHash,
} from "../src/opencode/native-journal";
import PulsoNativeBridge, {
  findDurableTaskCorrelation,
  isNativeManagedTaskCandidate,
  pulsoDataDirectoryOverride,
} from "../src/opencode/plugin";

test("native OpenCode bridge exposes one plugin entrypoint", () => {
  expect(typeof PulsoNativeBridge).toBe("function");
});

test("PULSO_DATA_DIR is an absolute infrastructure override only", () => {
  expect(pulsoDataDirectoryOverride(undefined)).toBeUndefined();
  expect(pulsoDataDirectoryOverride("/tmp/pulso-fixture-data")).toBe(
    "/tmp/pulso-fixture-data",
  );
  expect(() => pulsoDataDirectoryOverride("relative/pulso-data")).toThrow(
    "PULSO_DATA_DIR_MUST_BE_ABSOLUTE",
  );
});

test("C01: every canonical specialist selector is a managed candidate without a marker", () => {
  for (const subagent_type of [
    "planner",
    "explorer",
    "executor",
    "verifier",
    "security-auditor",
  ])
    expect(
      isNativeManagedTaskCandidate({
        description: "unprepared canonical specialist task",
        subagent_type,
        prompt: "ordinary host prompt",
      }),
    ).toBe(true);
});

test("C04: a current Work never captures an external noncanonical selector", () => {
  expect(
    isNativeManagedTaskCandidate({
      description: "external host task in a session with current Work",
      subagent_type: "external-agent",
      prompt: "ordinary host prompt",
    }),
  ).toBe(false);
});

test("a Pulso marker or durable delegation, call, or task wire selects the native bridge", () => {
  expect(
    isNativeManagedTaskCandidate({
      description: "false Pulso marker",
      subagent_type: "custom-agent",
      prompt: '<pulso-task v="2">tampered</pulso-task>',
    }),
  ).toBe(true);
  expect(
    isNativeManagedTaskCandidate(
      {
        description: "prepared task with marker removed",
        subagent_type: "explorer",
        prompt: "tampered host prompt",
      },
      { preparedTaskWire: true },
    ),
  ).toBe(true);
  expect(
    isNativeManagedTaskCandidate(
      {
        description: "prepared task with marker removed",
        subagent_type: "explorer",
        prompt: "ordinary host prompt",
      },
      { nativeDelegation: true },
    ),
  ).toBe(true);
});

test("C08: a restarted bridge resolves a durable correlated call and its rejection receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-plugin-restart-"));
  const path = join(root, "runtime-bindings.db");
  const first = new NativeJournal(path);
  let restarted: NativeJournal | undefined;
  try {
    await first.createPreparation({
      delegationId: "delegation",
      workspaceId: "workspace",
      parentSessionId: "parent",
      requestMessageId: "message",
      requestHash: "request",
      workId: "work",
      workItemId: "item",
      specialist: "explorer",
      taskWire: '<pulso-task v="2">prepared</pulso-task>',
      taskHash: "task",
      preparedAt: "2026-01-01T00:00:00.000Z",
      preparationExpiresAt: "2026-01-01T00:02:00.000Z",
    });
    const claimed = await first.claim({
      delegationId: "delegation",
      workspaceId: "workspace",
      parentSessionId: "parent",
      parentCallId: "call",
      ownerInstanceId: "before-restart",
      now: "2026-01-01T00:00:01.000Z",
      deadlineAt: "2026-01-01T00:30:01.000Z",
    });
    const rawResultHash = "raw-invalid-host-result";
    const receiptHash = rejectedNativeReceiptHash({
      delegationId: claimed.delegationId,
      stage: "protocol_schema",
      code: "PROTOCOL_VERSION_MISMATCH",
      rawResultHash,
    });
    const captured = await first.captureRejection({
      delegationId: claimed.delegationId,
      ownerInstanceId: "before-restart",
      version: claimed.version,
      stage: "protocol_schema",
      code: "PROTOCOL_VERSION_MISMATCH",
      rawResultHash,
      paths: ["protocol"],
      ids: {
        delegationId: claimed.delegationId,
        specialist: "explorer",
        workId: "work",
        workItemId: "item",
      },
    });
    await first.finishReceipt({
      delegationId: captured.delegationId,
      ownerInstanceId: "before-restart",
      version: captured.version,
      phase: "rejected",
      receiptJson: captured.receiptJson,
      errorJson: captured.errorJson,
    });
    first.close();

    restarted = new NativeJournal(path);
    const correlation = await findDurableTaskCorrelation(
      restarted,
      "workspace",
      "parent",
      "call",
      {
        description: "host call without a Pulso marker after restart",
        subagent_type: "external-agent",
        prompt: "ordinary host prompt",
      },
    );
    expect(correlation).toEqual({ nativeCall: true });
    expect(
      isNativeManagedTaskCandidate(
        {
          description: "host call without a Pulso marker after restart",
          subagent_type: "external-agent",
          prompt: "ordinary host prompt",
        },
        correlation,
      ),
    ).toBe(true);
    expect(await restarted.get("delegation")).toMatchObject({
      receiptPhase: "rejected",
      receiptHash,
      receiptJson: expect.stringContaining(rawResultHash),
    });
  } finally {
    restarted?.close();
    try {
      first.close();
    } catch {
      // The first process deliberately closed before reopening the durable DB.
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("reference markers fail closed even with a noncanonical selector", () => {
  expect(
    isNativeManagedTaskCandidate({
      description: "not an external task",
      subagent_type: "external-agent",
      prompt: "pulso-dispatch/1:malformed",
    }),
  ).toBe(true);
  expect(
    isNativeManagedTaskCandidate({
      description: "ordinary external task",
      subagent_type: "external-agent",
      prompt: "ordinary text",
    }),
  ).toBe(false);
});
