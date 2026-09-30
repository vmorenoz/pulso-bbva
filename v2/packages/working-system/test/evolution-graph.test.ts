import { expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkService } from "../src/domain";
import { SqliteStore } from "../src/persistence/sqlite-store";

const criterion = {
  key: "verified",
  description: "verified",
  evidenceRequired: true,
};
const graph = (revision: number) => ({
  protocol: "pulso-graph/1" as const,
  revision,
  branches: [
    {
      key: "branch-a",
      objective: "A",
      deliverable: "A output",
      allowedEffects: ["read"],
      criteria: [criterion],
    },
  ],
  nodes: [
    {
      key: "inspect",
      branch: "branch-a",
      specialist: "explorer",
      objective: "Inspect",
      dependsOn: [],
      effects: ["read"],
      resources: [
        { path: "src", coverage: "subtree" as const, access: "read" as const },
      ],
      mode: "read" as const,
      criteria: [criterion],
      requiredCapabilities: [],
    },
    {
      key: "report",
      branch: "branch-a",
      specialist: "planner",
      objective: "Report",
      dependsOn: ["inspect"],
      effects: ["read"],
      resources: [
        { path: "docs", coverage: "subtree" as const, access: "read" as const },
      ],
      mode: "read" as const,
      criteria: [criterion],
      requiredCapabilities: [],
    },
  ],
});

test("migration 6 loads old databases with empty graph and policy defaults", async () => {
  const store = new SqliteStore(":memory:");
  expect(store.diagnostics().schemaVersion).toBe(6);
  const state = await store.read();
  expect(state.workGraphs).toEqual([]);
  expect(state.workBranches).toEqual([]);
  expect(state.workItemPolicies).toEqual([]);
  expect(state.preparationIntents).toEqual([]);
  store.close();
});

test("creates graph-backed WorkItems with real dependency IDs and roundtrips graph, policy and intent", async () => {
  const dir = join(tmpdir(), `pulso-graph-${crypto.randomUUID()}`);
  mkdirSync(dir);
  const path = join(dir, "work.db");
  const firstStore = new SqliteStore(path);
  const service = new WorkService(firstStore);
  const created = await service.createFromGraph({
    workspaceId: "workspace",
    title: "Work",
    objective: "Objective",
    graph: graph(1),
    definitionHash: "hash-1",
    operationKey: "prepare:one",
    inputHash: "request-1",
  });
  const first = await firstStore.read();
  expect(first.items.map((item) => item.dependencies)).toEqual([
    [],
    [first.items[0].id],
  ]);
  expect(first.workGraphs[0]).toMatchObject({
    workId: created.id,
    revision: 1,
    definitionHash: "hash-1",
  });
  expect(first.workItemPolicies.map((policy) => policy.nodeKey).sort()).toEqual(
    ["inspect", "report"],
  );
  expect(first.preparationIntents).toHaveLength(1);
  firstStore.close();

  const reopened = new SqliteStore(path);
  const persisted = await reopened.read();
  expect(persisted.workGraphs).toEqual(first.workGraphs);
  expect(persisted.workBranches).toEqual(first.workBranches);
  expect(persisted.workItemPolicies).toEqual(first.workItemPolicies);
  expect(persisted.preparationIntents).toEqual(first.preparationIntents);
  const revised = await new WorkService(reopened).reviseGraph({
    workId: created.id,
    expectedRevision: 1,
    graph: graph(2),
    definitionHash: "hash-2",
    reason: "Refine graph",
  });
  expect(revised.revision).toBe(2);
  await expect(
    new WorkService(reopened).reviseGraph({
      workId: created.id,
      expectedRevision: 1,
      graph: graph(2),
      definitionHash: "hash-3",
      reason: "Stale CAS",
    }),
  ).rejects.toMatchObject({ code: "GRAPH_REVISION_CONFLICT" });
  const after = await reopened.read();
  expect(after.workGraphs.map((record) => record.revision)).toEqual([1, 2]);
  expect(after.items).toHaveLength(2);
  reopened.close();
});

test("refuses a graph revision that removes a terminal item", async () => {
  const store = new SqliteStore(":memory:");
  const service = new WorkService(store);
  const work = await service.createFromGraph({
    workspaceId: "workspace",
    title: "Work",
    objective: "Objective",
    graph: graph(1),
    definitionHash: "hash-1",
    operationKey: "prepare:terminal",
    inputHash: "request-terminal",
  });
  await store.transaction((state) => {
    const item = state.items.find(
      (candidate) => candidate.title === "Inspect",
    )!;
    item.status = "completed";
  });
  const next = graph(2);
  next.nodes[0].objective = "Revised inspection";
  await expect(
    service.reviseGraph({
      workId: work.id,
      expectedRevision: 1,
      graph: next,
      definitionHash: "hash-2",
      reason: "Remove",
    }),
  ).rejects.toMatchObject({ code: "GRAPH_ACTIVE_NODE_IMMUTABLE" });
  store.close();
});
