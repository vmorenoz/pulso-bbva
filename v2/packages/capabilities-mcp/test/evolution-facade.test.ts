import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapCapabilities } from "../src/bootstrap";
import { ArtifactService } from "../src/opencode/artifact-service";
import { CapabilityCatalog } from "../src/opencode/capability-catalog";
import { EvolutionFacade } from "../src/opencode/evolution-facade";
import { NativeDelegationService } from "../src/opencode/native-delegation-service";
import { NativeJournal } from "../src/opencode/native-journal";
import {
  type NativeSession,
  NativeWorkService,
} from "../src/opencode/native-work-service";
import type { OpenCodeTransport } from "../src/opencode/opencode-port";
import { PreferenceService } from "../src/opencode/preference-service";

test("pulso_prepare creates durable graph-backed Work and returns short task refs without execution", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-v21-facade-"));
  const runtime = bootstrapCapabilities(root, { dataDir: join(root, "data") });
  const journal = new NativeJournal(runtime.runtimeBindings.databasePath);
  const work = new NativeWorkService(runtime, journal);
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
      throw new Error("prepare must not create a child");
    },
  };
  const delegations = new NativeDelegationService(
    runtime,
    journal,
    port,
    "instance",
    work,
  );
  const preferences = new PreferenceService(
    join(runtime.dataDir, "preferences.db"),
  );
  const capabilities = new CapabilityCatalog();
  const artifacts = new ArtifactService(runtime, root, journal);
  const facade = new EvolutionFacade(
    runtime,
    journal,
    work,
    delegations,
    preferences,
    capabilities,
    root,
    artifacts,
  );
  const session: NativeSession = {
    workspaceId: runtime.workspaceId,
    parentSessionId: "parent",
    messageId: "user-message",
    agent: "pulso",
  };
  try {
    const result = await facade.prepare(
      {
        request: {
          intent: "new",
          objective: "Explain the current total contract",
          graph: {
            protocol: "pulso-graph/1",
            revision: 1,
            branches: [
              {
                key: "research",
                objective: "Inspect",
                deliverable: "Evidence-backed explanation",
                allowedEffects: ["read"],
                criteria: [
                  {
                    key: "evidence",
                    description: "Cite the current behavior",
                    evidenceRequired: false,
                  },
                ],
              },
            ],
            nodes: [
              {
                key: "inspect-total",
                branch: "research",
                specialist: "explorer",
                objective: "Inspect the total contract without editing",
                dependsOn: [],
                effects: ["read"],
                resources: [
                  { path: "src", coverage: "subtree", access: "read" },
                ],
                mode: "read",
                criteria: [
                  {
                    key: "evidence",
                    description: "Cite the current behavior",
                    evidenceRequired: false,
                  },
                ],
                requiredCapabilities: [],
                context: { facts: ["Plan only"], references: [] },
                constraints: ["Do not edit"],
                requestedEvidence: [],
              },
            ],
          },
        },
      },
      session,
    );
    const state = await runtime.store.read();
    const delegationsForSession = await journal.list(
      runtime.workspaceId,
      session.parentSessionId,
    );
    expect(state.works).toHaveLength(1);
    expect(state.workGraphs).toHaveLength(1);
    expect(state.workItemPolicies).toHaveLength(1);
    expect(state.executions).toHaveLength(0);
    expect(delegationsForSession).toHaveLength(1);
    expect(result.output).toContain("subagent_type: explorer");
    expect(result.output).toContain("prompt: pulso-dispatch/1:");
    expect(result.output).not.toContain("pulso-task/2");
    expect(result.metadata.workId).toBe(state.works[0]?.id);
  } finally {
    await delegations.dispose();
    artifacts.close();
    preferences.close();
    journal.close();
    runtime.close();
    rmSync(root, { recursive: true, force: true });
  }
});
