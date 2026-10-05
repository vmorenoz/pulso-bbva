---
name: bbva-apx-testing
description: Use when creating, changing, or running tests for confirmed BBVA APX transactions, libraries, DTOs, or Spring Batch jobs.
user-invocable: false
---

# BBVA APX Testing

Use only after confirming an APX deployment unit. Inspect its POM, Spring test XML, existing tests, fixtures, and mocks before selecting commands or APIs.

## Online Transactions

- Preserve established JUnit 4, Mockito, Spring Test, Surefire, and JaCoCo conventions when present.
- Where the unit uses them, follow `SpringJUnit4ClassRunner`, its `elara-test.xml` plus transaction test context, autowired transaction setup, and `DummyBundleContext`. These are patterns to confirm in the repository, not dependencies to introduce or reasons to migrate its runner.
- Reuse DTO builders, object mappers, fixtures, and Mockito mocks already used for request headers, requests, and service libraries. Do not create incompatible object shapes just to satisfy a test.
- Follow the existing lifecycle in order: initialize and start the transaction where required, set its context/request, stub libraries at the framework boundary, execute, then assert severity, HTTP outcome, advice, and observable output/state as applicable.
- Cover valid, missing/invalid input, library failure, and advice/error paths relevant to the change. Assert returned behavior as well as critical interactions; a stubbed dependency does not establish a real integration.

## Batch Jobs

- Test readers, processors, writers, tasklets, deciders, utilities, and state classes independently when behavior is local.
- For job or step integration tests, load the existing job/runner contexts and use `JobLauncherTestUtils` when that is the project's pattern. Build explicit `JobParameters` from synthetic test resources, mock the library boundary, launch the job or named step, then assert `ExitStatus`, executed steps, critical interactions, and output semantics.
- Cover normal flow, feature-flag/decider branches, malformed or missing input files, processing failures, writer failures, and retry/error paths relevant to the change. Check restartability and duplicate-processing behavior when those guarantees are affected.
- Keep fixtures in `src/test/resources`; do not use external systems, real host files, real services, or customer data.

## Coverage And Execution

- Read the effective artifact/parent POM configuration: runner, Surefire setup, JaCoCo metric and scope, exclusions, and inherited thresholds. Do not assume a universal coverage ratio.
- Run the narrowest Maven test first, then the required artifact or deployment-unit validation.
- Do not skip tests, bypass JaCoCo, or lower coverage merely to complete work.
- Report the command, selected artifact/tests, result, and environment limits. A build without executed tests, a mocked service, or an unavailable batch environment must not be reported as full functional verification.
