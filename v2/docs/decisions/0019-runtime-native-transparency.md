# Runtime-native transparency and concise Pulso UX

## Context

OpenCode displays MCP calls with a prefix for its configured MCP server. Registering tool names that already included `pulso_` produced a duplicated visible prefix, while full state and large Zod issue lists added noise to ordinary interactions. Both OpenCode and VS Code provide native ways to control how much tool/subagent detail users see.

## Decision

Register short capability tool IDs (`work_create`, `runtime_bind`, etc.) under the single server name `pulso`; OpenCode then displays one `pulso_` prefix. Keep full Work/history views opt-in and return compact success summaries by default. Protocol errors preserve their detailed causes internally but present a bounded summary to the agent. Pulso must terminalize a binding on every post-bind exit and should communicate concise outcomes without narrating MCP bookkeeping. Do not patch either runtime UI; document OpenCode's supported `/details` toggle and preserve VS Code's native collapsible subagent view.

## Consequences

- MCP tool IDs are a deliberate breaking rename; restart the host after updating its Pulso MCP server.
- Tool arguments and success responses retain only IDs/status/version needed for the next operation; `work_get(full|events|executions)` remains the explicit diagnostic surface.
- Per-tool hiding, TUI patches and custom VS Code presentation extensions are out of scope.
