import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  activePreferences,
  canonicalResourcePath,
  chooseCapability,
  gateSatisfied,
  nodesConflict,
  overlapMilliseconds,
  selectReadyWave,
  validateExecutablePlan,
  validateGraph,
} from "../src/adaptive/decision-kernel";
import type { Graph, Node, NodeResult } from "../src/adaptive/types";

const criterion = {
  key: "c1",
  description: "Resultado respaldado por evidencia",
  evidenceRequired: true,
};
const makeNode = (
  key: string,
  branch = "a",
  extra: Partial<Node> = {},
): Node => ({
  key,
  branch,
  specialist: "explorer",
  objective: `Investigar ${key}`,
  dependsOn: [],
  effects: ["read"],
  resources: [{ path: "src", coverage: "subtree", access: "read" }],
  mode: "read",
  criteria: [criterion],
  requiredCapabilities: [],
  ...extra,
});
const makeGraph = (nodes: Node[]): Graph => ({
  protocol: "pulso-graph/1",
  revision: 1,
  branches: [...new Set(nodes.map((n) => n.branch))].map((key) => ({
    key,
    objective: key,
    deliverable: "Artefacto comprobado",
    allowedEffects: ["read", "artifact", "edit", "test", "shell"],
    criteria: [criterion],
  })),
  nodes,
});
const ok: NodeResult = {
  status: "completed",
  accepted: true,
  criteria: { c1: "pass" },
  criterionEvidence: { c1: [{ kind: "file", ref: "src/a.ts:1" }] },
  evidence: [{ kind: "file", ref: "src/a.ts:1" }],
};
const throws = (fn: () => unknown, code: string) =>
  assert.throws(
    fn,
    (e: unknown) => e instanceof Error && e.message.startsWith(code + ":"),
  );
test("dos ramas de lectura se seleccionan simultáneamente", () =>
  assert.equal(
    selectReadyWave(makeGraph([makeNode("a"), makeNode("b", "b")]), {}, [])
      .length,
    2,
  ));
test("las dependencias reales se respetan", () => {
  const g = makeGraph([
    makeNode("a"),
    makeNode("b", "b", { dependsOn: ["a"] }),
  ]);
  assert.deepEqual(
    selectReadyWave(g, {}, []).map((n) => n.key),
    ["a"],
  );
  assert.deepEqual(
    selectReadyWave(g, { a: ok }, []).map((n) => n.key),
    ["b"],
  );
});
test("rama bloqueada no impide otra independiente", () => {
  const g = makeGraph([makeNode("a"), makeNode("b", "b")]);
  assert.deepEqual(
    selectReadyWave(g, { a: { ...ok, status: "blocked" } }, []).map(
      (n) => n.key,
    ),
    ["b"],
  );
});
test("rechaza ciclos sin crear trabajo", () =>
  throws(
    () =>
      validateGraph(
        makeGraph([
          makeNode("a", "a", { dependsOn: ["b"] }),
          makeNode("b", "a", { dependsOn: ["a"] }),
        ]),
      ),
    "GRAPH_CYCLE",
  ));
test("rechaza referencias inexistentes", () =>
  throws(
    () =>
      validateGraph(
        makeGraph([makeNode("a", "a", { dependsOn: ["missing"] })]),
      ),
    "DEPENDENCY_INVALID",
  ));
test("rechaza identificadores duplicados", () =>
  throws(
    () => validateGraph(makeGraph([makeNode("a"), makeNode("a")])),
    "GRAPH_DUPLICATE_KEY",
  ));
test("completar transporte no completa criterios", () =>
  assert.equal(
    gateSatisfied(makeNode("a"), { ...ok, criteria: { c1: "unknown" } }),
    false,
  ));
test("completed con verdict fail no desbloquea dependientes", () =>
  assert.equal(
    gateSatisfied(makeNode("a"), { ...ok, reviewerVerdict: "fail" }),
    false,
  ));
test("recibo no aceptado no desbloquea dependientes", () =>
  assert.equal(
    gateSatisfied(makeNode("a"), { ...ok, accepted: false }),
    false,
  ));
test("evidencia vacía no satisface criterio que la exige", () =>
  assert.equal(gateSatisfied(makeNode("a"), { ...ok, evidence: [] }), false));
