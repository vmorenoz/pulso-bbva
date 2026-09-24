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
- A subsequent Pulso native-task smoke invoked Planner, Explorer, Executor, Verifier, and Security Auditor with fresh Work bindings; each subagent ran and returned through the Pulso result/completion path. Invalid raw-marker results from an earlier deliberate protocol-negative check were rejected by Pulso.
- `opencode run --agent <specialist>` is not a direct subagent invocation; the CLI warns and falls back to its default primary. Native calls through Pulso's `task` capability are the supported delegation route and were exercised in the smoke.

## Canonical task/result protocol

OpenCode agent prompts insert `renderAgentProtocolInstructions` output generated from the canonical Zod protocol schemas. The native runtime contract identifies provider `opencode`, requires `externalExecutionId === delegationId`, and places the serialized TaskEnvelope in the native Task prompt. Specialist result fields, identity, status values, and lifecycle mapping come from the same protocol source; no manual `responseFormat` schema is rendered.

OpenCode 1.18.32's native Task parameters are `description`, `prompt`, and `subagent_type`, with optional `task_id`, `command`, and `background`; there is no output-schema parameter. The Task implementation calls the child prompt and returns child text. `client.session.prompt({ body: { format: { type: "json_schema", schema } } })` is a separate SDK/API request and cannot be passed through native Task. The protocol contract is therefore prompt-enforced, not a hard runtime gate. A real local smoke with freshly rendered, manifest-matching assets and `openai/gpt-6-luna` still produced a plain-JSON Task prompt with root-level `workId`/`workItemId` and no `specialist` or `output.contract`; Explorer returned a plain-JSON result with no top-level `specialist` and an `explorer` object instead of the required `specialistResult.kind`. Pulso then called `pulso_runtime_complete` with a prose summary. The canonical parser rejects that result, but native Task is not wired to call the TypeScript coordinator, so the prompt alone cannot guarantee that the model will not bypass validation. See the versioned [Task implementation](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/opencode/src/tool/task.ts) and the separate [SDK structured-output API](https://opencode.ai/docs/sdk#structured-output).

MCP is registered as the single `mcp.pulso` local server with the same bundled Capabilities MCP executable used by VS Code. Existing JSONC is patched with `jsonc-parser` edits so user comments, providers, MCP entries, and unrelated settings survive. A managed manifest records only managed file/config hashes, detected version, profile, and exact model IDs.

Agent Markdown permissions are generated from canonical capability profiles using OpenCode's `permission` rules. MCP tools use OpenCode's documented wildcard matching against underlying tool names; Pulso permits only its `pulso_*` tool namespace. Pulso is primary and may use OpenCode's native task/subagent capability only for its canonical specialists. The five specialists are subagents and deny task delegation. Inherited assignment omits `model`; it never emits `model: inherit`.
