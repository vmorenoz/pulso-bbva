---
name: bbva-cells
description: Use when implementing or reviewing confirmed BBVA CELLS applications, Lit components, Cells Bridge, declarative pages, or BBVA Experience components.
user-invocable: false
---

# BBVA CELLS

Use only after confirming a CELLS application from `package.json`, application structure, or the user.

## Discover And Preserve The Application

- Preserve existing Lit/LitElement, Cells Bridge, declarative page, routing, service, theme, scoped-element, and test patterns.
- Inspect manifests, installed versions, page/component registration, sibling implementations, and configuration before choosing APIs or changing a pattern.
- Reuse existing BBVA Experience or Cells components. Do not introduce React, another UI framework, or an unrelated design system unless explicitly requested.
- Trace the affected page/component through its service/data manager, subscriptions, publications, and navigation. Preserve payload contracts and state ownership; follow the project's lifecycle and cleanup conventions.

## Commands, Validation, And Safety

- Inspect target scripts and configuration before running commands; do not copy assumptions from another CELLS application.
- Inspect the installed `cells --help` or relevant subcommand help before unfamiliar CLI commands; do not assume a fixed CLI version. `cells app:serve -c <environment>.js` is a possible local flow only when supported by this project and its selected configuration.
- Run established lint, test, and build checks.
- For frontend changes connected to APX, trace contracts, loading/error states, and automated coverage end to end.
- Use the CELLS testing skill for changed behavior. Verify loading, empty, success, and error states relevant to the flow; do not replace a real contract check with an unrelated green test.
- Do not expose credentials, customer data, tokens, or sensitive request bodies in logs or artifacts.
