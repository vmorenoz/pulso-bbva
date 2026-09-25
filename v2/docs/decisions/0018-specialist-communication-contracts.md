# Specialist communication contracts

## Context

Native runtimes deliver prompts as model-authored tool arguments and specialist output as text. The old shared result required Explorer to emit Security-style severity findings and represented evidence inconsistently, so a useful read-only exploration failed strict validation. Maintaining fields in runtime-specific prompts would drift.

## Decision

Keep one canonical static specialist definition, specialist Task guidance, shared TaskEnvelope v2, Evidence primitive, and discriminated ResultContract v2 per specialist in `@pulso/orchestration`. Generate both runtime prompt instructions from these definitions/schemas. Add a host-neutral `SpecialistPromptAssembler` for programmatic construction and use it in `DelegationCoordinator`; native hosts still let Pulso's LLM issue subagent calls. Because the result schema and Task's result-contract reference changed incompatibly, version both wire contracts to v2 and do not silently accept v1.

## Consequences

- Explorer findings are observations (`summary`, optional Evidence), without irrelevant severity.
- Security findings retain mandatory severity and evidence.
- Executor, Verifier and Planner payloads express their actual work.
- Both runtimes receive the same generated semantic contracts.
- OpenCode runtime enforcement remains isolated in its plugin guard; VS Code remains prompt-level.
