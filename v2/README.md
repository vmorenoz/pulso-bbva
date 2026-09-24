# Pulso

Portable, local-first work infrastructure. `@pulso/working-system` is the authoritative Work System; `@pulso/capabilities-mcp` is its single external MCP capability facade. Neither package is an agent runtime or a VS Code extension.

Run `bun install`, then `bun run typecheck`, `bun test`, and `bun run build`. The sole MCP server starts with `bun run packages/capabilities-mcp/src/mcp/stdio.ts`; the administrative CLI is `bun run apps/cli/src/index.ts work list`.

See `docs/architecture.md` and `docs/host-integration.md`.

Future `@pulso/orchestration` is intentionally deferred. It will use MCP to call `@pulso/capabilities-mcp`, which uses the `@pulso/working-system` TypeScript API. Runtime lifecycle tools use only `bindingId` after bind; lease and fencing authority remain internal.

The implementation intentionally performs no network operation, telemetry, shell execution, or source-code upload. Operational state lives outside the workspace under the platform application-data directory.

Workspace identity is a SHA-256 prefix of the resolved workspace path. This prevents state files entering repositories and makes symlink aliases converge, but moving or copying a checkout intentionally creates a separate identity.
