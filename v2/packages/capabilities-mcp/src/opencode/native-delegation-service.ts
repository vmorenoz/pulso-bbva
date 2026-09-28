import { createHash } from "node:crypto";
import {
  type AgentResult,
  buildTaskEnvelope,
  createProtocolEnforcer,
  renderTaskResultTemplate,
  type SpecialistId,
  serializeAgentResult,
  serializeTaskEnvelope,
  specialistIds,
} from "../../../orchestration/src";
import { PulsoError, type WorkItem } from "../../../working-system/src";
import type { CapabilitiesRuntime } from "../bootstrap";
import type { NativePrepareInput, NativeStatusInput } from "./facade-contracts";
import { nativePolicy } from "./facade-contracts";
import {
  assertNativeTaskArgsMutable,
  hasNativeDispatchReferenceMarker,
  hydrateNativeTaskArgsInPlace,
  nativeDispatchDescription,
  nativeDispatchTaskArgs,
  parseNativeDispatchReference,
} from "./native-dispatch-reference";
import {
  type NativeDelegation,
  type NativeJournal,
  nativeReceiptHash,
  rejectedNativeReceiptHash,
} from "./native-journal";
import type { NativeSession, NativeWorkService } from "./native-work-service";
import {
  type OpenCodeTransport,
  type OpenCodeTransportFailure,
  transportFailureOf,
} from "./opencode-port";

type NativeTaskArgs = {
  description: string;
  subagent_type: string;
  prompt: string;
};
type HookCall = { sessionID: string; callID: string };
type AfterOutput = { output: string; metadata: unknown };
type NativeTaskWrapper = {
  state: string;
  childSessionId?: string;
  body: string;
};
type HookTaskMetadata = {
  parentSessionId: string;
  sessionId: string;
  background: boolean;
  model: { providerId: string; modelId: string };
};
type SettledNativeTask = {
  delegation: NativeDelegation;
  receipt: Record<string, unknown>;
  receiptHash: string;
  output: string;
};
type NativeObservationPolicy = {
  heartbeatIntervalMs: number;
  observationIntervalMs: number;
  observationTimeoutMs: number;
  maximumExecutionMs: number;
};
export type NativeErrorStage =
  | "input"
  | "permission"
  | "workspace_or_session"
  | "preparation"
  | "native_dispatch"
  | "observation"
  | "provider_auth_confirmed"
  | "provider_access"
  | "provider_rate_limit"
  | "transport_timeout"
  | "protocol_parse"
  | "protocol_schema"
  | "identity_mismatch"
  | "authority_expired"
  | "lifecycle_conflict"
  | "unknown";
export type NativeDiagnostic = {
  stage: NativeErrorStage;
  code: string;
  rawResultHash?: string;
  cleanupCode?: string;
  transport?: OpenCodeTransportFailure;
  paths?: string[];
  ids?: {
    delegationId: string;
    specialist: SpecialistId;
    workId: string;
    workItemId: string;
  };
};

const specialists = new Set<string>(specialistIds);
const now = () => new Date();
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const hash = (value: unknown) =>
  createHash("sha256").update(stable(value)).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nativeTaskMarker = /<pulso-task v="2">/;

const validationPaths = (error: unknown) => {
  const paths = new Set<string>();
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const details = current as { issues?: unknown; cause?: unknown };
    if (Array.isArray(details.issues))
      for (const issue of details.issues) {
        if (!isRecord(issue) || !Array.isArray(issue.path)) continue;
        const path = issue.path.filter(
          (part): part is string | number =>
            typeof part === "string" || typeof part === "number",
        );
        if (path.length !== issue.path.length) continue;
        paths.add(
          path.reduce<string>(
            (result, part) =>
              typeof part === "number"
                ? `${result}[${part}]`
                : result
                  ? `${result}.${part}`
                  : part,
            "",
          ) || "payload",
        );
      }
    current = details.cause;
  }
  return [...paths];
};

// Rejections fingerprint exact task-result bytes. Parsing invalid output here
// would turn a malformed result into a semantically different replay key.
const rawResultHash = (output: string) => {
  const result = /<task_result>([\s\S]*?)<\/task_result>/.exec(output)?.[1];
  return createHash("sha256")
    .update(result ?? output)
    .digest("hex");
};

const nativeError = (code: string, message: string): never => {
  throw new PulsoError(code, message);
};

const nativeErrorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).slice(
    0,
    nativePolicy.maximumDiagnosticBytes,
  );

const nativeErrorCode = (error: unknown) => {
  if (error instanceof PulsoError) return error.code;
  if (!(error instanceof Error)) return "unknown";
  return (
    /(?:AGENT_RESULT_INVALID|TASK_ENVELOPE_INVALID):([^:]+)/.exec(
      error.message,
    )?.[1] ??
    error.message.split(":")[0] ??
    "unknown"
  );
};

const transportEvidenceText = (failure: OpenCodeTransportFailure) =>
  [
    failure.className,
    failure.code,
    failure.message,
    failure.cause?.className,
    failure.cause?.code,
    failure.cause?.message,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

const hasProviderEvidence = (failure: OpenCodeTransportFailure) =>
  /\bprovider\b|(?:^|[\s:_-])provider[_ -]/i.test(
    transportEvidenceText(failure),
  );

/** Classifies SDK evidence without converting transport failures into dispatch errors. */
export const classifyNativeError = (
  error: unknown,
  fallback: NativeErrorStage,
): NativeDiagnostic => {
  const transport = transportFailureOf(error);
  if (transport) {
    const evidence = transportEvidenceText(transport);
    const code = transport.code ?? transport.className;
    if (hasProviderEvidence(transport) && transport.status === 401)
      return { stage: "provider_auth_confirmed", code, transport };
    if (hasProviderEvidence(transport) && transport.status === 403)
      return { stage: "provider_access", code, transport };
    if (hasProviderEvidence(transport) && transport.status === 429)
      return { stage: "provider_rate_limit", code, transport };
    if (
      /timeout|connection(?:error)?|network/i.test(evidence) ||
      transport.className === "AbortError"
    )
      return { stage: "transport_timeout", code, transport };
    return { stage: fallback, code, transport };
  }
  const message = nativeErrorMessage(error);
  const code = nativeErrorCode(error);
  if (code === "OBSERVATION_TIMEOUT")
    return { stage: "observation", code: "observation_unknown" };
  if (code === "NATIVE_PERMISSION_DENIED") return { stage: "permission", code };
  if (code === "WORKSPACE_OR_SESSION")
    return { stage: "workspace_or_session", code };
  if (/^(PREPARATION|PREPARATION_|OPERATION_|BUDGET_)/.test(code))
    return { stage: "preparation", code };
  if (/^NATIVE_DISPATCH/.test(code)) return { stage: "native_dispatch", code };
  if (/^OBSERVATION/.test(code)) return { stage: "observation", code };
  if (code === "AUTHORITY_EXPIRED") return { stage: "authority_expired", code };
  if (/IDENTITY|_MISMATCH/.test(code))
    return { stage: "identity_mismatch", code };
  if (/RESULT_REPLAY|LIFECYCLE|CAS_CONFLICT/.test(code))
    return { stage: "lifecycle_conflict", code };
  const protocolCode =
    /(?:AGENT_RESULT_INVALID|TASK_ENVELOPE_INVALID):([^:]+)/.exec(message)?.[1];
  if (protocolCode)
    return {
      stage: /PROTOCOL_(MALFORMED|PARSE_ERROR)/.test(protocolCode)
        ? "protocol_parse"
        : "protocol_schema",
      code: protocolCode,
    };
  if (
    /(?:provider|api key|credential|oauth)/i.test(message) &&
    /(?:401|unauthenticated|invalid[_ -]?api[_ -]?key)/i.test(message)
  )
    return {
      stage: "provider_auth_confirmed",
      code: "provider_auth_confirmed",
    };
  if (/provider/i.test(message) && /(?:403|forbidden)/i.test(message))
    return { stage: "provider_access", code: "provider_access" };
  if (/provider/i.test(message) && /(?:429|rate limit)/i.test(message))
    return { stage: "provider_rate_limit", code: "provider_rate_limit" };
  if (/timeout/i.test(message))
    return {
      stage: fallback === "observation" ? "observation" : "transport_timeout",
      code:
        fallback === "observation"
          ? "observation_unknown"
          : "transport_timeout",
    };
  return { stage: fallback, code };
};

export const observeWithTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number = nativePolicy.observationTimeoutMs,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new PulsoError("OBSERVATION_TIMEOUT", "Observation timed out"),
            ),
          timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const taskBudgetBreakdown = (task: {
  objective: string;
  context?: unknown;
  dependencies?: unknown;
  constraints?: unknown;
  acceptanceCriteria?: unknown;
  scope?: unknown;
  requestedEvidence?: unknown;
}) => {
  const bytes = (value: unknown) => Buffer.byteLength(stable(value), "utf8");
  const fields = {
    objective: bytes(task.objective),
    context: bytes(task.context ?? {}),
    dependencies: bytes(task.dependencies ?? []),
    constraints: bytes(task.constraints ?? []),
    acceptanceCriteria: bytes(task.acceptanceCriteria ?? []),
    scope: bytes(task.scope ?? {}),
    requestedEvidence: bytes(task.requestedEvidence ?? []),
  };
  return {
    ...fields,
    declared: Object.values(fields).reduce((sum, value) => sum + value, 0),
  };
};

