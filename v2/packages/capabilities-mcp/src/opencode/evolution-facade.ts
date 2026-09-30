import { createHash } from "node:crypto";
import {
  artifactSchema,
  graphSchema,
  preferencesSchema,
  prepareSchema,
  workSchema,
} from "../../../orchestration/src/adaptive/contracts";
import type { CapabilitiesRuntime } from "../bootstrap";
import type { ArtifactService } from "./artifact-service";
import type { CapabilityCatalog } from "./capability-catalog";
import type { NativeDelegationService } from "./native-delegation-service";
import type { NativeJournal } from "./native-journal";
import type { NativeSession, NativeWorkService } from "./native-work-service";
import type {
  PreferenceService,
  TrustedMessageProvenance,
} from "./preference-service";
import { presentPrepared, presentReceipt } from "./receipt-presenter";
import { buildSessionContext } from "./session-context";

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Compact prepare+task facade over the existing Work and native task authorities. */
export class EvolutionFacade {
  constructor(
    private readonly runtime: CapabilitiesRuntime,
    private readonly journal: NativeJournal,
    private readonly nativeWork: NativeWorkService,
    private readonly delegations: NativeDelegationService,
    private readonly preferenceService: PreferenceService,
    private readonly capabilities: CapabilityCatalog,
    private readonly workspaceRoot: string,
    private readonly artifacts: ArtifactService,
  ) {}

  async prepare(raw: unknown, session: NativeSession) {
    const input = prepareSchema.parse(raw).request;
    let workId = await this.journal.currentWork(
      session.workspaceId,
      session.parentSessionId,
    );
    if (input.intent === "new") {
      const graph = graphSchema.parse(input.graph);
      const inputHash = hash(input);
      const operationKey = hash({
        workspaceId: session.workspaceId,
        session: session.parentSessionId,
        message: session.messageId,
        inputHash,
      });
      const created = await this.runtime.work.createFromGraph({
        workspaceId: session.workspaceId,
        title: input.objective.slice(0, 80),
        objective: input.objective,
        graph,
        definitionHash: inputHash,
        operationKey,
        inputHash,
      });
      workId = created.id;
      await this.journal.associateWork({
        workspaceId: session.workspaceId,
        parentSessionId: session.parentSessionId,
        workId,
        associatedAt: new Date().toISOString(),
      });
    }
    if (!workId)
      throw new Error(
        "WORK_NOT_FOUND: prepare a graph or select an existing Work first",
      );
    const snapshot = await this.runtime.work.snapshot(workId);
    const effectiveContext = buildSessionContext({
      identity: {
        workspaceId: session.workspaceId,
        workspaceRoot: this.workspaceRoot,
        sessionId: session.parentSessionId,
      },
      preferences: this.preferenceService,
      capabilities: this.capabilities,
    });
    const state = await this.runtime.store.read();
    const latestRevision = Math.max(
      ...state.workGraphs
        .filter((item) => item.workId === workId)
        .map((item) => item.revision),
    );
    const policyByItem = new Map(
      state.workItemPolicies
        .filter((policy) => policy.graphRevision === latestRevision)
        .map((policy) => [policy.workItemId, policy]),
    );
    const ready = snapshot.items
      .filter((item) => item.status === "ready")
      .slice(0, 4);
    const prepared = [];
    for (const item of ready) {
      const policy = policyByItem.get(item.id);
      if (!policy) continue;
      const graph = graphSchema.parse(
        state.workGraphs.find(
          (record) =>
            record.workId === workId &&
            record.revision === policy.graphRevision,
        )?.definition,
      );
      const node = graph.nodes.find(
        (candidate) => candidate.key === policy.nodeKey,
      );
      if (!node) throw new Error("GRAPH_POLICY_MISMATCH");
      const result = await this.delegations.prepare(
        {
          specialist: node.specialist,
          objective: node.objective,
          workItemId: item.id,
          context: {
            facts: [
              ...(node.context?.facts ?? []),
              ...(effectiveContext?.rules
                ? [
                    `PULSO.md (sha256:${effectiveContext.rules.hash}):\n${effectiveContext.rules.content}`,
                  ]
                : []),
              ...(effectiveContext?.preferences.map(
                (preference) =>
                  `Preferencia ${preference.key} revisión ${preference.revision}: ${JSON.stringify(preference.value)}`,
              ) ?? []),
              ...(effectiveContext?.capabilities
                .filter((capability) =>
                  node.requiredCapabilities.includes(capability.id),
                )
                .map(
                  (capability) =>
                    `Capacidad ${capability.id}: discovered=${capability.discovered}, permitted=${capability.permitted}, health=${capability.health}, used=${capability.used}`,
                ) ?? []),
            ],
            references: [
              ...(node.context?.references ?? []),
              ...(effectiveContext?.rules
                ? [
                    {
                      kind: "file" as const,
                      ref: "PULSO.md",
                      note: `sha256:${effectiveContext.rules.hash}`,
                    },
                  ]
                : []),
            ],
          },
          constraints: [
            ...(node.constraints ?? []),
            ...node.criteria.map((criterion) => criterion.description),
          ],
          acceptanceCriteria: node.criteria.map(
            (criterion) => criterion.description,
          ),
          requestedEvidence: node.requestedEvidence,
          scope: {
            include: node.resources
              .filter((resource) => resource.access === "write")
              .map((resource) => resource.path),
            exclude: [],
          },
        },
        session,
      );
      prepared.push(result);
    }
    return {
      title: "Preparación lista",
      output: presentPrepared(prepared),
      metadata: {
        workId,
        workStatus: snapshot.work.status,
        prepared: prepared.map((item) => item.delegationId),
      },
    };
  }

