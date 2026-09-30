---
name: bbva-cells
description: Use when working in BBVA CELLS applications, Cells CLI, Lit/LitElement, Cells Bridge, declarative pages, or BBVA Experience web components.
---

# BBVA CELLS

Apply this skill only after confirming the target is a CELLS application from its `package.json`, application structure, or user statement.

- Preserve the repository's existing Lit/LitElement, Cells Bridge, declarative-page, routing, service, theme, scoped-element, and test patterns.
- Reuse existing BBVA Experience or Cells components. Do not introduce React, another UI framework, or an unrelated design system unless explicitly requested.
- Inspect the target application's scripts and configuration before running commands. Do not copy environment assumptions from another CELLS app.
- `cells` CLI version 4.9.3 is available. Use `cells --help` or relevant subcommand help before unfamiliar commands. A common local flow is `cells app:serve -c <environment>.js`.
- Run the project's established lint, test, and build checks before completion.
- For frontend changes connected to APX, trace request/response contracts, UI loading/error states, and automated coverage end-to-end.
- Do not expose credentials, customer data, tokens, or sensitive request bodies in logs or generated artifacts.
