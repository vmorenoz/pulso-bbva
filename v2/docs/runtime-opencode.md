# OpenCode Runtime

The renderer targets the documented OpenCode Markdown agent format: frontmatter `mode: primary|subagent`, optional exact `model: provider/model`, `description`, and current `permission` tool policy; semantic instructions are the Markdown body. OpenCode project assets use `.opencode/agents/`, `.opencode/skills/`, and `.opencode/opencode.json`. Global assets use `~/.config/opencode/agents/`, `skills/`, and `opencode.json`.

The installer probes the executable in `PATH`, runs `--version`, and checks `agent`, `agent create --help`, `models --help`, `mcp --help`, and `debug skill --help`. It gets models only from `opencode models` (optionally `--refresh`). `opencode auth list` is diagnostic only; Pulso never reads OpenCode credential files or configures providers.

## Manual smoke observed in the development environment

- `opencode --version` returned `1.18.32`; help for `agent`, `agent create`, `models`, `mcp`, `debug config`, and `debug skill` was checked.
- `opencode models` reported OpenAI Luna/Terra/Sol IDs and no GitHub Copilot provider models. The Balanced profile resolved to exact catalog entries; no IDs were synthesized.
- `opencode auth list` was run for diagnostics only. It reported provider labels; no credential file was read or recorded.
- A temporary local workspace was installed from canonical sources: six agents, six skills, MCP config, and manifest. `opencode debug config`, `opencode debug agent pulso`, `opencode debug agent executor`, and `opencode debug skill` recognized the generated assets.
- `opencode mcp list` showed Pulso connected. Existing globally configured MCP services remained present and untouched.
- Reconfigured only managed agent assets to Balanced, then `debug agent` resolved Pulso to `openai/gpt-5.6-terra` and Executor to `openai/gpt-6-luna`; the MCP config and skills were not reinstalled by the reconfiguration service.
- `opencode run --agent pulso --model openai/gpt-5.6-terra` returned `PULSO_OK` without tool calls.
- Earlier `/1` model smoke output motivated the runtime guard; it is historical evidence and is superseded by the `/2` validation below.
- `opencode run --agent <specialist>` is not a direct subagent invocation; the CLI warns and falls back to its default primary. Native calls through Pulso's `task` capability are the supported delegation route and were exercised in the smoke.

## Canonical task/result protocol

OpenCode agent prompts insert the same schema-derived Task/ResultContract instructions as VS Code. The primary agent calls native `task`, identifies provider `opencode`, and uses `externalExecutionId === delegationId`. Specialist semantics are host-neutral; frontmatter, permissions and native transport are OpenCode-specific.

OpenCode native Task has no output-schema parameter, so installation includes `.opencode/plugins/pulso-protocol-guard.js` (global: `~/.config/opencode/plugins/pulso-protocol-guard.js`). Public `tool.execute.before` / `tool.execute.after` hooks use `sessionID + callID`; BEFORE checks the TaskEnvelope and selector before child execution; AFTER checks the returned protocol result before accepting the Task. Unmarked Tasks pass through. Correlation is ephemeral and cleared/expired. The guard does not call MCP, mutate Work, route, or retry. Protocol failure is returned as a short error (up to three issue summaries); detailed causes remain diagnostic data.

The installer bundles the plugin from orchestration's canonical schema/parser/enforcer source into a self-contained JavaScript asset. Its manifest records the managed path, SHA-256 and guard version; modified assets are reported as conflicts and uninstall removes only manifest-managed files. `opencode debug config` confirms config parsing but does not expose whether local plugins have registered their hooks. OpenCode hooks are versioned API contracts; signatures and control-flow placement were checked against the official v1.18.32 plugin/task implementation and [plugin documentation](https://opencode.ai/docs/plugins).

Protocol verification: OpenCode 1.18.32 has been exercised with invalid Task, invalid result, and valid Explorer delegation cases under a local deterministic provider fixture. For failure cases Pulso must call `runtime_fail`; native hook rejection itself deliberately does not mutate Work. A real-provider Explorer smoke is required separately before claiming real-model compliance.

For a less detailed conversation view, OpenCode documents `/details` to toggle tool execution details. Pulso does not alter terminal UI visibility. There is no SDK orchestration runtime or Task replacement.

MCP is registered as the single `mcp.pulso` local server with the same bundled Capabilities MCP executable used by VS Code. Existing JSONC is patched with `jsonc-parser` edits so user comments, providers, MCP entries, and unrelated settings survive. A managed manifest records only managed file/config hashes, detected version, profile, and exact model IDs.

Agent Markdown permissions are generated from canonical capability profiles using OpenCode's `permission` rules. Since OpenCode prefixes MCP tool names with the configured server name, MCP registers short tool IDs (`work_create`, `runtime_bind`, etc.); OpenCode displays one `pulso_` prefix. Pulso may call native Task only for canonical specialists. Specialists deny task delegation. Inherited assignment omits `model`; it never emits `model: inherit`.