  async inspect(
    view: "health" | "capabilities" | "work" | "receipt",
    detail: "summary" | "full",
    session: NativeSession,
    reference?: string,
  ) {
    if (view === "health") {
      const doctor = this.runtime.doctor();
      return {
        title: "Estado de Pulso",
        output: `Bridge local operativo · OpenCode ${doctor.bridgeVersion ?? "versión fijada"}\nAlmacenamiento: ${doctor.runtimeBindingSchema ?? "disponible"}.`,
        metadata: { buildId: doctor.buildId },
      };
    }
    if (view === "work") {
      const current = await this.nativeWork.get(session);
      if (!current.currentWork)
        return {
          title: "Trabajo actual",
          output: "No hay un trabajo activo en esta conversación.",
          metadata: {},
        };
      return {
        title: "Trabajo actual",
        output: `Estado: ${current.currentWork.status}\n${Object.entries(
          current.currentWork.counts,
        )
          .map(([status, count]) => `${status}: ${count}`)
          .join(" · ")}`,
        metadata: { workId: current.currentWork.workId },
      };
    }
    if (view === "receipt") {
      if (!reference) throw new Error("RECEIPT_REFERENCE_REQUIRED");
      if (detail === "full")
        return {
          title: "Diagnóstico del resultado",
          output: JSON.stringify(
            await this.delegations.status(
              { delegationId: reference, view: "full" },
              session,
            ),
          ),
          metadata: { diagnosticId: reference },
        };
      await this.delegations.status(
        { delegationId: reference, view: "summary" },
        session,
      );
      const delegation = await this.journal.get(reference);
      if (!delegation) throw new Error("DELEGATION_NOT_FOUND");
      return {
        title: "Resultado",
        output: presentReceipt(delegation),
        metadata: { diagnosticId: reference },
      };
    }
    const observations = this.capabilities.list();
    return {
      title: "Capacidades",
      output: observations.length
        ? observations
            .map(
              (item) =>
                `${item.id} · ${item.discovered ? "detectada" : "no detectada"} · permiso ${item.permitted} · salud ${item.health} · ${item.used ? "usada" : "sin uso observado"}`,
            )
            .join("\n")
        : "No hay observaciones de capacidades recientes.",
      metadata: { observed: observations.length },
    };
  }

