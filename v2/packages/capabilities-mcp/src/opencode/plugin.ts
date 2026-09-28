import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { type Hooks, type Plugin, tool } from "@opencode-ai/plugin";
import { specialistIds } from "../../../orchestration/src";
import { workspaceId } from "../../../working-system/src";
import { bootstrapCapabilities, type CapabilitiesRuntime } from "../bootstrap";
import { assertActivePulsoBuild } from "./build-integrity";
import {
  nativePrepareInputSchema,
  nativeStatusInputSchema,
  nativeWorkInputSchema,
} from "./facade-contracts";
import { NativeDelegationService } from "./native-delegation-service";
import {
  hasNativeDispatchReferenceMarker,
  parseNativeDispatchReference,
} from "./native-dispatch-reference";
import { NativeJournal } from "./native-journal";
import { type NativeSession, NativeWorkService } from "./native-work-service";
import { OpenCodePort } from "./opencode-port";

export { assertActivePulsoBuild };

type Bridge = {
  runtime: CapabilitiesRuntime;
  journal: NativeJournal;
  work: NativeWorkService;
  delegations: NativeDelegationService;
};
export type DurableTaskCorrelation = {
  nativeDelegation?: boolean;
  nativeCall?: boolean;
  preparedTaskWire?: boolean;
};
type HookBridge = { bridge: Bridge; correlation: DurableTaskCorrelation };
const canonicalSpecialists = new Set<string>(specialistIds);
export const pulsoDataDirectoryOverride = (
  value = process.env.PULSO_DATA_DIR,
) => {
  if (value === undefined) return undefined;
  if (!isAbsolute(value)) throw new Error("PULSO_DATA_DIR_MUST_BE_ABSOLUTE");
  return value;
};

const bridgeKey = (workspace: string) =>
  workspaceId(realpathSync(resolve(workspace)));
const keyOf = (sessionID: string, callID: string) =>
  `${sessionID}\u0000${callID}`;
const taskSignal = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { marker: false, canonicalSelector: false };
  const args = value as Record<string, unknown>;
  return {
    marker:
      typeof args.prompt === "string" &&
      (/<pulso-task v="2">/.test(args.prompt) ||
        hasNativeDispatchReferenceMarker(args.prompt)),
    canonicalSelector:
      typeof args.subagent_type === "string" &&
      canonicalSpecialists.has(args.subagent_type),
  };
};
export const isNativeManagedTaskCandidate = (
  value: unknown,
  correlation: DurableTaskCorrelation = {},
) =>
  Boolean(
    correlation.nativeDelegation ||
      correlation.nativeCall ||
      correlation.preparedTaskWire ||
      taskSignal(value).marker ||
      taskSignal(value).canonicalSelector,
  );
export const findDurableTaskCorrelation = async (
  journal: Pick<NativeJournal, "get" | "getByCall" | "getByTaskWire">,
  workspaceId: string,
  sessionID: string,
  callID: string,
  args: unknown,
): Promise<DurableTaskCorrelation | undefined> => {
  const delegationId = delegationIdFrom(args);
  const taskWire =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>).prompt
      : undefined;
  if (delegationId) {
    const delegation = await journal.get(delegationId);
    if (
      delegation &&
      delegation.workspaceId === workspaceId &&
      delegation.parentSessionId === sessionID
    )
      return { nativeDelegation: true };
  }
  if (await journal.getByCall(workspaceId, sessionID, callID))
    return { nativeCall: true };
  if (
    typeof taskWire === "string" &&
    (await journal.getByTaskWire(workspaceId, sessionID, taskWire))
  )
    return { preparedTaskWire: true };
  return undefined;
};
const delegationIdFrom = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const prompt = (value as Record<string, unknown>).prompt;
  if (typeof prompt !== "string") return undefined;
  const referenceId = parseNativeDispatchReference(prompt);
  if (referenceId) return referenceId;
  const match = /"delegationId":"([^"\\]+)"/.exec(prompt);
  return match?.[1];
};
const buildId = () =>
  typeof __PULSO_BUILD_ID__ === "string" ? __PULSO_BUILD_ID__ : "development";

const session = (context: {
  agent: string;
  sessionID: string;
  messageID: string;
  directory: string;
}): NativeSession => ({
  workspaceId: bridgeKey(context.directory),
  parentSessionId: context.sessionID,
  messageId: context.messageID,
  agent: context.agent,
});

const toolArgs = {
  action: tool.schema.string(),
  intent: tool.schema.string().optional(),
  objective: tool.schema.string().optional(),
  title: tool.schema.string().optional(),
  workId: tool.schema.string().optional(),
  workItemId: tool.schema.string().optional(),
  previousDelegationId: tool.schema.string().optional(),
  reviewedReceiptHash: tool.schema.string().optional(),
  outcome: tool.schema.string().optional(),
  reason: tool.schema.string().optional(),
};

const prepareArgs = {
  specialist: tool.schema.string(),
  objective: tool.schema.string(),
  workItemId: tool.schema.string().optional(),
  context: tool.schema.unknown().optional(),
  dependencies: tool.schema.array(tool.schema.unknown()).optional(),
  constraints: tool.schema.array(tool.schema.string()).optional(),
  acceptanceCriteria: tool.schema.array(tool.schema.string()),
  scope: tool.schema.unknown().optional(),
  requestedEvidence: tool.schema.array(tool.schema.string()).optional(),
};

const statusArgs = {
  delegationId: tool.schema.string().optional(),
  view: tool.schema.string().optional(),
};

