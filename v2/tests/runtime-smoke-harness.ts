import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { parseNativeDispatchReference } from "../packages/capabilities-mcp/src/opencode/native-dispatch-reference";
import {
  applyOpenCodeInstall,
  type OpenCodeManifest,
  planOpenCodeInstall,
} from "../packages/installer/src/runtimes/opencode-installer";
import type { ResolvedAgentModelConfig } from "../packages/installer/src/wizard/model-profiles";
import { agentIds } from "../packages/orchestration/src/agents/definitions";
import { parseTaskEnvelope } from "../packages/orchestration/src/protocol/parse";
import type { TaskEnvelope } from "../packages/orchestration/src/protocol/schemas";
import type {
  AgentId,
  CanonicalSkill,
} from "../packages/orchestration/src/runtimes/types";
import { workspaceId } from "../packages/working-system/src/bootstrap";
import {
  assertFixtureAfterTurn,
  assertFixtureBaseline,
  assertFixtureBeforeTurn,
  assertFixtureFinalScope,
  captureFixtureSnapshot,
  compareFixtureSnapshots,
  type FixtureSnapshot,
  type FixtureTurnScope,
} from "./support/fixture-scope";
import {
  consolidateNativeCalls,
  type NativeCallEvidence,
  sanitizeEvidence,
  validateAttemptAuthority,
  validateNativeDispatchIdentity,
} from "./support/native-evidence";
import { readNativeState } from "./support/read-native-state";
import { SmokeArtifactArchive } from "./support/smoke-artifacts";

export const certifiedOpenCodeVersion = "1.18.32";
export const liveNotRunExitCode = 2;
const opencodeName = "opencode";
const root = resolve(import.meta.dir, "..");
const fixturesDirectory = join(root, "fixtures");
const nativeScenarioPath = join(fixturesDirectory, "native-scenario.json");
const technicalTools = new Set([
  "read",
  "grep",
  "glob",
  "bash",
  "edit",
  "apply_patch",
  "todowrite",
]);

type JsonRecord = Record<string, unknown>;
export type RuntimeEvent = {
  type?: string;
  timestamp?: number;
  sessionID?: string;
  part?: {
    tool?: string;
    callID?: string;
    messageID?: string;
    text?: string;
    state?: {
      status?: string;
      input?: JsonRecord;
      output?: string;
      error?: string;
      metadata?: JsonRecord;
    };
    metadata?: JsonRecord;
  };
};

export type NativeScenarioMessage = {
  turn: number;
  text: string;
  expectedWork: "A" | "B";
};
export type NativeScenario = {
  name: string;
  notes: string;
  files: Record<string, string>;
  messages: NativeScenarioMessage[];
  expected: {
    sameParentSession: boolean;
    workAUnchangedTurns: number[];
    workBNotEqualA: boolean;
    workAStillNotClosedAfter8: boolean;
    specialistsObserved: string[];
    securityFinding: string;
    authFileMustNotChange: boolean;
    noCommit: boolean;
    noAutomaticSemanticRetry: boolean;
  };
};

export type MultiTurnRecord = {
  turn: number;
  message: string;
  sessionId?: string;
  processExitCode: number | null;
  eventCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCount: number;
  directPulsoToolCount: number;
  directTechnicalToolCount: number;
  taskCount: number;
  mcpErrors: string[];
  workIds: string[];
  workStatuses: string[];
};

export type NativeAttemptEvidence = {
  turn: number;
  parentSessionId: string | "not-observed";
  nativeCallId: string | "not-observed";
  delegationId: string | "not-observed";
  workId: string | "not-observed";
  workItemId: string | "not-observed";
  specialist: string | "not-observed";
  childSessionId: string | "not-observed";
  bindingId: string | "not-observed";
  receiptHash: string | "not-observed";
  receiptPhase: string | "not-observed";
  receiptAccepted: string | "not-observed";
  diagnosticCode: string | "not-observed";
  observedModel: string | "not-observed";
  workStatus: string | "not-observed";
  executionId: string | "not-observed";
  executionStatus: string | "not-observed";
  leaseId: string | "not-observed";
  leaseStatus: string | "not-observed";
  fencingToken: string | "not-observed";
  buildId: string | "not-observed";
  taskStatus?: string;
  error?: string;
  workItemStatus?: string;
  bindingStatus?: string;
  transportPhase?: string;
  sideEffectsMayContinue?: boolean;
  stage?: "prepared" | "dispatched" | "rejected" | "unknown";
  parseError?: string;
};

export type EvidenceSource = "fixture" | "live";
export type SmokeStatus = "PASS" | "FAIL" | "NOT_RUN" | "BLOCKED";
export type SmokeSectionStatus = SmokeStatus | "PENDING_REVIEW";
export type SmokeEvaluation = {
  "INTEGRACIÓN TÉCNICA": {
    status: SmokeSectionStatus;
    verifiedThroughTurn: number;
  };
  "RESULTADO FUNCIONAL": {
    status: SmokeSectionStatus;
    checks: string[];
  };
  "CALIDAD DEL CONTENIDO": {
    status: "PENDING_REVIEW";
    evidence: string;
  };
};

export const smokeEvaluation = (
  integration: SmokeSectionStatus,
  verifiedThroughTurn: number,
  functional: SmokeSectionStatus,
  functionalChecks: string[] = [],
): SmokeEvaluation => ({
  "INTEGRACIÓN TÉCNICA": { status: integration, verifiedThroughTurn },
  "RESULTADO FUNCIONAL": { status: functional, checks: functionalChecks },
  "CALIDAD DEL CONTENIDO": {
    status: "PENDING_REVIEW",
    evidence:
      "Conservar exports/trazas para revisión humana; sin revisión registrada.",
  },
});

export type SanitizedFailure = {
  stage:
    | "provider_auth_confirmed"
    | "provider_access"
    | "provider_rate_limit"
    | "transport_timeout"
    | "protocol_schema"
    | "native_dispatch"
    | "unknown";
  code: string;
  message: string;
};

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(`SMOKE_ASSERTION_FAILED:${message}`);
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const redactString = (source: string) =>
  source
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(
      /\b(?:sk|sbp|sb_secret|plane_api)_[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    )
    .replace(
      /((?:(?:access|refresh|api)[_-]?(?:key|token)|client[_-]?secret|private[_-]?key|token|secret|password))\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );

export const sanitizeForTranscript = (value: unknown): unknown =>
  sanitizeEvidence(value);

export const decodeEvents = (source: string): RuntimeEvent[] =>
  source
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as RuntimeEvent;
        return [
          "tool_use",
          "user.message",
          "text",
          "step_start",
          "step_finish",
          "error",
          "reasoning",
        ].includes(event.type ?? "")
          ? [event]
          : [];
      } catch {
        return [];
      }
    });

export const commandTimeoutForCategory = (category: string) =>
  category === "run" || /^turn-[1-8]$/.test(category) ? 180_000 : 30_000;

const stringArray = (value: unknown, label: string) => {
  assert(
    Array.isArray(value) && value.every((entry) => typeof entry === "string"),
    `NATIVE_SCENARIO_${label}_INVALID`,
  );
  return value as string[];
};

const numberArray = (value: unknown, label: string) => {
  assert(
    Array.isArray(value) && value.every((entry) => Number.isInteger(entry)),
    `NATIVE_SCENARIO_${label}_INVALID`,
  );
  return value as number[];
};

const parseNativeScenario = (value: unknown): NativeScenario => {
  assert(isRecord(value), "NATIVE_SCENARIO_ROOT_INVALID");
  assert(typeof value.name === "string", "NATIVE_SCENARIO_NAME_INVALID");
  assert(typeof value.notes === "string", "NATIVE_SCENARIO_NOTES_INVALID");
  assert(isRecord(value.files), "NATIVE_SCENARIO_FILES_INVALID");
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(value.files)) {
    assert(typeof content === "string", "NATIVE_SCENARIO_FILE_CONTENT_INVALID");
    files[path] = content;
  }
  assert(Array.isArray(value.messages), "NATIVE_SCENARIO_MESSAGES_INVALID");
  const messages: NativeScenarioMessage[] = value.messages.map(
    (entry, index) => {
      assert(isRecord(entry), "NATIVE_SCENARIO_MESSAGE_INVALID");
      assert(entry.turn === index + 1, "NATIVE_SCENARIO_TURN_ORDER_INVALID");
      assert(
        typeof entry.text === "string",
        "NATIVE_SCENARIO_MESSAGE_TEXT_INVALID",
      );
      assert(
        entry.expectedWork === "A" || entry.expectedWork === "B",
        "NATIVE_SCENARIO_EXPECTED_WORK_INVALID",
      );
      return {
        turn: index + 1,
        text: entry.text,
        expectedWork: entry.expectedWork,
      };
    },
  );
  assert(messages.length === 8, "NATIVE_SCENARIO_REQUIRES_EIGHT_TURNS");
  assert(isRecord(value.expected), "NATIVE_SCENARIO_EXPECTED_INVALID");
  const expected = value.expected;
  const booleanField = (key: string) => {
    const field = expected[key];
    assert(typeof field === "boolean", `NATIVE_SCENARIO_${key}_INVALID`);
    return field;
  };
  const sameParentSession = booleanField("sameParentSession");
  const workBNotEqualA = booleanField("workBNotEqualA");
  const workAStillNotClosedAfter8 = booleanField("workAStillNotClosedAfter8");
  const authFileMustNotChange = booleanField("authFileMustNotChange");
  const noCommit = booleanField("noCommit");
  const noAutomaticSemanticRetry = booleanField("noAutomaticSemanticRetry");
  assert(
    typeof expected.securityFinding === "string",
    "NATIVE_SCENARIO_FINDING_INVALID",
  );
  return {
    name: value.name,
    notes: value.notes,
    files,
    messages,
    expected: {
      sameParentSession,
      workAUnchangedTurns: numberArray(
        expected.workAUnchangedTurns,
        "WORK_A_TURNS",
      ),
      workBNotEqualA,
      workAStillNotClosedAfter8,
      specialistsObserved: stringArray(
        expected.specialistsObserved,
        "SPECIALISTS",
      ),
      securityFinding: expected.securityFinding,
      authFileMustNotChange,
      noCommit,
      noAutomaticSemanticRetry,
    },
  };
};

export const loadNativeScenario = async () =>
  parseNativeScenario(JSON.parse(await readFile(nativeScenarioPath, "utf8")));

export const scenarioMessages = async () =>
  (await loadNativeScenario()).messages.map((message) => message.text);

export const sessionIdFromEvents = (events: RuntimeEvent[]) =>
  events.find((event) => typeof event.sessionID === "string")?.sessionID;

const workFromEvents = (events: RuntimeEvent[]) => {
  const values = events.flatMap((event) => {
    const tool = event.part?.tool;
    if (tool === "pulso_native_work") {
      try {
        const output = JSON.parse(event.part?.state?.output ?? "") as unknown;
        if (!isRecord(output)) return [];
        return isRecord(output.currentWork) ? [output.currentWork] : [output];
      } catch {
        return [];
      }
    }
    if (tool === "pulso_prepare") {
      const state = event.part?.state;
      const output = recordFromOutput(state?.output);
      const metadata = isRecord(state?.metadata)
        ? state.metadata
        : isRecord(output?.metadata)
          ? output.metadata
          : undefined;
      return metadata && typeof metadata.workId === "string"
        ? [{ workId: metadata.workId, status: metadata.workStatus }]
        : [];
    }
    return [];
  });
  const current = values.at(-1);
  return {
    ids: typeof current?.workId === "string" ? [current.workId] : [],
    statuses: typeof current?.status === "string" ? [current.status] : [],
  };
};

