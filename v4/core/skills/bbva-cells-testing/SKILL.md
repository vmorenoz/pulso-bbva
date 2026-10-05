---
name: bbva-cells-testing
description: Use when creating, changing, or running tests in confirmed BBVA CELLS applications using Lit, Cells pages, Vitest, or Open Web Components.
user-invocable: false
---

# BBVA CELLS Testing

Use only after confirming a CELLS application. Inspect `package.json`, test configuration, existing tests, and setup files before selecting an API or command.

## Placement And Runner

- Follow the existing layout, commonly `test/unit/<subject>.test.js` for applications or `test/<component>.test.js` for component packages.
- Do not assume a shared runner. In a Vitest suite, follow its existing `describe`, `test`, and `beforeEach` imports and lifecycle. In an Open Web Components suite, reuse its `@open-wc/testing` helpers such as `fixture`, `html`, `assert`, and `fixtureCleanup`, where present; follow that suite's actual `suite`/`setup`/`teardown` or other runner conventions. Do not mix APIs or introduce a different runner.
- Use project-defined commands instead of inventing `npm test`, `vitest`, or `web-test-runner` invocations.

## Component And Page Tests

- Import the target custom element or page after required setup. For page state/business behavior, create elements with `document.createElement` when the existing suite does so.
- Stub framework methods such as `subscribe`, `unsubscribe`, `publish`, and `navigate` only where the repository uses that approach. Check relevant payloads, published events, navigation intent, and subscription cleanup rather than only asserting that a method was called.
- Reset global/context/flow/session state before each test using the runner's existing lifecycle (for example `beforeEach` or `setup`). Restore mocks, timers, storage, listeners, and fixtures in the matching cleanup where the test changes them. Avoid test-order dependence or state leaking between cases.
- For render-oriented components, use existing fixture helpers and await `updateComplete` after reactive changes.
- Reuse fixtures, mocks, and helpers. Inputs must be synthetic and must not call real service endpoints.
- Test observable defaults, state transitions, payload mapping, published data, navigation intent, validation boundaries, fallback/error branches, and asynchronous outcomes.
- Stub services at the component boundary and assert calls, arguments, state, and visible behavior where local patterns do so.

## Browser Compatibility Setup

- Reuse the repository's setup before adding browser workarounds. When diagnosing headless failures, inspect existing handling for custom-element registration, scoped shadow roots, `window.location`, app configuration, locale requests, timers, and storage. This is a diagnostic checklist, not a list of patches to add by default.
- Add a patch only when a reproducing test needs it; keep it local to test setup and idempotent. Restore mutable test state and do not hide a product defect with a global workaround.

## Completion

- Run the narrowest relevant test, then the repository suite when practical. Do not weaken assertions merely to pass.
- Report the actual runner, command, outcome, and unexecuted checks. A mock verifies behavior at that boundary, not a real service connection or full browser journey.
- If a test exposes a product defect, identify the required behavior and authorized implementation scope before changing production code; a testing-only assignment does not authorize that change.