export const shouldRenewHeartbeat = (
  lastHeartbeatAt: string | undefined,
  dispatchedAt: string | undefined,
  current: Date,
  intervalMs: number = nativePolicy.heartbeatIntervalMs,
) => {
  const previous = lastHeartbeatAt ?? dispatchedAt;
  return (
    previous !== undefined &&
    current.getTime() - new Date(previous).getTime() >= intervalMs
  );
};

/** Coordinates native transport while preserving Work authority in the core. */
export class NativeDelegationService {
  private readonly enforcer = createProtocolEnforcer();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly afterCalls = new Map<
    string,
    Promise<NativeDelegation | undefined>
  >();

  constructor(
    private readonly runtime: CapabilitiesRuntime,
    private readonly journal: NativeJournal,
    private readonly port: OpenCodeTransport,
    private readonly instanceId: string,
    private readonly work: NativeWorkService,
    private readonly observationPolicy: NativeObservationPolicy = nativePolicy,
  ) {}

  async prepare(input: NativePrepareInput, session: NativeSession) {
    this.assertPulso(session);
    await this.journal.expirePreparations(now().toISOString());
    const requestHash = hash(input);
    const current = await this.work.get(session);
    const currentWork = current.currentWork;
    if (!currentWork)
      return nativeError(
        "WORK_NOT_FOUND",
        "Open or select a Work before preparing a delegation",
      );
    const workId = currentWork.workId;
    const snapshot = await this.runtime.work.snapshot(workId);
    if (["completed", "cancelled"].includes(snapshot.work.status))
      nativeError(
        "WORK_NOT_EXECUTABLE",
        "Cannot prepare work under a terminal Work",
      );
    if (["blocked", "waiting", "failed"].includes(snapshot.work.status))
      nativeError(
        "WORK_RESUME_REQUIRED",
        "Resume the Work before preparing a delegation",
      );
    const workItem = await this.resolveItem(input, session, snapshot.work.id);
    const completeItems = new Set(
      (await this.runtime.work.snapshot(workId)).items
        .filter((item) => item.status === "completed")
        .map((item) => item.id),
    );
    for (const dependency of input.dependencies ?? [])
      if (!completeItems.has(dependency.workItemId))
        nativeError(
          "DEPENDENCY_NOT_SATISFIED",
          "A requested dependency is not completed",
        );
    const expected = {
      delegationId: crypto.randomUUID(),
      specialist: input.specialist,
      workId,
      workItemId: workItem.id,
    };
    const resultTemplate = renderTaskResultTemplate(expected);
    const built = buildTaskEnvelope({
      ...input,
      delegationId: expected.delegationId,
      specialist: expected.specialist,
      workId: expected.workId,
      workItemId: expected.workItemId,
      constraints: [...(input.constraints ?? []), resultTemplate],
    });
    const taskWire = serializeTaskEnvelope(built.task);
    const total = Buffer.byteLength(taskWire, "utf8");
    if (total > nativePolicy.maximumTaskWireBytes) {
      const breakdown = {
        ...taskBudgetBreakdown(built.task),
        resultTemplate: Buffer.byteLength(resultTemplate, "utf8"),
        total,
        maximum: nativePolicy.maximumTaskWireBytes,
      };
      nativeError(
        "BUDGET_EXCEEDED",
        `Task envelope exceeds the native context budget: ${JSON.stringify(breakdown)}`,
      );
    }
    const preparedAt = now();
    const delegation = await this.journal.createPreparation({
      ...expected,
      workspaceId: session.workspaceId,
      parentSessionId: session.parentSessionId,
      requestMessageId: session.messageId,
      requestHash,
      taskWire,
      taskHash: hash(taskWire),
      preparedAt: preparedAt.toISOString(),
      preparationExpiresAt: new Date(
        preparedAt.getTime() + nativePolicy.preparationTtlMs,
      ).toISOString(),
    });
    return this.preparedResponse(delegation);
  }

  async before(call: HookCall, args: unknown, durableCorrelation = false) {
    const task = this.taskArgs(args);
    if (!this.isManagedCandidate(task, args, durableCorrelation)) return false;
    if (!task)
      return nativeError(
        "NATIVE_DISPATCH",
        "Managed task arguments are invalid",
      );
    if (!isRecord(args))
      return nativeError(
        "NATIVE_DISPATCH",
        "Managed task arguments are invalid",
      );
    if ("task_id" in args || "command" in args || "background" in args)
      nativeError(
        "NATIVE_DISPATCH",
        "task_id, command, and background are not supported",
      );
    // Validation of the host argument container precedes any state mutation.
    try {
      assertNativeTaskArgsMutable(args);
    } catch (error) {
      return nativeError("NATIVE_DISPATCH", nativeErrorMessage(error));
    }
    const referenceId = parseNativeDispatchReference(task.prompt);
    if (!referenceId && hasNativeDispatchReferenceMarker(task.prompt))
      return nativeError(
        "PREPARATION_REFERENCE_INVALID",
        "Dispatch reference is malformed",
      );

    // Legacy full envelopes remain strict: never repair a model-supplied payload.
    const legacyEnvelope = referenceId
      ? undefined
      : this.validateDispatchEnvelope(task.prompt);
    const delegationId = referenceId ?? legacyEnvelope?.delegationId;
    if (!delegationId)
      return nativeError(
        "PREPARATION",
        "A durable preparation reference is required",
      );
    const delegation = await this.journal.get(delegationId);
    if (!delegation)
      return nativeError(
        "PREPARATION",
        "No durable native preparation exists for this task",
      );
    if (
      delegation.workspaceId !== this.runtime.workspaceId ||
      delegation.parentSessionId !== call.sessionID ||
      !(await this.journal.ownsWork(
        this.runtime.workspaceId,
        call.sessionID,
        delegation.workId,
      ))
    )
      return nativeError(
        "IDENTITY_MISMATCH",
        "Preparation is not owned by this workspace and parent",
      );

    // Revalidate the persisted envelope. The lookup reference is not authority.
    if (delegation.taskHash !== hash(delegation.taskWire))
      return nativeError(
        "PREPARATION_INTEGRITY",
        "Durable task hash does not match stored bytes",
      );
    const envelope = this.validateDispatchEnvelope(delegation.taskWire);
    if (
      !specialists.has(envelope.specialist) ||
      task.subagent_type !== delegation.specialist ||
      delegation.delegationId !== envelope.delegationId ||
      delegation.specialist !== envelope.specialist ||
      delegation.workId !== envelope.work.workId ||
      delegation.workItemId !== envelope.work.workItemId
    )
      return nativeError(
        "IDENTITY_MISMATCH",
        "Task selector or durable envelope identity differs",
      );
    if (delegation.transportPhase !== "prepared") {
      if (delegation.parentCallId === call.callID)
        return nativeError(
          "NATIVE_DISPATCH_REPLAY",
          "The native call already consumed this preparation",
        );
      if (delegation.transportPhase === "expired")
        return nativeError(
          "PREPARATION_EXPIRED",
          "The native preparation expired",
        );
      return nativeError(
        "PREPARATION_ALREADY_CONSUMED",
        "Another call already consumed this preparation",
      );
    }
    const snapshot = await this.runtime.work.snapshot(delegation.workId);
    const preparedItem = snapshot.items.find(
      (item) => item.id === delegation.workItemId,
    );
    if (!preparedItem)
      return nativeError(
        "WORK_ITEM_NOT_FOUND",
        "Prepared WorkItem no longer exists",
      );
    if (
      !referenceId &&
      (task.description !== preparedItem.title.slice(0, 80) ||
        delegation.taskWire !== task.prompt ||
        delegation.taskHash !== hash(task.prompt))
    )
      return nativeError(
        "IDENTITY_MISMATCH",
        "Task differs from its durable preparation",
      );

    // A preparation must still be executable at dispatch time. Replays retain
    // their existing claim error path rather than reactivating an item.
    if (delegation.transportPhase === "prepared") {
      if (!["pending", "active"].includes(snapshot.work.status))
        return nativeError(
          "WORK_NOT_EXECUTABLE",
          "Prepared Work is not executable",
        );
      if (preparedItem.status !== "ready")
        return nativeError(
          "WORK_ITEM_NOT_READY",
          "Prepared WorkItem is no longer ready",
        );
      const assignment = snapshot.assignments.find(
        (item) =>
          item.workItemId === preparedItem.id && item.status === "active",
      );
      if (assignment?.assigneeId !== delegation.specialist)
        return nativeError(
          "ASSIGNMENT_INVALID",
          "Prepared specialist assignment changed",
        );
    }
    const canonicalArgs = {
      description: referenceId
        ? nativeDispatchDescription(delegation.specialist)
        : preparedItem.title.slice(0, 80),
      subagent_type: delegation.specialist,
      prompt: delegation.taskWire,
    };
    const claimed = await this.claim(delegation, call);
    // Hooks may replay after a host retry; the durable claim is observable but never dispatchable again.
    if (!claimed.dispatchAllowed)
      return nativeError(
        "NATIVE_DISPATCH_REPLAY",
        `Native call '${call.callID}' already has durable delegation '${claimed.delegationId}' (dispatchAllowed=false)`,
      );
    try {
      const binding = await this.runtime.runtimeAdapter.bind({
        workId: claimed.workId,
        workItemId: claimed.workItemId,
        executorId: claimed.specialist,
        assigneeId: claimed.specialist,
        managedBy: "opencode-native",
        runtimeReference: {
          provider: "opencode",
          executionId: claimed.delegationId,
          sessionId: claimed.parentSessionId,
          metadata: { parentCallId: call.callID },
        },
      });
      const bound = await this.journal.attachBinding({
        delegationId: claimed.delegationId,
        ownerInstanceId: this.instanceId,
        bindingId: binding.bindingId,
        version: claimed.version,
      });
      // Keep object identity: replacing output.args would not update the host call.
      hydrateNativeTaskArgsInPlace(args, canonicalArgs);
      this.armObservation(bound);
      return true;
    } catch (error) {
      await this.journal
        .closeDispatchFailure(
          claimed.delegationId,
          this.instanceId,
          nativeErrorCode(error),
        )
        .catch(() => undefined);
      throw error;
    }
  }

