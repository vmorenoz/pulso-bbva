import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentResult,
  parseTaskEnvelope,
  serializeAgentResult,
  serializeTaskEnvelope,
} from "../../orchestration/src";
import { bootstrapCapabilities } from "../src/bootstrap";
import { nativePolicy } from "../src/opencode/facade-contracts";
import {
  classifyNativeError,
  NativeDelegationService,
  observeWithTimeout,
  shouldRenewHeartbeat,
} from "../src/opencode/native-delegation-service";
import { NativeJournal } from "../src/opencode/native-journal";
import {
  type NativeSession,
  NativeWorkService,
} from "../src/opencode/native-work-service";
import type {
  ObservedNativeCall,
  OpenCodeTransport,
} from "../src/opencode/opencode-port";
import { OpenCodeTransportError } from "../src/opencode/opencode-port";

test("prepare, claimed native task, and receipt settle one authoritative binding", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-delegation-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      return {
        status: "completed",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
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
      {
        action: "open",
        intent: "new",
        objective: "Investigate the native bridge",
      },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Inspect one bounded source file",
        acceptanceCriteria: ["Return a valid explorer result"],
      },
      session,
    );
    expect(prepared.nativeTaskArgs.subagent_type).toBe("explorer");
    await service.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    const result: AgentResult = {
      protocol: "pulso-result/2",
      delegationId: prepared.delegationId,
      specialist: "explorer",
      workId: prepared.workId,
      workItemId: prepared.workItemId,
      status: "completed",
      summary: "Inspected the bounded source.",
      specialistResult: { kind: "explorer", findings: [] },
    };
    const output = {
      output: `<task id="child" state="completed"><task_result>${serializeAgentResult(result)}</task_result></task>`,
      metadata: {
        parentSessionId: "parent",
        sessionId: "child",
        background: false,
        model: { providerID: "provider", modelID: "observed-model" },
      },
    };
    await service.after({ sessionID: "parent", callID: "call" }, output, true);
    const receipt = output.output;
    expect(JSON.parse(output.output)).toMatchObject({
      protocol: "pulso-receipt/1",
      accepted: true,
      delegationId: prepared.delegationId,
      resultHash: expect.any(String),
      receiptHash: expect.any(String),
    });
    const acceptedReceipt = JSON.parse(output.output);
    expect(acceptedReceipt.resultHash).toBe(acceptedReceipt.receiptHash);
    expect(await journal.get(prepared.delegationId)).toMatchObject({
      resultHash: acceptedReceipt.resultHash,
      receiptHash: acceptedReceipt.receiptHash,
    });
    const replay = {
      output: `<task id="child" state="completed"><task_result>${serializeAgentResult(result)}</task_result></task>`,
      metadata: {},
    };
    await service.after({ sessionID: "parent", callID: "call" }, replay, true);
    expect(replay.output).toBe(receipt);
    const divergent = {
      output: `<task id="child" state="completed"><task_result>${serializeAgentResult({ ...result, summary: "Different validated result." })}</task_result></task>`,
      metadata: {},
    };
    await expect(
      service.after({ sessionID: "parent", callID: "call" }, divergent, true),
    ).rejects.toMatchObject({ code: "RESULT_REPLAY_CONFLICT" });
    expect(
      await runtime.runtimeAdapter.get(
        (await journal.get(prepared.delegationId))?.bindingId ?? "",
      ),
    ).toMatchObject({
      status: "completed",
      managedBy: "opencode-native",
    });
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("native observation timeout and heartbeat cadence remain fail-closed", async () => {
  await expect(
    observeWithTimeout(new Promise<never>(() => undefined), 1),
  ).rejects.toMatchObject({ code: "OBSERVATION_TIMEOUT" });
  expect(
    shouldRenewHeartbeat(
      undefined,
      "2026-01-01T00:00:00.000Z",
      new Date("2026-01-01T00:00:59.999Z"),
    ),
  ).toBe(false);
  expect(
    shouldRenewHeartbeat(
      "2026-01-01T00:01:00.000Z",
      "2026-01-01T00:00:00.000Z",
      new Date("2026-01-01T00:02:00.000Z"),
    ),
  ).toBe(true);
});

