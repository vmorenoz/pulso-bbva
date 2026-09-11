---
name: pulso-protocol
description: Use when working as any Pulso agent. Defines the local task-state protocol, agent authority boundaries, result contracts, skill selection, and safe collaboration rules.
---

# Pulso Protocol

Pulso is a lightweight, task-oriented workflow. Do not create phases, roadmaps, or narrative planning documents.

## State Layout

The repository-local state is intentionally untracked:

```text
.pulso/
  state.json
  tasks/
    PULSO-001.json
  circuit-breakers/
    PULSO-001.json
  leases/
    PULSO-001.json
```

At first use, the orchestrator creates `.pulso/` and adds `.pulso/` to the repository's local Git exclude file (`git rev-parse --git-path info/exclude`). Do not edit the versioned `.gitignore` for Pulso state.

`state.json` contains only shared state:

```json
{
  "schema_version": 1,
  "revision": 1,
  "project_profile": {
    "organization": "unknown",
    "stacks": [],
    "evidence": []
  },
  "objective": "",
  "status": "active",
  "external_provider": { "type": "local", "project": null },
  "decisions": [],
  "blockers": [],
  "updated_at": ""
}
```

Each task is an independent JSON document. Its required fields are:

```json
{
  "schema_version": 1,
  "revision": 1,
  "id": "PULSO-001",
  "external_ref": null,
  "title": "",
  "objective": "",
  "status": "ready",
  "depends_on": [],
  "scope": { "allowed_paths": [], "excluded_paths": [] },
  "acceptance_criteria": [],
  "validation": [],
  "recommended_audits": [],
  "required_skills": [],
  "plan": {},
  "execution": {},
  "integration": {}
}
```

Status values are `draft`, `ready`, `in_progress`, `blocked`, `implemented`, `verified`, `integrated`, `failed`, and `cancelled`.

## State Ownership

- `pulso`: shared state, objective, priority, decisions, blockers, task assignment and lifecycle.
- `pulso-planner`: new task files and only the `plan` section of tasks it was assigned to plan. A completed plan may proceed directly to Executor.
- `pulso-challenger`: optional lightweight read-only review for plans with an irreversible operation, new dependency, critical unverified assumption, or unresolved material decision. It never writes state and blocks only demonstrated critical risks or unresolved user decisions.
- `pulso-circuit-breaker` plugin: sole owner of `.pulso/circuit-breakers/`. It blocks a task after its deterministic limits are crossed; no agent may reset an open circuit.
- `pulso-experience-engine` plugin: sole owner of the external SQLite experience store. It retrieves at most three active memories, records objective-level metrics, and starts curation only on explicit objective finalization.
- `pulso-experience-curator`: asynchronous and read-only. It proposes only evidence-backed memories and preference candidates; it never persists them or blocks delivery.
- `pulso-delivery-reporter`: asynchronous, lightweight, and read-only. After finalization it converts the structured closure package into concise Spanish dashboard copy without changing status, metrics, or technical evidence.
- Pulso custom tools under `~/.config/opencode/tools/`: own deterministic routing, task leases, skill digests, and read-only health checks.
- `pulso-executor`: owns the `execution` and `integration` sections for its assigned task, transitions `ready -> in_progress -> implemented|blocked|failed`, and may transition `implemented|verified -> integrated` only after an explicitly requested selective commit with a valid Jira ticket.
- Explorers and auditors are read-only. They return evidence to Pulso; they never write `.pulso`.

No agent may alter another agent's owned section, task dependencies, acceptance criteria, scope, or task priority without an explicit delegation from Pulso.

## Safe State Update

Before changing a Pulso JSON file:

1. Read it and record `revision`.
2. Confirm the task ID, expected status, and section ownership.
3. Make the smallest scoped edit possible.
4. Increment `revision` once and update `updated_at` in the section being changed.
5. Validate valid JSON using `node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" <path>`.
6. Re-read the edited fields.

If the revision or expected status differs from the delegated task, do not overwrite it. Return `state_conflict` with the observed revision and status.

