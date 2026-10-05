---
name: bbva-apx
description: BBVA APX Java, Maven, transaction, DTO, library, online-flow, and batch-job guidance.
user-invocable: false
---

# BBVA APX

Use only after confirming an APX deployment unit from its structure, Maven artifacts, or the user.

## Online Transactions

- Preserve transaction, DTO, and reusable-library structure.
- Follow the established generated transaction base, framework-provided service libraries, request context propagation, advice/severity handling, and HTTP response mapping.
- Inspect existing transactions and sibling artifacts before changing contracts, DTO fields, or error behavior.

## Batch Jobs

- Preserve reader, processor, writer, tasklet, decider, state, utility, input/output, and test conventions.
- Treat idempotency, restartability, date processing, reconciliation, error behavior, and file semantics as explicit concerns.
- Add focused unit or functional coverage for changed behavior.

## Commands And Safety

- Inspect `apx <command> --help` before unfamiliar commands and use existing Maven/APX validation conventions.
- Do not deploy, send real business requests, or target external environments without explicit approval.
- Do not expose credentials, customer data, tokens, or sensitive request bodies in logs or artifacts.
