/** Pulso v2.1 business contracts. */
export type Specialist =
  | "explorer"
  | "planner"
  | "executor"
  | "verifier"
  | "security-auditor";
export type Effect =
  | "read"
  | "artifact"
  | "preference"
  | "edit"
  | "test"
  | "shell"
  | "delete"
  | "network"
  | "commit"
  | "push";
export type Verdict = "pass" | "fail" | "unknown";
export type Resource = {
  path: string;
  coverage: "exact" | "subtree";
  access: "read" | "write";
};
export type Evidence = {
  kind: "file" | "symbol" | "command" | "test" | "artifact" | "url";
  ref: string;
  note?: string;
};
export type Criterion = {
  key: string;
  description: string;
  evidenceRequired: boolean;
};
export type Branch = {
  key: string;
  objective: string;
  deliverable: string;
  allowedEffects: Effect[];
  criteria: Criterion[];
};
export type Node = {
  key: string;
  branch: string;
  specialist: Specialist;
  objective: string;
  dependsOn: string[];
  effects: Effect[];
  resources: Resource[];
  mode: "read" | "files" | "exclusive";
  criteria: Criterion[];
  requiredCapabilities: string[];
  context?: { facts: string[]; references: Evidence[] };
  constraints?: string[];
  requestedEvidence?: string[];
};
export type Graph = {
  protocol: "pulso-graph/1";
  revision: number;
  branches: Branch[];
  nodes: Node[];
};
export type NodeResult = {
  status:
    | "pending"
    | "running"
    | "completed"
    | "blocked"
    | "failed"
    | "cancelled";
  accepted: boolean;
  criteria: Record<string, Verdict>;
  evidence: Evidence[] /** Internally evaluated and linked to verified evidence. */;
  criterionEvidence: Record<string, Evidence[]>;
  reviewerVerdict?: "pass" | "fail" | "partial";
};
export type PlanTarget = {
  path: string;
  existence: "existing" | "new";
  evidence: Evidence[];
  behaviors: string[];
};
export type ExecutablePlan = {
  protocol: "pulso-plan/1";
  status: "draft" | "ready";
  title: string;
  inventoryComplete: boolean;
  targets: PlanTarget[];
  graph: Graph;
  unresolved: string[];
};
export type CapabilityObservation = {
  id: string;
  source: "native" | "mcp" | "plugin" | "skill" | "cli";
  configured: boolean;
  discovered: boolean;
  permitted: "allow" | "ask" | "deny" | "unknown";
  health: "unprobed" | "ok" | "error" | "stale";
  used: boolean;
  observedAt: string;
  evidence: Evidence[];
};
export type Preference = {
  key: string;
  value: string | boolean | string[];
  source: "user" | "project-file" | "suggestion";
  scope: "project" | "global";
  revision: number;
  active: boolean;
};
