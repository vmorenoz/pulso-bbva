# @pulso/installer

The installer is a separate distribution/host-integration layer. It depends on
the orchestration assets and capabilities MCP entrypoint, but neither lower
layer imports or calls the installer. It does not own Work, leases, execution
bindings, or orchestration policy.

## Interactive multi-runtime setup

From the `v2/` directory, run either npm script:

```sh
npm run install:v2
npm run uninstall:v2
```

Install the workspace dependencies first (`bun install` or `pnpm install`). The npm scripts run the installer with pinned Bun 1.4.2 through `npx`; you can also invoke the CLI directly when Bun is on `PATH`:

```sh
bun run packages/installer/src/cli.ts
```

The terminal wizard asks for:

1. One or both runtimes: VS Code / GitHub Copilot and OpenCode.
2. One shared **Local** or **Global** scope for every selected runtime.
3. OpenCode executable/version/capability/model discovery before its model
   profile selector. VS Code keeps the session's current model behavior.
4. A complete asset/configuration/model preview and explicit confirmation.
5. Apply, validate, and record per-runtime managed manifests.

Menus support Up/Down arrows and Enter. Runtime selection uses Space to toggle,
`a` to select all, and `n` to clear. Custom OpenCode model selection can be
filtered by provider, model ID, or display name. Non-TTY sessions fall back to
numbered/text input.

The installer builds one distributable Capabilities MCP bundle, shared by both
runtimes. VS Code global assets are in `~/.copilot/agents` and
`~/.copilot/skills`; local assets are in the selected workspace `.github/` and
MCP configuration in `.vscode/mcp.json`. Existing global profile discovery and
workspace interpolation are retained.

OpenCode local assets use `.opencode/agents/`, `.opencode/skills/`, and
`.opencode/opencode.json`; global assets use `~/.config/opencode/agents/`,
`skills/`, and `opencode.json`. Configuration is JSONC-patched, preserving
comments and unrelated settings. Profiles save exact discovered `provider/model`
IDs; Inherited omits each agent's `model` field.

If the MCP SDK or Zod cannot be resolved from the installed workspace, the
wizard downloads their pinned versions from the official npm registry into a
temporary directory, bundles the server, and removes the temporary directory.
The dependency step runs after installation confirmation and has a progress
indicator; download/build failures show diagnostics and return to an installer
menu instead of exiting abruptly.

To remove an installation:

```sh
npm run uninstall:v2
```

Uninstall lets you select runtime(s) and scope. It removes only hash-matching
Pulso assets/config entries; edited managed assets conflict and foreign agents,
skills, MCP servers, providers, and persistent Work data are preserved.

The installer does not install OpenCode, read credential files, configure model
credentials/providers, or send telemetry. `opencode auth list` is diagnostic
only; presets derive solely from `opencode models`.
