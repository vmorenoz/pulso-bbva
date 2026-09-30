import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAgentResult } from "../packages/orchestration/src/protocol/parse";
import type { ExpectedDelegationIdentity } from "../packages/orchestration/src/protocol/schemas";
import {
  assertIndependentMultiTurnSession,
  assertNativeScenarioContinuity,
  attemptEvidence,
  commandTimeoutForCategory,
  decodeEvents,
  evidenceSourceFor,
  failureFrom,
  liveNotRunExitCode,
  loadNativeScenario,
  managedInstallerAssetPaths,
  type NativeAttemptEvidence,
  runOfflineNativeSmoke,
  safeEffectiveConfig,
  sanitizeForTranscript,
  smokeEvaluation,
  validateFunctionalChecks,
  verifyLiveScenarioFunction,
} from "./runtime-smoke-harness";
import {
  assertFixtureAfterTurn,
  assertFixtureBeforeTurn,
  captureFixtureSnapshot,
} from "./support/fixture-scope";

const fixtureRoot = join(import.meta.dir, "..", "fixtures");
const expected: ExpectedDelegationIdentity = {
  delegationId: "delegation",
  specialist: "explorer" as const,
  workId: "work",
  workItemId: "item",
};

const resultFixture = async (
  name: string,
  identity: ExpectedDelegationIdentity = expected,
) => {
  const result = JSON.parse(
    await readFile(join(fixtureRoot, name), "utf8"),
  ) as Record<string, unknown>;
  return `<pulso-result v="2">${JSON.stringify({ ...result, ...identity })}</pulso-result>`;
};

test("retains user-message events when decoding JSON run output", () => {
  const events = decodeEvents(
    `${JSON.stringify({ type: "user.message", sessionID: "session-1" })}\n${JSON.stringify({ type: "text", sessionID: "session-1" })}`,
  );

  expect(events.map((event) => event.type)).toEqual(["user.message", "text"]);
  expect(events.filter((event) => event.type === "user.message")).toHaveLength(
    1,
  );
});

test("uses the literal OC-01 native scenario with eight independent turns", async () => {
  const scenario = await loadNativeScenario();

  expect(scenario.messages).toHaveLength(8);
  expect(scenario.messages.map((message) => message.expectedWork)).toEqual([
    "A",
    "A",
    "A",
    "A",
    "A",
    "A",
    "A",
    "B",
  ]);
  expect(scenario.messages[7]?.text).toContain("Nuevo objetivo B");
  expect(scenario.expected.workAStillNotClosedAfter8).toBe(true);
  expect(scenario.expected.noCommit).toBe(true);
  expect(scenario.expected.specialistsObserved).toEqual([
    "explorer",
    "planner",
    "executor",
    "verifier",
    "security-auditor",
  ]);
});

test("requires one persistent session and native Work A/B continuity", async () => {
  const scenario = await loadNativeScenario();
  const turns = scenario.messages.map((message, index) => ({
    turn: index + 1,
    message: message.text,
    sessionId: "session-1",
    processExitCode: 0,
    eventCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 1,
    toolCount: 1,
    directPulsoToolCount: 1,
    directTechnicalToolCount: 0,
    taskCount: 0,
    mcpErrors: [],
    workIds: [index === 7 ? "work-b" : "work-a"],
    workStatuses: ["active"],
  }));

  expect(() => assertIndependentMultiTurnSession(turns)).not.toThrow();
  expect(() => assertNativeScenarioContinuity(scenario, turns)).not.toThrow();
  expect(() =>
    assertIndependentMultiTurnSession(
      turns.map((turn, index) =>
        index === 7 ? { ...turn, sessionId: "session-2" } : turn,
      ),
    ),
  ).toThrow("MULTITURN_CREATED_MORE_THAN_ONE_SESSION");
  expect(() =>
    assertNativeScenarioContinuity(
      scenario,
      turns.map((turn, index) =>
        index === 6 ? { ...turn, workIds: ["work-b"] } : turn,
      ),
    ),
  ).toThrow("MULTITURN_WORK_A_CONTINUITY_LOST");
});