  async work(
    raw: unknown,
    session: NativeSession,
    implementationAuthorized = false,
  ) {
    const { request } = workSchema.parse(raw);
    const workId = await this.journal.currentWork(
      session.workspaceId,
      session.parentSessionId,
    );
    if (!workId) throw new Error("WORK_NOT_FOUND");
    if (request.action === "revise") {
      const result = await this.runtime.work.reviseGraph({
        workId,
        expectedRevision: request.expectedRevision,
        graph: request.graph,
        definitionHash: hash(request.graph),
        reason: request.reason,
      });
      return {
        title: "Plan revisado",
        output: `El grafo quedó en la revisión ${result.revision}.`,
        metadata: { workId, revision: result.revision },
      };
    }
    if (request.action === "adopt_plan") {
      if (!implementationAuthorized)
        throw new Error("IMPLEMENTATION_AUTHORIZATION_REQUIRED");
      const stored = await this.artifacts.read(request.artifactRef);
      if (
        stored.artifact.workId !== workId ||
        stored.artifact.state !== "accepted" ||
        stored.artifact.kind !== "plan"
      )
        throw new Error("ARTIFACT_NOT_READY");
      const plan = stored.document;
      if (plan.protocol !== "pulso-plan/1" || plan.status !== "ready")
        throw new Error("ARTIFACT_NOT_READY");
      await this.artifacts.validatePlanReadiness(plan);
      const state = await this.runtime.store.read();
      const prior = state.workGraphs
        .filter((item) => item.workId === workId)
        .sort((left, right) => right.revision - left.revision)[0];
      if (!prior || prior.revision !== request.expectedRevision)
        throw new Error("GRAPH_REVISION_CONFLICT");
      const current = graphSchema.parse(prior.definition);
      const prefix = `adopt-r${request.expectedRevision + 1}`;
      const branchMap = new Map(
        plan.graph.branches.map((branch) => [
          branch.key,
          `${prefix}/${branch.key}`,
        ]),
      );
      const nodeMap = new Map(
        plan.graph.nodes.map((node) => [node.key, `${prefix}/${node.key}`]),
      );
      const adopted = graphSchema.parse({
        ...plan.graph,
        revision: request.expectedRevision + 1,
        branches: [
          ...current.branches,
          ...plan.graph.branches.map((branch) => ({
            ...branch,
            key: branchMap.get(branch.key),
          })),
        ],
        nodes: [
          ...current.nodes,
          ...plan.graph.nodes.map((node) => ({
            ...node,
            key: nodeMap.get(node.key),
            branch: branchMap.get(node.branch),
            dependsOn: node.dependsOn.map((key) => nodeMap.get(key)),
          })),
        ],
      });
      const result = await this.runtime.work.reviseGraph({
        workId,
        expectedRevision: request.expectedRevision,
        graph: adopted,
        definitionHash: hash({ source: stored.artifact.hash, graph: adopted }),
        reason: request.reason,
      });
      return {
        title: "Plan adoptado",
        output: `El plan ready se añadió al trabajo en la revisión ${result.revision}. La ejecución aún no se ha despachado; pulso_prepare preparará los nodos autorizados.`,
        metadata: {
          workId,
          revision: result.revision,
          artifact: request.artifactRef,
        },
      };
    }
    if (request.action === "finish") {
      const outcome =
        request.outcome === "completed" ? "completed" : request.outcome;
      const result = await this.nativeWork.execute(
        { action: "close", workId, outcome, reason: request.reason },
        session,
      );
      return {
        title: "Trabajo actualizado",
        output: JSON.stringify(result),
        metadata: { workId },
      };
    }
    if (request.action === "pause") {
      await this.runtime.work.transition(
        "work",
        workId,
        "block",
        request.reason,
      );
      return {
        title: "Trabajo pausado",
        output: "El trabajo quedó pausado explícitamente.",
        metadata: { workId },
      };
    }
    if (request.action === "resume") {
      const result = await this.nativeWork.execute(
        { action: "resume", workId, reason: request.reason },
        session,
      );
      return {
        title: "Trabajo reanudado",
        output: JSON.stringify(result),
        metadata: { workId },
      };
    }
    throw new Error("RETRY_REQUIRES_NATIVE_RECEIPT_REVIEW");
  }

  async preferences(
    raw: unknown,
    session: NativeSession,
    service: PreferenceService,
    provenance?: TrustedMessageProvenance,
  ) {
    const { request } = preferencesSchema.parse(raw);
    if (request.action === "list") {
      const values = service.list(session.workspaceId, request.scope);
      return {
        title: "Preferencias",
        output: values.length
          ? values
              .map(
                (item) =>
                  `${item.key} (revisión ${item.revision}): ${JSON.stringify(item.value)}`,
              )
              .join("\n")
          : "No hay preferencias activas para este proyecto.",
        metadata: { count: values.length },
      };
    }
    if (!provenance) throw new Error("PREFERENCE_SOURCE_UNVERIFIED");
    if (request.action === "set") {
      const value = service.set({
        workspaceId: session.workspaceId,
        scope: request.scope,
        key: request.key,
        value: request.value,
        expectedRevision: request.expectedRevision,
        provenance,
      });
      return {
        title: "Preferencia guardada",
        output: `Guardada la revisión ${value.revision} para ${value.key}.`,
        metadata: { revision: value.revision },
      };
    }
    const value = service.remove({
      workspaceId: session.workspaceId,
      scope: request.scope,
      key: request.key,
      expectedRevision: request.expectedRevision,
      provenance,
    });
    return {
      title: "Preferencia revocada",
      output: `Revocada ${value.key} en la revisión ${value.revision}.`,
      metadata: { revision: value.revision },
    };
  }

  async artifact(
    raw: unknown,
    service: ArtifactService,
    bindingId?: string,
    parentSessionId?: string,
  ) {
    const { request } = artifactSchema.parse(raw);
    if (request.action === "read") {
      const value = await service.read(request.reference, parentSessionId);
      return {
        title: "Artefacto",
        output: value.markdown,
        metadata: {
          reference: value.artifact.reference,
          hash: value.artifact.hash,
        },
      };
    }
    if (!bindingId) throw new Error("ARTIFACT_BINDING_UNVERIFIED");
    const value = await service.publish(bindingId, request.document);
    return {
      title: "Artefacto preparado",
      output: `Artefacto ${value.kind} preparado: ${value.reference} (estado ${value.state}). Se registrará si el resultado de esta tarea es aceptado.`,
      metadata: { reference: value.reference, hash: value.hash },
    };
  }
}
