# VS Code Parity Matrix

Baseline captured on 2026-09-21 from `main`: `npm test` passed 118 tests.

| OpenCode capability | VS Code adapter evidence |
| --- | --- |
| Delivery and status | `pulso_delivery`, `pulso_status`, `pulso_reconcile` MCP tools |
| Routing and contracts | `pulso_route`, `pulso_skill_digest`, `pulso_contract` |
| Scope, leases, breaker, Git gate | `vscode/pulso-hook.mjs` on native tool events |
| State and SQLite | Existing control core and experience engine |
| Doctor and delivery status | `pulso_doctor`, `pulso_status` through MCP |
| External CodeGraph | Startup lifecycle only acts after a canonical valid workspace `PULSO.md` (`schema_version: 1`, `artifacts: tracked|untracked`) and then discovers compatible external CodeGraph 1.x, initializes a missing safe index with `--agents=none`, and writes only workspace-local MCP configuration. Missing or invalid Pulso configuration reports `not_initialized_with_pulso`; status and doctor are read-only and native tools remain the fallback. |
| External agent contacts | `/pulso-autointegrate`, `pulso-contact-manager`, and `pulso_agent_contacts` discover and register user/workspace-defined agents. Agent Host built-in agents are intentionally excluded. |
| Unsupported by Agent Host | Model assignment, Agent Host built-in agent discovery, metrics/dashboard. These remain OpenCode-only and are not installed or exposed in VS Code. |
| Installation | Managed Agent Host customizations in `~/.copilot/agents`, `~/.copilot/skills`, `~/.copilot/hooks`, and `~/.copilot/mcp-config.json` |
| OpenCode compatibility zone | `plugins/`, `tools/`, `scripts/install.mjs`, `scripts/sync.mjs`, and shared `lib/` retain runtime behavior; only prompt structure and legacy cleanup changed |

OpenCode prompt changes are structural semantic tags only. Agent permissions and frontmatter remain the compatibility contract.