test("rejects turns without observed user messages, responses, or session identity", async () => {
  const scenario = await loadNativeScenario();
  const turns = scenario.messages.map((message, index) => ({
    turn: index + 1,
    message: message.text,
    sessionId: "session-1",
    processExitCode: 0,
    eventCount: 2,
    userMessageCount: 1,
    assistantMessageCount: 1,
    toolCount: 0,
    directPulsoToolCount: 0,
    directTechnicalToolCount: 0,
    taskCount: 0,
    mcpErrors: [],
    workIds: ["work-a"],
    workStatuses: ["active"],
  }));

  expect(() =>
    assertIndependentMultiTurnSession(
      turns.map((turn, index) =>
        index === 0 ? { ...turn, userMessageCount: 0 } : turn,
      ),
    ),
  ).toThrow("MULTITURN_MESSAGES_NOT_INDEPENDENT");
  expect(() =>
    assertIndependentMultiTurnSession(
      turns.map((turn, index) =>
        index === 0 ? { ...turn, assistantMessageCount: 0 } : turn,
      ),
    ),
  ).toThrow("MULTITURN_MESSAGES_NOT_INDEPENDENT");
  expect(() =>
    assertIndependentMultiTurnSession(
      turns.map((turn, index) =>
        index === 0 ? { ...turn, sessionId: undefined } : turn,
      ),
    ),
  ).toThrow("MULTITURN_MESSAGES_NOT_INDEPENDENT");
});

test("uses the run timeout for every literal scenario turn", () => {
  expect(commandTimeoutForCategory("run")).toBe(180_000);
  for (let turn = 1; turn <= 8; turn += 1)
    expect(commandTimeoutForCategory(`turn-${turn}`)).toBe(180_000);
  expect(commandTimeoutForCategory("version")).toBe(30_000);
  expect(commandTimeoutForCategory("turn-9")).toBe(30_000);
});

test("retains a malformed native task callID and diagnostic instead of dropping the task", () => {
  const attempts = attemptEvidence(
    [
      {
        type: "tool_use",
        sessionID: "parent",
        part: {
          tool: "task",
          callID: "call-malformed",
          state: {
            status: "error",
            input: { prompt: "not-a-task-envelope" },
            error: "original-hook-error",
          },
        },
      },
    ],
    1,
  );
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    nativeCallId: "call-malformed",
    parentSessionId: "parent",
    specialist: "not-observed",
  });
  expect(attempts[0]?.error).toBe("original-hook-error");
  expect(attempts[0]?.parseError).toContain("call-malformed");
});

test("accepts every valid result fixture and rejects limitations nested in findings", async () => {
  expect(
    parseAgentResult(await resultFixture("result-explorer.json"), expected),
  ).toMatchObject({
    specialist: "explorer",
    specialistResult: { kind: "explorer" },
  });
  const invalid = await resultFixture(
    "result-explorer-invalid-limitations.json",
  );
  expect(() => parseAgentResult(invalid, expected)).toThrow();
  for (const [name, specialist] of [
    ["result-planner.json", "planner"],
    ["result-executor.json", "executor"],
    ["result-verifier.json", "verifier"],
    ["result-security-auditor.json", "security-auditor"],
  ] as const) {
    const identity = { ...expected, specialist };
    expect(
      parseAgentResult(await resultFixture(name, identity), identity),
    ).toMatchObject({
      specialist,
    });
  }
});

test("runs the installed native bridge against valid, invalid, and host-failure fixture responses", async () => {
  const valid = await runOfflineNativeSmoke("valid");
  const validWithStatus = await runOfflineNativeSmoke("valid-status");
  const invalid = await runOfflineNativeSmoke("invalid");
  const hostFailure = await runOfflineNativeSmoke("host-error");

  expect(valid.status).toBe("PASS");
  expect(validWithStatus.status).toBe("PASS");
  expect(invalid.status).toBe("PASS");
  expect(hostFailure.status).toBe("PASS");
  expect(valid.evidenceSource).toBe("fixture");
  expect(validWithStatus.evidenceSource).toBe("fixture");
  const lifecycle = (attempts: NativeAttemptEvidence[] | undefined) =>
    attempts?.map((attempt) => ({
      specialist: attempt.specialist,
      receiptPhase: attempt.receiptPhase,
      receiptAccepted: attempt.receiptAccepted,
      workStatus: attempt.workStatus,
      workItemStatus: attempt.workItemStatus,
      bindingStatus: attempt.bindingStatus,
      executionStatus: attempt.executionStatus,
      leaseStatus: attempt.leaseStatus,
      transportPhase: attempt.transportPhase,
      sideEffectsMayContinue: attempt.sideEffectsMayContinue,
    }));
  expect(lifecycle(validWithStatus.attempts)).toEqual(
    lifecycle(valid.attempts),
  );
  expect(invalid.failure).toBeDefined();
  expect(hostFailure.failure).toBeDefined();
}, 900_000);

