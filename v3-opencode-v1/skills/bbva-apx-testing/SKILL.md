---
name: bbva-apx-testing
description: BBVA APX JUnit, Mockito, Spring Batch, Surefire, and JaCoCo testing guidance.
user-invocable: false
---

# BBVA APX Testing

Use only after confirming an APX deployment unit. Inspect its POM, Spring test XML, existing tests, fixtures, and mocks before selecting commands or APIs.

## Online Transactions

- Preserve established JUnit 4, Mockito, Spring Test, Surefire, and JaCoCo conventions when present.
- Reuse transaction contexts, autowired transaction setup, `DummyBundleContext`, DTO builders, mocks, object mappers, and fixtures already used by the unit.
- Set transaction context/request, stub service libraries at the framework boundary, execute the transaction, and assert severity, HTTP outcome, advice, and observable state as applicable.

## Batch Jobs

- Test readers, processors, writers, tasklets, deciders, utilities, and state classes independently when behavior is local.
- For job or step tests, follow the existing Spring Batch setup with contexts, `JobLauncherTestUtils`, explicit `JobParameters`, mocked libraries, and assertions on `ExitStatus`, steps, and critical interactions.
- Cover normal and decider flows, malformed or missing input, processing/writer failures, retry paths, and output semantics relevant to the change.
- Keep fixtures in `src/test/resources`; do not use external systems, real host files, real services, or customer data.

## Coverage And Execution

- Respect POM configuration, including Surefire and JaCoCo thresholds where configured.
- Run the narrowest Maven test first, then the required artifact or deployment-unit validation.
- Do not skip tests, bypass JaCoCo, or lower coverage merely to complete work.
