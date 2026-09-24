# VS Code Host

The workspace installer copies canonical `.agent.md` files to `.github/agents` and skills to `.github/skills`. A `.github/.pulso-orchestration.json` manifest stores hashes of managed files. Existing unmanaged or user-modified files, and a conflicting `pulso` MCP entry, produce `CONFLICT` rather than being overwritten. Existing foreign MCP servers are preserved.

The installed `pulso` server runs the distributable `pulso-capabilities-mcp` bin, not a source-tree path in the consumer workspace. It uses documented custom-agent frontmatter, workspace skill locations, portable MCP configuration, and stateless native subagents. VS Code owns specialist invocation; no private host API is required.