test("scripted failure at turn one archives the first failure and marks later turns NOT_RUN", async () => {
  const report = await runOfflineNativeSmoke("barrier-error");
  expect(report.status).toBe("FAIL");
  expect(report.failedTurn).toBe(1);
  expect(report.lastVerifiedTurn).toBe(0);
  expect(report.notRunTurns).toEqual(
    [2, 3, 4, 5, 6, 7, 8].map((turn) => ({ turn, status: "NOT_RUN" })),
  );
  expect(report.archiveComplete).toBe(true);
  expect(report.evidenceDirectory).toContain(".pulso-evidence");
}, 300_000);

test("preserves the sanitized host cause instead of collapsing it to an auth probe", () => {
  const cause = failureFrom(
    "NATIVE_DISPATCH: host task failed; token=not-for-transcript",
  );

  expect(cause).toMatchObject({
    stage: "native_dispatch",
    code: "NATIVE_DISPATCH",
  });
  expect(cause.message).not.toContain("not-for-transcript");
  expect(cause.code).not.toBe("AUTH_SPECIALIST_TASK_REQUEST_FAILED");
});

test("labels fixture and live evidence separately and reserves a non-PASS NOT_RUN exit", () => {
  expect(evidenceSourceFor("offline")).toBe("fixture");
  expect(evidenceSourceFor("live")).toBe("live");
  expect(liveNotRunExitCode).not.toBe(0);
});

test("effective-config projection allows unrelated MCPs but excludes secrets and conflicting Pulso MCP", () => {
  const effective = safeEffectiveConfig(
    JSON.stringify({
      agent: { pulso: { model: "provider/model" } },
      model: "provider/model",
      permission: { read: "allow" },
      plugin: [
        "file:///tmp/workspace/.opencode/plugins/pulso-protocol-guard.js",
      ],
      mcp: {
        codegraph: { url: "https://example.invalid", apiKey: "never-report" },
      },
      provider: { apiKey: "do-not-project" },
    }),
  ) as Record<string, unknown>;
  expect(effective.mcpServerNames).toEqual(["codegraph"]);
  expect(JSON.stringify(effective)).not.toContain("never-report");
  expect(JSON.stringify(effective)).not.toContain("do-not-project");
  expect(() =>
    safeEffectiveConfig(
      JSON.stringify({
        plugin: [
          "file:///tmp/workspace/.opencode/plugins/pulso-protocol-guard.js",
        ],
        mcp: { pulso: { command: "old bridge" } },
      }),
    ),
  ).toThrow("EFFECTIVE_LEGACY_PULSO_MCP_CONFIGURED");
});

test("fixture scope recognizes only exact installer manifest, config, and bridge assets", () => {
  const workspace = "/tmp/pulso-fixture";
  const managed = managedInstallerAssetPaths(
    workspace,
    {
      configPath: `${workspace}/.opencode/opencode.json`,
      manifestPath: `${workspace}/.opencode/.pulso-manifest.json`,
      nativeBridgePath: `${workspace}/.opencode/plugins/pulso-protocol-guard.js`,
    },
    {
      version: 5,
      runtime: "opencode",
      scope: "local",
      buildId: "build",
      configEntries: {},
      nativeBridge: {
        role: "native-bridge",
        version: "1.18.32",
        path: `${workspace}/.opencode/plugins/pulso-protocol-guard.js`,
        sha256: "hash",
      },
      files: {
        [`${workspace}/.opencode/agents/explorer.md`]: "hash",
      },
    },
  );
  expect(managed).toContain(".opencode/opencode.json");
  expect(managed).toContain(".opencode/.pulso-manifest.json");
  expect(managed).toContain(".opencode/plugins/pulso-protocol-guard.js");
  expect(managed).toContain(".opencode/agents/explorer.md");
  expect(managed.has("src/auth.ts")).toBe(false);
});

