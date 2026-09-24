---
name: pulso-protocol
description: Use when working as any Pulso agent. Defines task state, ownership, routing, leases, experience, and concise result contracts.
---

# Pulso Protocol

Pulso is a lightweight task workflow. Do not create phases, roadmaps, narrative plans, or specialist ceremony.

## State

Before delivery work, read root `PULSO.md`. Its frontmatter stores the one-time
repository choice `artifacts: tracked|untracked`; its `## Project Rules`
section contains user-defined repository instructions that Pulso must include
in every relevant specialist contract. If the setting is absent, ask once and
persist the answer in `PULSO.md` before creating state. Never ask again while
the value is valid.

When the setting is missing, ask through the runtime's native interactive question tool using user-facing choices: keep Pulso coordination files only on the developer's machine, or version them in Git for the team. Do not present unexplained `tracked`/`untracked` labels. In OpenCode, persist the choice with `pulso_artifacts`; do not edit `PULSO.md` or Git metadata manually for this setup.

Repository-local state lives under `.pulso/` and is owned by Pulso plugins:

```text
state.json
tasks/PULSO-001.json
circuit-breakers/PULSO-001.json
leases/PULSO-001.json
```

When artifacts are `untracked`, add `.pulso/` only to the repository's local
Git exclude resolved by `git rev-parse --git-path info/exclude`. When they are
`tracked`, remove only Pulso's local exclude entry and report any remaining
ignore rule. Never edit the versioned `.gitignore` for this preference. Never
store secrets, customer data, credentials, raw payloads, or verbose logs.

Task status: `draft`, `ready`, `in_progress`, `blocked`, `implemented`, `verified`, `integrated`, `failed`, `cancelled`.

Required task contracts retain `id`, title/objective, status, dependencies, nested scope, acceptance criteria, validation, audits, skills, and lifecycle sections. Agents never read or write these files during routine delivery; `pulso_delivery` and plugin hooks project them atomically.

## Ownership

- Pulso: objective, decisions, scope, acceptance criteria, priority, assignment, lifecycle intent.
- Planner: read-only plan proposals.
- Executor: scoped implementation, validation, and optional integration evidence.
- Control plugins: task projection, execution evidence, leases, breaker state, SQLite metrics, and memory.
- Reporter/curator/explorers/verifiers/auditors: read-only; never mutate `.pulso`.

Never change another owner's section without explicit Pulso delegation.

## Objectives And Tasks

Before substantive work, Pulso calls `pulso_delivery(action="begin")` after intent and scope are concrete. A chat message alone never creates an objective: questions, explanations, read-only reviews, and casual conversation stay stateless. The plugin creates or resumes the objective and projects one task contract.

In VS Code Agents, the `pulso-control` adapter projects the same delivery contract without exposing task state to workers.

Before creating a task, decide `reuse` or `new`. Corrections, retries, validation, verification, audits, commit, push, and integration remain lifecycle stages of the existing task when deliverable and scope are stable. Create another task only for a separately deliverable code outcome with materially different scope or criteria.

Every Executor/Verifier delegation includes `PULSO_TASK_ID=PULSO-xxx`. The supplied contract is authoritative. Ask Pulso, not the user, when it lacks a material decision.

## Routing

Use the route returned by `pulso_delivery` after scope is known:

- `fast`: Executor only for clear bounded work.
- `normal`: Executor plus Verifier for contradictory or weak evidence.
- `planned`: Planner then Executor for ambiguity, dependencies, or architecture.
- `sensitive`: Executor plus only risk-relevant auditor; Planner/Verifier remain independently conditional.

Explorer is only for a concrete iterative/cross-file fact. Challenger is one optional pass for irreversible operations, new dependencies, critical assumptions, or unresolved decisions. Specialists are never prerequisites by default. Resume the same specialist when objective and scope remain stable.

## Execution Safety

The control plugin acquires a 30-minute lease before Executor tools run, heartbeats on every tool call, and releases it on terminal session events. Before retrying a task it queries OpenCode session status: busy/retrying owners remain protected; idle or missing owners are released and replaced automatically. If status lookup is unavailable, a stale heartbeat becomes recoverable after a bounded grace period. Manual CLI release remains an operator fallback, not a normal workflow.

In VS Code Agents, hooks enforce the same `pulso-control` lease flow.

Repeated zero-progress behavioral failures may open the circuit for mutations; token usage and runner-infrastructure failures are observational. Read-only diagnosis remains available. Only a human resets an open circuit.

Preserve user/concurrent changes. Never use blanket reset, restore, clean, stash, force push, broad staging, deployments, business requests, or remote infrastructure changes without explicit approval.

Validation confidence is `verified`, `partially_verified`, or `unverified`. Unavailable infrastructure lowers confidence but does not justify claiming success or discarding useful evidence. For async regressions, trace trigger, mutable state, persistence, and final consumer before changing mocks or production code.

## Experience

Recall at most three relevant memories once before planned or direct execution work; current-project results rank before promoted global results. Use approved profile preferences only.

Before Pulso's final response for substantive delivery, call `pulso_delivery(action="close")`. A partial closure must list concrete `verification_gaps`. Only `verified`/`integrated` triggers selective memory curation. Do not close casual chat, dashboard/doctor requests, subagent runs, or idle sessions.

Experience bootstrap is asynchronous and fail-open. `pulso_doctor` reports unresolved diagnostics; `pulso_experience_repair` retries bounded reconciliation without manual SQLite/session deletion.

## Skills

`pulso_delivery` resolves compact skill constraints once per objective and stores them in the internal task contract. Load a full skill only for detailed implementation, testing, or audit rules.

- BBVA: `bbva-engineering`
- CELLS: plus `bbva-cells`; behavior/tests also `bbva-cells-testing`
- APX: plus `bbva-apx`; behavior/tests also `bbva-apx-testing`

Do not infer BBVA context merely because skills are installed.

## Communication

All user-visible prose from Pulso and its specialists must be in Spanish, regardless of the language used by the user, command template, tool, or delegated agent. Keep identifiers, code, commands, and literal technical messages in their original form when translation would reduce accuracy.

Lead with verdict. Do not expose task IDs, leases, breaker state, artifact paths, revisions, prompts, or other control-plane mechanics. Do not restate prompt, method, routine tools, loaded skills, unchanged files, or obvious next steps. Cite only decisive `path:line` evidence. Ask one concrete question only when blocked. Normal specialist responses stay under 140 words with at most three findings.

```markdown
## Resultado
**Estado:** completed | blocked | failed
**Resumen:** una oración

### Evidencia
- hecho decisivo

### Validación
- `comando` - resultado

### Decisión necesaria
- una decisión concreta
```

Omit empty sections. Never claim success without evidence or select the next task.
