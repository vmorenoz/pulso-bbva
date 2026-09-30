# Two-layer infrastructure beneath orchestration

## Decision

Before orchestration, Pulso exposes only two public packages: `@pulso/working-system` and `@pulso/capabilities-mcp`.

## Rules

There is one authoritative Work System, one agent-facing capability boundary and one public MCP server with one stdio entrypoint. `@pulso/capabilities-mcp` calls `@pulso/working-system` through TypeScript application APIs. Neither public package requires a host-specific dependency.

## Consequences

`work.db` is authoritative Work persistence. `runtime-bindings.db` contains only external execution binding metadata. Lease IDs, fencing tokens and internal execution IDs stay behind the runtime binding adapter.

## Future

`@pulso/orchestration` may later own human interaction, agents, specialists, sessions, host lifecycle, delegation and structured agent protocol. It will use the capabilities MCP and will not become a dependency of either package.