test("turn-8 integration checks do not grade security explanation wording", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pulso-turn8-checker-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "tests"), { recursive: true });
    await mkdir(join(workspace, ".opencode/plugins"), { recursive: true });
    await writeFile(
      join(workspace, "src/total.ts"),
      "export const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);\n",
    );
    await writeFile(
      join(workspace, "tests/total.test.ts"),
      "// original test\n",
    );
    await writeFile(
      join(workspace, "src/auth.ts"),
      "export function canReadInvoice(user, invoice) { return user !== undefined; }\n",
    );
    await writeFile(join(workspace, ".opencode/.pulso-manifest.json"), "{}\n");
    await writeFile(join(workspace, ".opencode/opencode.json"), "{}\n");
    await writeFile(
      join(workspace, ".opencode/plugins/pulso-protocol-guard.js"),
      "// bridge\n",
    );
    const baseline = await captureFixtureSnapshot(workspace);
    await writeFile(
      join(workspace, "src/total.ts"),
      "export const total = (values) => values.reduce((sum, value) => { if (value < 0) throw new Error('NEGATIVE_AMOUNT'); return sum + value; }, 0);\n",
    );
    await writeFile(
      join(workspace, "tests/total.test.ts"),
      "test('negative amount throws NEGATIVE_AMOUNT', () => {});\n",
    );
    const afterExecutor = await captureFixtureSnapshot(workspace);
    const turn8Scope = assertFixtureAfterTurn(
      8,
      baseline,
      afterExecutor,
      afterExecutor,
    );
    assertFixtureBeforeTurn(8, baseline, afterExecutor, afterExecutor);

    const attempts: NativeAttemptEvidence[] = [
      {
        turn: 8,
        parentSessionId: "parent-session",
        nativeCallId: "call-security",
        delegationId: "delegation-security",
        workId: "work-b",
        workItemId: "item-security",
        specialist: "security-auditor",
        childSessionId: "child-security",
        bindingId: "binding-security",
        receiptHash: "receipt-hash",
        receiptPhase: "applied",
        receiptAccepted: "true",
        diagnosticCode: "not-observed",
        observedModel: "provider/model",
        workStatus: "active",
        executionId: "execution-security",
        executionStatus: "completed",
        leaseId: "lease-security",
        leaseStatus: "released",
        fencingToken: "1",
        buildId: "build",
      },
    ];
    const childExports = [
      {
        messages: [
          {
            parts: [
              {
                type: "tool",
                tool: "read",
                state: {
                  input: { filePath: "src/auth.ts" },
                  output: "return user !== undefined",
                },
              },
            ],
          },
        ],
      },
    ];
    const turn5ProductDiff =
      "diff -- src/total.ts\ndiff -- tests/total.test.ts\n+NEGATIVE_AMOUNT";

    expect(() =>
      verifyLiveScenarioFunction(
        8,
        attempts,
        childExports,
        turn5ProductDiff,
        turn8Scope,
      ),
    ).not.toThrow();
    expect(turn8Scope.turnDelta).toEqual({
      added: [],
      removed: [],
      modified: [],
    });
    expect(turn8Scope.cumulativeDelta.modified).toEqual([
      "src/total.ts",
      "tests/total.test.ts",
    ]);
    expect(smokeEvaluation("PASS", 8, "PASS")["CALIDAD DEL CONTENIDO"]).toEqual(
      expect.objectContaining({ status: "PENDING_REVIEW" }),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("turn-2 evidence is independent of model wording and keeps content pending", () => {
  const scope = {
    turn: 2,
    turnDelta: { added: [], removed: [], modified: [] },
  } as unknown as Parameters<typeof verifyLiveScenarioFunction>[4];
  const attempt = {
    turn: 2,
    specialist: "explorer",
    nativeCallId: "call-explorer",
  } as NativeAttemptEvidence;
  for (const wording of [
    "Revisé el archivo y sus dos casos.",
    "The tests cover sums positive, empty total, toBe; not executed.",
  ]) {
    expect(() =>
      verifyLiveScenarioFunction(
        2,
        [attempt],
        [
          {
            messages: [
              {
                parts: [
                  { type: "text", text: wording },
                  {
                    type: "tool",
                    tool: "read",
                    state: {
                      input: { filePath: "tests/total.test.ts" },
                      output: "test source",
                    },
                  },
                ],
              },
            ],
          },
        ],
        "",
        scope,
      ),
    ).not.toThrow();
    expect(
      smokeEvaluation("PASS", 2, "NOT_RUN")["CALIDAD DEL CONTENIDO"].status,
    ).toBe("PENDING_REVIEW");
    expect(
      smokeEvaluation("PASS", 2, "NOT_RUN")["RESULTADO FUNCIONAL"].status,
    ).toBe("NOT_RUN");
  }
});

test("functional verdict requires executed passing tests and actual positive, empty, negative behavior", () => {
  const passingTests = {
    status: 0,
    signal: null,
    stdout: "3 pass\n0 fail\n0 skip\n",
    stderr: "",
  };
  expect(
    validateFunctionalChecks(passingTests, {
      status: 0,
      signal: null,
      stdout: '{"positive":true,"empty":true,"negative":true}\n',
      stderr: "",
    }),
  ).toMatchObject({ testCount: 3 });
  expect(() =>
    validateFunctionalChecks(passingTests, {
      status: 0,
      signal: null,
      stdout:
        '{"positive":true,"empty":true,"negative":false,"summary":"all correct"}',
      stderr: "",
    }),
  ).toThrow("FUNCTIONAL_TOTAL_CONTRACT_EXPECTATION_FAILED");
  expect(() =>
    validateFunctionalChecks(
      { ...passingTests, stdout: "0 pass\n0 fail\n3 skip\n" },
      {
        status: 0,
        signal: null,
        stdout: '{"positive":true,"empty":true,"negative":true}',
        stderr: "",
      },
    ),
  ).toThrow("FUNCTIONAL_FIXTURE_TESTS_NOT_PROVEN_PASS");
});

test("turn-8 authorization result cannot substitute for an auth.ts scope change", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "pulso-turn8-auth-scope-"));
  try {
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, "tests"), { recursive: true });
    await writeFile(join(workspace, "src/total.ts"), "original total\n");
    await writeFile(join(workspace, "tests/total.test.ts"), "original tests\n");
    await writeFile(join(workspace, "src/auth.ts"), "original auth\n");
    const baseline = await captureFixtureSnapshot(workspace);
    await writeFile(join(workspace, "src/total.ts"), "turn-5 total edit\n");
    await writeFile(
      join(workspace, "tests/total.test.ts"),
      "turn-5 negative test\n",
    );
    const afterExecutor = await captureFixtureSnapshot(workspace);
    await writeFile(join(workspace, "src/auth.ts"), "unauthorized edit\n");
    const after = await captureFixtureSnapshot(workspace);
    let functionalCheckCalled = false;
    expect(() => {
      const scope = assertFixtureAfterTurn(8, baseline, afterExecutor, after);
      functionalCheckCalled = true;
      verifyLiveScenarioFunction(8, [], [], "historical diff", scope);
    }).toThrow("TURN_8_UNAUTHORIZED_CUMULATIVE_SCOPE");
    expect(functionalCheckCalled).toBe(false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("redacts credential properties in transcripts", () => {
  expect(
    sanitizeForTranscript({
      client_secret: "dummy-client-secret",
      private_key: "dummy-private-key",
    }),
  ).toEqual({
    client_secret: "[REDACTED]",
    private_key: "[REDACTED]",
  });
});

test("reference rejected before dispatch keeps its ID without inventing execution authority", () => {
  const referenceId = "d5304588-e374-4cec-9608-dab8604681a6";
  const attempts = attemptEvidence(
    [
      {
        type: "tool_use",
        sessionID: "parent",
        part: {
          tool: "task",
          callID: "rejected-call",
          state: {
            status: "error",
            input: {
              description: "label",
              subagent_type: "explorer",
              prompt: `pulso-dispatch/1:${referenceId}`,
            },
            error: "PREPARATION_EXPIRED: reference expired",
          },
        },
      },
    ],
    1,
  );
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({
    delegationId: referenceId,
    nativeCallId: "rejected-call",
    executionId: "not-observed",
    bindingId: "not-observed",
    receiptAccepted: "not-observed",
  });
  expect(attempts[0]?.parseError).toBeUndefined();
});