Never store secrets, customer data, credentials, raw production payloads, or verbose command output in Pulso state.

## Task Contract

Treat the delegation supplied by Pulso as authoritative. It must identify task ID, objective, scope, acceptance criteria, constraints, validation commands, project profile, and required skills. Ask Pulso, not the user, when the contract lacks a material decision.

For planned work, Pulso transitions a complete task from `draft` to `ready` and proceeds to Executor. Challenger is an optional one-pass check only when its explicit activation conditions apply; warnings are advisory and never create a planning loop.

Every executor and verifier delegation must include `PULSO_TASK_ID=PULSO-xxx`. The circuit breaker uses it to associate sessions, token metrics, and behavioral validation failures with a task. Tokens and recognized runner-infrastructure failures are observational and never open the circuit. Repeated zero-progress behavioral failures open it for mutating tools while preserving read-only diagnosis by the current worker or a focused explorer/verifier. Lease status and release remain available, but reacquisition and further edits require a human reset through `node ~/.config/opencode/bin/pulso-breaker.js reset PULSO-001 --reason "reason"`.

Experience memory is one external cross-project store organized by project origin. Pulso recalls no more than three active memories once before relevant planned or direct execution work, ranking current-project memories first and then shared global memories by query and tags. A global memory keeps its originating project identifier for traceability. Pulso explicitly calls `pulso_experience_finalize` before its final response for every substantive delivery so metrics do not remain active; a `partially_verified` closure must persist every concrete missing check in `verification_gaps`. Every finalization asynchronously requests developer-friendly Spanish dashboard copy from `pulso-delivery-reporter`; this presentation step may deduplicate and translate supplied content but never changes facts, metrics, or status. Statuses below `verified` close metrics without memory curation. Only a `verified` or `integrated` finalization starts the non-blocking experience curator. Never finalize casual conversation, dashboard/doctor requests, every subagent execution, or idle sessions. Technical memories require a non-obvious trap, a verified rule, evidence, and duplicate/sensitive-data checks. Preference candidates always remain `proposed` until a human approves or rejects them; approved profile rules are global across projects. Global memory promotion is an explicit human review action and must use sanitized content.

The experience engine gives each primary Pulso objective a stable `PULSO-OBJ-###` identifier even when no executor task is needed. It does not persist an objective from a user message alone. Before substantive work, Pulso inspects shared state, relevant tasks, and incomplete analytical objectives, then calls `pulso_experience_start` with an explicit `new` or `resume` decision and concrete reason. OpenCode `ses_*` identifiers remain internal to agent runs and must never be presented as objective IDs. Planner, executor, verifier, and auditor child sessions are agent runs of that parent objective, not separate objectives; an orphan child run is not allowed to create an objective from its `PULSO-###` task ID. For a substantive delivery, Pulso calls `pulso_experience_finalize` without `objective_id`; the engine resolves the current session objective. Do not create memory candidates without supplied evidence.

When a user continues an explicitly identified incomplete objective from another session, Pulso calls `pulso_experience_resume` before planning or delegation. The engine reopens that objective and moves the current session's provisional runs into it. A follow-up `PULSO-###` is a task under the resumed objective, never another analytical objective. If Pulso supplies an existing `objective_id` only at finalization, the engine merges the provisional objective before closing as a recovery safeguard. Verified or integrated objectives are terminal and cannot be resumed implicitly.

Use the smallest effort that can establish the requested fact or outcome. Do not create planning artifacts merely to describe routine work.

Before creating a task, Pulso inspects existing tasks for the objective and makes an explicit `reuse` or `new` decision. Corrections, retries, validation, verification, audits, commit, push, and integration are lifecycle stages of the existing task when the deliverable and material scope remain the same. They never justify an integration-only or validation-only `PULSO-###`. Create a new task only for a separately deliverable code outcome with materially different scope or acceptance criteria, and preserve the reason in its contract. A later integration request returns the implemented task to `ready` when necessary, resumes its Executor, records integration in the same task, and transitions that task to `integrated`.