test("tarea fallida no se reintenta automáticamente", () =>
  assert.equal(
    selectReadyWave(
      makeGraph([makeNode("a")]),
      { a: { ...ok, status: "failed" } },
      [],
    ).length,
    0,
  ));
test("no duplica un nodo activo", () => {
  const n = makeNode("a");
  assert.equal(selectReadyWave(makeGraph([n]), {}, [n]).length, 0);
});
const writer = (key: string, path: string): Node =>
  makeNode(key, "a", {
    specialist: "executor",
    mode: "files",
    effects: ["read", "edit"],
    resources: [{ path, coverage: "exact", access: "write" }],
  });
test("dos escrituras en archivos disjuntos sí pueden concurrir", () =>
  assert.equal(
    selectReadyWave(
      makeGraph([writer("a", "src/a.ts"), writer("b", "src/b.ts")]),
      {},
      [],
    ).length,
    2,
  ));
test("dos escrituras en un mismo archivo se serializan", () =>
  assert.equal(
    selectReadyWave(
      makeGraph([writer("a", "src/a.ts"), writer("b", "src/a.ts")]),
      {},
      [],
    ).length,
    1,
  ));
test("lectura de un árbol y escritura en ese árbol entran en conflicto", () =>
  assert.equal(nodesConflict(makeNode("a"), writer("b", "src/a.ts")), true));
test("src/a y src/abc no se confunden por prefijo textual", () =>
  assert.equal(
    nodesConflict(
      makeNode("a", "a", {
        resources: [{ path: "src/a", coverage: "subtree", access: "read" }],
      }),
      writer("b", "src/abc/file.ts"),
    ),
    false,
  ));
test("shell exclusivo bloquea otras ramas en ese workspace", () =>
  assert.equal(
    nodesConflict(
      makeNode("a", "a", {
        specialist: "verifier",
        mode: "exclusive",
        effects: ["test", "shell"],
      }),
      makeNode("b"),
    ),
    true,
  ));
test("modo files jamás habilita shell en paralelo", () =>
  throws(
    () =>
      validateGraph(
        makeGraph([
          writer("a", "src/a.ts"),
          makeNode("b", "a", {
            specialist: "executor",
            mode: "files",
            effects: ["shell"],
          }),
        ]),
      ),
    "FILES_MODE_NO_COMMANDS",
  ));
test("pedir un plan no autoriza implementar", () => {
  const g = makeGraph([writer("a", "src/a.ts")]);
  g.branches[0].allowedEffects = ["read", "artifact"];
  throws(() => validateGraph(g), "EFFECT_NOT_AUTHORIZED");
});
test("Explorer no hereda permiso de modificar por elegir una skill", () =>
  throws(
    () =>
      validateGraph(
        makeGraph([
          makeNode("a", "a", {
            mode: "exclusive",
            effects: ["edit"],
            resources: [
              { path: "src/a.ts", coverage: "exact", access: "write" },
            ],
          }),
        ]),
      ),
    "SPECIALIST_EFFECT_DENIED",
  ));
test("escritura requiere ámbito exacto en files", () =>
  throws(
    () =>
      validateGraph(
        makeGraph([
          writer("a", "src/a.ts"),
          makeNode("b", "a", {
            specialist: "executor",
            mode: "files",
            effects: ["edit"],
            resources: [{ path: "src", coverage: "subtree", access: "write" }],
          }),
        ]),
      ),
    "EXACT_WRITE_REQUIRED",
  ));
for (const p of [
  "../x",
  "/tmp/x",
  "a/../b",
  "a//b",
  "a\\b",
  "C:/x",
  "a/*",
  "a\u0000b",
])
  test(`rechaza ruta lógica peligrosa ${JSON.stringify(p)}`, () =>
    throws(() => canonicalResourcePath(p), "RESOURCE_PATH_INVALID"));
test("protege el plano de control contra escrituras de especialista", () =>
  throws(
    () => validateGraph(makeGraph([writer("a", ".opencode/opencode.json")])),
    "PROTECTED_RESOURCE",
  ));
