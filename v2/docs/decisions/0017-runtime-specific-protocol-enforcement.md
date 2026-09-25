# Runtime-Specific Protocol Enforcement

## Context

Native runtimes can return subagent input/output that violates the canonical Pulso wire format even when their prompts request it. In OpenCode 1.18.32, native `Task` has no output schema argument, so prompting alone cannot ensure a result is valid before Pulso acts on it.

## Decision

Canonical TaskEnvelope and AgentResult schemas remain host-agnostic and single-source in `@pulso/orchestration`. A host-agnostic `ProtocolEnforcer` reuses those schemas and parsers. A runtime MAY enforce the protocol through a supported public extension surface. OpenCode implements a protocol guard using its public `tool.execute.before` and `tool.execute.after` plugin hooks; the installer bundles and distributes it. VS Code / Copilot remains prompt-level only until a stable supported interception surface is selected.

The guard rejects invalid Pulso Tasks before child execution and invalid AgentResults before OpenCode records Task output as successful. It does not call MCP, mutate Work, route/retry, or replace native Task.

## Consequences

- Schemas and permitted structural repair remain single-source.
- Prompt drift alone cannot bypass OpenCode runtime validation.
- No custom runtime or replacement Task tool is required.
- Runtime-specific hook and installer infrastructure remains isolated from protocol meaning and lower packages.
- VS Code / Copilot currently has no equivalent hard enforcement guarantee.