/** OpenCode 1.18.32 native bridge entrypoint. */
const PulsoNativeBridge: Plugin = async (input) => {
  assertActivePulsoBuild();
  const bridges = new Map<string, Bridge>();
  const managedCalls = new Set<string>();
  const instanceId = crypto.randomUUID();
  const pulsoDataDir = pulsoDataDirectoryOverride();
  const getBridge = (directory: string) => {
    const verifiedDirectory = realpathSync(resolve(directory));
    const key = bridgeKey(verifiedDirectory);
    const existing = bridges.get(key);
    if (existing) return existing;
    const runtime = bootstrapCapabilities(verifiedDirectory, {
      ...(pulsoDataDir ? { dataDir: pulsoDataDir } : {}),
      heartbeatPolicy: { heartbeatIntervalMs: 60_000 },
      buildId: buildId(),
    });
    if (runtime.workspaceId !== key)
      throw new Error(
        "WORKSPACE_OR_SESSION: verified ToolContext directory changed identity",
      );
    const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
    const work = new NativeWorkService(runtime, journal);
    const delegations = new NativeDelegationService(
      runtime,
      journal,
      new OpenCodePort(input.client),
      instanceId,
      work,
    );
    const bridge = { runtime, journal, work, delegations };
    bridges.set(key, bridge);
    return bridge;
  };
  const bridgeForHook = async (
    sessionID: string,
    callID: string,
    args: unknown,
  ): Promise<HookBridge | undefined> => {
    // Hooks do not receive ToolContext. PluginInput.directory is the trusted host
    // directory for this plugin instance, so reopen its durable workspace first.
    const bridge = getBridge(input.directory);
    const correlation = await findDurableTaskCorrelation(
      bridge.journal,
      bridge.runtime.workspaceId,
      sessionID,
      callID,
      args,
    );
    return correlation ? { bridge, correlation } : undefined;
  };
  const hooks: Hooks = {
    tool: {
      pulso_native_work: tool({
        description:
          "Open, continue, resume, close, or inspect the Work owned by this Pulso session.",
        args: toolArgs,
        async execute(args, context) {
          const bridge = getBridge(context.directory);
          return JSON.stringify(
            await bridge.work.execute(
              nativeWorkInputSchema.parse(args),
              session(context),
            ),
          );
        },
      }),
      pulso_native_prepare: tool({
        description:
          "Prepare one tracked specialist WorkItem and return a short native task dispatch reference; the bridge supplies the immutable payload.",
        args: prepareArgs,
        async execute(args, context) {
          const bridge = getBridge(context.directory);
          return JSON.stringify(
            await bridge.delegations.prepare(
              nativePrepareInputSchema.parse(args),
              session(context),
            ),
          );
        },
      }),
      pulso_native_status: tool({
        description:
          "Read durable native delegation and Work authority without dispatching a task.",
        args: statusArgs,
        async execute(args, context) {
          const bridge = getBridge(context.directory);
          return JSON.stringify(
            await bridge.delegations.status(
              nativeStatusInputSchema.parse(args),
              session(context),
            ),
          );
        },
      }),
    },
    "tool.execute.before": async (hook, output) => {
      if (hook.tool !== "task") return;
      const signal = taskSignal(output.args);
      const resolved = await bridgeForHook(
        hook.sessionID,
        hook.callID,
        output.args,
      );
      const candidate = isNativeManagedTaskCandidate(
        output.args,
        resolved?.correlation,
      );
      if (!candidate) return;
      if (!resolved)
        throw new Error(
          signal.canonicalSelector
            ? "PREPARATION: canonical specialist task has no durable native preparation"
            : "PREPARATION: Pulso-marked task has no durable native correlation",
        );
      const managed = await resolved.bridge.delegations.before(
        { sessionID: hook.sessionID, callID: hook.callID },
        output.args,
        true,
      );
      if (managed) managedCalls.add(keyOf(hook.sessionID, hook.callID));
    },
    "tool.execute.after": async (hook, output) => {
      if (hook.tool !== "task") return;
      const signal = taskSignal(hook.args);
      const resolved = await bridgeForHook(
        hook.sessionID,
        hook.callID,
        hook.args,
      );
      const candidate = isNativeManagedTaskCandidate(
        hook.args,
        resolved?.correlation,
      );
      if (!candidate) return;
      if (!resolved)
        throw new Error(
          signal.canonicalSelector
            ? "NATIVE_DISPATCH: canonical specialist task has no durable native claim"
            : "NATIVE_DISPATCH: Pulso-marked task has no durable native claim",
        );
      const key = keyOf(hook.sessionID, hook.callID);
      const claim = await resolved.bridge.journal.getByCall(
        resolved.bridge.runtime.workspaceId,
        hook.sessionID,
        hook.callID,
      );
      const wasCandidate =
        managedCalls.delete(key) ||
        isNativeManagedTaskCandidate(hook.args, resolved.correlation) ||
        Boolean(claim);
      await resolved.bridge.delegations.after(
        { sessionID: hook.sessionID, callID: hook.callID },
        output,
        wasCandidate,
      );
    },
    dispose: async () => {
      for (const bridge of bridges.values()) {
        await bridge.delegations.dispose();
        bridge.journal.close();
        bridge.runtime.close();
      }
      bridges.clear();
      managedCalls.clear();
    },
  };
  return hooks;
};

export default PulsoNativeBridge;

declare const __PULSO_BUILD_ID__: string;
