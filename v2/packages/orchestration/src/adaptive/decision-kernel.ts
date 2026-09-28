import type {
  ExecutablePlan,
  Graph,
  Node,
  NodeResult,
  Preference,
  Resource,
} from "./types";
export class EvolutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.code = code;
    this.name = "EvolutionError";
  }
}
const fail = (code: string, message: string): never => {
  throw new EvolutionError(code, message);
};
const unique = (v: string[]) => new Set(v).size === v.length;
export function canonicalResourcePath(path: string): string {
  if (path === ".") return path;
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    [...path].some((character) => character.charCodeAt(0) < 32) ||
    [...path].some((character) => "*?[]{}".includes(character))
  )
    fail("RESOURCE_PATH_INVALID", path);
  const p = path.split("/");
  if (p.some((x) => !x || x === "." || x === ".."))
    fail("RESOURCE_PATH_INVALID", path);
  return path;
}
function covers(a: Resource, b: Resource) {
  return (
    a.path === b.path ||
    (a.coverage === "subtree" &&
      (a.path === "." || b.path.startsWith(`${a.path}/`)))
  );
}
export function resourcesOverlap(a: Resource, b: Resource) {
  canonicalResourcePath(a.path);
  canonicalResourcePath(b.path);
  return covers(a, b) || covers(b, a);
}
export function nodesConflict(a: Node, b: Node) {
  if (a.mode === "exclusive" || b.mode === "exclusive") return true;
  return a.resources.some((x) =>
    b.resources.some(
      (y) =>
        (x.access === "write" || y.access === "write") &&
        resourcesOverlap(x, y),
    ),
  );
}
const readonlyEffects = new Set(["read", "artifact"]);
export function validateGraph(graph: Graph): Graph {
  if (
    graph.protocol !== "pulso-graph/1" ||
    !Number.isInteger(graph.revision) ||
    graph.revision < 1
  )
    fail("GRAPH_VERSION_INVALID", "Revisión positiva obligatoria");
  if (!graph.branches.length || !graph.nodes.length)
    fail("GRAPH_EMPTY", "El grafo necesita resultados y nodos");
  if (
    !unique(graph.branches.map((b) => b.key)) ||
    !unique(graph.nodes.map((n) => n.key))
  )
    fail("GRAPH_DUPLICATE_KEY", "Clave duplicada");
  const branches = new Map(graph.branches.map((b) => [b.key, b])),
    nodes = new Map(graph.nodes.map((n) => [n.key, n]));
  for (const b of graph.branches) {
    if (!b.criteria.length || !unique(b.criteria.map((c) => c.key)))
      fail("CRITERIA_INVALID", b.key);
    if (!graph.nodes.some((n) => n.branch === b.key))
      fail("BRANCH_WITHOUT_NODE", b.key);
  }
  for (const n of graph.nodes) {
    const b = branches.get(n.branch) ?? fail("BRANCH_NOT_FOUND", n.branch);
    if (!n.criteria.length || !unique(n.criteria.map((c) => c.key)))
      fail("CRITERIA_INVALID", n.key);
    if (
      !unique(n.dependsOn) ||
      n.dependsOn.some((d) => d === n.key || !nodes.has(d))
    )
      fail("DEPENDENCY_INVALID", n.key);
    if (n.effects.some((e) => !b.allowedEffects.includes(e)))
      fail("EFFECT_NOT_AUTHORIZED", n.key);
    if (n.mode === "read" && n.effects.some((e) => !readonlyEffects.has(e)))
      fail("MODE_EFFECT_MISMATCH", n.key);
    if (
      n.mode === "files" &&
      n.effects.some((e) => !["read", "edit", "artifact"].includes(e))
    )
      fail("FILES_MODE_NO_COMMANDS", n.key);
    if (
      n.mode !== "exclusive" &&
      n.effects.some((e) =>
        [
          "test",
          "shell",
          "delete",
          "network",
          "commit",
          "push",
          "preference",
        ].includes(e),
      )
    )
      fail("EXCLUSIVE_REQUIRED", n.key);
    if (
      ["explorer", "planner", "security-auditor"].includes(n.specialist) &&
      n.effects.some((e) => !readonlyEffects.has(e))
    )
      fail("SPECIALIST_EFFECT_DENIED", n.key);
    if (
      n.specialist === "verifier" &&
      n.effects.some((e) =>
        ["edit", "delete", "preference", "commit", "push"].includes(e),
      )
    )
      fail("VERIFIER_MUTATION_DENIED", n.key);
    if (!n.resources.length) fail("RESOURCE_DECLARATION_REQUIRED", n.key);
    for (const r of n.resources) {
      canonicalResourcePath(r.path);
      if (
        r.access === "write" &&
        (r.path === "." || /^(\.git|\.opencode|\.pulso)(\/|$)/.test(r.path))
      )
        fail("PROTECTED_RESOURCE", r.path);
      if (n.mode === "read" && r.access === "write")
        fail("READ_MODE_WRITE_RESOURCE", n.key);
      if (n.mode === "files" && r.access === "write" && r.coverage !== "exact")
        fail("EXACT_WRITE_REQUIRED", n.key);
    }
    if (
      n.effects.includes("edit") &&
      !n.resources.some((r) => r.access === "write")
    )
      fail("WRITE_RESOURCE_REQUIRED", n.key);
  }
  const gray = new Set<string>(),
    black = new Set<string>();
  const visit = (k: string) => {
    if (gray.has(k)) fail("GRAPH_CYCLE", k);
    if (black.has(k)) return;
    gray.add(k);
    for (const d of nodes.get(k)?.dependsOn ?? []) visit(d);
    gray.delete(k);
    black.add(k);
  };
  for (const node of graph.nodes) visit(node.key);
  return graph;
}
export function gateSatisfied(n: Node, r?: NodeResult) {
  return Boolean(
    r?.status === "completed" &&
      r.accepted &&
      !["fail", "partial"].includes(r.reviewerVerdict ?? "") &&
      n.criteria.every(
        (c) =>
          r.criteria[c.key] === "pass" &&
          (!c.evidenceRequired ||
            (r.evidence.length > 0 &&
              (r.criterionEvidence[c.key]?.length ?? 0) > 0)),
      ),
  );
}
export function selectReadyWave(
  graph: Graph,
  results: Record<string, NodeResult>,
  active: Node[],
  limit = 4,
): Node[] {
  validateGraph(graph);
  if (!Number.isInteger(limit) || limit < 1 || limit > 4)
    fail("CONCURRENCY_LIMIT_INVALID", "Rango certificado 1–4");
  const byKey = new Map(graph.nodes.map((n) => [n.key, n])),
    chosen: Node[] = [];
  for (const n of graph.nodes) {
    if (chosen.length + active.length >= limit) break;
    if (active.some((x) => x.key === n.key)) continue;
    const own = results[n.key];
    if (own && own.status !== "pending") continue;
    if (!n.dependsOn.every((k) => gateSatisfied(byKey.get(k)!, results[k])))
      continue;
    if ([...active, ...chosen].some((x) => nodesConflict(n, x))) continue;
    chosen.push(n);
  }
  return chosen;
}
export function validateExecutablePlan(p: ExecutablePlan): ExecutablePlan {
  validateGraph(p.graph);
  if (p.protocol !== "pulso-plan/1")
    fail("PLAN_PROTOCOL_INVALID", "Contrato distinto");
  if (p.status === "ready") {
    if (!p.inventoryComplete || p.unresolved.length || !p.targets.length)
      fail("PLAN_NOT_READY", "Alcance incompleto");
    if (!unique(p.targets.map((t) => t.path)))
      fail("PLAN_DUPLICATE_TARGET", "Ruta duplicada");
    for (const t of p.targets) {
      canonicalResourcePath(t.path);
      if (!t.evidence.length || !t.behaviors.length)
        fail("PLAN_TARGET_UNSUPPORTED", t.path);
    }
  }
  return p;
}
export function activePreferences(
  values: Preference[],
  scope: "project" | "global" = "project",
): Preference[] {
  const latest = new Map<string, Preference>();
  for (const p of values) {
    if (p.scope !== scope || p.source === "suggestion") continue;
    if (!latest.has(p.key) || latest.get(p.key)!.revision < p.revision)
      latest.set(p.key, p);
  }
  return [...latest.values()]
    .filter((p) => p.active)
    .sort((a, b) => a.key.localeCompare(b.key));
}
export function chooseCapability(
  preferred: string[],
  observations: Record<
    string,
    { permitted: string; health: string; discovered: boolean }
  >,
  fallback: string,
): { id: string; reason: string } {
  for (const id of preferred) {
    const o = observations[id];
    if (o?.discovered && o.permitted === "allow" && o.health === "ok")
      return { id, reason: "preferred-verified" };
  }
  const f = observations[fallback];
  if (f?.discovered && f.permitted === "allow" && f.health === "ok")
    return { id: fallback, reason: "native-fallback" };
  return fail(
    "NO_ALLOWED_CAPABILITY",
    "Ni la preferencia ni su alternativa están verificadas y autorizadas",
  );
}
export function overlapMilliseconds(
  a: { start: number; end: number },
  b: { start: number; end: number },
): number {
  if (
    [a.start, a.end, b.start, b.end].some((n) => !Number.isFinite(n)) ||
    a.end < a.start ||
    b.end < b.start
  )
    fail("INTERVAL_INVALID", "Intervalo inválido");
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}
