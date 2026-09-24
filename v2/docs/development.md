# Development

Use Bun workspaces. Run `bun install`, `bun run typecheck`, `bun run lint`, `bun test`, `bun run test:mcp`, `bun run test:integration`, `bun run test:e2e`, and `bun run build`. Tests use temporary SQLite databases and synthetic data only.

PNPM support is provided for local static validation through `pnpm-workspace.yaml`; it mirrors the Bun workspace globs. Run `pnpm install`, `pnpm run typecheck`, and `pnpm exec biome check .` when Bun is unavailable. Runtime tests and builds still require Bun because SQLite uses Bun's built-in `bun:sqlite` API.
