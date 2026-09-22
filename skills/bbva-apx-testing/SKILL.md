---
name: bbva-apx-testing
description: Use when creating, changing, or running tests in BBVA APX Java/Maven transactions, libraries, DTOs, or Spring Batch jobs.
---

# BBVA APX Testing

Use this skill only after confirming the target is an APX deployment unit. Inspect the target artifact POM, Spring test XML, existing tests, fixtures, and mocks before adding tests or choosing Maven/APX commands.

## Common Stack

- Preserve the repository's JUnit 4, Mockito, Spring Test, Surefire, and JaCoCo conventions when they are present.
- APX online transaction tests commonly use `SpringJUnit4ClassRunner`, the artifact's `elara-test.xml` plus transaction test context, an autowired transaction, `DummyBundleContext`, and Mockito mocks for request headers, requests, and service libraries.
- Initialize and start the transaction as existing tests do, set the transaction context/request, stub the service library at the framework boundary, execute the transaction, and assert severity, HTTP outcome, advice, and externally observable state as applicable.
- Reuse existing DTO builders, mock classes, object mappers, and fixtures instead of creating incompatible test object shapes.

## Batch Jobs

- Unit-test readers, processors, writers, tasklets, deciders, utilities, and state classes independently when behavior is local.
- For job or step integration tests, follow the established Spring Batch pattern: load job/runner contexts, use `JobLauncherTestUtils`, build explicit `JobParameters` from test resources, mock libraries, launch the job or named step, then assert `ExitStatus`, executed steps, and critical library interactions.
- Cover normal flow, feature-flag/decider branches, malformed or missing input files, processing failures, writer failures, retry/error paths, and output semantics relevant to the change.
- Keep fixtures in `src/test/resources` and avoid external systems, real host files, real services, or production-like customer data.

## Coverage And Execution

- Respect the artifact's Maven configuration. Current units use Surefire and JaCoCo, often with a complexity covered-ratio threshold of `0.80` inherited from the deployment unit.
- Run the narrowest affected Maven test first, then the artifact or deployment-unit validation required by its POM and APX workflow.
- Do not bypass JaCoCo, skip tests, or lower coverage thresholds merely to complete a change.
