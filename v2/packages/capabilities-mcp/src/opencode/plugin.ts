import { realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { type Hooks, type Plugin, tool } from "@opencode-ai/plugin";
import { specialistIds } from "../../../orchestration/src";
import {
  artifactSchema,
  inspectSchema,
  preferencesSchema,
} from "../../../orchestration/src/adaptive/contracts";
import { workspaceId } from "../../../working-system/src";
import { bootstrapCapabilities, type CapabilitiesRuntime } from "../bootstrap";
import { ArtifactService } from "./artifact-service";
import { assertActivePulsoBuild } from "./build-integrity";
import { CapabilityCatalog } from "./capability-catalog";
import { guardNativeEffect } from "./effect-guard";
import { EvolutionFacade } from "./evolution-facade";
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
import { PreferenceService } from "./preference-service";
import { presentReceipt } from "./receipt-presenter";
import { buildSessionContext } from "./session-context";
import {
  artifactToolArgs,
  inspectToolArgs,
  preferencesToolArgs,
  prepareToolArgs,
  workToolArgs,
} from "./tool-schemas";

export { assertActivePulsoBuild };

type Bridge = {
  runtime: CapabilitiesRuntime;
  journal: NativeJournal;
  work: NativeWorkService;
  delegations: NativeDelegationService;
  facade: EvolutionFacade;
  preferences: PreferenceService;
  capabilities: CapabilityCatalog;
  artifacts: ArtifactService;
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
  const trustedUserMessages = new Map<
    string,
    { messageId: string; text: string }
  >();
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
    const preferences = new PreferenceService(
      `${runtime.dataDir}/preferences.db`,
    );
    const capabilities = new CapabilityCatalog();
    capabilities.loadApprovedDescriptors(
      join(runtime.dataDir, "capabilities.json"),
    );
    for (const id of [
      "read",
      "glob",
      "grep",
      "edit",
      "write",
      "apply_patch",
      "bash",
      "task",
      "pulso_prepare",
      "pulso_inspect",
      "pulso_work",
      "pulso_preferences",
      "pulso_artifact",
    ]) {
      capabilities.observe({
        id,
        source: "native",
        configured: true,
        discovered: true,
        permitted: "unknown",
        health: "unprobed",
        used: false,
        observedAt: new Date().toISOString(),
      });
    }
    const artifacts = new ArtifactService(runtime, verifiedDirectory, journal);
    const facade = new EvolutionFacade(
      runtime,
      journal,
      work,
      delegations,
      preferences,
      capabilities,
      verifiedDirectory,
      artifacts,
    );
    const bridge = {
      runtime,
      journal,
      work,
      delegations,
      facade,
      preferences,
      capabilities,
      artifacts,
    };
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
  const bridgeForTool = (directory: string) => getBridge(directory);
  const hooks: Hooks = {
    "chat.message": async (event, output) => {
      if (output.message?.role === "user" && event.messageID) {
        const text = output.parts
          .flatMap((part) =>
            "text" in part && typeof part.text === "string" ? [part.text] : [],
          )
          .join("\n");
        trustedUserMessages.set(event.sessionID, {
          messageId: event.messageID,
          text,
        });
      }
    },
    "experimental.chat.system.transform": async (event, output) => {
      if (!event.sessionID) return;
      const bridge = getBridge(input.directory);
      const snapshot = buildSessionContext({
        identity: {
          workspaceId: bridge.runtime.workspaceId,
          workspaceRoot: input.directory,
          sessionId: event.sessionID,
        },
        preferences: bridge.preferences,
        capabilities: bridge.capabilities,
      });
      if (!snapshot) return;
      const sections = [
        snapshot.rules?.content,
        snapshot.preferences.length
          ? `Preferencias activas (revisión ${snapshot.preferenceRevision}):\n${JSON.stringify(snapshot.preferences.map(({ key, value }) => ({ key, value })))}`
          : undefined,
      ].filter(Boolean);
      if (sections.length)
        output.system.push(
          `## Contexto explícito de Pulso\n${sections.join("\n\n")}`,
        );
    },
    "experimental.session.compacting": async (event, output) => {
      const bridge = getBridge(input.directory);
      const workId = await bridge.journal.currentWork(
        bridge.runtime.workspaceId,
        event.sessionID,
      );
      if (!workId) return;
      const snapshot = await bridge.runtime.work.snapshot(workId);
      const state = await bridge.runtime.store.read();
      const graph = state.workGraphs
        .filter((record) => record.workId === workId)
        .sort((left, right) => right.revision - left.revision)[0];
      const branches =
        graph &&
        Array.isArray((graph.definition as { branches?: unknown }).branches)
          ? (
              graph.definition as { branches: Array<{ key: string }> }
            ).branches.map((branch) => branch.key)
          : [];
      const preferenceRevision = Math.max(
        0,
        ...bridge.preferences
          .list(bridge.runtime.workspaceId)
          .map((item) => item.revision),
      );
      output.context.push(
        `Pulso continuity: work=${workId}; status=${snapshot.work.status}; graphRevision=${graph?.revision ?? 0}; branches=${branches.join(",")}; preferenceRevision=${preferenceRevision}. Rebuild current rules and preferences from PULSO.md/preferences.db; this note is continuity only.`,
      );
    },
    tool: {
      pulso_prepare: tool({
        description:
          "Create or continue a durable graph and prepare its ready native tasks.",
        args: prepareToolArgs,
        async execute(args, context) {
          return bridgeForTool(context.directory).facade.prepare(
            args,
            session(context),
          );
        },
      }),
      pulso_inspect: tool({
        description:
          "Inspect Pulso health, capabilities, current work, or a durable receipt.",
        args: inspectToolArgs,
        async execute(args, context) {
          const parsed = inspectSchema.parse(args);
          return bridgeForTool(context.directory).facade.inspect(
            parsed.view,
            parsed.detail,
            session(context),
            parsed.reference,
          );
        },
      }),
      pulso_work: tool({
        description:
          "Make an explicit lifecycle or graph decision for the current Work.",
        args: workToolArgs,
        async execute(args, context) {
          const source = trustedUserMessages.get(context.sessionID)?.text ?? "";
          const implementationAuthorized =
            /\b(autorizo|apruebo|procede|implementa|implementar|go ahead)\b/i.test(
              source,
            ) &&
            !/\b(no|not|don't|dont)\b.{0,60}\b(implementa|implementar|procede)\b/i.test(
              source,
            );
          return bridgeForTool(context.directory).facade.work(
            args,
            session(context),
            implementationAuthorized,
          );
        },
      }),
      pulso_preferences: tool({
        description: "Read or explicitly revise project preferences.",
        args: preferencesToolArgs,
        async execute(args, context) {
          const bridge = bridgeForTool(context.directory);
          const source = trustedUserMessages.get(context.sessionID);
          const request = preferencesSchema.parse(args).request;
          const explicit =
            request.action === "list"
              ? true
              : request.action === "set"
                ? /\b(recuerda|guarda|persiste|prefiero|preferencia|preference)\b/i.test(
                    source?.text ?? "",
                  )
                : /\b(revoca|olvida|elimina|quita|remove)\b/i.test(
                    source?.text ?? "",
                  );
          const explicitGlobal =
            request.scope !== "global" ||
            /\b(global|todos mis proyectos|en cualquier proyecto)\b/i.test(
              source?.text ?? "",
            );
          const provenance =
            source && explicit && explicitGlobal
              ? { messageId: source.messageId, role: "user" as const }
              : undefined;
          return bridge.facade.preferences(
            args,
            session(context),
            bridge.preferences,
            provenance,
          );
        },
      }),
      pulso_artifact: tool({
        description:
          "Publish or read a typed artifact owned by the active specialist binding.",
        args: artifactToolArgs,
        async execute(args, context) {
          const bridge = bridgeForTool(context.directory);
          const delegation =
            context.agent === "pulso"
              ? undefined
              : await bridge.journal.getByChildSession(
                  bridge.runtime.workspaceId,
                  context.sessionID,
                );
          const binding = delegation?.bindingId
            ? await bridge.runtime.runtimeBindings.get(delegation.bindingId)
            : undefined;
          if (
            delegation &&
            (delegation.specialist !== context.agent ||
              delegation.childSessionId !== context.sessionID)
          )
            throw new Error("ARTIFACT_BINDING_IDENTITY_MISMATCH");
          const parsed = artifactSchema.parse(args);
          return bridge.facade.artifact(
            parsed,
            bridge.artifacts,
            binding?.bindingId,
            delegation?.parentSessionId ?? context.sessionID,
          );
        },
      }),
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
      if (hook.tool !== "task") {
        const bridge = getBridge(input.directory);
        const delegation = await bridge.journal.getByChildSession(
          bridge.runtime.workspaceId,
          hook.sessionID,
        );
        if (
          !delegation ||
          !delegation.bindingId ||
          delegation.transportPhase !== "claimed"
        )
          return;
        const binding = await bridge.runtime.runtimeBindings.get(
          delegation.bindingId,
        );
        const snapshot = await bridge.runtime.work.snapshot(delegation.workId);
        const state = await bridge.runtime.store.read();
        const policy = state.workItemPolicies.find(
          (item) => item.workItemId === delegation.workItemId,
        );
        const lease = snapshot.leases.find(
          (item) =>
            item.workItemId === delegation.workItemId &&
            item.status === "active",
        );
        if (
          !binding ||
          binding.status !== "active" ||
          !policy ||
          !lease ||
          lease.executionId !== binding.executionId ||
          lease.fencingToken !== binding.fencingToken ||
          binding.workId !== delegation.workId ||
          binding.workItemId !== delegation.workItemId ||
          binding.executorId !== delegation.specialist ||
          binding.runtime.executionId !== delegation.delegationId ||
          binding.runtime.sessionId !== delegation.parentSessionId ||
          binding.managedBy !== "opencode-native" ||
          binding.runtime.provider !== "opencode"
        )
          throw new Error("EFFECT_AUTHORITY_INVALID");
        const graph = state.workGraphs.find(
          (item) =>
            item.workId === delegation.workId &&
            item.revision === policy.graphRevision,
        )?.definition as
          | {
              nodes?: Array<{
                key: string;
                mode: "read" | "files" | "exclusive";
              }>;
            }
          | undefined;
        const mode = graph?.nodes?.find(
          (node) => node.key === policy.nodeKey,
        )?.mode;
        if (!mode) throw new Error("EFFECT_POLICY_MISSING");
        const allowedTools =
          mode === "read"
            ? ["read", "glob", "grep"]
            : mode === "files"
              ? ["read", "glob", "grep", "edit", "write", "apply_patch"]
              : [
                  "read",
                  "glob",
                  "grep",
                  "edit",
                  "write",
                  "apply_patch",
                  "bash",
                ];
        await guardNativeEffect({
          tool: hook.tool,
          args: output.args as Record<string, unknown>,
          policy: {
            workspace: input.directory,
            mode,
            files: policy.resources
              .filter(
                (resource) =>
                  resource.access === "write" && resource.coverage === "exact",
              )
              .map((resource) => resource.path),
            leaseValid:
              lease.status === "active" && binding.status === "active",
            fenced: lease.fencingToken !== binding.fencingToken,
            cancelled: delegation.transportPhase !== "claimed",
            sideEffectsMayContinue: delegation.sideEffectsMayContinue,
            allowedTools,
          },
        });
        bridge.capabilities.recordCall(hook.tool);
        return;
      }
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
      const accepted = await resolved.bridge.journal.getByCall(
        resolved.bridge.runtime.workspaceId,
        hook.sessionID,
        hook.callID,
      );
      if (accepted?.receiptPhase === "rejected") {
        await resolved.bridge.artifacts
          .applyDelegationReceipt({
            delegationId: accepted.delegationId,
          })
          .catch(() => undefined);
        output.output = `Resultado rechazado por el bridge. No se registraron artefactos. Diagnóstico: ${accepted.delegationId}.`;
      }
      if (accepted?.receiptPhase === "applied") {
        let artifactError: string | undefined;
        let registeredArtifacts: Array<{ reference: string }> = [];
        try {
          registeredArtifacts =
            await resolved.bridge.artifacts.applyDelegationReceipt({
              delegationId: accepted.delegationId,
            });
        } catch (error) {
          artifactError =
            error instanceof Error ? error.message : String(error);
        }
        output.output = presentReceipt(accepted);
        if (registeredArtifacts.length)
          output.output += `\nArtefactos entregados: ${registeredArtifacts.map((artifact) => artifact.reference).join(", ")}.`;
        if (artifactError)
          output.output += `\nEl resultado quedó aceptado; el registro de un artefacto requiere diagnóstico (${artifactError}).`;
      }
    },
    dispose: async () => {
      for (const bridge of bridges.values()) {
        await bridge.delegations.dispose();
        bridge.artifacts.close();
        bridge.journal.close();
        bridge.preferences.close();
        bridge.runtime.close();
      }
      bridges.clear();
      managedCalls.clear();
      trustedUserMessages.clear();
    },
  };
  return hooks;
};

export default PulsoNativeBridge;

declare const __PULSO_BUILD_ID__: string;