When new CI, user, or concurrent-agent evidence contradicts an implementation hypothesis, preserve the task and revise the evidence packet rather than starting over. Resume the same executor while objective and scope remain stable; add an explorer or verifier only to answer a specific missing fact or provide an independent check. Track delivery confidence as `verified`, `partially_verified`, or `unverified`; unavailable infrastructure lowers confidence but does not by itself prohibit continued diagnosis or an explicitly risk-accepted integration.

## Adaptive Routing

Pulso calls `pulso_route` when scope is known and follows the smallest returned route. It may call it again when contradictory evidence, an unavailable validator, or a material scope change alters the risk signals:

- `fast`: executor only for any clear bounded change; file count alone does not add ceremony.
- `normal`: executor plus verifier for contradictory or weak validation evidence.
- `planned`: planner then executor for ambiguity, dependencies, or unresolved architecture.
- `sensitive`: executor plus only the auditor selected by concrete risk signals; add planner or verifier only when their independent activation conditions also apply.

Pulso may override the recommendation for explicit user instructions or repository evidence, and records the short reason. Do not invoke every specialist by default.

## Task Leases

Before editing, Executor acquires a 30-minute lease with `pulso_lease(action="acquire")`; heartbeat before long validation or integration and release on every completed, blocked, or failed return. Another session cannot acquire a live lease. An expired lease may be recovered by a new session and records the prior owner. Leases coordinate work only and never overwrite task state.

## Skills

Load `pulso-protocol` first. Pulso resolves applicable project skills once per objective with `pulso_skill_digest` and includes that digest in specialist contracts.

Use the digest for routing, planning, exploration, and lightweight review. Load a full BBVA skill only when the specialist will implement, test, or audit behavior governed by its detailed stack rules, when the digest marks `full_skill_required`, or when the contract lacks a digest. Do not independently rediscover the skill set in every agent.

If the task does not name skills, determine the project profile from repository evidence and load only applicable skills:

| Confirmed context | Load |
| --- | --- |
| BBVA project | `bbva-engineering` |
| CELLS application | `bbva-engineering`, `bbva-cells` |
| CELLS behavior or tests | previous skills plus `bbva-cells-testing` |
| APX deployment unit | `bbva-engineering`, `bbva-apx` |
| APX behavior or tests | previous skills plus `bbva-apx-testing` |
| CELLS with APX integration | all applicable APX and CELLS skills |

Do not load BBVA skills solely because they are installed. If context is uncertain, report the evidence and leave the profile as `unknown`.

## Agent Communication Contract

Specialist communication is optimized for decisions, not narration:

- Lead with the verdict or direct answer in one sentence.
- Do not restate the task, prompt, method, repository context, or obvious next step.
- Include at most five decision-relevant evidence items or findings. If more exist, report the highest-impact five and a count of omitted lower-priority items.
- Cite `path:line` for material code claims. Do not paste logs; quote only the decisive line.
- Omit empty sections, `none` placeholders, routine tool calls, loaded skills, and unchanged files.
- Report skills only when one could not be loaded or materially changed the result.
- Ask for one concrete decision only when blocked. Do not send optional questions or broad menus.
- Keep normal results under 250 words. Exceed this only when multiple critical findings require evidence.

Return concise structured Markdown:

```markdown
## Pulso Result

**Task:** PULSO-001
**Status:** completed | blocked | failed | state_conflict
**Summary:** one sentence

### Evidence
- `path:line` - only facts needed for Pulso's decision

### Validation
- `command` - passed | failed, with the decisive result

### Decision Needed
- one blocker and the exact decision required
```

Include `Evidence`, `Validation`, and `Decision Needed` only when applicable. Executors may add `Changed` and `Commit`; auditors may replace `Evidence` with a findings table. Do not claim success without evidence or select the next task.

## Safety

- Preserve user and concurrent-agent changes. Never use blanket reset, restore, clean, stash, force push, or unscoped staging.
- Do not deploy, send real business requests, change remote infrastructure, or expose sensitive information without explicit user approval.
- Repository instructions take precedence over general practice, except safety restrictions and explicit user constraints.
