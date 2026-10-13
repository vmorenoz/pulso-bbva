# Specialist communication contracts

Only Pulso is human-facing and orchestrates. Each stateless specialist has one canonical role, tool policy, SpecialistTaskContract and schema-derived ResultContract. Every specialist is not user-invocable, has `agents: []`, and has no Work MCP tools. The role-specific outputs are described below: Planner proposes steps, dependencies and assumptions; Explorer reports observations with optional evidence and no severity; Executor reports changed targets and validations; Verifier reports a pass/fail/partial verdict per criterion; Security Auditor reports evidence-backed, severity-rated findings.

`packages/orchestration/src/agents/definitions.ts` is the canonical static source for each specialist's purpose, boundaries and tool policy. Each specialist also references a `SpecialistTaskContract` (purpose, focus, desired output, exclusions). The Zod schemas in `protocol/schemas.ts` are the sole authority for wire fields and validation; generated protocol instructions show the schema-derived result shape rather than maintaining another field list.

## Shared TaskEnvelope v2

The dynamic envelope carries only per-delegation data: protocol/delegation/specialist identity, nested Work and WorkItem identity, objective, optional compact context, dependency references, constraints, acceptance criteria, scope, requested evidence and a result contract reference. A dependency reference is `{workItemId, summary, artifacts?}`; it does not inline the predecessor AgentResult. The envelope does not copy the conversation or the specialist's static role prompt.

`SpecialistPromptAssembler` is a host-neutral programmatic builder over `buildTaskEnvelope` and the canonical serializer. `DelegationCoordinator` uses it. During native OpenCode `Task` and VS Code subagent calls, Pulso's LLM still creates the tool arguments; the assembler is not invoked by those hosts per request. Rendered static instructions and OpenCode's runtime guard are the actual safeguards in that flow.

## ResultContract v2 by specialist

| Specialist | Payload | Contract intent |
|---|---|---|
| Planner | `steps[{objective, dependencies?, acceptanceCriteria?}]`, `assumptions?`, `risks?` | A concise proposal; Pulso still owns Work graph creation. |
| Explorer | `findings[{summary, evidence?}]`, `references?: Evidence[]`, `limitations?` | Observations and evidence; no severity requirement. |
| Executor | `changes[{target, summary}]`, `validations?`, `artifacts?`, `unresolved?` | Bounded implementation and checks. |
| Verifier | `verdict: pass|fail|partial`, `checks[{criterion, result, evidence?}]`, `failures?`, `risks?` | Independent criterion verification. `AgentResult.status` remains lifecycle outcome. |
| Security Auditor | `findings[{summary, severity, evidence, impact?, remediation?}]` | Security findings retain mandatory severity and evidence. |

Evidence is `{kind, ref, note?}` where `kind` is one of `file`, `symbol`, `command`, `test`, `artifact`, or `url`. Explorer findings use `summary`, not Security's severity-rated finding structure. Evidence references must be objects, not free-form strings.

## Versioning

This changes strict ResultContract fields and changes `TaskEnvelope.output.contract`; both are breaking, so the current protocols are `pulso-task/2` and `pulso-result/2`. The previous v1 result is not silently accepted or translated. Installation replaces only hash-matching managed agents and guard assets; clients should restart/reload customizations after upgrading the MCP tool IDs and contracts.
