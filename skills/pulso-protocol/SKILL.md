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

Repository-local state lives under `.pulso/`:

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

Required task contract: `id`, title/objective, status, dependencies, `scope: { allowed_paths: [...], excluded_paths: [...] }`, acceptance criteria, validation, audits, skills, and `plan`/`execution`/`integration` sections. Always nest both path lists under `scope`; never write them at the task root.

Before writing state: read revision/status, verify ownership, make the smallest edit, increment revision once, update the owned timestamp, validate JSON, and re-read changed fields. Return `state_conflict` instead of overwriting changed state.

## Ownership

- Pulso: objective, shared state, decisions, scope, acceptance criteria, priority, assignment, lifecycle.
- Planner: new delegated task files and assigned `plan` sections only.
- Executor: assigned `execution`/`integration`; transitions `ready -> in_progress -> implemented|blocked|failed`, or to `integrated` after explicitly requested selective commit.
- Circuit-breaker plugin: breaker state. Experience engine: external SQLite metrics/memory.
- Reporter/curator/explorers/verifiers/auditors: read-only; never mutate `.pulso`.

Never change another owner's section without explicit Pulso delegation.

## Objectives And Tasks

Before substantive work, Pulso inspects shared state, relevant tasks, and incomplete objectives, then calls `pulso_experience_start` once with `new` or `resume` and a concrete reason. A chat message alone never creates an objective. OpenCode session IDs remain internal.

Before creating a task, decide `reuse` or `new`. Corrections, retries, validation, verification, audits, commit, push, and integration remain lifecycle stages of the existing task when deliverable and scope are stable. Create another task only for a separately deliverable code outcome with materially different scope or criteria.

Every Executor/Verifier delegation includes `PULSO_TASK_ID=PULSO-xxx`. The supplied contract is authoritative. Ask Pulso, not the user, when it lacks a material decision.

## Routing

Call `pulso_route` after scope is known and use the smallest route:

- `fast`: Executor only for clear bounded work.
- `normal`: Executor plus Verifier for contradictory or weak evidence.
- `planned`: Planner then Executor for ambiguity, dependencies, or architecture.
- `sensitive`: Executor plus only risk-relevant auditor; Planner/Verifier remain independently conditional.

Explorer is only for a concrete iterative/cross-file fact. Challenger is one optional pass for irreversible operations, new dependencies, critical assumptions, or unresolved decisions. Specialists are never prerequisites by default. Resume the same specialist when objective and scope remain stable.

## Execution Safety

Executor acquires a 30-minute lease before editing, heartbeats before long validation/integration, and releases on every terminal return. Never override a live lease.

Repeated zero-progress behavioral failures may open the circuit for mutations; token usage and runner-infrastructure failures are observational. Read-only diagnosis remains available. Only a human resets an open circuit.

Preserve user/concurrent changes. Never use blanket reset, restore, clean, stash, force push, broad staging, deployments, business requests, or remote infrastructure changes without explicit approval.

Validation confidence is `verified`, `partially_verified`, or `unverified`. Unavailable infrastructure lowers confidence but does not justify claiming success or discarding useful evidence. For async regressions, trace trigger, mutable state, persistence, and final consumer before changing mocks or production code.

## Experience

Recall at most three relevant memories once before planned or direct execution work; current-project results rank before promoted global results. Use approved profile preferences only.

Before Pulso's final response for substantive delivery, call `pulso_experience_finalize`. A partial closure must list concrete `verification_gaps`. Only `verified`/`integrated` triggers selective memory curation; reporter formatting never changes facts or status. Do not finalize casual chat, dashboard/doctor requests, subagent runs, or idle sessions.

Experience bootstrap is asynchronous and fail-open. `pulso_doctor` reports unresolved diagnostics; `pulso_experience_repair` retries bounded reconciliation without manual SQLite/session deletion.

## Skills

Pulso resolves skills once per objective through `pulso_skill_digest` and sends the compact rules to specialists. Load a full skill only for detailed implementation/testing/audit rules or when digest says `full_skill_required`.

- BBVA: `bbva-engineering`
- CELLS: plus `bbva-cells`; behavior/tests also `bbva-cells-testing`
- APX: plus `bbva-apx`; behavior/tests also `bbva-apx-testing`

Do not infer BBVA context merely because skills are installed.

## Communication

Lead with verdict. Do not restate prompt, method, routine tools, loaded skills, unchanged files, or obvious next steps. Cite only decisive `path:line` evidence. Ask one concrete question only when blocked. Normal specialist responses stay under 140 words with at most three findings.

```markdown
## Pulso Result
**Task:** PULSO-001
**Status:** completed | blocked | failed | state_conflict
**Summary:** one sentence

### Evidence
- decisive fact

### Validation
- `command` - result

### Decision Needed
- one exact decision
```

Omit empty sections. Never claim success without evidence or select the next task.