const recordFromOutput = (output: string | undefined) => {
  try {
    const parsed = JSON.parse(output ?? "") as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const field = (value: JsonRecord | undefined, key: string) =>
  typeof value?.[key] === "string" ? value[key] : "not-observed";

export const attemptEvidence = (
  events: RuntimeEvent[],
  turn: number,
  snapshot?: ReturnType<typeof readNativeState>,
): NativeAttemptEvidence[] => {
  const attempts: NativeAttemptEvidence[] = [];
  for (const event of events) {
    if (event.part?.tool !== "task") continue;
    const base = {
      turn,
      parentSessionId: event.sessionID ?? "not-observed",
      nativeCallId: event.part.callID ?? "not-observed",
      delegationId: "not-observed",
      workId: "not-observed",
      workItemId: "not-observed",
      specialist: "not-observed",
      childSessionId: "not-observed",
      bindingId: "not-observed",
      receiptHash: "not-observed",
      receiptPhase: "not-observed",
      receiptAccepted: "not-observed",
      diagnosticCode: "not-observed",
      observedModel: "not-observed",
      workStatus: "not-observed",
      executionId: "not-observed",
      executionStatus: "not-observed",
      leaseId: "not-observed",
      leaseStatus: "not-observed",
      fencingToken: "not-observed",
      buildId: "not-observed",
      taskStatus: event.part.state?.status,
      error: event.part.state?.error,
      stage: "unknown",
    } satisfies NativeAttemptEvidence;
    const task = event.part.state?.input?.prompt;
    if (typeof task !== "string") {
      attempts.push({
        ...base,
        parseError: "TASK_PROMPT_NOT_OBSERVED",
        error: event.part.state?.error ?? "TASK_PROMPT_NOT_OBSERVED",
      });
      continue;
    }
    try {
      const referenceId = parseNativeDispatchReference(task);
      // A rejected reference can identify a preparation, not an authorized call.
      // Never infer binding/Execution/lease from "the most recent" preparation.
      const scopedSnapshot =
        snapshot?.parentSessionId === event.sessionID ? snapshot : undefined;
      const preparation = referenceId
        ? scopedSnapshot?.calls.find(
            (candidate) => candidate.delegationId === referenceId,
          )
        : undefined;
      const envelope = referenceId
        ? {
            delegationId: referenceId,
            specialist: preparation?.specialist ?? "not-observed",
            work: {
              workId: preparation?.workId ?? "not-observed",
              workItemId: preparation?.workItemId ?? "not-observed",
            },
          }
        : parseTaskEnvelope(task);
      const receipt = recordFromOutput(event.part.state?.output);
      const persisted = scopedSnapshot?.calls.find(
        (candidate) =>
          candidate.parentCallId === event.part?.callID &&
          candidate.delegationId === envelope.delegationId,
      );
      const persistedAttempt = persisted?.attempt;
      const authority = persistedAttempt?.authority;
      const metadata = event.part.state?.metadata ?? event.part.metadata;
      const pulso = isRecord(metadata?.pulso) ? metadata.pulso : undefined;
      const model = isRecord(pulso?.model) ? pulso.model : undefined;
      const nativeModel = isRecord(metadata?.model)
        ? metadata.model
        : undefined;
      const receiptHash = field(receipt ?? undefined, "receiptHash");
      const buildId = field(pulso, "buildId");
      const receiptAccepted =
        typeof receipt?.accepted === "boolean"
          ? String(receipt.accepted)
          : "not-observed";
      const diagnostic = persisted?.diagnostic;
      attempts.push({
        ...base,
        delegationId: envelope.delegationId,
        workId: envelope.work.workId,
        workItemId: envelope.work.workItemId,
        specialist: envelope.specialist,
        childSessionId: persisted?.childSessionId ?? "not-observed",
        bindingId: persisted?.bindingId ?? "not-observed",
        receiptHash:
          receiptHash !== "not-observed"
            ? receiptHash
            : (persistedAttempt?.receiptHash ?? "not-observed"),
        receiptPhase: persisted?.receiptPhase ?? "not-observed",
        receiptAccepted:
          receiptAccepted !== "not-observed"
            ? receiptAccepted
            : persistedAttempt?.accepted === undefined
              ? "not-observed"
              : String(persistedAttempt.accepted),
        diagnosticCode:
          isRecord(diagnostic) && typeof diagnostic.code === "string"
            ? diagnostic.code
            : "not-observed",
        observedModel:
          typeof nativeModel?.providerID === "string" &&
          typeof nativeModel.modelID === "string"
            ? `${nativeModel.providerID}/${nativeModel.modelID}`
            : typeof model?.providerId === "string" &&
                typeof model.modelId === "string"
              ? `${model.providerId}/${model.modelId}`
              : "not-observed",
        workStatus: persistedAttempt?.workStatus ?? "not-observed",
        executionId: authority?.executionId ?? "not-observed",
        executionStatus: authority?.executionStatus ?? "not-observed",
        leaseId: authority?.leaseId ?? "not-observed",
        leaseStatus: authority?.leaseStatus ?? "not-observed",
        fencingToken: authority
          ? String(authority.fencingToken)
          : "not-observed",
        buildId,
        workItemStatus: persistedAttempt?.workItemStatus,
        bindingStatus: persistedAttempt?.bindingStatus,
        transportPhase:
          persisted?.transportPhase ?? preparation?.transportPhase,
        sideEffectsMayContinue: persisted?.sideEffectsMayContinue,
      });
    } catch (error) {
      attempts.push({
        ...base,
        parseError: `${event.part.callID ?? "unknown"}:TASK_ENVELOPE_PARSE_FAILED:${redactString(String(error)).slice(0, 300)}`,
        error: base.error ?? "TASK_ENVELOPE_PARSE_FAILED",
      });
    }
  }
  const callRecords: NativeCallEvidence[] = attempts.map((attempt) => ({
    turn: attempt.turn,
    parentSessionId:
      attempt.parentSessionId === "not-observed"
        ? undefined
        : attempt.parentSessionId,
    parentCallId: attempt.nativeCallId,
    stage:
      attempt.receiptPhase === "applied"
        ? "dispatched"
        : attempt.receiptPhase === "rejected"
          ? "rejected"
          : attempt.bindingId !== "not-observed"
            ? "dispatched"
            : "unknown",
    ...(attempt.error ? { error: attempt.error } : {}),
    ...(attempt.delegationId !== "not-observed"
      ? { delegationId: attempt.delegationId }
      : {}),
    attempts: [
      attempt as unknown as import("./support/native-evidence").NativeAttemptEvidence,
    ],
  }));
  const consolidated = consolidateNativeCalls(callRecords);
  return consolidated.map((call) => {
    const observations = call.attempts as unknown as NativeAttemptEvidence[];
    const initial = observations[0];
    if (!initial)
      throw new Error(`NATIVE_CALL_EVIDENCE_EMPTY:${call.parentCallId}`);
    const merged = { ...initial };
    for (const observation of observations.slice(1)) {
      if (
        merged.delegationId !== "not-observed" &&
        observation.delegationId !== "not-observed" &&
        merged.delegationId !== observation.delegationId
      )
        merged.error = `CALL_ID_DELEGATION_ID_CHANGED:${call.parentCallId}`;
      for (const [key, value] of Object.entries(observation) as Array<
        [
          keyof NativeAttemptEvidence,
          NativeAttemptEvidence[keyof NativeAttemptEvidence],
        ]
      >)
        if (value !== undefined && value !== "not-observed")
          (merged as unknown as Record<string, unknown>)[key] = value;
    }
    return merged;
  });
};

export const assertIndependentMultiTurnSession = (turns: MultiTurnRecord[]) => {
  assert(turns.length === 8, "MULTITURN_REQUIRES_EIGHT_TURNS");
  assert(
    turns.every((turn, index) => turn.turn === index + 1),
    "MULTITURN_TURN_ORDER_INVALID",
  );
  assert(
    !turns
      .slice(0, 7)
      .flatMap((turn) => turn.workStatuses)
      .some((status) => status === "completed" || status === "cancelled"),
    "MULTITURN_WORK_A_CLOSED_EARLY",
  );
  const sessions = new Set(turns.map((turn) => turn.sessionId).filter(Boolean));
  assert(sessions.size === 1, "MULTITURN_CREATED_MORE_THAN_ONE_SESSION");
  assert(
    turns.every(
      (turn) =>
        turn.eventCount > 0 &&
        turn.userMessageCount === 1 &&
        turn.processExitCode === 0 &&
        turn.assistantMessageCount > 0 &&
        typeof turn.sessionId === "string" &&
        turn.sessionId.length > 0,
    ),
    "MULTITURN_MESSAGES_NOT_INDEPENDENT",
  );
  assert(
    turns.every((turn) => turn.directTechnicalToolCount === 0),
    "MULTITURN_DIRECT_TECHNICAL_TOOL_OBSERVED",
  );
};

export const assertNativeScenarioContinuity = (
  scenario: NativeScenario,
  turns: MultiTurnRecord[],
) => {
  assertIndependentMultiTurnSession(turns);
  assert(
    turns.every(
      (turn, index) => turn.message === scenario.messages[index]?.text,
    ),
    "MULTITURN_SCENARIO_MESSAGE_CHANGED",
  );
  const workA = turns[0]?.workIds[0];
  const workB = turns[7]?.workIds[0];
  assert(Boolean(workA), "MULTITURN_WORK_A_NOT_OBSERVED");
  assert(Boolean(workB), "MULTITURN_WORK_B_NOT_OBSERVED");
  assert(
    turns
      .slice(0, 7)
      .every((turn) => turn.workIds.length === 1 && turn.workIds[0] === workA),
    "MULTITURN_WORK_A_CONTINUITY_LOST",
  );
  assert(workB !== workA, "MULTITURN_WORK_B_NOT_NEW");
};

const assertScenarioSpecialists = (
  scenario: NativeScenario,
  attempts: NativeAttemptEvidence[],
) => {
  const observed = new Set(attempts.map((attempt) => attempt.specialist));
  assert(
    scenario.expected.specialistsObserved.every((specialist) =>
      observed.has(specialist),
    ),
    "MULTITURN_SPECIALISTS_NOT_OBSERVED",
  );
  assert(
    attempts.every((attempt) => {
      const required = [
        attempt.nativeCallId,
        attempt.childSessionId,
        attempt.bindingId,
        attempt.receiptHash,
        attempt.receiptPhase,
        attempt.receiptAccepted,
        attempt.executionId,
        attempt.executionStatus,
        attempt.leaseId,
        attempt.leaseStatus,
        attempt.fencingToken,
        attempt.buildId,
      ];
      return required.every((value) => value !== "not-observed");
    }),
    `NATIVE_ATTEMPT_EVIDENCE_INCOMPLETE:${JSON.stringify(
      attempts.map((attempt) => ({
        turn: attempt.turn,
        specialist: attempt.specialist,
        nativeCallId: attempt.nativeCallId,
        childSessionId: attempt.childSessionId,
        bindingId: attempt.bindingId,
        receiptHash: attempt.receiptHash,
        receiptPhase: attempt.receiptPhase,
        receiptAccepted: attempt.receiptAccepted,
        diagnosticCode: attempt.diagnosticCode,
        executionId: attempt.executionId,
        executionStatus: attempt.executionStatus,
        leaseId: attempt.leaseId,
        leaseStatus: attempt.leaseStatus,
        fencingToken: attempt.fencingToken,
        buildId: attempt.buildId,
      })),
    )}`,
  );
  assert(
    attempts.every(
      (attempt) =>
        attempt.receiptPhase === "applied" &&
        attempt.receiptAccepted === "true" &&
        attempt.executionStatus === "completed" &&
        attempt.leaseStatus === "released" &&
        attempt.bindingStatus === "completed" &&
        attempt.transportPhase === "closed" &&
        attempt.workStatus !== "completed" &&
        attempt.workStatus !== "cancelled",
    ),
    "NATIVE_ATTEMPT_NOT_ACCEPTED_OR_TERMINAL",
  );
};

export const failureFrom = (value: unknown): SanitizedFailure => {
  const message = redactString(
    value instanceof Error ? value.message : String(value),
  ).slice(0, 4_096);
  const code =
    /\b(?:[A-Z][A-Z0-9]*_){1,}[A-Z][A-Z0-9]*\b/.exec(message)?.[0] ??
    "HOST_COMMAND_FAILED";
  if (
    /provider/i.test(message) &&
    /(?:401|unauthenticated|invalid[_ -]?api)/i.test(message)
  )
    return { stage: "provider_auth_confirmed", code, message };
  if (/provider/i.test(message) && /(?:403|forbidden)/i.test(message))
    return { stage: "provider_access", code, message };
  if (/provider/i.test(message) && /(?:429|rate limit)/i.test(message))
    return { stage: "provider_rate_limit", code, message };
  if (/timeout|connection|network/i.test(message))
    return { stage: "transport_timeout", code, message };
  if (/PROTOCOL|AGENT_RESULT|TASK_ENVELOPE/.test(code))
    return { stage: "protocol_schema", code, message };
  if (/NATIVE_DISPATCH|PREPARATION|IDENTITY_MISMATCH/.test(code))
    return { stage: "native_dispatch", code, message };
  return { stage: "unknown", code, message };
};

export const evidenceSourceFor = (mode: "offline" | "live"): EvidenceSource =>
  mode === "live" ? "live" : "fixture";

const canonicalSkills = async (): Promise<CanonicalSkill[]> => {
  const skillsRoot = join(root, "packages/orchestration/skills");
  const entries = await (await import("node:fs/promises")).readdir(skillsRoot, {
    withFileTypes: true,
  });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        id: entry.name as CanonicalSkill["id"],
        content: await readFile(
          join(skillsRoot, entry.name, "SKILL.md"),
          "utf8",
        ),
      })),
  );
};

