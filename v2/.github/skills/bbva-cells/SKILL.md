---
name: bbva-cells
description: BBVA CELLS, Lit, Cells Bridge, declarative-page, and BBVA Experience component guidance.
user-invocable: false
---

# BBVA CELLS

Use only after confirming a CELLS application from `package.json`, application structure, or the user.

- Preserve existing Lit/LitElement, Cells Bridge, declarative page, routing, service, theme, scoped-element, and test patterns.
- Reuse existing BBVA Experience or Cells components. Do not introduce another UI framework or unrelated design system unless explicitly requested.
- Inspect target scripts and configuration before running commands; do not copy assumptions from another CELLS application.
- Inspect `cells --help` or relevant subcommand help before unfamiliar CLI commands. A common local flow is `cells app:serve -c <environment>.js`.
- Run established lint, test, and build checks.
- For frontend changes connected to APX, trace contracts, loading/error states, and automated coverage end to end.
- Do not expose credentials, customer data, tokens, or sensitive request bodies in logs or artifacts.
