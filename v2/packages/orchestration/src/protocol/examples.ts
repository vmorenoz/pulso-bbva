import {
  type AgentResult,
  agentResultSchema,
  type ExpectedDelegationIdentity,
  type SpecialistId,
} from "./schemas";
import { serializeAgentResult } from "./serialize";

/** Synthetic illustrations only. Validate them with the production schema. */
const exampleResults: Record<SpecialistId, unknown> = {
  planner: {
    protocol: "pulso-result/2",
    delegationId: "example-delegation",
    specialist: "planner",
    workId: "example-work",
    workItemId: "example-item",
    status: "completed",
    summary: "EJEMPLO DE FORMATO: no describe trabajo ejecutado.",
    specialistResult: {
      kind: "planner",
      steps: [
        {
          objective:
            "EJEMPLO: corregir un contrato de fixture sin cambiar su API pública.",
          acceptanceCriteria: [
            "La fixture válida pasa y la inválida se rechaza.",
          ],
        },
      ],
      assumptions: [
        "EJEMPLO ilustrativo, no un plan para un repositorio real.",
      ],
      risks: ["No confundir un ejemplo con evidencia."],
    },
  },
  explorer: {
    protocol: "pulso-result/2",
    delegationId: "example-delegation",
    specialist: "explorer",
    workId: "example-work",
    workItemId: "example-item",
    status: "completed",
    summary: "EJEMPLO DE FORMATO: no describe trabajo ejecutado.",
    specialistResult: {
      kind: "explorer",
      findings: [
        {
          summary:
            "EJEMPLO: el contrato de fixture permite limitaciones en la raíz.",
          evidence: [
            {
              kind: "file",
              ref: "fixture/example.ts:1",
              note: "Referencia ficticia para mostrar la forma.",
            },
          ],
        },
      ],
      references: [
        { kind: "symbol", ref: "FixtureContract", note: "Símbolo ficticio." },
      ],
      limitations: [
        "EJEMPLO: no se ejecutaron pruebas; esta limitación está en la raíz.",
      ],
    },
  },
  executor: {
    protocol: "pulso-result/2",
    delegationId: "example-delegation",
    specialist: "executor",
    workId: "example-work",
    workItemId: "example-item",
    status: "blocked",
    summary: "EJEMPLO DE FORMATO: no describe trabajo ejecutado.",
    specialistResult: {
      kind: "executor",
      changes: [
        {
          target: "fixture/example.ts",
          summary: "EJEMPLO de cambio, no un archivo modificado real.",
        },
      ],
      validations: [
        {
          command: "bun test fixture/example.test.ts",
          outcome: "not-run",
          note: "Ejemplo de formato; el comando no fue ejecutado.",
        },
      ],
      unresolved: ["Sustituir los ejemplos por resultados reales."],
    },
  },
  verifier: {
    protocol: "pulso-result/2",
    delegationId: "example-delegation",
    specialist: "verifier",
    workId: "example-work",
    workItemId: "example-item",
    status: "completed",
    summary: "EJEMPLO DE FORMATO: no describe trabajo ejecutado.",
    specialistResult: {
      kind: "verifier",
      verdict: "partial",
      checks: [
        {
          criterion:
            "EJEMPLO: el contrato inspeccionado define el campo requerido.",
          result: "pass",
          evidence: [
            {
              kind: "file",
              ref: "fixture/example.ts:1",
              note: "Evidencia ficticia; no reutilizar como comprobación real.",
            },
          ],
        },
      ],
      risks: ["EJEMPLO: ejecución live no comprobada; se omite de checks."],
    },
  },
  "security-auditor": {
    protocol: "pulso-result/2",
    delegationId: "example-delegation",
    specialist: "security-auditor",
    workId: "example-work",
    workItemId: "example-item",
    status: "completed",
    summary: "EJEMPLO DE FORMATO: no describe trabajo ejecutado.",
    specialistResult: {
      kind: "security-auditor",
      findings: [
        {
          severity: "medium",
          summary: "EJEMPLO ficticio de autorización ausente.",
          evidence: [
            {
              kind: "file",
              ref: "fixture/handler.ts:1",
              note: "No corresponde al repositorio del usuario.",
            },
          ],
          impact: "Impacto hipotético de la fixture.",
          remediation: "Comprobar la autorización antes del acceso.",
        },
      ],
    },
  },
};

const emptyPayloads: Record<SpecialistId, unknown> = {
  planner: { kind: "planner", steps: [] },
  explorer: {
    kind: "explorer",
    findings: [],
    limitations: ["REEMPLAZAR por una limitación real o eliminar este campo."],
  },
  executor: {
    kind: "executor",
    changes: [],
    unresolved: [
      "REEMPLAZAR por trabajo pendiente real o eliminar este campo.",
    ],
  },
  verifier: {
    kind: "verifier",
    verdict: "partial",
    checks: [],
    risks: ["REEMPLAZAR por criterios pendientes reales."],
  },
  "security-auditor": { kind: "security-auditor", findings: [] },
};

export function exampleResult(specialist: SpecialistId): AgentResult {
  return agentResultSchema.parse(structuredClone(exampleResults[specialist]));
}

/** Filled with real identity, but deliberately NOT a completed result. */
export function resultTemplate(
  expected: ExpectedDelegationIdentity,
): AgentResult {
  return agentResultSchema.parse({
    protocol: "pulso-result/2",
    ...expected,
    status: "blocked",
    summary:
      "PLANTILLA: sustituye este texto, el estado y el payload por el resultado real.",
    specialistResult: structuredClone(emptyPayloads[expected.specialist]),
  });
}

export function renderExample(specialist: SpecialistId): string {
  return `Ejemplo ficticio de formato; no reutilices sus IDs, hechos ni referencias: ${serializeAgentResult(exampleResult(specialist))}`;
}

export function renderTaskResultTemplate(
  expected: ExpectedDelegationIdentity,
): string {
  return `PLANTILLA DE SALIDA, NO EVIDENCIA: reemplaza el resumen, estado y payload con tu resultado real; conserva exactamente la identidad. ${serializeAgentResult(resultTemplate(expected))}`;
}