const inheritedModels: ResolvedAgentModelConfig = {
  profile: "inherited",
  agents: Object.fromEntries(agentIds.map((id) => [id, null])) as Record<
    AgentId,
    null
  >,
};

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const fileExists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return false;
    throw error;
  }
};

const executablePath = async (
  name = process.env.OPENCODE_EXECUTABLE ?? opencodeName,
) => {
  const candidates = isAbsolute(name)
    ? [name]
    : (process.env.PATH ?? "")
        .split(delimiter)
        .filter(Boolean)
        .map((directory) => join(directory, name));
  for (const candidate of candidates)
    try {
      await access(candidate);
      return realpath(candidate);
    } catch {
      // Keep looking: PATH may contain an unreadable or non-executable candidate.
    }
  throw new Error(`OPENCODE_EXECUTABLE_UNAVAILABLE:${name}`);
};

type CommandResult = {
  status: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};

const runCommand = async (
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number },
): Promise<CommandResult> =>
  new Promise((resolveResult, rejectResult) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timeout = setTimeout(() => child.kill("SIGTERM"), options.timeout);
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolveResult({ status, signal, stdout, stderr });
    });
  });

export const validateFunctionalChecks = (
  testRun: CommandResult,
  contractRun: CommandResult,
) => {
  const testOutput = `${testRun.stdout}\n${testRun.stderr}`;
  const passCount = Number(testOutput.match(/^\s*(\d+)\s+pass\b/m)?.[1] ?? 0);
  const failCount = Number(testOutput.match(/^\s*(\d+)\s+fail\b/m)?.[1] ?? 0);
  const skipCount = Number(
    testOutput.match(/^\s*(\d+)\s+skip(?:ped)?\b/m)?.[1] ?? 0,
  );
  assert(
    testRun.status === 0 && passCount > 0 && failCount === 0 && skipCount === 0,
    "FUNCTIONAL_FIXTURE_TESTS_NOT_PROVEN_PASS",
  );
  assert(contractRun.status === 0, "FUNCTIONAL_TOTAL_CONTRACT_CHECK_FAILED");
  let contract: unknown;
  try {
    contract = JSON.parse(contractRun.stdout);
  } catch {
    throw new Error("FUNCTIONAL_TOTAL_CONTRACT_OUTPUT_INVALID");
  }
  assert(
    isRecord(contract) &&
      contract.positive === true &&
      contract.empty === true &&
      contract.negative === true,
    "FUNCTIONAL_TOTAL_CONTRACT_EXPECTATION_FAILED",
  );
  return {
    testCount: passCount,
    checks: [
      "positive total",
      "empty total",
      "negative throws NEGATIVE_AMOUNT",
    ],
  };
};

const runFunctionalContractCheck = (
  workspace: string,
  env: NodeJS.ProcessEnv,
) =>
  runCommand(
    "bun",
    [
      "-e",
      [
        'import { total } from "./src/total.ts";',
        "const checks = { positive: total([2, 3]) === 5, empty: total([]) === 0, negative: false };",
        'try { total([-1]); } catch (error) { checks.negative = error instanceof Error && error.message === "NEGATIVE_AMOUNT"; }',
        "console.log(JSON.stringify(checks));",
        "if (!Object.values(checks).every(Boolean)) process.exitCode = 1;",
      ].join("\n"),
    ],
    { cwd: workspace, env, timeout: commandTimeoutForCategory("run") },
  );

const stageScenario = async (workspace: string, scenario: NativeScenario) => {
  for (const [path, content] of Object.entries(scenario.files)) {
    const destination = resolve(workspace, path);
    assert(
      relative(workspace, destination) &&
        !relative(workspace, destination).startsWith(".."),
      "NATIVE_SCENARIO_PATH_ESCAPES_WORKSPACE",
    );
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, content, { mode: 0o600 });
  }
};

const initializeFixtureRepository = async (
  workspace: string,
  env: NodeJS.ProcessEnv,
  scenario: NativeScenario,
) => {
  const initialized = await runCommand("git", ["init", "--quiet"], {
    cwd: workspace,
    env,
    timeout: commandTimeoutForCategory("git"),
  });
  assert(initialized.status === 0, "NATIVE_SCENARIO_GIT_INIT_FAILED");
  const added = await runCommand(
    "git",
    ["add", "--", ...Object.keys(scenario.files)],
    { cwd: workspace, env, timeout: commandTimeoutForCategory("git") },
  );
  assert(added.status === 0, "NATIVE_SCENARIO_GIT_BASELINE_ADD_FAILED");
  const tree = await runCommand("git", ["write-tree"], {
    cwd: workspace,
    env,
    timeout: commandTimeoutForCategory("git"),
  });
  assert(
    tree.status === 0 && /^[0-9a-f]+\s*$/i.test(tree.stdout),
    "NATIVE_SCENARIO_GIT_BASELINE_TREE_FAILED",
  );
  return tree.stdout.trim();
};

const assertFixtureHasNoCommit = async (
  workspace: string,
  env: NodeJS.ProcessEnv,
) => {
  const head = await runCommand("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: workspace,
    env,
    timeout: commandTimeoutForCategory("git"),
  });
  assert(head.status !== 0, "NATIVE_SCENARIO_COMMIT_CREATED");
};

export type InstalledAssets = {
  buildId: string;
  configPath: string;
  manifestPath: string;
  nativeBridgePath: string;
  manifest: OpenCodeManifest;
  manifestSha256: string;
  allManagedAssetsMatch: boolean;
  inherited: boolean;
  config: unknown;
};

export const managedInstallerAssetPaths = (
  workspace: string,
  installed: Pick<
    InstalledAssets,
    "configPath" | "manifestPath" | "nativeBridgePath"
  >,
  manifest: OpenCodeManifest,
) =>
  new Set(
    [
      ...Object.keys(manifest.files),
      installed.configPath,
      installed.manifestPath,
      installed.nativeBridgePath,
    ].map((path) => (isAbsolute(path) ? relative(workspace, path) : path)),
  );

const inspectInstalledAssets = async (
  workspace: string,
): Promise<InstalledAssets> => {
  const configPath = join(workspace, ".opencode/opencode.json");
  const manifestPath = join(workspace, ".opencode/.pulso-manifest.json");
  const configValue = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as OpenCodeManifest;
  assert(typeof manifest.buildId === "string", "INSTALLED_BUILD_ID_MISSING");
  assert(
    manifest.nativeBridge.role === "native-bridge",
    "INSTALLED_NATIVE_BRIDGE_ROLE_INVALID",
  );
  assert(
    manifest.nativeBridge.version === certifiedOpenCodeVersion,
    "INSTALLED_NATIVE_BRIDGE_VERSION_INVALID",
  );
  assert(isRecord(configValue), "INSTALLED_CONFIG_INVALID");
  const plugins = configValue.plugin;
  assert(
    Array.isArray(plugins) &&
      plugins.includes("./plugins/pulso-protocol-guard.js"),
    "INSTALLED_NATIVE_BRIDGE_NOT_CONFIGURED",
  );
  assert(!("mcp" in configValue), "LEGACY_MCP_CONFIGURED_FOR_NATIVE_BRIDGE");
  const allManagedAssetsMatch = (
    await Promise.all(
      Object.entries(manifest.files).map(async ([path, expected]) => {
        try {
          return digest(await readFile(path, "utf8")) === expected;
        } catch {
          return false;
        }
      }),
    )
  ).every(Boolean);
  const agentAssets = Object.keys(manifest.files).filter((path) =>
    path.includes("/agents/"),
  );
  const inherited = (
    await Promise.all(agentAssets.map((path) => readFile(path, "utf8")))
  ).every((source) => !/^model:/m.test(source));
  return {
    buildId: manifest.buildId,
    configPath,
    manifestPath,
    nativeBridgePath: manifest.nativeBridge.path,
    manifest,
    manifestSha256: digest(manifestRaw),
    allManagedAssetsMatch,
    inherited,
    config: sanitizeForTranscript(configValue),
  };
};

const addScriptedProvider = async (configPath: string, baseURL: string) => {
  const config = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  assert(isRecord(config), "INSTALLED_CONFIG_INVALID");
  const provider = isRecord(config.provider) ? config.provider : {};
  provider["pulso-scripted"] = {
    npm: "@ai-sdk/openai-compatible",
    name: "Pulso scripted fixture provider",
    options: { baseURL },
    models: {
      scripted: {
        name: "Pulso scripted fixture model",
        limit: { context: 32_000, output: 8_000 },
      },
    },
  };
  config.provider = provider;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
};

const messageText = (value: unknown) => {
  if (!Array.isArray(value)) return "";
  return (
    value
      .filter(isRecord)
      .filter((message) => message.role === "user")
      .map((message) => {
        const content = message.content;
        return typeof content === "string"
          ? content
          : JSON.stringify(content ?? "");
      })
      .at(-1) ?? ""
  );
};

const findNativeTaskArgs = (value: unknown): JsonRecord | undefined => {
  let latest: JsonRecord | undefined;
  const visit = (candidate: unknown) => {
    if (typeof candidate === "string") {
      const match =
        /(?:^|\n)([^\r\n]+?) · (planner|explorer|executor|verifier|security-auditor)\r?\n- subagent_type: (planner|explorer|executor|verifier|security-auditor)\r?\n- prompt: (pulso-dispatch\/1:[^\s]+)/.exec(
          candidate,
        );
      if (match && match[2] === match[3])
        latest = {
          description: match[1],
          subagent_type: match[3],
          prompt: match[4],
        };
      try {
        visit(JSON.parse(candidate) as unknown);
      } catch {
        // The user-facing prepare output is Markdown rather than JSON.
      }
      return;
    }
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    const output =
      typeof candidate.output === "string" ? candidate.output : undefined;
    if (output) {
      const match =
        /(?:^|\n)([^\r\n]+?) · (planner|explorer|executor|verifier|security-auditor)\r?\n- subagent_type: (planner|explorer|executor|verifier|security-auditor)\r?\n- prompt: (pulso-dispatch\/1:[^\s]+)/.exec(
          output,
        );
      if (match && match[2] === match[3])
        latest = {
          description: match[1],
          subagent_type: match[3],
          prompt: match[4],
        };
    }
    if (typeof candidate.text === "string") {
      const match =
        /(?:^|\n)([^\r\n]+?) · (planner|explorer|executor|verifier|security-auditor)\r?\n- subagent_type: (planner|explorer|executor|verifier|security-auditor)\r?\n- prompt: (pulso-dispatch\/1:[^\s]+)/.exec(
          candidate.text,
        );
      if (match && match[2] === match[3])
        latest = {
          description: match[1],
          subagent_type: match[3],
          prompt: match[4],
        };
    }
    const taskArgs = candidate.nativeTaskArgs;
    if (
      isRecord(taskArgs) &&
      typeof taskArgs.description === "string" &&
      typeof taskArgs.subagent_type === "string" &&
      typeof taskArgs.prompt === "string"
    )
      latest = taskArgs;
    for (const child of Object.values(candidate)) {
      visit(child);
    }
  };
  visit(value);
  return latest;
};

const delegationIdFrom = (value: unknown): string | undefined => {
  if (typeof value === "string")
    try {
      return delegationIdFrom(JSON.parse(value) as unknown);
    } catch {
      return undefined;
    }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const id = delegationIdFrom(entry);
      if (id) return id;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (typeof value.delegationId === "string") return value.delegationId;
  for (const child of Object.values(value)) {
    const id = delegationIdFrom(child);
    if (id) return id;
  }
  return undefined;
};

const taskWireFrom = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    for (const match of value.matchAll(
      /<pulso-task v="2">[\s\S]*?<\/pulso-task>/g,
    ))
      try {
        parseTaskEnvelope(match[0]);
        return match[0];
      } catch {
        // Agent instructions may include an illustrative task marker before the real wire.
      }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const wire = taskWireFrom(entry);
      if (wire) return wire;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const child of Object.values(value)) {
    const wire = taskWireFrom(child);
    if (wire) return wire;
  }
  return undefined;
};

const specialistForMessage = (message: string) => {
  if (/Security Auditor/.test(message)) return "security-auditor";
  if (/Verifier/.test(message)) return "verifier";
  if (/Planner/.test(message)) return "planner";
  if (/Implementa ahora/.test(message)) return "executor";
  if (/Objetivo A: revisar/.test(message)) return "explorer";
  if (/Continúa el objetivo A\./.test(message)) return "explorer";
  if (/Use the native bridge/.test(message)) return "explorer";
  return undefined;
};

const fixtureForSpecialist = (specialist: string, invalid: boolean) => {
  if (invalid) return "result-explorer-invalid-limitations.json";
  return `result-${specialist}.json`;
};

