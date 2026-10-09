---
name: bbva-apx
description: Use when implementing or reviewing confirmed BBVA APX Java/Maven transactions, DTOs, libraries, online flows, or batch jobs.
user-invocable: false
---

# BBVA APX

Use only after confirming an APX deployment unit from its structure, Maven artifacts, or the user.

## Discover The Unit

- Read the target and parent POMs, generated bases, sibling implementations, configuration, and existing tests before choosing a pattern or command.
- Identify the affected transaction/library/DTO or batch job and its callers. Follow the actual framework and dependency versions; an installed skill does not establish which CLI or APIs are available.

## Online Transactions

- Preserve transaction, DTO, and reusable-library structure.
- Follow the established generated abstract transaction base, framework-provided service libraries, request context propagation, advice/severity handling, and HTTP response mapping. Do not replace framework-managed wiring with an unrelated construction pattern.
- Inspect existing transactions and sibling artifacts before changing contracts, DTO fields, or error behavior.
- Trace inputs, library calls, outputs, and error/advice mapping together. Preserve compatible field types and required/optional semantics across consumers; confirm a contract change rather than silently changing one side.

## Batch Jobs

- Preserve reader, processor, writer, tasklet, decider, state, utility, input/output, and test conventions.
- Treat idempotency, restartability, date processing, reconciliation, error behavior, and file semantics as explicit concerns.
- Add or update focused unit and functional coverage as required by the changed behavior and risk. Use the APX testing skill; state which layer was checked and which remains unverified.

## Commands And Safety

- Inspect repository scripts and the installed CLI's help before unfamiliar commands; do not assume a CLI version or a universal command set. Names such as `init`, `add`, `build`, `check`, `start`, `send`, `mvn`, `show`, and `deploy` are discovery hints only, not permission or proof of support.
- Use established Maven/APX validation commands, beginning with the affected artifact. Check the target environment and side effects before running a command.
- Do not deploy, send real business requests, or target external environments without explicit approval.
- Do not expose credentials, customer data, tokens, or sensitive request bodies in logs or artifacts.