test("respeta presupuesto global de cuatro tareas", () =>
  assert.equal(
    selectReadyWave(
      makeGraph(Array.from({ length: 6 }, (_, i) => makeNode(String(i)))),
      {},
      [],
    ).length,
    4,
  ));
test("concurrencia inválida no se corrige silenciosamente", () =>
  throws(
    () => selectReadyWave(makeGraph([makeNode("a")]), {}, [], 0),
    "CONCURRENCY_LIMIT_INVALID",
  ));
test("un plan incompleto es borrador, nunca ready", () =>
  throws(
    () =>
      validateExecutablePlan({
        protocol: "pulso-plan/1",
        status: "ready",
        title: "Plan",
        inventoryComplete: false,
        targets: [],
        graph: makeGraph([makeNode("a")]),
        unresolved: [],
      }),
    "PLAN_NOT_READY",
  ));
test("ready exige comportamientos y referencias de cada ruta", () =>
  throws(
    () =>
      validateExecutablePlan({
        protocol: "pulso-plan/1",
        status: "ready",
        title: "Plan",
        inventoryComplete: true,
        targets: [
          {
            path: "src/a.ts",
            existence: "existing",
            evidence: [],
            behaviors: ["render"],
          },
        ],
        graph: makeGraph([makeNode("a")]),
        unresolved: [],
      }),
    "PLAN_TARGET_UNSUPPORTED",
  ));
test("un borrador incompleto se conserva sin presentarlo como ejecutable", () =>
  assert.equal(
    validateExecutablePlan({
      protocol: "pulso-plan/1",
      status: "draft",
      title: "Plan",
      inventoryComplete: false,
      targets: [],
      graph: makeGraph([makeNode("a")]),
      unresolved: ["Falta inspección"],
    }).status,
    "draft",
  ));
test("una sugerencia del modelo no se convierte en preferencia", () =>
  assert.equal(
    activePreferences([
      {
        key: "search.primary",
        value: "fake",
        source: "suggestion",
        scope: "project",
        revision: 1,
        active: true,
      },
    ]).length,
    0,
  ));
test("tombstone elimina la preferencia sin revivir versión anterior", () =>
  assert.equal(
    activePreferences([
      {
        key: "style.emoji",
        value: false,
        source: "user",
        scope: "project",
        revision: 1,
        active: true,
      },
      {
        key: "style.emoji",
        value: false,
        source: "user",
        scope: "project",
        revision: 2,
        active: false,
      },
    ]).length,
    0,
  ));
test("preferencia de otro alcance no se filtra", () =>
  assert.equal(
    activePreferences([
      {
        key: "search.primary",
        value: "tool-a",
        source: "user",
        scope: "global",
        revision: 1,
        active: true,
      },
    ]).length,
    0,
  ));
test("preferencia no sobreescribe una denegación", () =>
  assert.equal(
    chooseCapability(
      ["tool-a"],
      {
        "tool-a": { discovered: true, permitted: "deny", health: "ok" },
        grep: { discovered: true, permitted: "allow", health: "ok" },
      },
      "grep",
    ).id,
    "grep",
  ));
test("documentar una herramienta no equivale a salud verificada", () =>
  assert.equal(
    chooseCapability(
      ["tool-a"],
      {
        "tool-a": { discovered: true, permitted: "allow", health: "unprobed" },
        grep: { discovered: true, permitted: "allow", health: "ok" },
      },
      "grep",
    ).reason,
    "native-fallback",
  ));
test("no inventa un fallback disponible", () =>
  throws(() => chooseCapability([], {}, "grep"), "NO_ALLOWED_CAPABILITY"));
test("solapamiento real se calcula con intervalos, no con cantidad de agentes", () => {
  assert.equal(
    overlapMilliseconds({ start: 0, end: 10 }, { start: 6, end: 14 }),
    4,
  );
  assert.equal(
    overlapMilliseconds({ start: 0, end: 10 }, { start: 10, end: 14 }),
    0,
  );
});
test("la evidencia de otro criterio no satisface el actual", () =>
  assert.equal(
    gateSatisfied(makeNode("a"), {
      ...ok,
      criterionEvidence: { unrelated: [{ kind: "file", ref: "src/a.ts:1" }] },
    }),
    false,
  ));