const scriptedResult = async (taskWire: string, invalid: boolean) => {
  const task: TaskEnvelope = parseTaskEnvelope(taskWire);
  const fixture = JSON.parse(
    await readFile(
      join(fixturesDirectory, fixtureForSpecialist(task.specialist, invalid)),
      "utf8",
    ),
  ) as unknown;
  assert(isRecord(fixture), "SCRIPTED_RESULT_FIXTURE_INVALID");
  return `<pulso-result v="2">${JSON.stringify({
    ...fixture,
    delegationId: task.delegationId,
    specialist: task.specialist,
    workId: task.work.workId,
    workItemId: task.work.workItemId,
    // The literal executor fixture demonstrates a blocked schema; the eight-turn
    // continuity scenario needs its scripted implementation attempt to settle.
    ...(task.specialist === "executor" && !invalid
      ? { status: "completed" }
      : {}),
  })}</pulso-result>`;
};

const readRequest = async (request: IncomingMessage) => {
  let source = "";
  for await (const chunk of request) source += String(chunk);
  return JSON.parse(source) as unknown;
};

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const sendCompletion = (
  response: ServerResponse,
  id: string,
  message: JsonRecord,
) => {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  const event = (body: JsonRecord) =>
    response.write(`data: ${JSON.stringify(body)}\n\n`);
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.filter(isRecord)
    : [];
  event({
    id,
    object: "chat.completion.chunk",
    created: 0,
    model: "scripted",
    choices: [
      {
        index: 0,
        delta: {
          ...message,
          ...(toolCalls.length
            ? {
                tool_calls: toolCalls.map((call, index) => {
                  const functionCall = isRecord(call.function)
                    ? call.function
                    : {};
                  return {
                    ...call,
                    index,
                    function: { ...functionCall, arguments: "" },
                  };
                }),
              }
            : {}),
        },
        finish_reason: null,
      },
    ],
  });
  if (toolCalls.length)
    event({
      id,
      object: "chat.completion.chunk",
      created: 0,
      model: "scripted",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: toolCalls.map((call, index) => {
              const functionCall = isRecord(call.function) ? call.function : {};
              return {
                index,
                function: { arguments: functionCall.arguments },
              };
            }),
          },
          finish_reason: null,
        },
      ],
    });
  event({
    id,
    object: "chat.completion.chunk",
    created: 0,
    model: "scripted",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
  });
  response.end("data: [DONE]\n\n");
};

export type ScriptedMode =
  | "valid"
  | "valid-status"
  | "invalid"
  | "host-error"
  | "barrier-error";
type ScriptedProvider = {
  url: string;
  close(): Promise<void>;
  requestCount(): number;
};

const startScriptedProvider = async (
  mode: ScriptedMode,
): Promise<ScriptedProvider> => {
  let parentMessage = "";
  let parentStage = 0;
  let awaitingChild = false;
  let preparedDelegationId: string | undefined;
  let requests = 0;
  const server = createServer((request, response) => {
    void (async () => {
      requests += 1;
      const payload = await readRequest(request);
      const body = isRecord(payload) ? payload : {};
      const taskWire = taskWireFrom(body.messages);
      if (awaitingChild && taskWire) {
        assert(
          parseTaskEnvelope(taskWire).delegationId === preparedDelegationId,
          "SCRIPTED_CHILD_DID_NOT_RECEIVE_PREPARED_DELEGATION",
        );
        awaitingChild = false;
        if (mode === "host-error") {
          sendJson(response, 503, {
            error: {
              message: "scripted provider host failure during native task",
              type: "fixture_host",
            },
          });
          return;
        }
        sendCompletion(response, `fixture-child-${requests}`, {
          role: "assistant",
          content: await scriptedResult(
            taskWire,
            mode === "invalid" || mode === "barrier-error",
          ),
        });
        return;
      }
      const userMessage = messageText(body.messages);
      if (userMessage !== parentMessage) {
        parentMessage = userMessage;
        parentStage = 0;
        preparedDelegationId = undefined;
        awaitingChild = false;
      }
      const specialist = specialistForMessage(userMessage);
      const call = (name: string, argumentsValue: JsonRecord) => ({
        id: `fixture-call-${requests}`,
        type: "function",
        function: { name, arguments: JSON.stringify(argumentsValue) },
      });
      let message: JsonRecord;
      if (parentStage === 0 && specialist) {
        parentStage += 1;
        const readonly = ["explorer", "planner", "security-auditor"].includes(
          specialist,
        );
        const verifier = specialist === "verifier";
        const effects = readonly
          ? ["read", "artifact"]
          : verifier
            ? ["read", "test"]
            : ["read", "edit", "test", "shell"];
        const mode = readonly
          ? "read"
          : verifier || specialist === "executor"
            ? "exclusive"
            : "read";
        const resources =
          specialist === "executor"
            ? [{ path: "src/total.ts", coverage: "exact", access: "write" }]
            : [{ path: ".", coverage: "subtree", access: "read" }];
        message = {
          role: "assistant",
          content: null,
          tool_calls: [
            call("pulso_prepare", {
              request: {
                intent: "new",
                objective: userMessage.slice(0, 240),
                graph: {
                  protocol: "pulso-graph/1",
                  revision: 1,
                  branches: [
                    {
                      key: "delivery",
                      objective: userMessage.slice(0, 240),
                      deliverable: "Verified delegated result",
                      allowedEffects: effects,
                      criteria: [
                        {
                          key: "result",
                          description: "Return the requested result",
                          evidenceRequired: false,
                        },
                      ],
                    },
                  ],
                  nodes: [
                    {
                      key: "delivery",
                      branch: "delivery",
                      specialist,
                      objective: userMessage.slice(0, 240),
                      dependsOn: [],
                      effects,
                      resources,
                      mode,
                      criteria: [
                        {
                          key: "result",
                          description: "Return the requested result",
                          evidenceRequired: false,
                        },
                      ],
                      requiredCapabilities: [],
                      context: { facts: [], references: [] },
                      constraints: [],
                      requestedEvidence: [],
                    },
                  ],
                },
              },
            }),
          ],
        };
      } else if (parentStage === 1 && specialist) {
        const nativeTaskArgs = findNativeTaskArgs(body);
        assert(nativeTaskArgs, "SCRIPTED_NATIVE_TASK_ARGS_NOT_OBSERVED");
        assert(
          typeof nativeTaskArgs.prompt === "string",
          "SCRIPTED_NATIVE_TASK_PROMPT_NOT_OBSERVED",
        );
        preparedDelegationId = parseNativeDispatchReference(
          nativeTaskArgs.prompt,
        );
        assert(
          preparedDelegationId,
          "SCRIPTED_NATIVE_DISPATCH_REFERENCE_NOT_OBSERVED",
        );
        parentStage += 1;
        awaitingChild = true;
        message = {
          role: "assistant",
          content: null,
          tool_calls: [call("task", nativeTaskArgs)],
        };
      } else if (parentStage === 2 && specialist) {
        parentStage += 1;
        if (mode === "valid-status") {
          const delegationId = delegationIdFrom(body.messages);
          assert(delegationId, "SCRIPTED_DELEGATION_ID_NOT_OBSERVED");
          message = {
            role: "assistant",
            content: null,
            tool_calls: [
              call("pulso_inspect", {
                view: "receipt",
                detail: "full",
                reference: delegationId,
              }),
            ],
          };
        } else {
          message = {
            role: "assistant",
            content: "The native specialist result was delivered and accepted.",
          };
        }
      } else {
        parentStage += 1;
        message = {
          role: "assistant",
          content: "Fixture response completed through the native bridge.",
        };
      }
      sendCompletion(response, `fixture-parent-${requests}`, message);
    })().catch((error) =>
      sendJson(response, 500, {
        error: {
          message: failureFrom(error).message,
          type: "fixture_internal",
        },
      }),
    );
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    close: () =>
      new Promise((resolveClose, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolveClose())),
      ),
    requestCount: () => requests,
  };
};

const installedPlan = async (
  workspace: string,
  homeDir: string,
  executable: string,
) => {
  const options = {
    scope: "local" as const,
    workspace,
    homeDir,
    executable,
    // OpenCode native bridge is installed as a plugin; MCP is intentionally absent.
    mcpCommand: [],
    version: certifiedOpenCodeVersion,
    modelConfig: inheritedModels,
    skills: await canonicalSkills(),
  };
  const plan = await planOpenCodeInstall(options);
  await applyOpenCodeInstall(options, plan);
  return inspectInstalledAssets(workspace);
};

const temporaryEnvironment = (
  home: string,
  pulsoDataDir = join(home, "pulso-data"),
): NodeJS.ProcessEnv => ({
  PATH: process.env.PATH,
  HOME: home,
  TMPDIR: home,
  XDG_CONFIG_HOME: join(home, "config"),
  XDG_DATA_HOME: join(home, "data"),
  XDG_STATE_HOME: join(home, "state"),
  XDG_CACHE_HOME: join(home, "cache"),
  OPENCODE_DB: join(home, "data/opencode/runtime-smoke.db"),
  PULSO_DATA_DIR: pulsoDataDir,
  LANG: process.env.LANG ?? "en_US.UTF-8",
});

type TurnCapture = {
  archive: SmokeArtifactArchive;
  dataDir: string;
  baselineTree: string;
  installed?: InstalledAssets;
  progress?: {
    activeTurn: number;
    lastVerifiedTurn: number;
    functionalStatus?: SmokeSectionStatus;
    functionalChecks?: string[];
  };
  liveFixtureScope?: {
    baseline: FixtureSnapshot;
    lastVerified: FixtureSnapshot;
  };
};

const exportedMessages = (value: unknown) => {
  const messages: Array<{
    role: string;
    text: string;
    id?: string;
    parentId?: string;
  }> = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    const info = isRecord(candidate.info) ? candidate.info : candidate;
    const role = typeof info.role === "string" ? info.role : undefined;
    if (role) {
      const parts = Array.isArray(candidate.parts) ? candidate.parts : [];
      const text = parts
        .filter(isRecord)
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("\n");
      const id = typeof info.id === "string" ? info.id : undefined;
      const parentId =
        typeof info.parentID === "string" ? info.parentID : undefined;
      messages.push({
        role,
        text,
        ...(id ? { id } : {}),
        ...(parentId ? { parentId } : {}),
      });
    }
    for (const [key, child] of Object.entries(candidate))
      if (key !== "parts" && key !== "info") visit(child);
  };
  visit(value);
  return messages;
};

const toolsFromExport = (value: unknown) => {
  const tools: Array<{
    name: string;
    input: unknown;
    output: unknown;
    error?: string;
  }> = [];
  const visit = (candidate: unknown) => {
    if (Array.isArray(candidate)) {
      for (const entry of candidate) visit(entry);
      return;
    }
    if (!isRecord(candidate)) return;
    if (candidate.type === "tool" && typeof candidate.tool === "string") {
      const state = isRecord(candidate.state) ? candidate.state : {};
      tools.push({
        name: candidate.tool,
        input: state.input,
        output: state.output,
        ...(typeof state.error === "string" ? { error: state.error } : {}),
      });
    }
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(value);
  return tools;
};

const normalizedPersistedMessageText = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"'))
    try {
      const decoded: unknown = JSON.parse(trimmed);
      if (typeof decoded === "string") return decoded;
    } catch {
      // Preserve the exact persisted source when it is not a JSON string literal.
    }
  return text;
};

const childSessionIdsFrom = (events: RuntimeEvent[]) => [
  ...new Set(
    events.flatMap((event) => {
      if (event.part?.tool !== "task") return [];
      const metadata = event.part.state?.metadata ?? event.part.metadata;
      const candidates = [metadata?.sessionId, metadata?.sessionID];
      return candidates.filter(
        (candidate): candidate is string => typeof candidate === "string",
      );
    }),
  ),
];

const expectedSpecialistForTurn = (turn: number) =>
  ({
    1: "explorer",
    2: "explorer",
    4: "planner",
    5: "executor",
    6: "verifier",
    8: "security-auditor",
  })[turn as 1 | 2 | 4 | 5 | 6 | 8];

