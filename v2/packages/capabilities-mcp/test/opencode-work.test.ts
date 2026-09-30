import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapCapabilities } from "../src/bootstrap";
import type { NativeWorkInput } from "../src/opencode/facade-contracts";
import { NativeJournal } from "../src/opencode/native-journal";
import {
  type NativeSession,
  NativeWorkService,
} from "../src/opencode/native-work-service";

const hasWork = (
  value: unknown,
): value is { workId: string; objective: string; reused: boolean } =>
  typeof value === "object" &&
  value !== null &&
  "workId" in value &&
  "objective" in value &&
  "reused" in value;

test("native Work continuity is scoped to its verified parent session", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-work-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const service = new NativeWorkService(runtime, journal);
  const first: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent-a",
    messageId: "message-a",
    agent: "pulso",
  };
  const second: NativeSession = {
    ...first,
    parentSessionId: "parent-b",
    messageId: "message-b",
  };
  try {
    const open: NativeWorkInput = {
      action: "open",
      intent: "new",
      objective: "Inspect the scoped current Work",
    };
    const created = await service.execute(open, first);
    if (!hasWork(created)) throw new Error("NATIVE_WORK_OPEN_FAILED");
    expect(created.reused).toBe(false);
    expect((await service.get(second)).currentWork).toBeNull();

    const continued: NativeWorkInput = {
      action: "open",
      intent: "continue",
      objective: "This text must not replace the prior objective",
    };
    const reused = await service.execute(continued, first);
    if (!hasWork(reused)) throw new Error("NATIVE_WORK_CONTINUE_FAILED");
    expect(reused.reused).toBe(true);
    expect(reused.workId).toBe(created.workId);
    expect(reused.objective).toBe(open.objective);

    const useOther: NativeWorkInput = { action: "use", workId: created.workId };
    await expect(service.execute(useOther, second)).rejects.toMatchObject({
      code: "WORK_SESSION_OWNERSHIP",
    });
  } finally {
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
