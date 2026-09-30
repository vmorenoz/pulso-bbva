# VS Code / GitHub Copilot Runtime

The renderer creates `.agent.md` files from canonical `AgentDefinition`s. It uses the documented custom-agent fields: tools allowlist, `agents` for Pulso's permitted native subagents, `user-invocable: false` for specialists, and `disable-model-invocation: false`. The same schema-derived `communication_protocol` is rendered for both VS Code and OpenCode; host markup/permissions differ, contract meaning does not.

VS Code/Copilot receives TaskEnvelope v2 through its native subagent mechanism and should return AgentResult v2. This renderer remains prompt-only: no preview/experimental hooks are required or used for hard enforcement. VS Code's native subagent presentation is collapsible. Pulso uses the single MCP lifecycle boundary; specialists do not receive lifecycle MCP tools.

Official references: [custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents), [subagents](https://code.visualstudio.com/docs/agents/run/subagents), and [MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers). The host exposes native tools in its own UI; Pulso does not add an extension to hide or restyle them.