const verifyTurnAttempts = (
  turn: number,
  snapshot: ReturnType<typeof readNativeState>,
  attempts: NativeAttemptEvidence[],
) => {
  const expectedSpecialist = expectedSpecialistForTurn(turn);
  if (expectedSpecialist)
    assert(
      attempts.some(
        (attempt) =>
          attempt.turn === turn && attempt.specialist === expectedSpecialist,
      ),
      `TURN_${turn}_EXPECTED_SPECIALIST_NOT_OBSERVED:${expectedSpecialist}`,
    );
  for (const attempt of attempts.filter(
    (candidate) => candidate.turn === turn,
  )) {
    assert(
      attempt.specialist !== "not-observed",
      `TURN_${turn}_TASK_ENVELOPE_UNKNOWN:${attempt.nativeCallId}`,
    );
    assert(
      attempt.receiptPhase === "applied",
      `TURN_${turn}_RECEIPT_NOT_APPLIED:${attempt.nativeCallId}:${attempt.receiptPhase}`,
    );
    assert(
      attempt.receiptAccepted === "true",
      `TURN_${turn}_RECEIPT_NOT_ACCEPTED:${attempt.nativeCallId}:${attempt.receiptAccepted}`,
    );
    assert(
      attempt.workStatus !== "completed" && attempt.workStatus !== "cancelled",
      `TURN_${turn}_WORK_CLOSED`,
    );
    assert(
      attempt.executionStatus === "completed",
      `TURN_${turn}_EXECUTION_NOT_COMPLETED:${attempt.nativeCallId}`,
    );
    assert(
      attempt.leaseStatus === "released",
      `TURN_${turn}_LEASE_NOT_RELEASED:${attempt.nativeCallId}`,
    );
    assert(
      attempt.bindingStatus === "completed",
      `TURN_${turn}_BINDING_NOT_COMPLETED:${attempt.nativeCallId}`,
    );
    assert(
      attempt.transportPhase === "closed",
      `TURN_${turn}_TRANSPORT_NOT_CLOSED:${attempt.nativeCallId}`,
    );
    assert(
      attempt.workItemStatus === "completed",
      `TURN_${turn}_WORK_ITEM_NOT_COMPLETED:${attempt.nativeCallId}`,
    );
    assert(
      attempt.sideEffectsMayContinue === false,
      `TURN_${turn}_SIDE_EFFECT_AUTHORITY_REMAINS:${attempt.nativeCallId}`,
    );
    assert(
      validateAttemptAuthority({
        workspaceId: snapshot.workspaceId,
        parentSessionId: snapshot.parentSessionId,
        parentCallId: attempt.nativeCallId,
        delegationId: attempt.delegationId,
        workId: attempt.workId,
        workItemId: attempt.workItemId,
        specialist: attempt.specialist,
        childSessionId:
          attempt.childSessionId === "not-observed"
            ? undefined
            : attempt.childSessionId,
        bindingId:
          attempt.bindingId === "not-observed" ? undefined : attempt.bindingId,
        receiptPhase: attempt.receiptPhase,
        accepted: attempt.receiptAccepted === "true",
        authority: {
          executionId: attempt.executionId,
          executionStatus: attempt.executionStatus,
          leaseId: attempt.leaseId,
          leaseStatus: attempt.leaseStatus,
          fencingToken: Number(attempt.fencingToken),
        },
      }).accepted,
      `TURN_${turn}_AUTHORITY_REJECTED:${attempt.nativeCallId}`,
    );
    const call = snapshot.calls.find(
      (entry) => entry.parentCallId === attempt.nativeCallId,
    );
    const receipt = isRecord(call?.receiptJson) ? call.receiptJson : undefined;
    assert(
      receipt?.protocol === "pulso-receipt/1" && receipt.accepted === true,
      `TURN_${turn}_PERSISTED_RECEIPT_INVALID:${attempt.nativeCallId}`,
    );
    const result = isRecord(receipt.result) ? receipt.result : undefined;
    assert(
      result?.status === "completed",
      `TURN_${turn}_AGENT_RESULT_NOT_COMPLETED:${attempt.nativeCallId}`,
    );
    const specialistResult = isRecord(result.specialistResult)
      ? result.specialistResult
      : undefined;
    if (turn === 1 || turn === 2)
      assert(
        specialistResult?.kind === "explorer" &&
          Array.isArray(specialistResult.findings),
        `TURN_${turn}_EXPLORER_PAYLOAD_INVALID`,
      );
    if (turn === 4)
      assert(
        specialistResult?.kind === "planner" &&
          Array.isArray(specialistResult.steps),
        "TURN_4_PLANNER_PLAN_MISSING",
      );
    if (turn === 5)
      assert(
        specialistResult?.kind === "executor" &&
          Array.isArray(specialistResult.changes) &&
          specialistResult.changes.length > 0 &&
          Array.isArray(specialistResult.validations) &&
          specialistResult.validations.length > 0,
        "TURN_5_EXECUTOR_CHANGE_OR_VALIDATION_MISSING",
      );
    if (turn === 6)
      assert(
        specialistResult?.kind === "verifier" &&
          Array.isArray(specialistResult.checks),
        "TURN_6_VERIFIER_PAYLOAD_MISSING",
      );
    if (turn === 8)
      assert(
        specialistResult?.kind === "security-auditor" &&
          Array.isArray(specialistResult.findings),
        "TURN_8_SECURITY_AUDITOR_PAYLOAD_INVALID",
      );
  }
};

export const verifyLiveScenarioFunction = (
  turn: number,
  attempts: NativeAttemptEvidence[],
  childExports: unknown[],
  cumulativeProductDiff: string,
  scope: FixtureTurnScope,
) => {
  assert(scope.turn === turn, `LIVE_TURN_${turn}_SCOPE_TURN_MISMATCH`);
  if (turn !== 5)
    assert(
      scope.turnDelta.added.length === 0 &&
        scope.turnDelta.removed.length === 0 &&
        scope.turnDelta.modified.length === 0,
      `LIVE_TURN_${turn}_READ_ONLY_SCOPE_CHANGED`,
    );
  const currentAttempts = attempts.filter((attempt) => attempt.turn === turn);
  const tools = childExports.flatMap(toolsFromExport);
  const requiredAttempt = (specialist: string) => {
    const attempt = currentAttempts.find(
      (candidate) => candidate.specialist === specialist,
    );
    assert(
      attempt,
      `LIVE_TURN_${turn}_${specialist.toUpperCase()}_ATTEMPT_MISSING`,
    );
    return attempt;
  };
  const hasReadEvidence = (path: string) =>
    tools.some((tool) => {
      if (!/^(read|grep|glob|bash)$/.test(tool.name)) return false;
      const encoded = JSON.stringify({
        input: tool.input,
        output: tool.output,
      });
      return encoded.includes(path);
    });

  if (turn === 1) {
    requiredAttempt("explorer");
    assert(
      hasReadEvidence("src/total.ts"),
      "LIVE_TURN_1_EXPLORER_DID_NOT_INSPECT_TOTAL",
    );
  } else if (turn === 2) {
    requiredAttempt("explorer");
    assert(
      hasReadEvidence("tests/total.test.ts"),
      "LIVE_TURN_2_EXPLORER_DID_NOT_INSPECT_TESTS",
    );
  } else if (turn === 3) {
    assert(
      currentAttempts.length === 0,
      "LIVE_TURN_3_DISPATCHED_BEFORE_IMPLEMENTATION",
    );
  } else if (turn === 4) {
    requiredAttempt("planner");
  } else if (turn === 5) {
    requiredAttempt("executor");
    assert(
      cumulativeProductDiff.includes("NEGATIVE_AMOUNT"),
      "LIVE_TURN_5_FIXTURE_DIFF_MISSES_NEGATIVE_AMOUNT",
    );
  } else if (turn === 6) {
    requiredAttempt("verifier");
    assert(
      hasReadEvidence("src/total.ts") && hasReadEvidence("tests/total.test.ts"),
      "LIVE_TURN_6_VERIFIER_DID_NOT_INDEPENDENTLY_INSPECT",
    );
    assert(
      !tools.some((tool) =>
        ["edit", "apply_patch", "write"].includes(tool.name),
      ),
      "LIVE_TURN_6_VERIFIER_EDITED_FIXTURE",
    );
  } else if (turn === 7) {
    assert(
      currentAttempts.length === 0,
      "LIVE_TURN_7_CREATED_UNREQUESTED_DELEGATION",
    );
  } else if (turn === 8) {
    requiredAttempt("security-auditor");
    assert(
      hasReadEvidence("src/auth.ts"),
      "LIVE_TURN_8_AUDITOR_DID_NOT_INSPECT_AUTH",
    );
    assert(
      !tools.some((tool) =>
        ["edit", "apply_patch", "write"].includes(tool.name),
      ),
      "LIVE_TURN_8_AUDITOR_MODIFIED_FIXTURE",
    );
    assert(
      !tools.some(
        (tool) =>
          tool.name === "bash" &&
          /\b(curl|wget)\b|\bnode\b[^\n]*src\/auth\.ts/i.test(
            JSON.stringify(tool.input),
          ),
      ),
      "LIVE_TURN_8_AUDITOR_RAN_PROHIBITED_COMMAND",
    );
  }
};

const assertScenarioContinuityAtTurn = (
  scenario: NativeScenario,
  turn: number,
  snapshot: ReturnType<typeof readNativeState>,
  turns: MultiTurnRecord[],
) => {
  const expected = scenario.messages[turn - 1]?.expectedWork;
  assert(snapshot.currentWorkId, `TURN_${turn}_CURRENT_WORK_NOT_OBSERVED`);
  if (expected === "A") {
    const workA = turns[0]?.workIds[0] ?? snapshot.currentWorkId;
    assert(
      snapshot.currentWorkId === workA,
      `TURN_${turn}_WORK_A_CONTINUITY_LOST`,
    );
  } else {
    const workA = turns[0]?.workIds[0];
    assert(workA && snapshot.currentWorkId !== workA, "TURN_8_WORK_B_NOT_NEW");
    const workAState = snapshot.works.find((work) => work.id === workA);
    assert(workAState?.status === "active", "TURN_8_WORK_A_NOT_STILL_OPEN");
  }
};

const evidenceWithAuthorityProjection = (attempt: NativeAttemptEvidence) => {
  const {
    executionId,
    executionStatus,
    leaseId,
    leaseStatus,
    fencingToken,
    ...identity
  } = attempt;
  return {
    ...identity,
    authority: {
      executionId,
      executionStatus,
      leaseId,
      leaseStatus,
      fencingToken:
        fencingToken === "not-observed" ? "not-observed" : Number(fencingToken),
    },
  };
};

