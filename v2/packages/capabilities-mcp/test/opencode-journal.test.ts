import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NativeJournal } from "../src/opencode/native-journal";

const preparation = (
  delegationId: string,
  specialist: "executor" | "explorer" | "planner" | "verifier",
) => ({
  delegationId,
  workspaceId: "workspace",
  parentSessionId: "parent",
  requestMessageId: `${delegationId}-message`,
  requestHash: `${delegationId}-request`,
  workId: "work",
  workItemId: `${delegationId}-item`,
  specialist,
  taskWire: `<pulso-task v="2">${delegationId}</pulso-task>`,
  taskHash: `${delegationId}-task`,
  preparedAt: "2026-01-01T00:00:00.000Z",
  preparationExpiresAt: "2026-01-01T00:02:00.000Z",
});

test("native journal keeps session membership and atomically limits shell specialists", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-journal-"));
  const journal = new NativeJournal(join(root, "runtime-bindings.db"));
  try {
    await journal.associateWork({
      workspaceId: "workspace",
      parentSessionId: "parent",
      workId: "work",
      associatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await journal.currentWork("workspace", "parent")).toBe("work");
    expect(await journal.ownsWork("workspace", "parent", "work")).toBe(true);

    const first = await journal.createPreparation(
      preparation("delegation-a", "executor"),
    );
    await journal.createPreparation(preparation("delegation-b", "verifier"));
    await journal.claim({
      delegationId: first.delegationId,
      workspaceId: "workspace",
      parentSessionId: "parent",
      parentCallId: "call-a",
      ownerInstanceId: "instance-a",
      now: "2026-01-01T00:00:01.000Z",
      deadlineAt: "2026-01-01T00:30:01.000Z",
    });
    const replay = await journal.claim({
      delegationId: first.delegationId,
      workspaceId: "workspace",
      parentSessionId: "parent",
      parentCallId: "call-a",
      ownerInstanceId: "instance-a",
      now: "2026-01-01T00:00:01.000Z",
      deadlineAt: "2026-01-01T00:30:01.000Z",
    });
    expect(replay.dispatchAllowed).toBe(false);
    expect(replay.parentCallId).toBe("call-a");
    await expect(
      journal.claim({
        delegationId: "delegation-b",
        workspaceId: "workspace",
        parentSessionId: "parent",
        parentCallId: "call-b",
        ownerInstanceId: "instance-b",
        now: "2026-01-01T00:00:01.000Z",
        deadlineAt: "2026-01-01T00:30:01.000Z",
      }),
    ).rejects.toThrow("SHELL_SPECIALIST_LIMIT");
  } finally {
    journal.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("request hash distinguishes read preparations from the same Pulso message", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-journal-reads-"));
  const journal = new NativeJournal(join(root, "runtime-bindings.db"));
  try {
    const explorer = {
      ...preparation("read-explorer", "explorer"),
      requestMessageId: "message",
      requestHash: "explorer-input-hash",
    };
    const planner = {
      ...preparation("read-planner", "planner"),
      requestMessageId: "message",
      requestHash: "planner-input-hash",
    };
    const first = await journal.createPreparation(explorer);
    const second = await journal.createPreparation(planner);
    const replay = await journal.createPreparation({
      ...explorer,
      delegationId: "different-generated-id-is-not-a-new-request",
    });
    expect(first.delegationId).toBe("read-explorer");
    expect(second.delegationId).toBe("read-planner");
    expect(replay.delegationId).toBe(first.delegationId);
    expect(
      (await journal.list("workspace", "parent"))
        .map((item) => item.delegationId)
        .sort(),
    ).toEqual(["read-explorer", "read-planner"]);
  } finally {
    journal.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an expired preparation remains a durable tombstone and cannot dispatch after recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-journal-expired-"));
  const journal = new NativeJournal(join(root, "runtime-bindings.db"));
  try {
    await journal.createPreparation({
      ...preparation("expired-explorer", "explorer"),
      preparationExpiresAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await journal.expirePreparations("2026-01-01T00:00:01.000Z")).toBe(
      1,
    );
    expect(await journal.get("expired-explorer")).toMatchObject({
      transportPhase: "expired",
    });
    await expect(
      journal.claim({
        delegationId: "expired-explorer",
        workspaceId: "workspace",
        parentSessionId: "parent",
        parentCallId: "recovery-call",
        ownerInstanceId: "restarted-instance",
        now: "2026-01-01T00:00:02.000Z",
        deadlineAt: "2026-01-01T00:30:02.000Z",
      }),
    ).rejects.toThrow("PREPARATION_ALREADY_CONSUMED");
  } finally {
    journal.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("two SQLite journal instances fence an old owner without releasing its shell claim", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-journal-restart-"));
  const path = join(root, "runtime-bindings.db");
  const first = new NativeJournal(path);
  const second = new NativeJournal(path);
  try {
    await first.createPreparation(preparation("restart-executor", "executor"));
    const claimed = await first.claim({
      delegationId: "restart-executor",
      workspaceId: "workspace",
      parentSessionId: "parent",
      parentCallId: "call",
      ownerInstanceId: "instance-before-restart",
      now: "2026-01-01T00:00:01.000Z",
      deadlineAt: "2026-01-01T00:30:01.000Z",
    });
    const adopted = await second.adoptClaim({
      delegationId: claimed.delegationId,
      workspaceId: "workspace",
      parentSessionId: "parent",
      parentCallId: "call",
      ownerInstanceId: "instance-after-restart",
    });
    expect(adopted).toMatchObject({
      ownerInstanceId: "instance-after-restart",
      transportPhase: "claimed",
    });
    await expect(
      first.observe({
        delegationId: adopted.delegationId,
        ownerInstanceId: "instance-before-restart",
        version: adopted.version,
        observedAt: "2026-01-01T00:00:02.000Z",
      }),
    ).rejects.toThrow("CLAIM_OWNERSHIP_LOST");
    const renewed = await second.recordHeartbeat({
      delegationId: adopted.delegationId,
      ownerInstanceId: "instance-after-restart",
      version: adopted.version,
      renewedAt: "2026-01-01T00:01:01.000Z",
    });
    expect(renewed.lastHeartbeatAt).toBe("2026-01-01T00:01:01.000Z");
    expect(renewed.transportPhase).toBe("claimed");
  } finally {
    second.close();
    first.close();
    rmSync(root, { recursive: true, force: true });
  }
});
