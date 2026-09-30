# Architecture

`@pulso/working-system` contains host-agnostic domain types, invariants, application services and its SQLite Store implementation. It is the exclusive authority for Work, WorkItem, Assignment, Execution, Lease, Recovery, events, artifacts and dependencies in `work.db`.

Dependency graph: future `@pulso/orchestration` -> MCP -> `@pulso/capabilities-mcp` -> TypeScript -> `@pulso/working-system` -> SQLite. `@pulso/capabilities-mcp` persists only external execution bindings in `runtime-bindings.db`; it never owns Work state. The administrative CLI is an internal app consuming capabilities.

There is one public MCP server and one stdio entrypoint. It exposes work structure tools and runtime binding lifecycle tools. `pulso_work_execution` remains an internal TypeScript capability only; MCP consumers use `bindingId` for heartbeat, completion, failure, cancellation and status. No public package imports VS Code, Copilot, OpenCode or agent code.
