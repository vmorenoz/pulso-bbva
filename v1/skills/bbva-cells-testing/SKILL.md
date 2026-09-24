---
name: bbva-cells-testing
description: Use when creating, changing, or running tests in BBVA CELLS applications using Lit components, Cells pages, Vitest, or Open Web Components.
---

# BBVA CELLS Testing

Use this skill only after confirming the target is a CELLS application. Inspect the target repository's `package.json`, test configuration, existing tests, and setup files before selecting a test API or command.

## Test Placement And Runner

- Follow the application's existing test layout. Current CELLS applications commonly use `test/unit/<subject>.test.js`; component packages can use a root `test/<component>.test.js` layout.
- Do not assume one runner across CELLS repositories.
- When the repository uses Vitest, follow its imports and test style, such as `describe`, `test`, and `beforeEach` from `vitest`.
- When the repository uses Open Web Components, follow its `@open-wc/testing` style, such as `fixture`, `html`, `assert`, `fixtureCleanup`, `suite`, `setup`, and `teardown`.
- Use the project-defined command. Inspect scripts and test configuration rather than inventing `npm test`, `vitest`, or `web-test-runner` commands.

## Component And Page Tests

- Import the target custom element or page under test after any required setup module.
- For page state and business behavior, create the element with `document.createElement`, stub framework methods such as `subscribe`, `unsubscribe`, `publish`, and `navigate` only when the existing tests use that approach, and reset global/context/flow/session state in `beforeEach`.
- For render-oriented components, use the repository's fixture helper and await `updateComplete` after setting reactive properties or invoking rendering behavior.
- Reuse existing fixture data, mocks, and test helpers. Keep test inputs synthetic and do not use customer data or real service endpoints.
- Test observable behavior: defaults, state transitions, request payload mapping, emitted/published data, navigation intent, validation boundaries, fallback/error branches, and asynchronous service results.
- Stub service/data-manager calls at the component boundary. Assert calls, input arguments, state updates, and the resulting user-visible behavior where the local suite does so.

## Browser Compatibility Setup

- Reuse the repository's setup file before adding new browser workarounds. Some suites patch custom-element registration, scoped shadow roots, `window.location`, app configuration, locale requests, timers, and storage for headless CI.
- Do not add global patches unless a reproducing test requires one. Make any new patch idempotent and local to the test setup.

## Completion

- Run the narrowest relevant test first, then the repository's appropriate suite if practical.
- Do not weaken assertions merely to make a test pass. Update the implementation only when the required behavior is clear and in scope.