const runScenarioTurns = async (
  executable: string,
  workspace: string,
  env: NodeJS.ProcessEnv,
  scenario: NativeScenario,
  model: string,
  capture?: TurnCapture,
) => {
  let sessionId: string | undefined;
  const turns: MultiTurnRecord[] = [];
  const attempts: NativeAttemptEvidence[] = [];
  let harnessTestRun: CommandResult | undefined;
  let functionalVerification:
    | ReturnType<typeof validateFunctionalChecks>
    | undefined;
  let lastVerifiedTurn = 0;
  if (capture?.progress) capture.progress.lastVerifiedTurn = 0;
  for (const message of scenario.messages) {
    if (capture?.progress) capture.progress.activeTurn = message.turn;
    let fixtureBefore: FixtureSnapshot | undefined;
    if (model === "") {
      const scope = capture?.liveFixtureScope;
      assert(scope, "LIVE_FIXTURE_SCOPE_NOT_INITIALIZED");
      try {
        fixtureBefore = await captureFixtureSnapshot(workspace);
        await capture.archive.write(
          `turn-${message.turn}/fixture-before.json`,
          fixtureBefore,
        );
      } catch (error) {
        capture.archive.markIncomplete();
        await capture.archive
          .write(`turn-${message.turn}/fixture-before-capture-error.json`, {
            error: failureFrom(error),
          })
          .catch(() => capture.archive.markIncomplete());
        throw error;
      }
      assertFixtureBeforeTurn(
        message.turn,
        scope.baseline,
        scope.lastVerified,
        fixtureBefore,
      );
    }
    let result: CommandResult;
    try {
      result = await runCommand(
        executable,
        [
          "run",
          "--auto",
          "--agent",
          "pulso",
          ...(model ? ["--model", model] : []),
          "--format",
          "json",
          "--dir",
          workspace,
          ...(sessionId ? ["--session", sessionId] : []),
          message.text,
        ],
        {
          cwd: workspace,
          env,
          timeout: commandTimeoutForCategory(`turn-${message.turn}`),
        },
      );
    } catch (error) {
      if (capture) {
        await capture.archive
          .write(`turn-${message.turn}/process-error.json`, {
            turn: message.turn,
            message: message.text,
            error: failureFrom(error),
          })
          .catch(() => capture.archive.markIncomplete());
      }
      throw Object.assign(
        new Error(
          `MULTITURN_TURN_${message.turn}_PROCESS_FAILED:${failureFrom(error).code}`,
        ),
        {
          failedTurn: message.turn,
          lastVerifiedTurn,
          notRunTurns: scenario.messages
            .slice(message.turn)
            .map((entry) => entry.turn),
          cause: error,
        },
      );
    }
    const events = decodeEvents(result.stdout);
    const work = workFromEvents(events);
    const observedSessionId = sessionIdFromEvents(events);
    sessionId ??= observedSessionId;
    turns.push({
      turn: message.turn,
      message: message.text,
      ...(sessionId ? { sessionId } : {}),
      processExitCode: result.status,
      eventCount: events.length,
      userMessageCount: events.filter((event) => event.type === "user.message")
        .length,
      assistantMessageCount: events.filter((event) => event.type === "text")
        .length,
      toolCount: events.filter((event) => event.type === "tool_use").length,
      directPulsoToolCount: events.filter(
        (event) =>
          event.type === "tool_use" && event.part?.tool?.startsWith("pulso_"),
      ).length,
      directTechnicalToolCount: events.filter(
        (event) =>
          event.type === "tool_use" &&
          technicalTools.has(event.part?.tool ?? ""),
      ).length,
      taskCount: events.filter((event) => event.part?.tool === "task").length,
      mcpErrors: events
        .filter(
          (event) =>
            event.type === "tool_use" && Boolean(event.part?.state?.error),
        )
        .map((event) => event.part?.state?.error ?? "unknown"),
      workIds: work.ids,
      workStatuses: work.statuses,
    });
    let snapshot: ReturnType<typeof readNativeState> | undefined;
    let exported: unknown;
    let exportError: string | undefined;
    let cumulativeProductDiff = "";
    let fixtureAfter: FixtureSnapshot | undefined;
    let fixtureTurnScope: FixtureTurnScope | undefined;
    const childExportValues: unknown[] = [];
    const sessionForExport = observedSessionId ?? sessionId;
    if (capture) {
      await capture.archive.write(`turn-${message.turn}/run.json`, {
        input: message.text,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.status,
        events,
      });
      if (sessionForExport) {
        const parentExport = await runCommand(
          executable,
          ["export", sessionForExport],
          {
            cwd: workspace,
            env,
            timeout: commandTimeoutForCategory("export"),
          },
        );
        if (parentExport.status === 0) {
          try {
            exported = JSON.parse(parentExport.stdout) as unknown;
            await capture.archive.write(
              `turn-${message.turn}/parent-export.json`,
              exported,
            );
          } catch (error) {
            exportError = `SESSION_EXPORT_JSON_INVALID:${String(error)}`;
          }
        } else
          exportError = `SESSION_EXPORT_FAILED:${parentExport.status}:${redactString(parentExport.stderr).slice(0, 500)}`;
        for (const [index, childSessionId] of childSessionIdsFrom(
          events,
        ).entries()) {
          const childExport = await runCommand(
            executable,
            ["export", childSessionId],
            {
              cwd: workspace,
              env,
              timeout: commandTimeoutForCategory("export"),
            },
          );
          await capture.archive.write(
            `turn-${message.turn}/child-${index + 1}-export.json`,
            {
              sessionId: childSessionId,
              exitCode: childExport.status,
              stdout: childExport.stdout,
              stderr: childExport.stderr,
            },
          );
          if (childExport.status !== 0)
            exportError ??= `CHILD_EXPORT_FAILED:${childSessionId}:${childExport.status}`;
          else
            try {
              childExportValues.push(JSON.parse(childExport.stdout) as unknown);
            } catch {
              exportError ??= `CHILD_EXPORT_JSON_INVALID:${childSessionId}`;
            }
        }
      } else exportError = "PARENT_SESSION_ID_NOT_OBSERVED";
      const dataRoot = capture.dataDir;
      const wsId = workspaceId(workspace);
      const workDbPath = join(dataRoot, "workspaces", wsId, "work.db");
      const runtimeDbPath = join(
        dataRoot,
        "workspaces",
        wsId,
        "runtime-bindings.db",
      );
      try {
        snapshot = readNativeState({
          workDbPath,
          runtimeDbPath,
          workspaceId: wsId,
          parentSessionId: sessionForExport ?? "",
        });
        await capture.archive.write(
          `turn-${message.turn}/native-state.json`,
          snapshot,
        );
      } catch (error) {
        await capture.archive.write(
          `turn-${message.turn}/native-state-error.json`,
          {
            message: message.text,
            workDbPath,
            runtimeDbPath,
            error: failureFrom(error),
          },
        );
        exportError ??= `NATIVE_STATE_CAPTURE_FAILED:${failureFrom(error).code}`;
      }
      if (message.turn === 5) {
        const tests = await runCommand("bun", ["test"], {
          cwd: workspace,
          env,
          timeout: commandTimeoutForCategory("run"),
        });
        await capture.archive.write(`turn-${message.turn}/harness-tests.json`, {
          origin: "harness-independent-verification",
          stdout: tests.stdout,
          stderr: tests.stderr,
          exitCode: tests.status,
        });
        harnessTestRun = tests;
        if (tests.status !== 0)
          exportError ??= `HARNESS_TESTS_FAILED:${tests.status}`;
        if (model === "") {
          const contract = await runFunctionalContractCheck(workspace, env);
          await capture.archive.write(
            `turn-${message.turn}/functional-contract.json`,
            {
              stdout: contract.stdout,
              stderr: contract.stderr,
              exitCode: contract.status,
            },
          );
          if (tests.status === 0 && contract.status === 0)
            functionalVerification = validateFunctionalChecks(tests, contract);
          else exportError ??= "FUNCTIONAL_CONTRACT_CHECK_COMMAND_FAILED";
          if (functionalVerification && capture.progress) {
            capture.progress.functionalStatus = "PASS";
            capture.progress.functionalChecks = functionalVerification.checks;
          }
        }
      }
      const diff = await runCommand(
        "git",
        ["diff", "--no-ext-diff", "--binary", capture.baselineTree],
        { cwd: workspace, env, timeout: commandTimeoutForCategory("git") },
      );
      cumulativeProductDiff = diff.stdout;
      const untracked = await runCommand(
        "git",
        ["ls-files", "--others", "--exclude-standard"],
        {
          cwd: workspace,
          env,
          timeout: commandTimeoutForCategory("git"),
        },
      );
      const status = await runCommand(
        "git",
        ["status", "--porcelain=v1", "--untracked-files=all"],
        {
          cwd: workspace,
          env,
          timeout: commandTimeoutForCategory("git"),
        },
      );
      const observedFiles = [
        ...new Set([
          ...Object.keys(scenario.files),
          ...untracked.stdout.split("\n").filter(Boolean),
        ]),
      ];
      await capture.archive.write(`turn-${message.turn}/fixture-diff.json`, {
        diff: diff.stdout,
        diffExitCode: diff.status,
        baselineTree: capture.baselineTree,
        changedFiles: (
          await runCommand(
            "git",
            ["diff", "--name-only", "--no-ext-diff", capture.baselineTree],
            {
              cwd: workspace,
              env,
              timeout: commandTimeoutForCategory("git"),
            },
          )
        ).stdout,
        untracked: untracked.stdout,
        status: status.stdout,
        index: status.stdout,
        files: await Promise.all(
          observedFiles.map(async (path) => ({
            path,
            content: await readFile(join(workspace, path), "utf8").catch(
              () => "not-observed",
            ),
            baselineSha256:
              scenario.files[path] === undefined
                ? "not-in-baseline"
                : digest(scenario.files[path]),
            currentSha256: await readFile(join(workspace, path), "utf8")
              .then(digest)
              .catch(() => "not-observed"),
          })),
        ),
      });
      if (diff.status !== 0 || untracked.status !== 0 || status.status !== 0)
        exportError ??= "FIXTURE_GIT_CAPTURE_FAILED";
      if (model === "") {
        const scope = capture.liveFixtureScope;
        assert(scope && fixtureBefore, "LIVE_FIXTURE_SCOPE_NOT_INITIALIZED");
        try {
          fixtureAfter = await captureFixtureSnapshot(workspace);
          await capture.archive.write(
            `turn-${message.turn}/fixture-after.json`,
            fixtureAfter,
          );
        } catch (error) {
          capture.archive.markIncomplete();
          await capture.archive
            .write(`turn-${message.turn}/fixture-after-capture-error.json`, {
              error: failureFrom(error),
            })
            .catch(() => capture.archive.markIncomplete());
          throw error;
        }
        const turnDelta = compareFixtureSnapshots(fixtureBefore, fixtureAfter);
        const cumulativeDelta = compareFixtureSnapshots(
          scope.baseline,
          fixtureAfter,
        );
        await capture.archive.write(
          `turn-${message.turn}/fixture-scope-observed.json`,
          {
            turn: message.turn,
            baselineDigest: scope.baseline.digest,
            beforeDigest: fixtureBefore.digest,
            afterDigest: fixtureAfter.digest,
            incremental: turnDelta,
            cumulative: cumulativeDelta,
          },
        );
        fixtureTurnScope = assertFixtureAfterTurn(
          message.turn,
          scope.baseline,
          fixtureBefore,
          fixtureAfter,
        );
        await assertFixtureHasNoCommit(workspace, env);
      }
    }
    const snapshotCalls = snapshot?.calls ?? [];
    const evidenceAttempts = attemptEvidence(events, message.turn, snapshot);
    attempts.push(...evidenceAttempts);
    const actualMessages =
      exported === undefined ? [] : exportedMessages(exported);
    const persistedUserMessages = actualMessages.filter(
      (entry) => entry.role === "user",
    );
    const exactUserMessages = persistedUserMessages.filter(
      (entry) => normalizedPersistedMessageText(entry.text) === message.text,
    );
    const record = turns.at(-1);
    if (record) {
      record.userMessageCount = exactUserMessages.length;
      if (sessionForExport) record.sessionId = sessionForExport;
      record.workIds = snapshot?.currentWorkId ? [snapshot.currentWorkId] : [];
      record.workStatuses =
        snapshot?.works.map((work) => String(work.status)) ?? [];
    }
    await capture?.archive.write(`turn-${message.turn}/barrier.json`, {
      turn: message.turn,
      exitCode: result.status,
      sessionId: sessionForExport ?? "not-observed",
      persistedUserMessageCount: exactUserMessages.length,
      persistedUserMessageIds: actualMessages
        .filter(
          (entry) => entry.role === "user" && entry.text.includes(message.text),
        )
        .flatMap((entry) => (entry.id ? [entry.id] : [])),
      exportError,
      snapshotCalls,
      attempts: evidenceAttempts.map(evidenceWithAuthorityProjection),
      mcpErrors: record?.mcpErrors ?? [],
    });
    if (exportError)
      throw Object.assign(
        new Error(
          `MULTITURN_TURN_${message.turn}_EVIDENCE_FAILED:${exportError}`,
        ),
        {
          failedTurn: message.turn,
          lastVerifiedTurn,
          notRunTurns: scenario.messages
            .slice(message.turn)
            .map((entry) => entry.turn),
        },
      );
    if (result.status !== 0)
      throw Object.assign(
        new Error(
          `MULTITURN_TURN_${message.turn}_FAILED:${failureFrom(`${result.stderr}\n${result.stdout}`).code}`,
        ),
        {
          failedTurn: message.turn,
          lastVerifiedTurn,
          notRunTurns: scenario.messages
            .slice(message.turn)
            .map((entry) => entry.turn),
        },
      );
    if (record?.mcpErrors.length)
      throw Object.assign(
        new Error(
          `MULTITURN_TURN_${message.turn}_TOOL_ERROR:${record.mcpErrors[0]}`,
        ),
        {
          failedTurn: message.turn,
          lastVerifiedTurn,
          notRunTurns: scenario.messages
            .slice(message.turn)
            .map((entry) => entry.turn),
        },
      );
    assert(
      exactUserMessages.length === 1 && Boolean(exactUserMessages[0]?.id),
      `TURN_${message.turn}_PERSISTED_USER_MESSAGE_INVALID`,
    );
    assert(snapshot, `TURN_${message.turn}_NATIVE_STATE_NOT_OBSERVED`);
    assertScenarioContinuityAtTurn(scenario, message.turn, snapshot, turns);
    validateNativeDispatchIdentity(
      attempts.map((attempt) => ({
        turn: attempt.turn,
        parentSessionId:
          attempt.parentSessionId === "not-observed"
            ? undefined
            : attempt.parentSessionId,
        parentCallId: attempt.nativeCallId,
        stage: attempt.receiptPhase === "rejected" ? "rejected" : "dispatched",
        ...(attempt.delegationId !== "not-observed"
          ? { delegationId: attempt.delegationId }
          : {}),
        attempts: [],
      })),
    );
    verifyTurnAttempts(message.turn, snapshot, evidenceAttempts);
    if (model === "") {
      assert(fixtureTurnScope, "LIVE_FIXTURE_TURN_SCOPE_NOT_OBSERVED");
      verifyLiveScenarioFunction(
        message.turn,
        evidenceAttempts,
        childExportValues,
        cumulativeProductDiff,
        fixtureTurnScope,
      );
    }
    assert(
      observedSessionId === sessionId,
      `MULTITURN_TURN_${message.turn}_SESSION_CHANGED`,
    );
    lastVerifiedTurn = message.turn;
    if (capture?.progress) capture.progress.lastVerifiedTurn = lastVerifiedTurn;
    if (capture?.liveFixtureScope && fixtureAfter)
      capture.liveFixtureScope.lastVerified = fixtureAfter;
  }
  assertNativeScenarioContinuity(scenario, turns);
  assertScenarioSpecialists(scenario, attempts);
  return { turns, attempts, harnessTestRun, functionalVerification };
};

