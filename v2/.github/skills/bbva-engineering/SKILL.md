---
name: bbva-engineering
description: BBVA engineering safety, discovery, integration, validation, and APX/CELLS skill-selection guidance.
user-invocable: false
---

# BBVA Engineering

Use only when the user or repository evidence confirms a BBVA target. Do not infer ownership from local configuration.

## Discovery

- Read repository instructions and inspect sibling implementations before introducing a pattern.
- Identify CELLS applications and APX deployment units from manifests, structure, and configuration.
- Load APX, CELLS, or their testing skills only when their technology is present.
- For CELLS-to-APX changes, trace request/response contracts, loading and error states, error mapping, and relevant automated coverage end to end.

## Safety

- Do not expose credentials, tokens, customer data, sensitive headers, or request bodies in logs, tests, artifacts, or reports.
- Use synthetic data and mocks. Do not target real business services or production-like customer data without explicit approval.
- Do not deploy or perform irreversible environment operations without explicit approval.

## Delivery

- Preserve existing architecture, framework conventions, error handling, and validation commands.
- Do not invent APIs, CLI flags, framework behavior, or internal contracts; inspect local evidence or documentation first.
- Run the narrowest relevant validation before broader repository checks when practical.
- Escalate contradictions between repository instructions, task constraints, and existing contracts.
