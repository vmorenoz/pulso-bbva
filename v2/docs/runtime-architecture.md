# Runtime Architecture

Pulso v2 keeps the dependency direction and authority boundary intact:

```text
@pulso/orchestration → MCP → @pulso/capabilities-mcp → @pulso/working-system
```

Pulso and the native agent runtime (VS Code/Copilot or OpenCode) perform reasoning and native subagent invocation. `@pulso/orchestration` supplies host-neutral protocol, compact context construction, identity correlation, lifecycle mapping, and installation tooling; it is not a subagent runtime. `@pulso/capabilities-mcp` is the sole lower operational boundary, while `@pulso/working-system` remains authoritative truth.

`@pulso/orchestration/src/agents/definitions.ts` is the canonical static source for Pulso and specialist roles, boundaries, tool policy, and task guidance. `src/protocol/schemas.ts` is the single authority for `pulso-task/2`, `pulso-result/2`, Evidence, and all discriminated specialist payloads. Prompt instructions and examples are generated from those schemas. `SpecialistPromptAssembler` reuses the Task builder/serializer for programmatic consumers; native runtimes still let Pulso's model formulate tool arguments, so this library is not a claim of deterministic per-call assembly. The `RuntimeDefinition` interface has no filesystem or discovery operations; renderers own host syntax only.

The static specialist prompt is rendered from the canonical agent definition, SpecialistTaskContract, and schema-derived ResultContract by both `vscode-copilot` and `opencode`; model assignment is renderer metadata. Dynamic TaskEnvelope fields are assembled by the programmatic assembler/coordinator path. In native host sessions, Pulso's LLM still supplies tool-call arguments, so this library is not claimed to execute on each delegation. Skills are read from canonical assets and passed through both renderers unchanged.

Runtime ids are `vscode-copilot` and `opencode`. Install scope is selected once (`local` or `global`) and applies to every chosen runtime. Discovery uses executable invocations with argv arrays and timeouts; it is never part of orchestration.

## Delegation policy

Pulso re-evaluates evidence at every meaningful point. It may act directly only when work is unequivocal, tiny, low risk, and does not benefit from isolated context, specialization, or independent review. Otherwise it chooses only the specialists that add material value. No category, score, route, or sequence forces planning, execution, verification, or security review.

## Shared background skills

Migrated background skills are `bbva-engineering`, `bbva-apx`, `bbva-apx-testing`, `bbva-cells`, `bbva-cells-testing`, and `integration-verification`. They contain reusable technology and verification guidance only. They do not contain legacy control-plane, session lease, host-specific, or routing instructions.

## Prompt size proxy

UTF-8 byte lengths (a reproducible size proxy, not a token count) for the six installed OpenCode agent prompts were **15,438 bytes before** and **15,987 bytes after** this change (**+3.6%** aggregate). Pulso's static instructions grow to include lifecycle closure and the specialist roster; individual specialist prompts stay near their former size. A same-data TaskEnvelope fixture measured **574 bytes before and after**; its wire structure is unchanged apart from `/2` version values. Dynamic prompts still contain only the objective and minimal context supplied for that delegation.

The installer distributes the canonical renderer output, MCP bundle, and managed OpenCode guard. Canonical schema/parser/serializer/validation feed the host-agnostic `ProtocolEnforcer`; the OpenCode plugin applies it through public hooks. VS Code/Copilot uses documented `.agent.md` custom agents and native subagent calls; no preview hooks are required. Working System remains authoritative for Work state and Capabilities MCP remains the sole lifecycle boundary.