const assertLiveFixtureChanges = async (
  workspace: string,
  env: NodeJS.ProcessEnv,
  scenario: NativeScenario,
  baselineTree: string,
  fixtureBaseline: FixtureSnapshot,
  lastVerifiedSnapshot: FixtureSnapshot,
  finalSnapshot: FixtureSnapshot,
  testRun?: CommandResult,
) => {
  assertFixtureFinalScope(fixtureBaseline, finalSnapshot);
  const finalDrift = compareFixtureSnapshots(
    lastVerifiedSnapshot,
    finalSnapshot,
  );
  assert(
    finalDrift.added.length === 0 &&
      finalDrift.removed.length === 0 &&
      finalDrift.modified.length === 0,
    "LIVE_FIXTURE_CHANGED_AFTER_LAST_BARRIER",
  );
  const diff = await runCommand(
    "git",
    [
      "diff",
      "--no-ext-diff",
      "--binary",
      baselineTree,
      "--",
      "src/total.ts",
      "tests/total.test.ts",
    ],
    { cwd: workspace, env, timeout: commandTimeoutForCategory("git") },
  );
  assert(diff.status === 0, "LIVE_FIXTURE_DIFF_FAILED");
  const changedFiles = await runCommand(
    "git",
    ["diff", "--name-only", "--no-ext-diff", baselineTree],
    { cwd: workspace, env, timeout: commandTimeoutForCategory("git") },
  );
  const status = await runCommand(
    "git",
    ["status", "--porcelain=v1", "--untracked-files=all"],
    { cwd: workspace, env, timeout: commandTimeoutForCategory("git") },
  );
  assert(
    changedFiles.status === 0 && status.status === 0,
    "LIVE_FIXTURE_GIT_STATE_CAPTURE_FAILED",
  );
  const changed = changedFiles.stdout.split("\n").filter(Boolean);
  const authorized = new Set(["src/total.ts", "tests/total.test.ts"]);
  assert(
    [...authorized].every((path) => changed.includes(path)),
    "LIVE_FIXTURE_REQUIRED_PRODUCT_CHANGES_MISSING",
  );
  assert(
    diff.stdout.includes("NEGATIVE_AMOUNT"),
    "LIVE_FIXTURE_NEGATIVE_AMOUNT_NOT_OBSERVED",
  );
  assert(
    (await readFile(join(workspace, "src/auth.ts"), "utf8")) ===
      scenario.files["src/auth.ts"],
    "LIVE_FIXTURE_SECURITY_FILE_CHANGED",
  );
  const authHash = digest(
    await readFile(join(workspace, "src/auth.ts"), "utf8"),
  );
  assert(
    authHash === digest(scenario.files["src/auth.ts"]),
    "LIVE_FIXTURE_SECURITY_HASH_CHANGED",
  );
  assert(
    testRun?.status === 0,
    "LIVE_FIXTURE_TESTS_NOT_PASSED_AT_EXECUTOR_BARRIER",
  );
  const head = await runCommand("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: workspace,
    env,
    timeout: commandTimeoutForCategory("git"),
  });
  assert(head.status !== 0, "NATIVE_SCENARIO_COMMIT_CREATED");
  return {
    diff: diff.stdout,
    changedFiles: changed,
    indexStatus: status.stdout,
    authHash,
    testRun,
  };
};

export type RuntimeSmokeReport = {
  status: SmokeStatus;
  evidenceSource: EvidenceSource;
  results: SmokeEvaluation;
  reason?: string;
  executable?: string;
  openCodeVersion?: string;
  certification?: "certified" | "outside-baseline";
  installed?: InstalledAssets;
  fixture?: { name: string; requestCount: number; turnCount: number };
  attempts?: NativeAttemptEvidence[];
  failure?: SanitizedFailure;
  evidenceDirectory?: string;
  archiveComplete?: boolean;
  failedTurn?: number;
  lastVerifiedTurn?: number;
  notRunTurns?: Array<{ turn: number; status: "NOT_RUN" }>;
  turns?: MultiTurnRecord[];
  temporaryRoot?: string;
  cleanupEffective?: boolean;
};

const versionOf = async (
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) => {
  const result = await runCommand(executable, ["--version"], {
    cwd,
    env,
    timeout: commandTimeoutForCategory("version"),
  });
  if (result.status !== 0)
    throw new Error(
      `OPENCODE_VERSION_FAILED:${result.stderr || result.stdout}`,
    );
  return result.stdout.trim();
};

const assertLoadedBuild = (
  attempts: NativeAttemptEvidence[],
  installed: InstalledAssets,
) =>
  assert(
    attempts.every((attempt) => attempt.buildId === installed.buildId),
    "NATIVE_ATTEMPT_BUILD_MISMATCH",
  );

/** Runs only against a temporary HOME and an HTTP fixture provider; it never reads auth. */
export const runOfflineNativeSmoke = async (
  mode: ScriptedMode = "valid",
): Promise<RuntimeSmokeReport> => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pulso-native-offline-"));
  let provider: ScriptedProvider | undefined;
  let archive: SmokeArtifactArchive | undefined;
  let baselineTree = "";
  const progress = {
    activeTurn: 0,
    lastVerifiedTurn: 0,
    functionalStatus: "NOT_RUN" as SmokeSectionStatus,
  };
  try {
    archive = await SmokeArtifactArchive.create(root);
    const scenario = await loadNativeScenario();
    const workspace = join(temporaryRoot, "workspace");
    const home = join(temporaryRoot, "home");
    const env = temporaryEnvironment(home);
    const executable = await executablePath();
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await stageScenario(workspace, scenario);
    baselineTree = await initializeFixtureRepository(workspace, env, scenario);
    provider = await startScriptedProvider(mode);
    const installed = await installedPlan(workspace, home, executable);
    await addScriptedProvider(installed.configPath, provider.url);
    const effectiveInstalled = await inspectInstalledAssets(workspace);
    assert(effectiveInstalled.inherited, "OFFLINE_PROFILE_NOT_INHERITED");
    const pulsoDataDir = env.PULSO_DATA_DIR;
    assert(pulsoDataDir, "OFFLINE_PULSO_DATA_DIR_NOT_CONFIGURED");
    assert(
      (await fileExists(join(home, "data/opencode/auth.json"))) === false,
      "OFFLINE_AUTH_STAGED",
    );
    const version = await versionOf(executable, workspace, env);
    if (
      mode === "valid" ||
      mode === "valid-status" ||
      mode === "barrier-error"
    ) {
      const run = await runScenarioTurns(
        executable,
        workspace,
        env,
        scenario,
        "pulso-scripted/scripted",
        {
          archive,
          dataDir: pulsoDataDir,
          baselineTree,
          installed: effectiveInstalled,
          progress,
        },
      );
      assert(
        mode === "valid" || mode === "valid-status",
        "SCRIPTED_BARRIER_FAILURE_WAS_ACCEPTED",
      );
      assertLoadedBuild(run.attempts, effectiveInstalled);
      await assertFixtureHasNoCommit(workspace, env);
      const finalized = await archive.finalize({
        mode: "scripted",
        turnCount: run.turns.length,
        lastVerifiedTurn: run.turns.length,
      });
      assert(
        (await fileExists(join(home, "data/opencode/auth.json"))) === false,
        "OFFLINE_AUTH_STAGED",
      );
      return {
        status: "PASS",
        evidenceSource: "fixture",
        results: smokeEvaluation("PASS", run.turns.length, "NOT_RUN"),
        executable,
        openCodeVersion: version,
        certification:
          version === certifiedOpenCodeVersion
            ? "certified"
            : "outside-baseline",
        installed: effectiveInstalled,
        fixture: {
          name: scenario.name,
          requestCount: provider.requestCount(),
          turnCount: run.turns.length,
        },
        attempts: run.attempts,
        turns: run.turns,
        evidenceDirectory: finalized.directory,
        archiveComplete: finalized.archiveComplete,
      };
    }
    const result = await runCommand(
      executable,
      [
        "run",
        "--auto",
        "--agent",
        "pulso",
        "--model",
        "pulso-scripted/scripted",
        "--format",
        "json",
        "--dir",
        workspace,
        "Use the native bridge to inspect the fixture.",
      ],
      { cwd: workspace, env, timeout: commandTimeoutForCategory("run") },
    );
    const events = decodeEvents(result.stdout);
    const hasNativeTask = events.some((event) => event.part?.tool === "task");
    assert(
      hasNativeTask || mode === "host-error",
      "OFFLINE_NATIVE_TASK_NOT_OBSERVED",
    );
    const toolErrors = events
      .filter((event) => Boolean(event.part?.state?.error))
      .map((event) => ({
        tool: event.part?.tool,
        error: event.part?.state?.error ?? "",
      }));
    assert(
      mode === "invalid"
        ? toolErrors.some(
            (error) =>
              error.tool === "task" &&
              /AGENT_RESULT_INVALID|PROTOCOL_INVALID_RESULT/.test(error.error),
          )
        : result.status !== 0,
      mode === "invalid"
        ? "OFFLINE_INVALID_RESULT_ACCEPTED"
        : "OFFLINE_HOST_FAILURE_FIXTURE_WAS_ACCEPTED",
    );
    return {
      status: "PASS",
      evidenceSource: "fixture",
      results: smokeEvaluation("PASS", 0, "NOT_RUN"),
      executable,
      openCodeVersion: version,
      certification:
        version === certifiedOpenCodeVersion ? "certified" : "outside-baseline",
      installed: effectiveInstalled,
      fixture: {
        name: scenario.name,
        requestCount: provider.requestCount(),
        turnCount: 0,
      },
      failure: failureFrom(`${result.stderr}\n${result.stdout}`),
    };
  } catch (error) {
    const failedTurn =
      typeof (error as { failedTurn?: unknown }).failedTurn === "number"
        ? (error as { failedTurn: number }).failedTurn
        : progress.activeTurn || undefined;
    const lastVerifiedTurn =
      typeof (error as { lastVerifiedTurn?: unknown }).lastVerifiedTurn ===
      "number"
        ? (error as { lastVerifiedTurn: number }).lastVerifiedTurn
        : progress.lastVerifiedTurn;
    const notRunTurns = failedTurn
      ? (await loadNativeScenario()).messages
          .filter((message) => message.turn > failedTurn)
          .map((message) => ({
            turn: message.turn,
            status: "NOT_RUN" as const,
          }))
      : [];
    let archived:
      | Awaited<ReturnType<SmokeArtifactArchive["finalize"]>>
      | undefined;
    if (archive) {
      await archive
        .write("scenario/failure-summary.json", {
          failure: failureFrom(error),
          failedTurn: failedTurn ?? null,
          lastVerifiedTurn,
          notRunTurns,
        })
        .catch(() => archive?.markIncomplete());
      archived = await archive
        .finalize({
          mode: "scripted",
          failure: failureFrom(error),
          failedTurn: failedTurn ?? null,
          lastVerifiedTurn,
        })
        .catch(() => {
          archive?.markIncomplete();
          return undefined;
        });
    }
    return {
      status: "FAIL",
      evidenceSource: "fixture",
      results: smokeEvaluation(
        "FAIL",
        lastVerifiedTurn,
        progress.functionalStatus ?? "NOT_RUN",
      ),
      failure: failureFrom(error),
      ...(archived
        ? {
            evidenceDirectory: archived.directory,
            archiveComplete: archived.archiveComplete,
          }
        : {}),
      ...(failedTurn ? { failedTurn } : {}),
      lastVerifiedTurn,
      ...(failedTurn ? { notRunTurns } : {}),
    };
  } finally {
    await provider?.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

export const safeEffectiveConfig = (source: string) => {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    const start = source.indexOf("{");
    const end = source.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("EFFECTIVE_CONFIG_NOT_JSON");
    value = JSON.parse(source.slice(start, end + 1));
  }
  assert(isRecord(value), "EFFECTIVE_CONFIG_INVALID");
  const projection: JsonRecord = {};
  for (const key of [
    "agent",
    "agents",
    "model",
    "permission",
    "plugin",
    "plugin_origins",
    "default_agent",
  ])
    if (key in value) projection[key] = value[key];
  const mcpNames = isRecord(value.mcp) ? Object.keys(value.mcp).sort() : [];
  assert(
    !mcpNames.some((name) => /pulso/i.test(name)),
    "EFFECTIVE_LEGACY_PULSO_MCP_CONFIGURED",
  );
  projection.mcpServerNames = mcpNames;
  assert(
    Array.isArray(projection.plugin),
    "EFFECTIVE_PLUGIN_CONFIG_NOT_OBSERVED",
  );
  const pulsoPlugins = projection.plugin.filter(
    (plugin) => typeof plugin === "string" && /pulso/i.test(plugin),
  );
  const pulsoPlugin = pulsoPlugins[0];
  assert(
    pulsoPlugins.length === 1 &&
      typeof pulsoPlugin === "string" &&
      pulsoPlugin.includes("pulso-protocol-guard"),
    "EFFECTIVE_PULSO_PLUGIN_NOT_UNIQUE_OR_NOT_LOCAL",
  );
  return sanitizeForTranscript(projection);
};