test("ToolPart running accepts the completed wrapper result synchronously", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-running-wrapper-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const work = new NativeWorkService(runtime, journal);
  let observations = 0;
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      observations += 1;
      if (observations === 1)
        return {
          status: "running",
          parentSessionId: "parent",
          parentCallId: "call",
          background: false,
          metadataObserved: false,
        };
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
    async readChildResult() {
      throw new Error("AFTER_MUST_USE_TASK_WRAPPER_RESULT");
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
  const service = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance",
    work,
    nativePolicy,
  );
  try {
    await work.execute(
      {
        action: "open",
        intent: "new",
        objective: "Wait for an asynchronous native child",
      },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Inspect the delayed native child",
        acceptanceCriteria: ["Return the delayed result"],
      },
      session,
    );
    await service.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    const result: AgentResult = {
      protocol: "pulso-result/2",
      delegationId: prepared.delegationId,
      specialist: "explorer",
      workId: prepared.workId,
      workItemId: prepared.workItemId,
      status: "completed",
      summary: "The completed wrapper result.",
      specialistResult: { kind: "explorer", findings: [] },
    };
    const output = {
      output: `<task id="child" state="completed"><task_result>${serializeAgentResult(result)}</task_result></task>`,
      metadata: {
        parentSessionId: "parent",
        sessionId: "child",
        background: false,
        model: { providerID: "provider", modelID: "observed-model" },
      },
    };
    const identicalOutput = {
      output: output.output,
      metadata: structuredClone(output.metadata),
    };
    await Promise.all([
      service.after({ sessionID: "parent", callID: "call" }, output, true),
      service.after(
        { sessionID: "parent", callID: "call" },
        identicalOutput,
        true,
      ),
    ]);
    const receipt = JSON.parse(output.output);
    expect(receipt).toMatchObject({
      protocol: "pulso-receipt/1",
      accepted: true,
    });
    expect(receipt.state.authority).toMatchObject({
      workspaceId: runtime.workspaceId,
      parentSessionId: "parent",
      parentCallId: "call",
      childSessionId: "child",
      workId: prepared.workId,
      workItemId: prepared.workItemId,
      bindingStatus: "completed",
      executionStatus: "completed",
      leaseStatus: "released",
    });
    expect(output.metadata).toMatchObject({
      model: { providerID: "provider", modelID: "observed-model" },
      pulso: { receiptHash: expect.any(String) },
    });
    expect(identicalOutput.output).toBe(output.output);
    expect(
      (await runtime.work.snapshot(prepared.workId)).executions,
    ).toHaveLength(1);
    expect(observations).toBe(0);
    expect(await journal.get(prepared.delegationId)).toMatchObject({
      childSessionId: "child",
      transportPhase: "closed",
      receiptPhase: "applied",
    });
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a running wrapper and completed-looking child text never apply through status or observation", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "pulso-opencode-running-wrapper-no-apply-"),
  );
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  let identity:
    | { delegationId: string; workId: string; workItemId: string }
    | undefined;
  let childResultReads = 0;
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      return {
        status: "running",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async readChildResult() {
      childResultReads += 1;
      if (!identity) throw new Error("CHILD_IDENTITY_NOT_PREPARED");
      return {
        output: serializeAgentResult({
          protocol: "pulso-result/2",
          ...identity,
          specialist: "explorer",
          status: "completed",
          summary: "This child text is not terminal task output.",
          specialistResult: { kind: "explorer", findings: [] },
        }),
        completedAt: 1,
      };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
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
      {
        action: "open",
        intent: "new",
        objective: "Keep running wrapper unaccepted",
      },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Read terminal distinction",
        acceptanceCriteria: ["Do not settle from child transcript"],
      },
      session,
    );
    identity = prepared;
    await service.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    await expect(
      service.after(
        { sessionID: "parent", callID: "call" },
        {
          output: '<task id="child" state="running"></task>',
          metadata: {
            parentSessionId: "parent",
            sessionId: "child",
            background: false,
            model: { providerID: "provider", modelID: "model" },
          },
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "NATIVE_DISPATCH" });
    await service.status(
      { delegationId: prepared.delegationId, view: "full" },
      session,
    );
    await service.observeNow(prepared.delegationId);
    const delegation = await journal.get(prepared.delegationId);
    expect(delegation).toMatchObject({
      receiptPhase: "none",
      transportPhase: "claimed",
      sideEffectsMayContinue: true,
    });
    expect(childResultReads).toBe(0);
    expect(
      await runtime.runtimeBindings.get(delegation?.bindingId ?? ""),
    ).toMatchObject({ status: "active" });
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unverified running wrapper retains native authority after its deadline", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "pulso-opencode-unverified-running-"),
  );
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      return {
        status: "running",
        parentSessionId: "parent",
        parentCallId: "call",
        background: false,
        metadataObserved: false,
      };
    },
    async readChild() {
      return undefined;
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
  const work = new NativeWorkService(runtime, journal);
  const service = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance",
    work,
    {
      ...nativePolicy,
      maximumExecutionMs: 0,
    },
  );
  try {
    await work.execute(
      {
        action: "open",
        intent: "new",
        objective: "Retain authority until the host verifies the child",
      },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "executor",
        objective: "Run only after child verification",
        acceptanceCriteria: ["Do not release uncertain authority"],
      },
      session,
    );
    await service.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    await expect(
      service.after(
        { sessionID: "parent", callID: "call" },
        { output: '<task state="running"></task>', metadata: {} },
        true,
      ),
    ).rejects.toMatchObject({ code: "NATIVE_DISPATCH" });
    await service.observeNow(prepared.delegationId);
    const claimed = await journal.get(prepared.delegationId);
    expect(claimed).toMatchObject({
      transportPhase: "claimed",
      sideEffectsMayContinue: true,
    });
    const bindingId = claimed?.bindingId;
    if (!bindingId) throw new Error("NATIVE_BINDING_NOT_CREATED");
    expect(await runtime.runtimeAdapter.get(bindingId)).toMatchObject({
      status: "active",
      managedBy: "opencode-native",
    });
    const snapshot = await runtime.work.snapshot(prepared.workId);
    expect(snapshot.executions).toContainEqual(
      expect.objectContaining({
        workItemId: prepared.workItemId,
        status: "running",
      }),
    );
    expect(snapshot.leases).toContainEqual(
      expect.objectContaining({
        workItemId: prepared.workItemId,
        status: "active",
      }),
    );
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("C01/C05/C09: before rejects unprepared or altered canonical tasks and never dispatches twice", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-before-replay-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      return {
        status: "running",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
  const work = new NativeWorkService(runtime, journal);
  const service = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance",
    work,
  );
  const bind = runtime.runtimeAdapter.bind.bind(runtime.runtimeAdapter);
  let bindCount = 0;
  runtime.runtimeAdapter.bind = async (...input) => {
    bindCount++;
    return bind(...input);
  };
  try {
    await work.execute(
      { action: "open", intent: "new", objective: "Replay one native call" },
      session,
    );
    for (const subagent_type of [
      "planner",
      "explorer",
      "executor",
      "verifier",
      "security-auditor",
    ])
      await expect(
        service.before(
          { sessionID: "parent", callID: `external-${subagent_type}` },
          {
            description: `external ${subagent_type}`,
            subagent_type,
            prompt: "ordinary host prompt",
          },
        ),
      ).rejects.toMatchObject({ code: "PREPARATION" });
    const externalCanonicalTask = {
      description: "external explorer",
      subagent_type: "explorer",
      prompt: "ordinary host prompt",
    };
    expect(
      await service.before(
        { sessionID: "parent", callID: "external-agent" },
        {
          description: "external host task",
          subagent_type: "external-agent",
          prompt: "ordinary host prompt",
        },
      ),
    ).toBe(false);
    await expect(
      service.before(
        { sessionID: "parent", callID: "marker" },
        {
          ...externalCanonicalTask,
          prompt: '<pulso-task v="2">not-json</pulso-task>',
        },
      ),
    ).rejects.toMatchObject({ code: "PREPARATION" });
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Inspect the replay behavior",
        acceptanceCriteria: ["Dispatch only once"],
      },
      session,
    );
    // OC-02.2: these preexisting tamper cases cover the STRICT legacy wire path.
    const legacyPreparation = await journal.get(prepared.delegationId);
    if (!legacyPreparation) throw new Error("TEST_PREPARATION_MISSING");
    const legacySnapshot = await runtime.work.snapshot(prepared.workId);
    const legacyItem = legacySnapshot.items.find(
      (item) => item.id === prepared.workItemId,
    );
    if (!legacyItem) throw new Error("TEST_ITEM_MISSING");
    const legacyArgs = {
      description: legacyItem.title.slice(0, 80),
      subagent_type: legacyPreparation.specialist,
      prompt: legacyPreparation.taskWire,
    };

    await expect(
      service.before(
        { sessionID: "parent", callID: "call" },
        { ...legacyArgs, description: "tampered" },
        true,
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await expect(
      service.before(
        { sessionID: "parent", callID: "call" },
        { ...legacyArgs, subagent_type: "planner" },
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await expect(
      service.before(
        { sessionID: "parent", callID: "call" },
        {
          ...legacyArgs,
          prompt: `${legacyArgs.prompt} `,
        },
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    const alteredIdentity = parseTaskEnvelope(legacyArgs.prompt);
    await expect(
      service.before(
        { sessionID: "parent", callID: "call" },
        {
          ...legacyArgs,
          prompt: serializeTaskEnvelope({
            ...alteredIdentity,
            work: { ...alteredIdentity.work, workId: "altered-work" },
          }),
        },
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await service.before({ sessionID: "parent", callID: "call" }, legacyArgs);
    await expect(
      service.before({ sessionID: "parent", callID: "call" }, legacyArgs),
    ).rejects.toMatchObject({ code: "NATIVE_DISPATCH_REPLAY" });
    expect(bindCount).toBe(1);
    expect(await journal.get(prepared.delegationId)).toMatchObject({
      parentCallId: "call",
      transportPhase: "claimed",
    });
  } finally {
    runtime.runtimeAdapter.bind = bind;
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a verified native observation renews through the internal adapter, never MCP", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-native-heartbeat-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      return {
        status: "running",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
  const work = new NativeWorkService(runtime, journal);
  const service = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance",
    work,
    { ...nativePolicy, heartbeatIntervalMs: 0 },
  );
  try {
    await work.execute(
      { action: "open", intent: "new", objective: "Renew native authority" },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Observe the verified child",
        acceptanceCriteria: ["Keep the authoritative lease active"],
      },
      session,
    );
    await service.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    await service.observeNow(prepared.delegationId);
    const delegation = await journal.get(prepared.delegationId);
    expect(delegation).toMatchObject({
      childSessionId: "child",
      lastNativeObservationAt: expect.any(String),
      lastHeartbeatAt: expect.any(String),
    });
    const bindingId = delegation?.bindingId;
    if (!bindingId) throw new Error("NATIVE_BINDING_NOT_CREATED");
    await expect(
      runtime.runtimeAdapter.heartbeat(bindingId),
    ).rejects.toMatchObject({
      code: "BINDING_MANAGED_BY_NATIVE",
    });
    expect((await runtime.runtimeAdapter.get(bindingId)).status).toBe("active");
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("different read requests in one message retain separate preparations and exact replay", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-read-prepares-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall() {
      return {
        status: "missing" as const,
        parentSessionId: "parent",
        parentCallId: "call",
        background: false,
        metadataObserved: false,
      };
    },
    async readChild() {
      return undefined;
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
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
      { action: "open", intent: "new", objective: "Read two sources" },
      session,
    );
    const explorer = await service.prepare(
      {
        specialist: "explorer",
        objective: "Read the first bounded source",
        acceptanceCriteria: ["Return the first finding"],
      },
      session,
    );
    const explorerReplay = await service.prepare(
      {
        specialist: "explorer",
        objective: "Read the first bounded source",
        acceptanceCriteria: ["Return the first finding"],
      },
      session,
    );
    const planner = await service.prepare(
      {
        specialist: "planner",
        objective: "Read the second bounded source",
        acceptanceCriteria: ["Return the decision options"],
      },
      session,
    );
    expect(explorerReplay.delegationId).toBe(explorer.delegationId);
    expect(planner.delegationId).not.toBe(explorer.delegationId);
    expect(planner.workItemId).not.toBe(explorer.workItemId);
    const preparations = await journal.list(
      session.workspaceId,
      session.parentSessionId,
    );
    expect(preparations).toHaveLength(2);
    expect(new Set(preparations.map((item) => item.requestHash)).size).toBe(2);
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepare rejects an oversized task with the prescribed budget breakdown", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-budget-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall() {
      return {
        status: "missing",
        parentSessionId: "parent",
        parentCallId: "call",
        background: false,
        metadataObserved: false,
      };
    },
    async readChild() {
      return undefined;
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
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
      { action: "open", intent: "new", objective: "Bound native context" },
      session,
    );
    try {
      await service.prepare(
        {
          specialist: "explorer",
          objective: "x".repeat(66_000),
          acceptanceCriteria: ["Return a result"],
        },
        session,
      );
      throw new Error("BUDGET_LIMIT_NOT_ENFORCED");
    } catch (error) {
      expect(error).toMatchObject({ code: "BUDGET_EXCEEDED" });
      expect(error instanceof Error ? error.message : "").toContain(
        '"objective"',
      );
      expect(error instanceof Error ? error.message : "").toContain(
        '"maximum"',
      );
    }
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("before rejects unsupported task controls and after preserves identity diagnostics", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-controls-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall() {
      return {
        status: "completed",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "wrong-child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "wrong-child", parentId: "other-parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
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
      { action: "open", intent: "new", objective: "Verify native controls" },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Inspect controls",
        acceptanceCriteria: ["Return structured evidence"],
      },
      session,
    );
    // OC-02.2: these preexisting tamper cases cover the STRICT legacy wire path.
    const legacyPreparation = await journal.get(prepared.delegationId);
    if (!legacyPreparation) throw new Error("TEST_PREPARATION_MISSING");
    const legacySnapshot = await runtime.work.snapshot(prepared.workId);
    const legacyItem = legacySnapshot.items.find(
      (item) => item.id === prepared.workItemId,
    );
    if (!legacyItem) throw new Error("TEST_ITEM_MISSING");
    const legacyArgs = {
      description: legacyItem.title.slice(0, 80),
      subagent_type: legacyPreparation.specialist,
      prompt: legacyPreparation.taskWire,
    };

    for (const args of [
      { ...legacyArgs, task_id: "resume" },
      { ...legacyArgs, command: "resume" },
      { ...legacyArgs, background: true },
    ])
      await expect(
        service.before({ sessionID: "parent", callID: "call" }, args),
      ).rejects.toMatchObject({ code: "NATIVE_DISPATCH" });
    await expect(
      service.before(
        { sessionID: "parent", callID: "call" },
        { ...legacyArgs, description: "tampered" },
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await expect(
      service.before(
        { sessionID: "parent", callID: "call" },
        {
          description: "ordinary host task",
          subagent_type: "custom-agent",
          prompt: "ordinary host prompt",
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "PREPARATION" });

    await service.before({ sessionID: "parent", callID: "call" }, legacyArgs);
    const result: AgentResult = {
      protocol: "pulso-result/2",
      delegationId: prepared.delegationId,
      specialist: "explorer",
      workId: prepared.workId,
      workItemId: prepared.workItemId,
      status: "completed",
      summary: "The response has a mismatched child.",
      specialistResult: { kind: "explorer", findings: [] },
    };
    await expect(
      service.after(
        { sessionID: "parent", callID: "call" },
        {
          output: `<task id="wrapper-child" state="completed"><task_result>${serializeAgentResult(result)}</task_result></task>`,
          metadata: {
            parentSessionId: "parent",
            sessionId: "child",
            background: false,
            model: { providerID: "provider", modelID: "model" },
          },
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(
      JSON.parse((await journal.get(prepared.delegationId))?.errorJson ?? "{}"),
    ).toMatchObject({
      stage: "identity_mismatch",
    });
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unconfirmed abort keeps an executor claim durable and fenced", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-abort-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall() {
      return {
        status: "running",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "executor",
        background: true,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
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
      { action: "open", intent: "new", objective: "Bound executor effects" },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "executor",
        objective: "Run one bounded operation",
        acceptanceCriteria: ["Report the operation"],
      },
      session,
    );
    await service.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    await expect(
      service.after(
        { sessionID: "parent", callID: "call" },
        {
          output: '<task id="child" state="running"></task>',
          metadata: {},
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "NATIVE_DISPATCH" });
    const claimed = await journal.get(prepared.delegationId);
    if (!claimed) throw new Error("CLAIM_NOT_CREATED");
    expect(claimed).toMatchObject({
      transportPhase: "claimed",
      sideEffectsMayContinue: true,
    });
    const bindingId = claimed.bindingId;
    if (!bindingId) throw new Error("NATIVE_BINDING_NOT_CREATED");
    expect(await runtime.runtimeAdapter.get(bindingId)).toMatchObject({
      status: "active",
      managedBy: "opencode-native",
    });
    const snapshot = await runtime.work.snapshot(prepared.workId);
    expect(snapshot.executions).toContainEqual(
      expect.objectContaining({
        workItemId: prepared.workItemId,
        status: "running",
      }),
    );
    expect(snapshot.leases).toContainEqual(
      expect.objectContaining({
        workItemId: prepared.workItemId,
        status: "active",
      }),
    );
    await service.dispose();
    const uncertain = await journal.get(prepared.delegationId);
    expect(uncertain).toMatchObject({
      transportPhase: "claimed",
      sideEffectsMayContinue: true,
    });
    await journal.createPreparation({
      delegationId: "blocked-verifier",
      workspaceId: runtime.workspaceId,
      parentSessionId: "parent",
      requestMessageId: "second-message",
      requestHash: "second-request",
      workId: prepared.workId,
      workItemId: "another-item",
      specialist: "verifier",
      taskWire: '<pulso-task v="2">verifier</pulso-task>',
      taskHash: "second-task",
      preparedAt: "2026-01-01T00:00:00.000Z",
      preparationExpiresAt: "2026-01-01T00:02:00.000Z",
    });
    await expect(
      journal.claim({
        delegationId: "blocked-verifier",
        workspaceId: runtime.workspaceId,
        parentSessionId: "parent",
        parentCallId: "second-call",
        ownerInstanceId: "other-instance",
        now: "2026-01-01T00:00:01.000Z",
        deadlineAt: "2026-01-01T00:30:01.000Z",
      }),
    ).rejects.toThrow("SHELL_SPECIALIST_LIMIT");
  } finally {
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("status recovers a claimed binding after restart without dispatching again", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-status-restart-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall() {
      return {
        status: "running",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
  const work = new NativeWorkService(runtime, journal);
  const beforeRestart = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance-before-restart",
    work,
  );
  const afterRestart = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance-after-restart",
    work,
  );
  try {
    await work.execute(
      { action: "open", intent: "new", objective: "Recover native claim" },
      session,
    );
    const prepared = await beforeRestart.prepare(
      {
        specialist: "explorer",
        objective: "Observe only",
        acceptanceCriteria: ["Do not dispatch twice"],
      },
      session,
    );
    await beforeRestart.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    const recovered = await afterRestart.status(
      { delegationId: prepared.delegationId, view: "summary" },
      session,
    );
    if (!("delegation" in recovered))
      throw new Error("STATUS_DID_NOT_RETURN_DELEGATION");
    expect(recovered.delegation).toMatchObject({
      delegationId: prepared.delegationId,
      transportPhase: "claimed",
    });
    expect((await journal.get(prepared.delegationId))?.ownerInstanceId).toBe(
      "instance-after-restart",
    );
  } finally {
    await beforeRestart.dispose();
    await afterRestart.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("status applies a captured receipt after a post-core snapshot failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-opencode-captured-recovery-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      return {
        status: "completed",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
  const work = new NativeWorkService(runtime, journal);
  const service = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance",
    work,
  );
  const completeNative = runtime.runtimeAdapter.completeNative;
  const readStore = runtime.store.read;
  let coreApplied = false;
  try {
    await work.execute(
      { action: "open", intent: "new", objective: "Recover captured receipt" },
      session,
    );
    const prepared = await service.prepare(
      {
        specialist: "explorer",
        objective: "Inspect the receipt recovery path",
        acceptanceCriteria: ["Return the valid explorer result"],
      },
      session,
    );
    await service.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    runtime.runtimeAdapter.completeNative = async (bindingId, result) => {
      const settled = await completeNative.call(
        runtime.runtimeAdapter,
        bindingId,
        result,
      );
      coreApplied = true;
      return settled;
    };
    runtime.store.read = async () => {
      if (coreApplied) throw new Error("post_core_snapshot_failure");
      return readStore.call(runtime.store);
    };
    const result: AgentResult = {
      protocol: "pulso-result/2",
      delegationId: prepared.delegationId,
      specialist: "explorer",
      workId: prepared.workId,
      workItemId: prepared.workItemId,
      status: "completed",
      summary: "The receipt was captured before the snapshot failed.",
      specialistResult: { kind: "explorer", findings: [] },
    };
    await expect(
      service.after(
        { sessionID: "parent", callID: "call" },
        {
          output: `<task id="child" state="completed"><task_result>${serializeAgentResult(result)}</task_result></task>`,
          metadata: {
            parentSessionId: "parent",
            sessionId: "child",
            background: false,
            model: { providerID: "provider", modelID: "model" },
          },
        },
        true,
      ),
    ).rejects.toThrow("post_core_snapshot_failure");
    expect(await journal.get(prepared.delegationId)).toMatchObject({
      transportPhase: "claimed",
      receiptPhase: "captured",
    });
    runtime.store.read = readStore;
    runtime.runtimeAdapter.completeNative = completeNative;
    await service.status(
      { delegationId: prepared.delegationId, view: "full" },
      session,
    );
    expect(await journal.get(prepared.delegationId)).toMatchObject({
      transportPhase: "closed",
      receiptPhase: "applied",
      receiptHash: expect.any(String),
    });
  } finally {
    runtime.store.read = readStore;
    runtime.runtimeAdapter.completeNative = completeNative;
    await service.dispose();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("C10: rejected receipts replay only their byte-identical raw result", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "pulso-opencode-rejection-recovery-"),
  );
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "message",
    agent: "pulso",
  };
  const transport = {
    async observeCall(): Promise<ObservedNativeCall> {
      return {
        status: "completed",
        parentSessionId: "parent",
        parentCallId: "call",
        metadataParentSessionId: "parent",
        childSessionId: "child",
        specialist: "explorer",
        background: false,
        metadataObserved: true,
      };
    },
    async readChild() {
      return { id: "child", parentId: "parent" };
    },
    async abortChild() {},
  } satisfies OpenCodeTransport;
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  let restartedJournal: NativeJournal | undefined;
  const work = new NativeWorkService(runtime, journal);
  const beforeRestart = new NativeDelegationService(
    runtime,
    journal,
    transport,
    "instance-before-restart",
    work,
  );
  let afterRestart: NativeDelegationService | undefined;
  const failNative = runtime.runtimeAdapter.failNative;
  const invalidRawResult =
    '<pulso-result v="2">{"not":"a pulso result","also":true}</pulso-result>';
  const invalidOutput = `<task id="child" state="completed"><task_result>${invalidRawResult}</task_result></task>`;
  const identicalReplayOutput = invalidOutput;
  try {
    await work.execute(
      { action: "open", intent: "new", objective: "Recover rejection" },
      session,
    );
    const prepared = await beforeRestart.prepare(
      {
        specialist: "explorer",
        objective: "Reject an invalid specialist result",
        acceptanceCriteria: ["Fail the binding through the native authority"],
      },
      session,
    );
    await beforeRestart.before(
      { sessionID: "parent", callID: "call" },
      prepared.nativeTaskArgs,
    );
    runtime.runtimeAdapter.failNative = async () => {
      throw new Error("simulated_crash_before_protocol_failure");
    };
    await expect(
      beforeRestart.after(
        { sessionID: "parent", callID: "call" },
        {
          output: invalidOutput,
          metadata: {
            parentSessionId: "parent",
            sessionId: "child",
            background: false,
            model: { providerID: "provider", modelID: "model" },
          },
        },
        true,
      ),
    ).rejects.toThrow();
    expect(await journal.get(prepared.delegationId)).toMatchObject({
      transportPhase: "claimed",
      receiptPhase: "captured",
      receiptHash: expect.any(String),
    });
    const capturedReceipt = await journal.get(prepared.delegationId);
    const capturedRejection = JSON.parse(capturedReceipt?.receiptJson ?? "{}");
    const expectedReceiptHash = createHash("sha256")
      .update(
        JSON.stringify({
          code: capturedRejection.code,
          delegationId: prepared.delegationId,
          rawResultHash: capturedRejection.rawResultHash,
          stage: capturedRejection.stage,
        }),
      )
      .digest("hex");
    expect(capturedRejection).toMatchObject({
      delegationId: prepared.delegationId,
      rawResultHash: expect.any(String),
      receiptHash: expectedReceiptHash,
      paths: expect.any(Array),
      ids: {
        delegationId: prepared.delegationId,
        specialist: "explorer",
        workId: prepared.workId,
        workItemId: prepared.workItemId,
      },
    });
    expect(capturedRejection.rawResultHash).toEqual(
      createHash("sha256").update(invalidRawResult).digest("hex"),
    );
    expect(capturedReceipt).toMatchObject({ receiptHash: expectedReceiptHash });
    expect(capturedReceipt?.resultHash).toBeUndefined();

    // A fresh journal/owner models the process dying after receipt capture.
    journal.close();
    runtime.runtimeAdapter.failNative = failNative;
    restartedJournal = new NativeJournal(runtime.runtimeBindings.databasePath);
    afterRestart = new NativeDelegationService(
      runtime,
      restartedJournal,
      transport,
      "instance-after-restart",
      new NativeWorkService(runtime, restartedJournal),
    );
    const status = await afterRestart.status(
      { delegationId: prepared.delegationId, view: "full" },
      session,
    );
    if (!("delegation" in status))
      throw new Error("STATUS_DID_NOT_RETURN_DELEGATION");
    expect(status.delegation).toMatchObject({
      transportPhase: "closed",
      receiptPhase: "rejected",
    });
    expect(
      await runtime.runtimeAdapter.get(status.delegation.bindingId ?? ""),
    ).toMatchObject({ status: "failed" });
    const eventsBeforeReplay = (await runtime.work.snapshot(prepared.workId))
      .events.length;
    const identicalReplay = { output: identicalReplayOutput, metadata: {} };
    await afterRestart.after(
      { sessionID: "parent", callID: "call" },
      identicalReplay,
      true,
    );
    expect(JSON.parse(identicalReplay.output)).toEqual(capturedRejection);
    expect(JSON.parse(identicalReplay.output)).not.toHaveProperty("accepted");
    expect((await runtime.work.snapshot(prepared.workId)).events).toHaveLength(
      eventsBeforeReplay,
    );
    await expect(
      afterRestart.after(
        { sessionID: "parent", callID: "call" },
        {
          output:
            '<task id="child" state="completed"><task_result><pulso-result v="2">{"also":false,"not":"a pulso result"}</pulso-result></task_result></task>',
          metadata: {},
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "RESULT_REPLAY_CONFLICT" });
    expect((await runtime.work.snapshot(prepared.workId)).events).toHaveLength(
      eventsBeforeReplay,
    );
  } finally {
    runtime.runtimeAdapter.failNative = failNative;
    await beforeRestart.dispose();
    await afterRestart?.dispose();
    restartedJournal?.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("classifies sanitized OpenCode SDK evidence by provider and transport facts", () => {
  class ProviderRateLimitError extends Error {
    readonly code = "PROVIDER_RATE_LIMIT";
    readonly status = 429;

    constructor() {
      super("Provider rate limit; token=not-for-diagnostics");
      this.name = "RateLimitError";
    }
  }
  class ConnectionTimeoutError extends Error {
    readonly code = "ETIMEDOUT";

    constructor() {
      super("Connection timeout to OpenCode SDK");
      this.name = "APIConnectionTimeoutError";
    }
  }

  const provider = new OpenCodeTransportError(
    "observeCall",
    new ProviderRateLimitError(),
  );
  expect(classifyNativeError(provider, "observation")).toMatchObject({
    stage: "provider_rate_limit",
    code: "PROVIDER_RATE_LIMIT",
    transport: {
      operation: "observeCall",
      className: "RateLimitError",
      status: 429,
    },
  });
  expect(provider.failure.message).not.toContain("not-for-diagnostics");

  const timeout = new OpenCodeTransportError(
    "readChild",
    new ConnectionTimeoutError(),
  );
  expect(classifyNativeError(timeout, "observation")).toMatchObject({
    stage: "transport_timeout",
    code: "ETIMEDOUT",
    transport: {
      operation: "readChild",
      className: "APIConnectionTimeoutError",
    },
  });

  const unprovenAccess = new OpenCodeTransportError(
    "observeCall",
    Object.assign(new Error("OpenCode endpoint denied the request"), {
      code: "FORBIDDEN",
      status: 403,
    }),
  );
  expect(classifyNativeError(unprovenAccess, "observation")).toMatchObject({
    stage: "observation",
    code: "FORBIDDEN",
  });
});