  isCandidate(args: unknown, durableCorrelation = false) {
    return this.isManagedCandidate(
      this.taskArgs(args),
      args,
      durableCorrelation,
    );
  }

  async after(call: HookCall, output: AfterOutput, wasCandidate: boolean) {
    if (!wasCandidate) return;
    const key = `${call.sessionID}\u0000${call.callID}`;
    const inFlight = this.afterCalls.get(key);
    if (inFlight) await inFlight;
    const current = this.afterCalls.get(key);
    if (current) await current;
    const operation = this.applyAfter(call, output, true);
    this.afterCalls.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.afterCalls.get(key) === operation) this.afterCalls.delete(key);
    }
  }

  private async applyAfter(
    call: HookCall,
    output: AfterOutput,
    wasCandidate: boolean,
  ) {
    if (!wasCandidate) return;
    let receivedResultHash = rawResultHash(output.output);
    let delegation = await this.journal.getByCall(
      this.runtime.workspaceId,
      call.sessionID,
      call.callID,
    );
    if (!delegation)
      return nativeError(
        "NATIVE_DISPATCH",
        "Managed task has no durable claim",
      );
    if (delegation.receiptHash) {
      this.stopObservation(delegation.delegationId);
      return this.replayAfter(delegation, output, receivedResultHash);
    }
    try {
      if (
        delegation.workspaceId !== this.runtime.workspaceId ||
        delegation.parentSessionId !== call.sessionID ||
        delegation.parentCallId !== call.callID
      )
        return nativeError(
          "IDENTITY_MISMATCH",
          "Durable native delegation does not match the actual hook call",
        );
      delegation = await this.journal.adoptClaim({
        delegationId: delegation.delegationId,
        workspaceId: delegation.workspaceId,
        parentSessionId: call.sessionID,
        parentCallId: call.callID,
        ownerInstanceId: this.instanceId,
      });
      // The hook carries the terminal wrapper for this call. Stop background
      // polling before applying that same result; its lifecycle is settled here.
      this.stopObservation(delegation.delegationId);
      const wrapper = this.taskWrapper(output.output);
      let metadata: HookTaskMetadata;
      try {
        metadata = this.hookTaskMetadata(
          output.metadata,
          wrapper.state === "completed",
        );
      } catch (error) {
        if (wrapper.state !== "completed") {
          await this.recordUncertainAbort(
            delegation,
            "native_wrapper_running_metadata_unverified",
          );
          return nativeError(
            "NATIVE_DISPATCH",
            "Running task metadata could not verify an abort target",
          );
        }
        throw error;
      }
      if (
        metadata.parentSessionId !== call.sessionID ||
        metadata.parentSessionId !== delegation.parentSessionId
      ) {
        if (wrapper.state !== "completed") {
          await this.recordUncertainAbort(
            delegation,
            "native_wrapper_parent_unverified",
          );
          return nativeError(
            "IDENTITY_MISMATCH",
            "Running task parent could not be verified",
          );
        }
        return nativeError(
          "IDENTITY_MISMATCH",
          "Hook metadata parent session does not match the managed call",
        );
      }
      if (
        wrapper.state === "completed" &&
        wrapper.childSessionId !== metadata.sessionId
      )
        return nativeError(
          "IDENTITY_MISMATCH",
          "Task wrapper child does not match native hook metadata",
        );
      if (metadata.background || wrapper.state !== "completed") {
        if (
          wrapper.childSessionId &&
          wrapper.childSessionId === metadata.sessionId
        )
          await this.stopUnsupportedFromHook(
            delegation,
            wrapper,
            metadata,
            metadata.background
              ? "background_unsupported"
              : "native_wrapper_running_unsupported",
          );
        else
          await this.recordUncertainAbort(
            delegation,
            metadata.background
              ? "background_child_unverified"
              : "running_child_unverified",
          );
        return nativeError(
          "NATIVE_DISPATCH",
          metadata.background
            ? "Native task was promoted to unsupported background execution"
            : "Native task wrapper did not complete in the foreground",
        );
      }
      const verified = await this.observeWrapperChild(
        delegation,
        wrapper.childSessionId,
      );
      if (!verified)
        return nativeError(
          "IDENTITY_MISMATCH",
          "Task child session could not be verified against the parent",
        );
      const terminal = await this.applyVerifiedResult(
        verified,
        this.extractTaskResult(wrapper),
        output.output,
      );
      receivedResultHash = rawResultHash(terminal.output);
      output.output = JSON.stringify(terminal.receipt);
      this.attachMetadata(output, terminal.receiptHash, {
        model: metadata.model,
      });
      this.stopObservation(delegation.delegationId);
      return terminal.delegation;
    } catch (error) {
      await this.rejectAfter(delegation, error, receivedResultHash);
      throw error;
    }
  }

  async status(input: NativeStatusInput, session: NativeSession) {
    this.assertPulso(session);
    await this.journal.expirePreparations(now().toISOString());
    await this.runtime.runtimeAdapter.reconcile();
    const candidates = input.delegationId
      ? [await this.journal.get(input.delegationId)].filter(
          (delegation): delegation is NativeDelegation => Boolean(delegation),
        )
      : await this.journal.list(session.workspaceId, session.parentSessionId);
    for (const delegation of candidates) {
      if (
        delegation.workspaceId !== session.workspaceId ||
        delegation.parentSessionId !== session.parentSessionId
      )
        continue;
      await this.reconcileDelegation(delegation);
    }
    if (input.delegationId) {
      const delegation = await this.journal.get(input.delegationId);
      if (
        !delegation ||
        delegation.workspaceId !== session.workspaceId ||
        delegation.parentSessionId !== session.parentSessionId
      )
        return nativeError(
          "NATIVE_PERMISSION_DENIED",
          "Delegation is not owned by this parent session",
        );
      return this.state(delegation, input.view, true);
    }
    const current = await this.work.get(session);
    const delegations = await this.journal.list(
      session.workspaceId,
      session.parentSessionId,
    );
    return {
      ...current,
      doctor: {
        workspaceId: session.workspaceId,
        storage: "runtime-bindings.db",
        buildId: this.buildId(),
        bridgeVersion: nativePolicy.certifiedOpenCodeVersion,
        protocol: "pulso-receipt/1",
      },
      delegations: delegations
        .slice(0, input.view === "full" ? undefined : 10)
        .map((delegation) => this.delegationView(delegation)),
    };
  }

  async dispose() {
    const delegationIds = [...this.timers.keys()];
    for (const delegationId of delegationIds)
      this.stopObservation(delegationId);
    const active = await Promise.all(
      delegationIds.map((delegationId) => this.journal.get(delegationId)),
    );
    await Promise.all(
      active
        .filter((delegation): delegation is NativeDelegation =>
          Boolean(delegation?.childSessionId),
        )
        .map(async (delegation) => {
          const childSessionId = delegation.childSessionId;
          if (!childSessionId) return;
          const stopped = await this.abortVerifiedChild(
            delegation,
            childSessionId,
          );
          if (stopped) {
            const cleanupCode = await this.failBinding(delegation, "disposed");
            await this.journal
              .reject({
                delegationId: delegation.delegationId,
                ownerInstanceId: this.instanceId,
                stage: "native_dispatch",
                code: "disposed_after_confirmed_abort",
              })
              .catch(() => undefined);
            if (cleanupCode)
              await this.recordObservationDiagnostic(
                delegation,
                "disposed_after_confirmed_abort",
                "native_dispatch",
                cleanupCode,
              );
          } else
            await this.recordUncertainAbort(
              delegation,
              "dispose_abort_unconfirmed",
            );
        }),
    );
  }

  private async resolveItem(
    input: NativePrepareInput,
    session: NativeSession,
    workId: string,
  ): Promise<WorkItem> {
    const snapshot = await this.runtime.work.snapshot(workId);
    if (!input.workItemId) {
      const inputHash = hash({ input, workId });
      return this.runtime.work.addItem(
        {
          workId,
          title: input.objective.slice(0, 80),
          description: input.objective,
          kind: input.specialist,
          assigneeId: input.specialist,
        },
        {
          operationKey: hash({
            workspaceId: session.workspaceId,
            parentSessionId: session.parentSessionId,
            messageId: session.messageId,
            name: "prepare-item",
            inputHash,
          }),
          inputHash,
        },
      );
    }
    const item = snapshot.items.find(
      (candidate) => candidate.id === input.workItemId,
    );
    if (item?.status !== "ready")
      return nativeError(
        "WORK_ITEM_NOT_READY",
        "Prepared WorkItem must belong to the Work and be ready",
      );
    const assignment = snapshot.assignments.find(
      (candidate) =>
        candidate.workItemId === item.id && candidate.status === "active",
    );
    if (assignment?.assigneeId !== input.specialist)
      return nativeError(
        "ASSIGNMENT_INVALID",
        "Prepared WorkItem assignment does not match specialist",
      );
    return item;
  }

  private async claim(delegation: NativeDelegation, call: HookCall) {
    return this.journal.claim({
      delegationId: delegation.delegationId,
      workspaceId: delegation.workspaceId,
      parentSessionId: delegation.parentSessionId,
      parentCallId: call.callID,
      ownerInstanceId: this.instanceId,
      now: now().toISOString(),
      deadlineAt: new Date(
        now().getTime() + this.observationPolicy.maximumExecutionMs,
      ).toISOString(),
    });
  }

  private validateDispatchEnvelope(wire: string) {
    try {
      return this.enforcer.validateTask(wire);
    } catch (error) {
      return nativeError(
        "PREPARATION",
        `Task envelope rejected: ${nativeErrorMessage(error)}`,
      );
    }
  }

  private taskArgs(value: unknown): NativeTaskArgs | undefined {
    if (!isRecord(value)) return undefined;
    const description = value.description;
    const subagent = value.subagent_type;
    const prompt = value.prompt;
    if (
      typeof description !== "string" ||
      typeof subagent !== "string" ||
      typeof prompt !== "string"
    )
      return undefined;
    return { description, subagent_type: subagent, prompt };
  }

  private isManagedCandidate(
    task: NativeTaskArgs | undefined,
    args: unknown,
    durableCorrelation = false,
  ) {
    if (durableCorrelation) return true;
    if (!task)
      return (
        isRecord(args) &&
        typeof args.prompt === "string" &&
        (nativeTaskMarker.test(args.prompt) ||
          hasNativeDispatchReferenceMarker(args.prompt))
      );
    return (
      nativeTaskMarker.test(task.prompt) ||
      hasNativeDispatchReferenceMarker(task.prompt) ||
      specialists.has(task.subagent_type)
    );
  }

  private taskWrapper(output: string): NativeTaskWrapper {
    const match = /^\s*<task\b([^>]*)>([\s\S]*?)<\/task>\s*$/.exec(output);
    if (!match)
      return nativeError("NATIVE_DISPATCH", "Task wrapper is missing");
    const attributes = match[1] ?? "";
    const states = [...attributes.matchAll(/\bstate="([^"]+)"/g)];
    if (states.length !== 1)
      return nativeError("NATIVE_DISPATCH", "Task wrapper state is missing");
    const ids = [...attributes.matchAll(/\bid="([^"]+)"/g)];
    if (
      ids.length > 1 ||
      (states[0]?.[1] === "completed" && (ids.length !== 1 || !ids[0]?.[1]))
    )
      return nativeError(
        "NATIVE_DISPATCH_IDENTITY_MISSING",
        "Task wrapper must expose exactly one child id",
      );
    const state = states[0]?.[1];
    if (!state)
      return nativeError("NATIVE_DISPATCH", "Task wrapper state is missing");
    return {
      state,
      ...(ids[0]?.[1] ? { childSessionId: ids[0][1] } : {}),
      body: match[2] ?? "",
    };
  }

  private hookTaskMetadata(
    value: unknown,
    completedWrapper = false,
  ): HookTaskMetadata {
    if (!isRecord(value))
      return nativeError(
        "NATIVE_DISPATCH_METADATA_MISSING",
        "Native task hook metadata is missing",
      );
    const model = isRecord(value.model) ? value.model : undefined;
    const providerId = model?.providerID ?? model?.providerId;
    const modelId = model?.modelID ?? model?.modelId;
    if (
      typeof value.parentSessionId !== "string" ||
      typeof value.sessionId !== "string" ||
      (typeof value.background !== "boolean" && !completedWrapper) ||
      typeof providerId !== "string" ||
      typeof modelId !== "string"
    )
      return nativeError(
        "NATIVE_DISPATCH_METADATA_INCOMPLETE",
        "Native task hook metadata must include parent, child, background, and observed model",
      );
    return {
      parentSessionId: value.parentSessionId,
      sessionId: value.sessionId,
      // OpenCode 1.18.32 omits the false flag for foreground tasks. A complete
      // native wrapper is the public evidence of foreground completion; an
      // absent flag on a running wrapper remains indeterminate and fail-closed.
      background: value.background === true,
      model: { providerId, modelId },
    };
  }

  private async settleObservedTerminal(
    delegation: NativeDelegation,
    observed: Awaited<ReturnType<OpenCodeTransport["observeCall"]>>,
    hookOutput?: string,
  ): Promise<SettledNativeTask> {
    if (observed.status !== "completed")
      return nativeError(
        "NATIVE_DISPATCH_TERMINAL_STATUS",
        "Native task was not completed during terminal settlement",
      );
    const terminalOutput = observed.output ?? hookOutput;
    if (!terminalOutput)
      return nativeError(
        "OBSERVATION_TERMINAL_OUTPUT_MISSING",
        "Completed native task did not expose a public wrapper output",
      );
    const verified = await this.observeVerifiedChild(delegation, observed);
    if (!verified)
      return nativeError(
        "OBSERVATION",
        "Native task completed without a verified child session",
      );
    delegation = verified;
    const wrapper = this.taskWrapper(terminalOutput);
    if (wrapper.state !== "completed")
      return nativeError(
        "NATIVE_DISPATCH_TERMINAL_WRAPPER",
        "Completed native task exposed a nonterminal wrapper",
      );
    if (wrapper.childSessionId !== observed.childSessionId)
      return nativeError(
        "IDENTITY_MISMATCH",
        "Task wrapper child does not match observed native metadata",
      );
    const childSessionId = observed.childSessionId;
    if (!childSessionId)
      return nativeError(
        "OBSERVATION",
        "Verified native result lost its child session identity",
      );
    return this.applyVerifiedResult(
      delegation,
      this.extractTaskResult(wrapper),
      terminalOutput,
    );
  }

  private async applyVerifiedResult(
    delegation: NativeDelegation,
    wire: string,
    output: string,
  ): Promise<SettledNativeTask> {
    const result = this.enforcer.validateResult(wire, {
      delegationId: delegation.delegationId,
      specialist: delegation.specialist,
      workId: delegation.workId,
      workItemId: delegation.workItemId,
    });
    const binding = await this.bindingAuthority(delegation);
    const resultHash = nativeReceiptHash(result);
    const receiptHash = resultHash;
    const captured = await this.journal.captureReceipt({
      delegationId: delegation.delegationId,
      ownerInstanceId: this.instanceId,
      version: delegation.version,
      resultHash,
      receiptHash,
      receiptJson: serializeAgentResult(result),
    });
    await this.settle(binding.bindingId, result);
    const receipt = {
      protocol: "pulso-receipt/1" as const,
      accepted: true as const,
      delegationId: delegation.delegationId,
      resultHash,
      receiptHash,
      result,
      state: await this.state(
        {
          ...captured,
          transportPhase: "closed",
          receiptPhase: "applied",
          sideEffectsMayContinue: false,
        },
        "summary",
        false,
      ),
    };
    const applied = await this.journal.finishReceipt({
      delegationId: captured.delegationId,
      ownerInstanceId: this.instanceId,
      version: captured.version,
      phase: "applied",
      receiptJson: JSON.stringify(receipt),
    });
    return { delegation: applied, receipt, receiptHash, output };
  }

  private async observeVerifiedChild(
    delegation: NativeDelegation,
    observed: Awaited<ReturnType<OpenCodeTransport["observeCall"]>>,
  ): Promise<NativeDelegation | undefined> {
    const childSessionId = observed.childSessionId;
    if (
      !childSessionId ||
      !observed.metadataObserved ||
      observed.metadataParentSessionId !== delegation.parentSessionId
    )
      return undefined;
    if (observed.specialist && observed.specialist !== delegation.specialist)
      return nativeError(
        "IDENTITY_MISMATCH",
        "Observed child specialist does not match the preparation",
      );
    return this.observeWrapperChild(delegation, childSessionId);
  }

  /** A task wrapper ID is host output for this exact hook call, not model input. */
  private async observeWrapperChild(
    delegation: NativeDelegation,
    childSessionId: string | undefined,
  ): Promise<NativeDelegation | undefined> {
    if (!childSessionId) return undefined;
    if (
      delegation.childSessionId &&
      delegation.childSessionId !== childSessionId
    )
      return nativeError(
        "IDENTITY_MISMATCH",
        "Native task changed its observed child session",
      );
    const child = await observeWithTimeout(this.port.readChild(childSessionId));
    if (
      !child ||
      child.id !== childSessionId ||
      child.parentId !== delegation.parentSessionId
    )
      return nativeError(
        "IDENTITY_MISMATCH",
        "Observed child does not belong to the parent session",
      );
    if (delegation.childSessionId === childSessionId) return delegation;
    return this.journal.observe({
      delegationId: delegation.delegationId,
      ownerInstanceId: this.instanceId,
      version: delegation.version,
      childSessionId,
      observedAt: now().toISOString(),
    });
  }

  private extractTaskResult(wrapper: NativeTaskWrapper) {
    const matches = [
      ...wrapper.body.matchAll(/<task_result>([\s\S]*?)<\/task_result>/g),
    ];
    const resultMatch = matches[0];
    if (
      wrapper.state !== "completed" ||
      matches.length !== 1 ||
      !resultMatch?.[1]?.trim()
    )
      return nativeError(
        "NATIVE_DISPATCH_RESULT_MISSING",
        "Task wrapper must be completed with exactly one non-empty task_result",
      );
    const prefix = wrapper.body.replace(resultMatch[0], "").trim();
    if (prefix)
      return nativeError(
        "NATIVE_DISPATCH_RESULT_MALFORMED",
        "Task wrapper contains unexpected content outside task_result",
      );
    return resultMatch[1].trim();
  }

  private replayAfter(
    delegation: NativeDelegation,
    output: AfterOutput,
    receivedResultHash: string,
  ) {
    if (!delegation.receiptJson)
      return nativeError(
        "LIFECYCLE_CONFLICT",
        "Managed task has a captured receipt that requires recovery",
      );
    if (delegation.receiptPhase === "rejected") {
      const rejected = this.rejectedReceipt(delegation);
      if (!rejected || receivedResultHash !== rejected.rawResultHash)
        return nativeError(
          "RESULT_REPLAY_CONFLICT",
          "Managed task already has a different rejected result",
        );
      // Preserve the durable rejection rather than converting it into success.
      output.output = delegation.receiptJson;
      return delegation;
    }
    if (delegation.receiptPhase !== "applied")
      return nativeError(
        "LIFECYCLE_CONFLICT",
        "Managed task has a captured receipt that requires recovery",
      );
    if (output.output === delegation.receiptJson) return delegation;
    const result = this.enforcer.validateResult(
      this.extractTaskResult(this.taskWrapper(output.output)),
      {
        delegationId: delegation.delegationId,
        specialist: delegation.specialist,
        workId: delegation.workId,
        workItemId: delegation.workItemId,
      },
    );
    const persistedResultHash = delegation.resultHash ?? delegation.receiptHash;
    if (
      nativeReceiptHash(result) !== persistedResultHash ||
      (delegation.resultHash !== undefined &&
        delegation.resultHash !== delegation.receiptHash)
    )
      return nativeError(
        "RESULT_REPLAY_CONFLICT",
        "Managed task already has a different validated result",
      );
    output.output = delegation.receiptJson;
    return delegation;
  }

  private async bindingAuthority(delegation: NativeDelegation) {
    const bindingId = delegation.bindingId;
    if (!bindingId)
      return nativeError("NATIVE_DISPATCH", "Claim has no native binding");
    const binding = await this.runtime.runtimeBindings.get(bindingId);
    if (!binding)
      return nativeError(
        "AUTHORITY_EXPIRED",
        "Native binding authority is missing",
      );
    if (
      binding.managedBy !== "opencode-native" ||
      binding.runtime.provider !== "opencode" ||
      binding.runtime.executionId !== delegation.delegationId ||
      binding.runtime.sessionId !== delegation.parentSessionId ||
      binding.workId !== delegation.workId ||
      binding.workItemId !== delegation.workItemId ||
      binding.status !== "active" ||
      new Date(binding.expiresAt) <= now()
    )
      return nativeError(
        "AUTHORITY_EXPIRED",
        "Binding authority is absent, mismatched, or expired",
      );
    const snapshot = await this.runtime.store.read();
    const execution = snapshot.executions.find(
      (candidate) => candidate.id === binding.executionId,
    );
    const lease = snapshot.leases.find(
      (candidate) => candidate.id === binding.leaseId,
    );
    const item = snapshot.items.find(
      (candidate) => candidate.id === delegation.workItemId,
    );
    const assignment = binding.assignmentId
      ? snapshot.assignments.find(
          (candidate) => candidate.id === binding.assignmentId,
        )
      : undefined;
    if (
      execution?.status !== "running" ||
      execution.workItemId !== delegation.workItemId ||
      !binding.assignmentId ||
      execution.assignmentId !== binding.assignmentId ||
      !assignment ||
      assignment.workItemId !== delegation.workItemId ||
      assignment.status !== "active" ||
      execution.externalExecutionRef?.provider !== "opencode" ||
      execution.externalExecutionRef.id !== delegation.delegationId ||
      !lease ||
      lease.id !== binding.leaseId ||
      lease.executionId !== execution.id ||
      lease.workItemId !== delegation.workItemId ||
      lease.status !== "active" ||
      lease.fencingToken !== binding.fencingToken ||
      new Date(lease.expiresAt) <= now() ||
      !item ||
      item.workId !== delegation.workId ||
      item.status !== "in_progress" ||
      !snapshot.works.some(
        (work) =>
          work.id === delegation.workId &&
          work.workspaceId === this.runtime.workspaceId &&
          work.status === "active",
      )
    )
      return nativeError(
        "AUTHORITY_EXPIRED",
        "Execution, lease, WorkItem, or fencing authority is not active for this attempt",
      );
    return binding;
  }

  private async settle(bindingId: string, result: AgentResult) {
    if (result.status === "completed")
      return this.runtime.runtimeAdapter.completeNative(
        bindingId,
        JSON.stringify(result),
      );
    if (result.status === "failed")
      return this.runtime.runtimeAdapter.failNative(
        bindingId,
        "specialist_failed",
      );
    if (result.status === "cancelled")
      return this.runtime.runtimeAdapter.cancelNative(
        bindingId,
        "specialist_cancelled",
      );
    return this.runtime.runtimeAdapter.suspendNative(
      bindingId,
      "blocked",
      "specialist_blocked",
    );
  }

  private armObservation(delegation: NativeDelegation) {
    this.stopObservation(delegation.delegationId);
    const timer = setInterval(() => {
      void this.observeNow(delegation.delegationId);
    }, this.observationPolicy.observationIntervalMs);
    timer.unref?.();
    this.timers.set(delegation.delegationId, timer);
  }

  private stopObservation(delegationId: string) {
    const timer = this.timers.get(delegationId);
    if (timer) clearInterval(timer);
    this.timers.delete(delegationId);
  }

  /** Runs the same verified observation cycle used by the native timer. */
  async observeNow(delegationId: string) {
    const delegation = await this.journal.get(delegationId);
    if (
      delegation?.transportPhase !== "claimed" ||
      delegation.ownerInstanceId !== this.instanceId
    )
      return;
    if (delegation.deadlineAt && new Date(delegation.deadlineAt) <= now()) {
      this.stopObservation(delegationId);
      const stopped = delegation.childSessionId
        ? await this.abortVerifiedChild(delegation, delegation.childSessionId)
        : false;
      if (!stopped) {
        await this.recordUncertainAbort(
          delegation,
          "deadline_abort_unconfirmed",
        );
        return;
      }
      const cleanupCode = await this.failBinding(
        delegation,
        "transport_timeout",
      );
      await this.journal
        .reject({
          delegationId,
          ownerInstanceId: this.instanceId,
          stage: "transport_timeout",
          code: "deadline_exceeded",
        })
        .catch(() => undefined);
      if (cleanupCode)
        await this.recordObservationDiagnostic(
          delegation,
          "deadline_exceeded",
          "transport_timeout",
          cleanupCode,
        );
      return;
    }
    if (!delegation.parentCallId) return;
    try {
      const observed = await this.observeCall(
        delegation.parentSessionId,
        delegation.parentCallId,
      );
      if (observed.background) {
        await this.stopUnsupportedNativeExecution(
          delegation,
          observed,
          undefined,
          "background_unsupported",
        );
        return;
      }
      if (observed.status === "error") {
        await this.closeObservedTerminal(delegation, "native_task_error");
        return;
      }
      if (observed.status === "completed") {
        this.stopObservation(delegationId);
        try {
          await this.settleObservedTerminal(delegation, observed);
        } catch (error) {
          await this.rejectAfter(
            delegation,
            error,
            rawResultHash(observed.output ?? ""),
          );
        }
        return;
      }
      if (!["pending", "running"].includes(observed.status))
        return this.recordObservationDiagnostic(
          delegation,
          "observation_unknown",
        );
      const childSessionId =
        observed.childSessionId ?? delegation.childSessionId;
      const recorded = observed.metadataObserved
        ? await this.observeVerifiedChild(delegation, observed)
        : await this.observeWrapperChild(delegation, childSessionId);
      if (!recorded || !childSessionId)
        return this.recordObservationDiagnostic(
          delegation,
          "child_parentage_unverified",
          "identity_mismatch",
        );
      const binding = await this.bindingAuthority(recorded);
      if (
        shouldRenewHeartbeat(
          recorded.lastHeartbeatAt,
          recorded.dispatchedAt,
          now(),
          this.observationPolicy.heartbeatIntervalMs,
        )
      ) {
        await this.runtime.runtimeAdapter.heartbeatNative(binding.bindingId);
        await this.journal.recordHeartbeat({
          delegationId,
          ownerInstanceId: this.instanceId,
          version: recorded.version,
          renewedAt: now().toISOString(),
        });
      }
    } catch (error) {
      const diagnostic = classifyNativeError(error, "observation");
      await this.recordObservationDiagnostic(
        delegation,
        diagnostic.code,
        diagnostic.stage,
        undefined,
        diagnostic.transport,
      );
    }
  }

  private async rejectAfter(
    delegation: NativeDelegation,
    error: unknown,
    receivedResultHash: string = rawResultHash(""),
  ) {
    this.stopObservation(delegation.delegationId);
    const diagnostic = classifyNativeError(error, "unknown");
    const diagnosticHash = hash(nativeErrorMessage(error));
    const current = await this.journal.get(delegation.delegationId);
    if (current?.receiptPhase === "captured") {
      if (this.isCapturedRejection(current)) {
        await this.finalizeRejectedReceipt(current);
        return;
      }
      await this.journal
        .diagnose({
          delegationId: current.delegationId,
          ownerInstanceId: this.instanceId,
          version: current.version,
          errorJson: JSON.stringify({
            ...diagnostic,
            rawResultHash: diagnosticHash,
            code: "captured_receipt_recovery_required",
          }),
        })
        .catch(() => undefined);
      return;
    }
    if (current?.transportPhase === "claimed" && current.sideEffectsMayContinue)
      return;
    const captured = await this.journal
      .captureRejection({
        delegationId: delegation.delegationId,
        ownerInstanceId: this.instanceId,
        version: current?.version ?? delegation.version,
        stage: diagnostic.stage,
        code: diagnostic.code,
        rawResultHash: receivedResultHash,
        diagnosticHash,
        paths: validationPaths(error),
        ids: {
          delegationId: delegation.delegationId,
          specialist: delegation.specialist,
          workId: delegation.workId,
          workItemId: delegation.workItemId,
        },
      })
      .catch(() => undefined);
    if (captured?.receiptPhase === "captured")
      await this.finalizeRejectedReceipt(captured);
  }

  private async reconcileDelegation(delegation: NativeDelegation) {
    if (delegation.transportPhase !== "claimed" || !delegation.parentCallId)
      return;
    let claimed: NativeDelegation;
    try {
      claimed = await this.journal.adoptClaim({
        delegationId: delegation.delegationId,
        workspaceId: delegation.workspaceId,
        parentSessionId: delegation.parentSessionId,
        parentCallId: delegation.parentCallId,
        ownerInstanceId: this.instanceId,
      });
    } catch (error) {
      const diagnostic = classifyNativeError(error, "lifecycle_conflict");
      return this.recordObservationDiagnostic(
        delegation,
        diagnostic.code,
        diagnostic.stage,
        undefined,
        diagnostic.transport,
      );
    }
    if (!claimed.bindingId) {
      const recovered = await this.runtime.runtimeAdapter.getByRuntime({
        provider: "opencode",
        executionId: claimed.delegationId,
        sessionId: claimed.parentSessionId,
        metadata: { parentCallId: delegation.parentCallId },
      });
      if (!recovered) {
        await this.journal.closeDispatchFailure(
          claimed.delegationId,
          this.instanceId,
          "binding_missing_after_claim",
        );
        return;
      }
      claimed = await this.journal.attachBinding({
        delegationId: claimed.delegationId,
        ownerInstanceId: this.instanceId,
        bindingId: recovered.bindingId,
        version: claimed.version,
      });
    }
    const binding = await this.runtime.runtimeAdapter
      .get(claimed.bindingId ?? "")
      .catch(() => undefined);
    if (!binding) {
      await this.recordObservationDiagnostic(
        claimed,
        "binding_missing_after_claim",
        "authority_expired",
      );
      return;
    }
    if (this.isCapturedRejection(claimed)) {
      await this.finalizeRejectedReceipt(claimed);
      return;
    }
    if (binding.status !== "active") {
      if (claimed.receiptPhase === "captured") {
        await this.reconcileCapturedReceipt(claimed, binding.status);
        return;
      }
      const observed = await this.readTerminalObservation(claimed);
      if (observed) {
        await this.closeObservedTerminal(
          claimed,
          "recovered_terminal_without_receipt",
        );
        return;
      }
      await this.recordUncertainAbort(
        claimed,
        `binding_${binding.status}_without_host_stop`,
      );
      return;
    }
    if (claimed.receiptPhase === "captured") {
      if (!(await this.readTerminalObservation(claimed))) {
        await this.recordObservationDiagnostic(
          claimed,
          "captured_receipt_waiting_for_host_observation",
        );
        return;
      }
      try {
        const result = this.enforcer.validateResult(claimed.receiptJson ?? "", {
          delegationId: claimed.delegationId,
          specialist: claimed.specialist,
          workId: claimed.workId,
          workItemId: claimed.workItemId,
        });
        await this.settle(binding.bindingId, result);
        const settled = await this.runtime.runtimeAdapter.get(
          binding.bindingId,
        );
        await this.reconcileCapturedReceipt(claimed, settled.status);
      } catch (error) {
        await this.rejectAfter(claimed, error);
      }
      return;
    }
    const parentCallId = claimed.parentCallId;
    if (!parentCallId)
      return this.recordObservationDiagnostic(
        claimed,
        "recovery_missing_parent_call",
      );
    try {
      const observed = await this.observeCall(
        claimed.parentSessionId,
        parentCallId,
      );
      if (observed.background) {
        await this.stopUnsupportedNativeExecution(
          claimed,
          observed,
          undefined,
          "background_unsupported",
        );
        return;
      }
      if (observed.status === "completed") {
        this.stopObservation(claimed.delegationId);
        await this.settleObservedTerminal(claimed, observed);
      } else if (observed.status === "error")
        await this.closeObservedTerminal(claimed, "native_task_error");
      else {
        if (["pending", "running"].includes(observed.status)) {
          const recorded = observed.metadataObserved
            ? await this.observeVerifiedChild(claimed, observed)
            : undefined;
          if (!recorded)
            await this.recordObservationDiagnostic(
              claimed,
              "child_parentage_unverified",
              "identity_mismatch",
            );
          else
            await this.recordObservationDiagnostic(
              recorded,
              "recovery_waiting_for_terminal_toolpart",
            );
        } else
          await this.recordObservationDiagnostic(
            claimed,
            "recovery_waiting_for_host_observation",
          );
      }
    } catch (error) {
      await this.rejectAfter(claimed, error);
      throw error;
    }
  }

  private async reconcileCapturedReceipt(
    delegation: NativeDelegation,
    observedBindingStatus: string,
  ) {
    if (!delegation.receiptJson || !delegation.receiptHash) return;
    let result: AgentResult;
    try {
      result = this.enforcer.validateResult(delegation.receiptJson, {
        delegationId: delegation.delegationId,
        specialist: delegation.specialist,
        workId: delegation.workId,
        workItemId: delegation.workItemId,
      });
      const expectedStatus =
        result.status === "completed"
          ? "completed"
          : result.status === "failed"
            ? "failed"
            : result.status === "cancelled"
              ? "cancelled"
              : "blocked";
      const resultHash = nativeReceiptHash(result);
      if (
        resultHash !== delegation.resultHash ||
        resultHash !== delegation.receiptHash
      )
        return this.rejectCapturedRecovery(
          delegation,
          "captured_result_hash_mismatch",
        );
      const binding = delegation.bindingId
        ? await this.runtime.runtimeBindings.get(delegation.bindingId)
        : undefined;
      const snapshot = await this.runtime.store.read();
      const work = snapshot.works.find(
        (entry) => entry.id === delegation.workId,
      );
      const item = snapshot.items.find(
        (entry) =>
          entry.id === delegation.workItemId &&
          entry.workId === delegation.workId,
      );
      const execution = binding?.executionId
        ? snapshot.executions.find((entry) => entry.id === binding.executionId)
        : undefined;
      const assignment = binding?.assignmentId
        ? snapshot.assignments.find(
            (entry) => entry.id === binding.assignmentId,
          )
        : undefined;
      const lease = binding?.leaseId
        ? snapshot.leases.find((entry) => entry.id === binding.leaseId)
        : undefined;
      if (
        !binding ||
        !work ||
        work.workspaceId !== this.runtime.workspaceId ||
        !item ||
        binding.status !== expectedStatus ||
        observedBindingStatus !== expectedStatus ||
        binding.managedBy !== "opencode-native" ||
        binding.runtime.provider !== "opencode" ||
        binding.runtime.executionId !== delegation.delegationId ||
        binding.runtime.sessionId !== delegation.parentSessionId ||
        binding.workId !== delegation.workId ||
        binding.workItemId !== delegation.workItemId ||
        !binding.assignmentId ||
        !assignment ||
        assignment.workItemId !== delegation.workItemId ||
        !execution ||
        execution.workItemId !== delegation.workItemId ||
        execution.assignmentId !== binding.assignmentId ||
        execution.externalExecutionRef?.provider !== "opencode" ||
        execution.externalExecutionRef.id !== delegation.delegationId ||
        execution.status !== expectedStatus ||
        !lease ||
        lease.id !== binding.leaseId ||
        lease.executionId !== execution.id ||
        lease.workItemId !== delegation.workItemId ||
        lease.fencingToken !== binding.fencingToken ||
        lease.status !== "released" ||
        item.status !== expectedStatus
      )
        return this.rejectCapturedRecovery(
          delegation,
          "captured_result_authority_mismatch",
        );
    } catch (error) {
      const diagnostic = classifyNativeError(error, "lifecycle_conflict");
      await this.journal
        .finishReceipt({
          delegationId: delegation.delegationId,
          ownerInstanceId: this.instanceId,
          version: delegation.version,
          phase: "rejected",
          errorJson: JSON.stringify(diagnostic),
        })
        .catch(() => undefined);
      return;
    }
    try {
      const resultHash = nativeReceiptHash(result);
      const receipt = {
        protocol: "pulso-receipt/1" as const,
        accepted: true as const,
        delegationId: delegation.delegationId,
        resultHash,
        receiptHash: delegation.receiptHash,
        result,
        state: await this.state(
          {
            ...delegation,
            transportPhase: "closed",
            receiptPhase: "applied",
            sideEffectsMayContinue: false,
          },
          "summary",
          false,
          false,
        ),
      };
      await this.journal.finishReceipt({
        delegationId: delegation.delegationId,
        ownerInstanceId: this.instanceId,
        version: delegation.version,
        phase: "applied",
        receiptJson: JSON.stringify(receipt),
      });
    } catch (error) {
      const diagnostic = classifyNativeError(error, "lifecycle_conflict");
      await this.journal
        .diagnose({
          delegationId: delegation.delegationId,
          ownerInstanceId: this.instanceId,
          version: delegation.version,
          errorJson: JSON.stringify(diagnostic),
        })
        .catch(() => undefined);
    }
  }

  private async rejectCapturedRecovery(
    delegation: NativeDelegation,
    code: string,
  ) {
    await this.journal.finishReceipt({
      delegationId: delegation.delegationId,
      ownerInstanceId: this.instanceId,
      version: delegation.version,
      phase: "rejected",
      errorJson: JSON.stringify({ stage: "lifecycle_conflict", code }),
    });
  }

  private async readTerminalObservation(delegation: NativeDelegation) {
    if (!delegation.parentCallId) return false;
    try {
      const observed = await this.observeCall(
        delegation.parentSessionId,
        delegation.parentCallId,
      );
      if (
        observed.background ||
        (observed.status !== "completed" && observed.status !== "error") ||
        !observed.metadataObserved ||
        observed.metadataParentSessionId !== delegation.parentSessionId
      )
        return false;
      if (!observed.childSessionId) return true;
      const child = await observeWithTimeout(
        this.port.readChild(observed.childSessionId),
      );
      return (
        child?.id === observed.childSessionId &&
        child.parentId === delegation.parentSessionId
      );
    } catch (error) {
      const diagnostic = classifyNativeError(error, "observation");
      await this.recordObservationDiagnostic(
        delegation,
        diagnostic.code,
        diagnostic.stage,
        undefined,
        diagnostic.transport,
      );
      return false;
    }
  }

  private async closeObservedTerminal(
    delegation: NativeDelegation,
    code: string,
  ) {
    this.stopObservation(delegation.delegationId);
    const cleanupCode = await this.failBinding(delegation, code);
    await this.journal
      .reject({
        delegationId: delegation.delegationId,
        ownerInstanceId: this.instanceId,
        stage: "native_dispatch",
        code,
      })
      .catch(() => undefined);
    if (cleanupCode)
      await this.recordObservationDiagnostic(
        delegation,
        code,
        "native_dispatch",
        cleanupCode,
      );
  }

  private async stopUnsupportedNativeExecution(
    delegation: NativeDelegation,
    observed: Awaited<ReturnType<OpenCodeTransport["observeCall"]>>,
    wrapper: NativeTaskWrapper | undefined,
    code: string,
  ) {
    this.stopObservation(delegation.delegationId);
    const childSessionId = observed.childSessionId;
    const wrapperMatchesObservedChild =
      !wrapper?.childSessionId || wrapper.childSessionId === childSessionId;
    const stopped =
      childSessionId && wrapperMatchesObservedChild
        ? await this.abortVerifiedChild(delegation, childSessionId, observed)
        : false;
    if (!stopped) {
      // A failed or unavailable abort leaves the original authority fenced until
      // the host proves terminal state; releasing it could admit overlapping I/O.
      await this.recordUncertainAbort(delegation, `${code}_abort_unconfirmed`);
      return;
    }
    const cleanupCode = await this.failBinding(delegation, code);
    await this.journal
      .reject({
        delegationId: delegation.delegationId,
        ownerInstanceId: this.instanceId,
        stage: "native_dispatch",
        code,
      })
      .catch(() => undefined);
    if (cleanupCode)
      await this.recordObservationDiagnostic(
        delegation,
        code,
        "native_dispatch",
        cleanupCode,
      );
  }

  private async stopUnsupportedFromHook(
    delegation: NativeDelegation,
    wrapper: NativeTaskWrapper,
    metadata: HookTaskMetadata,
    code: string,
  ) {
    this.stopObservation(delegation.delegationId);
    if (
      metadata.parentSessionId !== delegation.parentSessionId ||
      metadata.sessionId !== wrapper.childSessionId ||
      (delegation.childSessionId &&
        delegation.childSessionId !== wrapper.childSessionId)
    ) {
      await this.recordUncertainAbort(
        delegation,
        `${code}_identity_unverified`,
      );
      return;
    }
    let verified: NativeDelegation | undefined;
    try {
      verified = await this.observeWrapperChild(
        delegation,
        wrapper.childSessionId,
      );
      if (!verified) throw new Error("NATIVE_CHILD_PARENTAGE_UNVERIFIED");
      await observeWithTimeout(this.port.abortChild(wrapper.childSessionId));
      const stopped = await this.observeCall(
        delegation.parentSessionId,
        delegation.parentCallId ?? "",
      );
      const terminal =
        (stopped.status === "completed" || stopped.status === "error") &&
        stopped.parentSessionId === delegation.parentSessionId &&
        stopped.parentCallId === delegation.parentCallId &&
        stopped.metadataObserved &&
        stopped.metadataParentSessionId === delegation.parentSessionId &&
        stopped.childSessionId === wrapper.childSessionId;
      if (!terminal) throw new Error("NATIVE_ABORT_NOT_CONFIRMED");
    } catch {
      await this.recordUncertainAbort(
        verified ?? delegation,
        `${code}_abort_unconfirmed`,
      );
      return;
    }
    const verifiedDelegation = verified;
    if (!verifiedDelegation) {
      await this.recordUncertainAbort(delegation, `${code}_abort_unconfirmed`);
      return;
    }
    const cleanupCode = await this.failBinding(verifiedDelegation, code);
    await this.journal
      .reject({
        delegationId: verifiedDelegation.delegationId,
        ownerInstanceId: this.instanceId,
        stage: "native_dispatch",
        code,
      })
      .catch(() => undefined);
    if (cleanupCode)
      await this.recordObservationDiagnostic(
        verifiedDelegation,
        code,
        "native_dispatch",
        cleanupCode,
      );
  }

  private async abortVerifiedChild(
    delegation: NativeDelegation,
    childSessionId: string,
    initial?: Awaited<ReturnType<OpenCodeTransport["observeCall"]>>,
  ) {
    if (!delegation.parentCallId) return false;
    try {
      const observed =
        initial ??
        (await this.observeCall(
          delegation.parentSessionId,
          delegation.parentCallId,
        ));
      if (
        observed.parentSessionId !== delegation.parentSessionId ||
        observed.parentCallId !== delegation.parentCallId ||
        !observed.metadataObserved ||
        observed.metadataParentSessionId !== delegation.parentSessionId ||
        observed.childSessionId !== childSessionId ||
        (observed.specialist !== undefined &&
          observed.specialist !== delegation.specialist)
      )
        return false;
      const child = await observeWithTimeout(
        this.port.readChild(childSessionId),
      );
      if (
        !child ||
        child.id !== childSessionId ||
        child.parentId !== delegation.parentSessionId
      )
        return false;
      await observeWithTimeout(this.port.abortChild(childSessionId));
      const afterAbort = await this.observeCall(
        delegation.parentSessionId,
        delegation.parentCallId,
      );
      return (
        (afterAbort.status === "completed" || afterAbort.status === "error") &&
        afterAbort.metadataObserved &&
        afterAbort.metadataParentSessionId === delegation.parentSessionId &&
        afterAbort.childSessionId === childSessionId
      );
    } catch {
      return false;
    }
  }

  private async failBinding(delegation: NativeDelegation, reason: string) {
    if (!delegation.bindingId) return undefined;
    try {
      const binding = await this.runtime.runtimeAdapter.get(
        delegation.bindingId,
      );
      if (binding.status === "active")
        await this.runtime.runtimeAdapter.failNative(binding.bindingId, reason);
      return undefined;
    } catch (error) {
      return nativeErrorCode(error);
    }
  }

  private isCapturedRejection(delegation: NativeDelegation) {
    if (delegation.receiptPhase !== "captured" || !delegation.receiptJson)
      return false;
    try {
      const receipt: unknown = JSON.parse(delegation.receiptJson);
      return (
        isRecord(receipt) &&
        receipt.delegationId === delegation.delegationId &&
        typeof receipt.stage === "string" &&
        typeof receipt.code === "string"
      );
    } catch {
      return false;
    }
  }

  private rejectedReceipt(delegation: NativeDelegation) {
    if (!delegation.receiptJson || !delegation.receiptHash) return undefined;
    try {
      const receipt: unknown = JSON.parse(delegation.receiptJson);
      if (
        !isRecord(receipt) ||
        receipt.delegationId !== delegation.delegationId ||
        typeof receipt.stage !== "string" ||
        typeof receipt.code !== "string" ||
        typeof receipt.rawResultHash !== "string"
      )
        return undefined;
      const receiptHash = rejectedNativeReceiptHash({
        delegationId: receipt.delegationId,
        stage: receipt.stage,
        code: receipt.code,
        rawResultHash: receipt.rawResultHash,
      });
      if (
        receipt.receiptHash !== receiptHash ||
        delegation.receiptHash !== receiptHash
      )
        return undefined;
      return { rawResultHash: receipt.rawResultHash };
    } catch {
      return undefined;
    }
  }

  private async finalizeRejectedReceipt(delegation: NativeDelegation) {
    const cleanupCode = await this.failBinding(delegation, "protocol_error");
    if (cleanupCode) {
      await this.journal
        .diagnose({
          delegationId: delegation.delegationId,
          ownerInstanceId: this.instanceId,
          version: delegation.version,
          errorJson: JSON.stringify({
            ...(this.parseDiagnostic(delegation.errorJson) ?? {
              stage: "unknown",
              code: "rejection_recovery_required",
            }),
            cleanupCode,
          }),
        })
        .catch(() => undefined);
      return;
    }
    await this.journal
      .finishReceipt({
        delegationId: delegation.delegationId,
        ownerInstanceId: this.instanceId,
        version: delegation.version,
        phase: "rejected",
        receiptJson: delegation.receiptJson,
        errorJson: delegation.errorJson,
      })
      .catch(() => undefined);
  }

  private async recordUncertainAbort(
    delegation: NativeDelegation,
    code: string,
    cleanupCode?: string,
  ) {
    const current = await this.journal.get(delegation.delegationId);
    if (
      current?.transportPhase !== "claimed" ||
      current.ownerInstanceId !== this.instanceId
    )
      return;
    await this.journal
      .diagnose({
        delegationId: current.delegationId,
        ownerInstanceId: this.instanceId,
        version: current.version,
        errorJson: JSON.stringify({
          stage: "observation",
          code,
          ...(cleanupCode ? { cleanupCode } : {}),
        } satisfies NativeDiagnostic),
        sideEffectsMayContinue: true,
      })
      .catch(() => undefined);
  }

  private async recordObservationDiagnostic(
    delegation: NativeDelegation,
    code: string,
    stage: NativeErrorStage = "observation",
    cleanupCode?: string,
    transport?: OpenCodeTransportFailure,
  ) {
    const current = await this.journal.get(delegation.delegationId);
    if (!current || current.ownerInstanceId !== this.instanceId) return;
    await this.journal
      .diagnose({
        delegationId: current.delegationId,
        ownerInstanceId: this.instanceId,
        version: current.version,
        errorJson: JSON.stringify({
          stage,
          code,
          ...(cleanupCode ? { cleanupCode } : {}),
          ...(transport ? { transport } : {}),
        } satisfies NativeDiagnostic),
      })
      .catch(() => undefined);
  }

  private observeCall(parentSessionId: string, parentCallId: string) {
    return observeWithTimeout(
      this.port.observeCall(parentSessionId, parentCallId),
    );
  }

  private async state(
    delegation: NativeDelegation,
    view: "summary" | "full",
    includeReceipt = true,
    includeCurrentBuild = true,
  ) {
    const snapshot = await this.runtime.store.read();
    const binding = delegation.bindingId
      ? await this.runtime.runtimeBindings.get(delegation.bindingId)
      : undefined;
    const work = snapshot.works.find(
      (candidate) => candidate.id === delegation.workId,
    );
    const item = snapshot.items.find(
      (candidate) =>
        candidate.id === delegation.workItemId &&
        candidate.workId === delegation.workId,
    );
    if (!work || work.workspaceId !== this.runtime.workspaceId || !item)
      return nativeError(
        "LIFECYCLE_AUTHORITY_MISSING",
        "Native receipt projection cannot find the exact Work and WorkItem",
      );

    let authority:
      | {
          workspaceId: string;
          parentSessionId: string;
          parentCallId: string;
          childSessionId?: string;
          workId: string;
          workItemId: string;
          workItemStatus: string;
          bindingId: string;
          bindingStatus: string;
          executionId: string;
          executionStatus: string;
          leaseId: string;
          leaseStatus: string;
          fencingToken: number;
        }
      | undefined;
    if (delegation.bindingId) {
      if (!binding)
        return nativeError(
          "LIFECYCLE_AUTHORITY_MISSING",
          "Native receipt projection cannot find its exact binding",
        );
      const execution = snapshot.executions.find(
        (candidate) => candidate.id === binding.executionId,
      );
      const lease = snapshot.leases.find(
        (candidate) => candidate.id === binding.leaseId,
      );
      if (
        binding.bindingId !== delegation.bindingId ||
        binding.runtime.executionId !== delegation.delegationId ||
        binding.runtime.provider !== "opencode" ||
        binding.runtime.sessionId !== delegation.parentSessionId ||
        binding.managedBy !== "opencode-native" ||
        binding.workId !== delegation.workId ||
        binding.workItemId !== delegation.workItemId ||
        !binding.executionId ||
        !binding.leaseId ||
        !execution ||
        execution.workItemId !== delegation.workItemId ||
        execution.externalExecutionRef?.provider !== "opencode" ||
        execution.externalExecutionRef.id !== delegation.delegationId ||
        !lease ||
        lease.executionId !== execution.id ||
        lease.workItemId !== delegation.workItemId ||
        lease.fencingToken !== binding.fencingToken
      )
        return nativeError(
          "LIFECYCLE_AUTHORITY_MISMATCH",
          "Native binding, Execution, lease, and fencing identities disagree",
        );
      if (
        delegation.receiptPhase === "applied" &&
        execution.status === "completed" &&
        (binding.status !== "completed" || lease.status !== "released")
      )
        return nativeError(
          "LIFECYCLE_AUTHORITY_MISMATCH",
          "Applied native receipt has nonterminal binding or lease state",
        );
      authority = {
        workspaceId: this.runtime.workspaceId,
        parentSessionId: delegation.parentSessionId,
        parentCallId: delegation.parentCallId ?? "",
        ...(delegation.childSessionId
          ? { childSessionId: delegation.childSessionId }
          : {}),
        workId: delegation.workId,
        workItemId: delegation.workItemId,
        workItemStatus: item.status,
        bindingId: binding.bindingId,
        bindingStatus: binding.status,
        executionId: execution.id,
        executionStatus: execution.status,
        leaseId: lease.id,
        leaseStatus: lease.status,
        fencingToken: lease.fencingToken,
      };
    } else if (delegation.receiptPhase === "applied")
      return nativeError(
        "LIFECYCLE_AUTHORITY_MISSING",
        "Applied native receipt has no binding authority",
      );

    const delegationState = this.delegationView(delegation);
    if (!includeReceipt) delete delegationState.receipt;
    return {
      doctor: {
        workspaceId: this.runtime.workspaceId,
        storage: "runtime-bindings.db",
        ...(includeCurrentBuild ? { buildId: this.buildId() } : {}),
        bridgeVersion: nativePolicy.certifiedOpenCodeVersion,
        protocol: "pulso-receipt/1",
      },
      delegation: delegationState,
      work: {
        workId: work.id,
        status: work.status,
        workItem: { id: item.id, status: item.status, kind: item.kind },
      },
      ...(authority ? { authority } : {}),
      ...(view === "full"
        ? {
            executions: snapshot.executions.filter(
              (entry) => entry.workItemId === delegation.workItemId,
            ),
            leases: snapshot.leases.filter(
              (entry) => entry.workItemId === delegation.workItemId,
            ),
            binding,
            events: snapshot.events.filter(
              (entry) => entry.workId === delegation.workId,
            ),
          }
        : {
            binding: binding
              ? {
                  bindingId: binding.bindingId,
                  status: binding.status,
                  expiresAt: binding.expiresAt,
                }
              : undefined,
          }),
    };
  }

  private delegationView(delegation: NativeDelegation) {
    return {
      delegationId: delegation.delegationId,
      workId: delegation.workId,
      workItemId: delegation.workItemId,
      specialist: delegation.specialist,
      transportPhase: delegation.transportPhase,
      receiptPhase: delegation.receiptPhase,
      resultHash: delegation.resultHash,
      receiptHash: delegation.receiptHash,
      receipt: delegation.receiptJson,
      bindingId: delegation.bindingId,
      childSessionId: delegation.childSessionId,
      lastNativeObservationAt: delegation.lastNativeObservationAt,
      lastHeartbeatAt: delegation.lastHeartbeatAt,
      sideEffectsMayContinue: delegation.sideEffectsMayContinue,
      diagnostic: this.parseDiagnostic(delegation.errorJson),
    };
  }

  private async preparedResponse(delegation: NativeDelegation) {
    const snapshot = await this.runtime.work.snapshot(delegation.workId);
    const item = snapshot.items.find(
      (candidate) => candidate.id === delegation.workItemId,
    );
    if (!item)
      return nativeError(
        "WORK_ITEM_NOT_FOUND",
        "Prepared WorkItem no longer exists",
      );
    const nativeTaskArgs = nativeDispatchTaskArgs(delegation);
    const response = {
      delegationId: delegation.delegationId,
      workId: delegation.workId,
      workItemId: delegation.workItemId,
      expiresAt: delegation.preparationExpiresAt,
      nativeTaskArgs,
    };
    if (delegation.transportPhase !== "prepared")
      return {
        ...response,
        dispatchAllowed: false,
        receipt: delegation.receiptJson,
      };
    return { ...response, dispatchAllowed: true };
  }

  private attachMetadata(
    output: AfterOutput,
    receiptHash: string,
    observed: { model?: { providerId: string; modelId: string } },
  ) {
    const metadata = isRecord(output.metadata) ? output.metadata : {};
    metadata.pulso = {
      receiptHash,
      buildId: this.buildId(),
      ...(observed.model ? { model: observed.model } : {}),
    };
    output.metadata = metadata;
  }

  private assertPulso(session: NativeSession) {
    if (session.agent !== "pulso")
      nativeError(
        "NATIVE_PERMISSION_DENIED",
        "Only Pulso may create a native delegation",
      );
    if (
      session.workspaceId !== this.runtime.workspaceId ||
      !session.parentSessionId ||
      !session.messageId
    )
      nativeError(
        "WORKSPACE_OR_SESSION",
        "Verified ToolContext workspace and session are required",
      );
  }

  private parseDiagnostic(value: string | undefined) {
    if (!value) return undefined;
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed)
        ? parsed
        : { stage: "unknown", code: "invalid_diagnostic" };
    } catch {
      return { stage: "unknown", code: "invalid_diagnostic" };
    }
  }

  private buildId() {
    return typeof __PULSO_BUILD_ID__ === "string"
      ? __PULSO_BUILD_ID__
      : "development";
  }
}

declare const __PULSO_BUILD_ID__: string;
