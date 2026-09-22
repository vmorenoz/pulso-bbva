---
name: bbva-engineering
description: Use when a repository is confirmed to be a BBVA project. Applies BBVA-wide engineering safety, project discovery, integration, validation, and skill-selection rules.
---

# BBVA Engineering

Apply this skill only when the user identifies the target as BBVA or repository evidence confirms it. Do not infer BBVA ownership from the local machine or installed skills.

## Project Discovery

- Read repository instructions and inspect sibling implementations before introducing a new pattern.
- Detect CELLS applications and APX deployment units from their actual manifests, structure, and configuration.
- Load `bbva-cells`, `bbva-apx`, and their testing skills only when their trigger conditions are met.
- For CELLS-to-APX changes, trace the request/response contract, loading and error states, error mapping, and relevant automated coverage end-to-end.

## Data And Environment Safety

- Never expose credentials, tokens, customer data, sensitive headers, or request bodies in logs, tests, task state, generated artifacts, or reports.
- Use synthetic test data and mocks. Do not target real business services, external environments, or production-like customer data without explicit user approval.
- Do not deploy or make irreversible environment changes without explicit user approval.

## Implementation And Validation

- Preserve the repository's existing architecture, framework conventions, error handling, and validation commands.
- Do not invent APIs, CLI flags, framework behavior, or internal contracts. Inspect local evidence or applicable documentation first.
- Run the narrowest relevant validation first, then the repository-required check when practical.
- Escalate contradictions between repository instructions, task constraints, and an existing contract rather than silently choosing one.

## Pulso Integration

- Record only a concise, non-sensitive reason for this skill in the task result.
- The Pulso integrator owns Jira validation and commit policy. This skill does not impose a commit-message format.
