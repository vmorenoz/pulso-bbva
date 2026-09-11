# Pulso

Pulso is an adaptive delivery orchestrator for OpenCode. This project packages its agents, protocol, plugins, tools, control-plane libraries, CLI, and tests as one versionable source of truth.

The default delivery path is deliberately small: Pulso coordinates and delegates directly to Executor. Planner, Challenger, Explorer, Verifier, and auditors are optional capabilities selected only for concrete ambiguity, missing evidence, or risk. Pulso and Executor perform simple file reads and narrow searches themselves; Explorer is reserved for iterative discovery, cross-file traces, or parallel research.

## Requirements

- Node.js 22.5 or newer (`node:sqlite` is used by the experience engine).
- OpenCode with a configured model provider.

## Development

```bash
npm install
npm test
```

Edit Pulso in this repository. Install its runtime files and register its plugins in OpenCode with:

```bash
npm run install:local
```

The installer defaults to `~/.config/opencode`. Set `OPENCODE_CONFIG_DIR` to target another installation. It preserves JSONC formatting and existing configuration, deduplicates plugin entries, and sets Pulso as the default agent. It refuses to overwrite divergent managed files; inspect them first, then use `npm run install:local:force` when replacement is intentional.

Remove only project-managed runtime files whose contents still match this repository and unregister Pulso's plugins with:

```bash
npm run uninstall:local
```

Quit and restart OpenCode after installation because agents, skills, tools, and plugins are loaded at startup.

## Dashboard

Ask Pulso to open the dashboard or run `/pulso-dashboard` inside OpenCode. From this repository, `npm run dashboard` opens the same local view. It shows objective status and duration, token and run totals, per-agent activity, human interventions, repair cycles, verified memories, and profile preferences. Select an objective to inspect its measured timing and agent breakdown.

The dashboard binds only to `127.0.0.1`, uses a temporary access token, reads SQLite without modifying it, and stops after 30 minutes of inactivity or when its Stop server button is pressed.

Run `/pulso-doctor` inside OpenCode for a read-only health check of agents, plugins, tools, local task state, and the experience store.

## OpenCode Configuration

Merge the relevant fields from `opencode.example.jsonc` into the target `opencode.jsonc`. Plugin paths are relative to that configuration file. Agent models are examples and can be changed without modifying Pulso's behavior contracts.

## Repository Layout

- `agents/`: orchestrator and bounded specialists.
- `skills/pulso-protocol/`: shared coordination and state protocol.
- `plugins/`: circuit breaker and experience engine.
- `tools/`: deterministic routing, leases, skill digest, and health check.
- `lib/`: control-plane implementation.
- `bin/`: operator CLI.
- `test/`: control-plane tests.
- `pulso.manifest.json`: files synchronized by the installer.

## Bootstrap

`npm run bootstrap` imports the runtime manifest files from an existing OpenCode installation. Tests and other development-only files remain repository-owned and are never expected in the OpenCode configuration directory. Bootstrap is intended only to initialize or deliberately reconcile this repository. Normal development flows from this project to OpenCode, not the reverse.