/** Live deliberately uses existing OpenCode authentication without reading or copying it. */
export const runLiveNativeSmoke = async (): Promise<RuntimeSmokeReport> => {
  if (process.env.PULSO_RUNTIME_SMOKE_LIVE_AUTH !== "1")
    return {
      status: "NOT_RUN",
      evidenceSource: "live",
      results: smokeEvaluation("NOT_RUN", 0, "NOT_RUN"),
      reason: "PULSO_RUNTIME_SMOKE_LIVE_AUTH=1 is required",
    };
  if (process.env.OPENCODE_CONFIG)
    return {
      status: "BLOCKED",
      evidenceSource: "live",
      results: smokeEvaluation("BLOCKED", 0, "NOT_RUN"),
      reason:
        "OPENCODE_CONFIG prevents the harness from proving that the temporary local profile was loaded",
    };
  const archive = await SmokeArtifactArchive.create(root);
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pulso-native-live-"));
  let cleanupAllowed = false;
  let finalized:
    | Awaited<ReturnType<SmokeArtifactArchive["finalize"]>>
    | undefined;
  let version = "not-observed";
  let executable = "not-observed";
  let installed: InstalledAssets | undefined;
  let baselineTree = "not-observed";
  let lastVerifiedTurn = 0;
  let cleanupEffective = false;
  const progress = {
    activeTurn: 0,
    lastVerifiedTurn: 0,
    functionalStatus: "NOT_RUN" as SmokeSectionStatus,
  };
  try {
    const scenario = await loadNativeScenario();
    const workspace = join(temporaryRoot, "workspace");
    executable = await executablePath();
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await stageScenario(workspace, scenario);
    const dataDir = join(temporaryRoot, "pulso-data");
    const env = {
      ...process.env,
      OPENCODE_DB: join(temporaryRoot, "opencode-live.db"),
      PULSO_DATA_DIR: dataDir,
    };
    baselineTree = await initializeFixtureRepository(workspace, env, scenario);
    installed = await installedPlan(
      workspace,
      process.env.HOME ?? temporaryRoot,
      executable,
    );
    version = await versionOf(executable, workspace, env);
    const lockHash = digest(await readFile(join(root, "bun.lock"), "utf8"));
    const debugConfig = await runCommand(executable, ["debug", "config"], {
      cwd: workspace,
      env,
      timeout: commandTimeoutForCategory("config"),
    });
    assert(debugConfig.status === 0, "EFFECTIVE_CONFIG_COMMAND_FAILED");
    const effectiveConfig = safeEffectiveConfig(debugConfig.stdout);
    installed = await inspectInstalledAssets(workspace);
    assert(
      installed.allManagedAssetsMatch,
      "PREFLIGHT_INSTALLED_ASSET_HASH_MISMATCH",
    );
    assert(installed.inherited, "PREFLIGHT_AGENT_MODEL_WAS_NOT_INHERITED");
    for (const [path, expectedContent] of Object.entries(scenario.files))
      assert(
        (await readFile(join(workspace, path), "utf8")) === expectedContent,
        `PREFLIGHT_SCENARIO_FILE_CHANGED:${path}`,
      );
    const requiredInstallerPaths = [
      ...managedInstallerAssetPaths(workspace, installed, installed.manifest),
    ];
    let fixtureBaseline: FixtureSnapshot;
    try {
      fixtureBaseline = await captureFixtureSnapshot(workspace);
      await archive.write("preflight-fixture.json", {
        baseline: fixtureBaseline,
        requiredInstallerPaths,
        scenarioFileHashes: Object.fromEntries(
          Object.entries(scenario.files).map(([path, content]) => [
            path,
            digest(content),
          ]),
        ),
      });
    } catch (error) {
      archive.markIncomplete();
      await archive
        .write("preflight-fixture-capture-error.json", {
          error: failureFrom(error),
        })
        .catch(() => archive.markIncomplete());
      throw error;
    }
    assertFixtureBaseline(fixtureBaseline, requiredInstallerPaths);
    const liveFixtureScope = {
      baseline: fixtureBaseline,
      lastVerified: fixtureBaseline,
    };
    await archive.write("preflight.json", {
      opencodeExecutable: executable,
      opencodeVersion: version,
      nodeVersion: process.version,
      bunVersion: (
        await runCommand("bun", ["--version"], {
          cwd: workspace,
          env,
          timeout: 30_000,
        })
      ).stdout.trim(),
      lockfileSha256: lockHash,
      buildId: installed.buildId,
      manifestSha256: installed.manifestSha256,
      manifestFiles: installed.manifest.files,
      harnessSha256: digest(
        (await readFile(join(root, "tests/runtime-smoke-harness.ts"))).toString(
          "utf8",
        ),
      ),
      fixtureScopeModuleSha256: digest(
        (await readFile(join(root, "tests/support/fixture-scope.ts"))).toString(
          "utf8",
        ),
      ),
      effectiveConfig,
      configSource: debugConfig.stderr,
      workspace,
      dataDir,
      opencodeDb: env.OPENCODE_DB,
      baselineTree,
    });
    const run = await runScenarioTurns(
      executable,
      workspace,
      env,
      scenario,
      "",
      {
        archive,
        dataDir,
        baselineTree,
        installed,
        progress,
        liveFixtureScope,
      },
    );
    assert(run.functionalVerification, "LIVE_FUNCTIONAL_RESULT_NOT_VERIFIED");
    assertLoadedBuild(run.attempts, installed);
    const finalSnapshot = await captureFixtureSnapshot(workspace);
    await archive.write("scenario/fixture-final.json", finalSnapshot);
    const fixtureVerification = await assertLiveFixtureChanges(
      workspace,
      env,
      scenario,
      baselineTree,
      fixtureBaseline,
      liveFixtureScope.lastVerified,
      finalSnapshot,
      run.harnessTestRun,
    );
    await assertFixtureHasNoCommit(workspace, env);
    lastVerifiedTurn = run.turns.length;
    await archive.write("scenario/success-summary.json", {
      results: smokeEvaluation(
        "PASS",
        run.turns.length,
        "PASS",
        run.functionalVerification.checks,
      ),
      turns: run.turns,
      attempts: run.attempts,
      fixtureVerification: {
        diff: fixtureVerification.diff,
        scopeDelta: compareFixtureSnapshots(fixtureBaseline, finalSnapshot),
        tests: {
          stdout: fixtureVerification.testRun.stdout,
          stderr: fixtureVerification.testRun.stderr,
          exitCode: fixtureVerification.testRun.status,
        },
      },
    });
    await rm(temporaryRoot, { recursive: true, force: true });
    cleanupEffective = true;
    cleanupAllowed = false;
    await archive.write("scenario/cleanup.json", {
      temporaryRootPreserved: false,
      cleanupEffective,
    });
    finalized = await archive.finalize({
      status: "PASS",
      results: smokeEvaluation(
        "PASS",
        lastVerifiedTurn,
        "PASS",
        run.functionalVerification.checks,
      ),
      failedTurn: null,
      lastVerifiedTurn,
      notRunTurns: [],
      buildId: installed.buildId,
      temporaryRoot,
      temporaryRootPreserved: false,
      cleanupEffective,
    });
    cleanupAllowed = finalized.archiveComplete;
    return {
      status: "PASS",
      evidenceSource: "live",
      results: smokeEvaluation(
        "PASS",
        lastVerifiedTurn,
        "PASS",
        run.functionalVerification.checks,
      ),
      executable,
      openCodeVersion: version,
      certification:
        version === certifiedOpenCodeVersion ? "certified" : "outside-baseline",
      installed,
      fixture: {
        name: scenario.name,
        requestCount: 0,
        turnCount: run.turns.length,
      },
      attempts: run.attempts,
      turns: run.turns,
      evidenceDirectory: finalized.directory,
      archiveComplete: finalized.archiveComplete,
      cleanupEffective,
    };
  } catch (error) {
    const failureMessage =
      error instanceof Error ? error.message : String(error);
    const functionalFailure =
      /FUNCTIONAL_|HARNESS_TESTS_FAILED|LIVE_FIXTURE_TESTS_NOT_PASSED/.test(
        failureMessage,
      );
    const failedTurn =
      typeof (error as { failedTurn?: unknown })?.failedTurn === "number"
        ? (error as { failedTurn: number }).failedTurn
        : progress.activeTurn || undefined;
    const turnLastVerified =
      typeof (error as { lastVerifiedTurn?: unknown })?.lastVerifiedTurn ===
      "number"
        ? (error as { lastVerifiedTurn: number }).lastVerifiedTurn
        : progress.lastVerifiedTurn || lastVerifiedTurn;
    const remainingTurns = failedTurn
      ? (await loadNativeScenario()).messages
          .filter((message) => message.turn > failedTurn)
          .map((message) => ({ turn: message.turn, status: "NOT_RUN" }))
      : [];
    await archive
      .write("scenario/failure-summary.json", {
        results: smokeEvaluation(
          functionalFailure ? "BLOCKED" : "FAIL",
          turnLastVerified,
          functionalFailure ? "FAIL" : (progress.functionalStatus ?? "NOT_RUN"),
        ),
        failure: failureFrom(error),
        failedTurn: failedTurn ?? null,
        lastVerifiedTurn: turnLastVerified,
        notRunTurns: remainingTurns,
        buildId: installed?.buildId ?? "not-observed",
        temporaryRoot,
        temporaryRootPreserved: !cleanupEffective,
        cleanupEffective,
        failureCause: (error as Error)?.cause
          ? failureFrom((error as Error).cause)
          : undefined,
      })
      .catch(() => archive.markIncomplete());
    finalized = await archive
      .finalize({
        status: "FAIL",
        results: smokeEvaluation(
          functionalFailure ? "BLOCKED" : "FAIL",
          turnLastVerified,
          functionalFailure ? "FAIL" : (progress.functionalStatus ?? "NOT_RUN"),
        ),
        failedTurn: failedTurn ?? null,
        lastVerifiedTurn: turnLastVerified,
        buildId: installed?.buildId ?? "not-observed",
        temporaryRoot,
        temporaryRootPreserved: !cleanupEffective,
        cleanupEffective,
      })
      .catch(() => {
        archive.markIncomplete();
        return undefined;
      });
    return {
      status: "FAIL",
      evidenceSource: "live",
      results: smokeEvaluation(
        functionalFailure ? "BLOCKED" : "FAIL",
        turnLastVerified,
        functionalFailure ? "FAIL" : (progress.functionalStatus ?? "NOT_RUN"),
      ),
      failure: failureFrom(error),
      ...(failedTurn ? { failedTurn } : {}),
      lastVerifiedTurn: turnLastVerified,
      ...(failedTurn
        ? {
            notRunTurns: remainingTurns as Array<{
              turn: number;
              status: "NOT_RUN";
            }>,
          }
        : {}),
      ...(finalized
        ? {
            evidenceDirectory: finalized.directory,
            archiveComplete: finalized.archiveComplete,
          }
        : {}),
      temporaryRoot,
      cleanupEffective,
    };
  } finally {
    if (cleanupAllowed)
      await rm(temporaryRoot, { recursive: true, force: true });
  }
};

if (import.meta.main) {
  const mode = process.argv[2];
  const report =
    mode === "live"
      ? await runLiveNativeSmoke()
      : await runOfflineNativeSmoke(
          mode === "invalid" || mode === "host-error" ? mode : "valid",
        );
  console.log(JSON.stringify(sanitizeForTranscript(report), null, 2));
  process.exitCode =
    report.status === "PASS"
      ? 0
      : report.status === "NOT_RUN"
        ? liveNotRunExitCode
        : 1;
}
