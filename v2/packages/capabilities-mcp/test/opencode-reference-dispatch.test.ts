import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseTaskEnvelope,
  serializeAgentResult,
  serializeTaskEnvelope,
} from "../../orchestration/src";
import { bootstrapCapabilities } from "../src/bootstrap";
import { NativeDelegationService } from "../src/opencode/native-delegation-service";
import { renderNativeDispatchReference } from "../src/opencode/native-dispatch-reference";
import { NativeJournal } from "../src/opencode/native-journal";
import {
  type NativeSession,
  NativeWorkService,
} from "../src/opencode/native-work-service";
import type { OpenCodeTransport } from "../src/opencode/opencode-port";
import { findDurableTaskCorrelation } from "../src/opencode/plugin";

const fixture = async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-ref-dispatch-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport: OpenCodeTransport = {
    async observeCall() {
      return {
        status: "running",
        parentSessionId: "parent",
        parentCallId: "call",
        background: false,
        metadataObserved: false,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  };
  const work = new NativeWorkService(runtime, journal);
  const service = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance",
    work,
  );
  try {
    await work.execute(
      { action: "open", intent: "new", objective: "Test reference dispatch" },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Inspect total.ts without edits",
        acceptanceCriteria: ["Return real source findings"],
      },
      session,
    );
    const stored = await journal.get(prepared.delegationId);
    if (!stored) throw new Error("TEST_PREPARATION_MISSING");
    return {
      root,
      runtime,
      journal,
      session,
      service,
      prepared,
      stored,
      async close() {
        await service.dispose();
        journal.close();
        runtime.close();
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
};
const noExecution = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const state = await f.runtime.store.read();
  expect(state.executions).toHaveLength(0);
  expect(state.leases).toHaveLength(0);
  expect(
    (await f.journal.get(f.prepared.delegationId))?.bindingId,
  ).toBeUndefined();
};

test("REF1: real preparation -> same host args hydrated -> receipt and released lease", async () => {
  const f = await fixture();
  try {
    expect(f.prepared.dispatchAllowed).toBe(true);
    expect(f.prepared.nativeTaskArgs.prompt).toBe(
      renderNativeDispatchReference(f.prepared.delegationId),
    );
    const args = {
      ...f.prepared.nativeTaskArgs,
      description: "Investiga contrato total",
    };
    const sameObject = args;
    expect(
      await f.service.before({ sessionID: "parent", callID: "call" }, args),
    ).toBe(true);
    expect(args).toBe(sameObject);
    expect(args.prompt).toBe(f.stored.taskWire);
    expect(args.description).toBe("Pulso explorer task");
    expect(parseTaskEnvelope(args.prompt).delegationId).toBe(
      f.prepared.delegationId,
    );
    const output = {
      output: `<task id="child" state="completed"><task_result>${serializeAgentResult(
        {
          protocol: "pulso-result/2",
          delegationId: f.prepared.delegationId,
          specialist: "explorer",
          workId: f.prepared.workId,
          workItemId: f.prepared.workItemId,
          status: "completed",
          summary: "Fixture inspected",
          specialistResult: { kind: "explorer", findings: [] },
        },
      )}</task_result></task>`,
      metadata: {
        parentSessionId: "parent",
        sessionId: "child",
        model: { providerID: "scripted", modelID: "scripted" },
      },
    };
    await f.service.after(
      { sessionID: "parent", callID: "call" },
      output,
      true,
    );
    const receipt = JSON.parse(output.output);
    expect(receipt.accepted).toBe(true);
    expect(receipt.state.authority.executionStatus).toBe("completed");
    expect(receipt.state.authority.leaseStatus).toBe("released");
    await expect(
      f.service.before({ sessionID: "parent", callID: "call" }, args),
    ).rejects.toMatchObject({ code: "NATIVE_DISPATCH_REPLAY" });
    expect((await f.runtime.store.read()).executions).toHaveLength(1);
  } finally {
    await f.close();
  }
});

test("REF2: wrong session, selector, missing reference and extra controls never bind", async () => {
  const f = await fixture();
  try {
    const cases = [
      {
        sessionID: "other-parent",
        args: { ...f.prepared.nativeTaskArgs },
        code: "IDENTITY_MISMATCH",
      },
      {
        sessionID: "parent",
        args: { ...f.prepared.nativeTaskArgs, subagent_type: "executor" },
        code: "IDENTITY_MISMATCH",
      },
      {
        sessionID: "parent",
        args: {
          ...f.prepared.nativeTaskArgs,
          prompt: renderNativeDispatchReference(crypto.randomUUID()),
        },
        code: "PREPARATION",
      },
      {
        sessionID: "parent",
        args: {
          ...f.prepared.nativeTaskArgs,
          prompt: `${f.prepared.nativeTaskArgs.prompt}\nextra`,
        },
        code: "PREPARATION_REFERENCE_INVALID",
      },
      {
        sessionID: "parent",
        args: { ...f.prepared.nativeTaskArgs, background: false },
        code: "NATIVE_DISPATCH",
      },
      {
        sessionID: "parent",
        args: { ...f.prepared.nativeTaskArgs, unexpected: "value" },
        code: "NATIVE_DISPATCH",
      },
    ];
    for (const c of cases) {
      await expect(
        f.service.before({ sessionID: c.sessionID, callID: "call" }, c.args),
      ).rejects.toMatchObject({ code: c.code });
      await noExecution(f);
    }
  } finally {
    await f.close();
  }
});

test("REF3: concurrent calls consume one preparation at most once", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled(
      ["one", "two"].map((callID) =>
        f.service.before(
          { sessionID: "parent", callID },
          { ...f.prepared.nativeTaskArgs },
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect((await f.runtime.store.read()).executions).toHaveLength(1);
  } finally {
    await f.close();
  }
});

for (const mode of ["hash", "identity"] as const) {
  test(`REF4: tampered persisted ${mode} never authorizes dispatch`, async () => {
    const f = await fixture();
    try {
      const db = new Database(f.runtime.runtimeBindings.databasePath);
      try {
        if (mode === "hash") {
          db.query(
            "UPDATE native_delegations SET task_hash=? WHERE delegation_id=?",
          ).run("bad", f.prepared.delegationId);
        } else {
          const envelope = parseTaskEnvelope(f.stored.taskWire);
          const wire = serializeTaskEnvelope({
            ...envelope,
            work: { ...envelope.work, workId: "wrong" },
          });
          const hash = createHash("sha256")
            .update(JSON.stringify(wire))
            .digest("hex");
          db.query(
            "UPDATE native_delegations SET task_wire=?, task_hash=? WHERE delegation_id=?",
          ).run(wire, hash, f.prepared.delegationId);
        }
      } finally {
        db.close();
      }
      await expect(
        f.service.before(
          { sessionID: "parent", callID: "call" },
          { ...f.prepared.nativeTaskArgs },
        ),
      ).rejects.toMatchObject({
        code: mode === "hash" ? "PREPARATION_INTEGRITY" : "IDENTITY_MISMATCH",
      });
      await noExecution(f);
    } finally {
      await f.close();
    }
  });
}

test("REF5: expired preparation stays nondispatchable", async () => {
  const f = await fixture();
  try {
    await f.journal.expirePreparations(
      new Date(Date.now() + 180_000).toISOString(),
    );
    await expect(
      f.service.before(
        { sessionID: "parent", callID: "call" },
        { ...f.prepared.nativeTaskArgs },
      ),
    ).rejects.toMatchObject({ code: "PREPARATION_EXPIRED" });
    await noExecution(f);
  } finally {
    await f.close();
  }
});

test("REF6: a reopened journal resolves an owned reference, not a foreign session", async () => {
  const f = await fixture();
  const reopened = new NativeJournal(f.runtime.runtimeBindings.databasePath);
  try {
    expect(
      await findDurableTaskCorrelation(
        reopened,
        f.runtime.workspaceId,
        "parent",
        "call",
        f.prepared.nativeTaskArgs,
      ),
    ).toEqual({ nativeDelegation: true });
    expect(
      await findDurableTaskCorrelation(
        reopened,
        f.runtime.workspaceId,
        "foreign",
        "call",
        f.prepared.nativeTaskArgs,
      ),
    ).toBeUndefined();
    expect(
      await findDurableTaskCorrelation(
        reopened,
        "foreign-workspace",
        "parent",
        "call",
        f.prepared.nativeTaskArgs,
      ),
    ).toBeUndefined();
  } finally {
    reopened.close();
    await f.close();
  }
});
