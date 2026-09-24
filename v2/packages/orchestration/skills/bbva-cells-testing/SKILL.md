---
name: bbva-cells-testing
description: BBVA CELLS Vitest, Open Web Components, fixtures, browser setup, and frontend test guidance.
user-invocable: false
---

# BBVA CELLS Testing

Use only after confirming a CELLS application. Inspect `package.json`, test configuration, existing tests, and setup files before selecting an API or command.

## Placement And Runner

- Follow the existing layout, commonly `test/unit/<subject>.test.js` for applications or `test/<component>.test.js` for component packages.
- Do not assume a shared runner. Follow Vitest imports and style where used, or the existing `@open-wc/testing` fixture style where used.
- Use project-defined commands instead of inventing `npm test`, `vitest`, or `web-test-runner` invocations.

## Component And Page Tests

- Load the target element after required setup. For page behavior, create elements with `document.createElement` and only stub framework methods as existing tests do.
- For render-oriented components, use existing fixture helpers and await `updateComplete` after reactive changes.
- Reuse fixtures, mocks, and helpers. Inputs must be synthetic and must not call real service endpoints.
- Test observable defaults, state transitions, payload mapping, published data, navigation intent, validation boundaries, fallback/error branches, and asynchronous outcomes.
- Stub services at the component boundary and assert calls, arguments, state, and visible behavior where local patterns do so.

## Browser Setup And Completion

- Reuse setup before adding browser workarounds. Any necessary patch must be local, idempotent, and justified by a reproducing test.
- Run the narrowest relevant test, then the repository suite when practical. Do not weaken assertions merely to pass.
