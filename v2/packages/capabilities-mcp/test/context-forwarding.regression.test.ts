import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTaskEnvelope } from "../../orchestration/src";
import { bootstrapCapabilities } from "../src/bootstrap";
import { NativeDelegationService } from "../src/opencode/native-delegation-service";
import { NativeJournal } from "../src/opencode/native-journal";
import {
  type NativeSession,
  NativeWorkService,
} from "../src/opencode/native-work-service";
import type { OpenCodeTransport } from "../src/opencode/opencode-port";

test("preparation preserves nested facts and references in the durable task", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-context-regression-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const port: OpenCodeTransport = {
    async observeCall() {
      return {
        status: "unknown",
        parentSessionId: "parent",
        parentCallId: "call",
        background: false,
        metadataObserved: false,
      };
    },
    async readChild() {
      return undefined;
    },
    async abortChild() {
      throw new Error("No child should be started by prepare");
    },
  };
  const work = new NativeWorkService(runtime, journal);
  const service = new NativeDelegationService(
    runtime,
    journal,
    port,
    "instance",
    work,
  );
  try {
    await work.execute(
      {
        action: "open",
        intent: "new",
        objective: "Preserve delegated context",
      },
      session,
    );
    const expected = {
      facts: ["Only plan; do not implement tests."],
      references: [
        {
          kind: "file" as const,
          ref: "src/total.ts:1-12",
          note: "verified source",
        },
      ],
    };
    const result = await service.prepare(
      {
        specialist: "planner",
        objective: "Prepare an evidence-backed plan",
        context: expected,
        acceptanceCriteria: ["Preserve authorization boundary"],
      },
      session,
    );
    const durable = await journal.get(result.delegationId);
    expect(durable).toBeDefined();
    expect(parseTaskEnvelope(durable!.taskWire).context).toEqual(expected);
    expect((await runtime.store.read()).executions).toHaveLength(0);
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
