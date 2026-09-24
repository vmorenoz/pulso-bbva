---
name: bbva-apx
description: Use when working in BBVA APX deployment units, Java/Maven transactions, DTOs, libraries, online synchronous flows, or asynchronous batch jobs.
---

# BBVA APX

Apply this skill only after confirming the target is an APX deployment unit from its structure, Maven artifacts, or user statement.

## Online Transactions

- Preserve the existing transaction, DTO, and reusable-library structure.
- Follow the established framework pattern: generated abstract transaction base, service libraries obtained through the framework, request context propagation, advice/severity handling, and framework HTTP response mapping.
- Inspect the existing transaction and sibling artifacts before adding contracts, DTO fields, or error behavior.

## Batch Jobs

- Preserve the job's reader, processor, writer, tasklet, decider, state, utility, input/output, and test conventions.
- Treat idempotency, restartability, date processing, reconciliation, error behavior, and file semantics as explicit design concerns.
- Add or update focused unit and functional tests for changed behavior.

## CLI And Safety

- `apx` CLI version 1.22.0 is available. It supports `init`, `add`, `build`, `check`, `start`, `send`, `mvn`, `show`, and `deploy`.
- Run `apx <command> --help` before using unfamiliar commands in the target unit.
- Use existing Maven/APX validation conventions.
- Never run `apx deploy`, send a real business request, or target an external environment without explicit user approval.
- Do not expose credentials, customer data, tokens, or sensitive request bodies in logs or generated artifacts.
