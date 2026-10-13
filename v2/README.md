# Pulso

Portable, local-first work infrastructure. `@pulso/working-system` is the authoritative Work System; `@pulso/capabilities-mcp` is its single external MCP capability facade. Neither package is an agent runtime or a VS Code extension.

Run `bun install`, then `bun run typecheck`, `bun test`, and `bun run build`. The sole MCP server starts with `bun run packages/capabilities-mcp/src/mcp/stdio.ts`; the administrative CLI is `bun run apps/cli/src/index.ts work list`.

Agent definitions, specialist contracts and runtime renderers live in `@pulso/orchestration`; `@pulso/installer` discovers and installs `vscode-copilot` and `opencode` in local or global scope. See [specialist contracts](docs/specialist-contracts.md), [runtime architecture](docs/runtime-architecture.md), [OpenCode runtime](docs/runtime-opencode.md), [VS Code runtime](docs/runtime-vscode.md), [installer guide](packages/installer/README.md), [OpenCode model profiles](docs/opencode-model-profiles.md), and [architecture](docs/architecture.md).

Runtime lifecycle tools use only `bindingId` after bind; lease and fencing authority remain internal. Runtime-specific agent files are rendered from one canonical semantic definition; skills remain shared canonical assets.

The Work System and Capabilities MCP intentionally perform no network operation, telemetry, shell execution, or source-code upload. This does not describe the installer: it invokes executables for runtime discovery and bundling and, when MCP SDK or Zod dependencies are unavailable locally, downloads pinned versions from the official npm registry after confirmation. The documented npm launch scripts also use `npx` to run pinned Bun. See the [installer guide](packages/installer/README.md). Operational state lives outside the workspace under the platform application-data directory.

Workspace identity is a SHA-256 prefix of the resolved workspace path. This prevents state files entering repositories and makes symlink aliases converge, but moving or copying a checkout intentionally creates a separate identity.
