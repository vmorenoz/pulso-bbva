# Host Integration

`.mcp.json` is the repository MCP configuration consumed by compatible hosts. It declares a `mcpServers` object whose `pulso` entry has a `command`, `args`, and optional `env`; its process is started with standard input/output as the MCP transport. No agent profiles or host lifecycle integrations are part of this milestone.

The server uses `@modelcontextprotocol/sdk`, specifically its public `McpServer`, `registerTool`, and `StdioServerTransport` exports. No host-private APIs or lifecycle hooks are required.

Clients use the MCP `tools/list` and `tools/call` protocol methods. `tools/list` exposes seven tool names and their JSON Schema input contracts. A `tools/call` request supplies `{ "name": "...", "arguments": { ... } }`. Successful calls return text content containing the JSON representation and equivalent `structuredContent` of `{ "ok": true, "value": ... }`. Domain failures return `isError: true` and `structuredContent` of `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Schema-invalid requests are rejected by the SDK before a tool handler is invoked.
