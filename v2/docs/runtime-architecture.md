# Runtime Architecture

Pulso v2 keeps the dependency direction and authority boundary intact:

```text
@pulso/installer → @pulso/orchestration → @pulso/capabilities-mcp → @pulso/working-system
```

`@pulso/orchestration/src/agents/definitions.ts` is the single semantic source for Pulso and its five specialists. It owns role, non-protocol prompt sections, capability profiles, delegation roster, and skill IDs. `src/protocol/schemas.ts` is the only source for TaskEnvelope/AgentResult contracts, and `renderAgentProtocolInstructions` inserts compact schema-derived instructions into agent prompts. The `RuntimeDefinition` interface in `src/runtimes/types.ts` has no filesystem or discovery operations. Runtime renderers add frontmatter, permissions, runtime contract, and config artifacts. The installer owns discovery, scope, planning, mutation, manifests, and uninstall.

The semantic body is rendered from `StructuredPromptDefinition` by both `vscode-copilot` and `opencode`; model assignment is renderer metadata and does not change the prompt. Skills are read from the canonical `packages/orchestration/skills` assets and passed through both renderers unchanged.

Runtime ids are `vscode-copilot` and `opencode`. Install scope is selected once (`local` or `global`) and applies to every chosen runtime. Discovery uses executable invocations with argv arrays and timeouts; it is never part of orchestration.

The lower packages retain their existing concepts: Working System owns Work state; Capabilities MCP is the only capabilities boundary; orchestration keeps dynamic Pulso-only delegation and the pulso-task/1 / pulso-result/1 protocol.
