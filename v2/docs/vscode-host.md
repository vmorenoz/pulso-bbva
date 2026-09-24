# VS Code Host

The installer renders canonical agent definitions to `.github/agents/*.agent.md` and copies canonical skills to `.github/skills`. A `.github/.pulso-installer.json` manifest stores hashes of managed files and identifies the `vscode-copilot` runtime and scope. Existing unmanaged or user-modified files, and a conflicting `pulso` MCP entry, produce `CONFLICT` rather than being overwritten. Existing foreign MCP servers are preserved.

The installed `pulso` server runs the distributable `pulso-capabilities-mcp` bin, not a source-tree path in the consumer workspace. It uses documented custom-agent frontmatter, workspace skill locations, portable MCP configuration, and stateless native subagents. VS Code owns specialist invocation; no private host API is required. A temporary workspace smoke installed six agents, six skills, the `pulso` MCP entry, and a manifest; all were read back before uninstall.
