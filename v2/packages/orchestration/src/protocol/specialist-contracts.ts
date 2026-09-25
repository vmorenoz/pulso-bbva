import type { SpecialistTaskContract } from "../runtimes/types";
import type { SpecialistId } from "./schemas";

/** Canonical semantic task guidance. Wire result shape is defined only in schemas.ts. */
export const specialistTaskContracts: Record<
  SpecialistId,
  SpecialistTaskContract
> = {
  planner: {
    purpose: "Produce a minimal, actionable plan for the delegated objective.",
    focus: [
      "plan",
      "dependencies",
      "assumptions",
      "risks",
      "acceptance criteria",
    ],
    produce: ["ordered steps with objectives", "assumptions", "risks"],
    avoid: [
      "modifying code or Work",
      "executing the plan",
      "routing or delegating work",
    ],
  },
  explorer: {
    purpose:
      "Perform read-only investigation of the delegated question and report evidence-backed findings.",
    focus: [
      "relevant definitions",
      "references",
      "current behavior",
      "tests",
      "limitations",
    ],
    produce: [
      "concise findings with supporting Evidence",
      "useful references",
      "limitations when relevant",
    ],
    avoid: [
      "modifying files or Work",
      "inventing severity for ordinary findings",
      "deciding routing",
    ],
  },
  executor: {
    purpose: "Implement exactly the bounded delegated objective.",
    focus: ["targeted changes", "validation", "artifacts", "unresolved items"],
    produce: [
      "changes with targets and summaries",
      "validation outcomes",
      "artifacts and unresolved items when relevant",
    ],
    avoid: [
      "unrelated findings",
      "scope expansion",
      "modifying Work or delegating",
    ],
  },
  verifier: {
    purpose:
      "Independently verify the delegated criteria and report a verification verdict.",
    focus: ["acceptance criteria", "checks", "evidence", "failures", "risks"],
    produce: [
      "pass, fail, or partial verdict",
      "criterion checks with evidence where available",
    ],
    avoid: [
      "changing lifecycle status",
      "editing files",
      "modifying Work or delegating",
    ],
  },
  "security-auditor": {
    purpose: "Assess concrete security risks in the bounded delegated scope.",
    focus: [
      "trust boundaries",
      "authorization",
      "validation",
      "secrets",
      "data exposure",
      "remediation",
    ],
    produce: [
      "security findings with severity and Evidence",
      "impact and remediation when applicable",
    ],
    avoid: [
      "unsubstantiated findings",
      "editing files",
      "modifying Work or delegating",
    ],
  },
};
