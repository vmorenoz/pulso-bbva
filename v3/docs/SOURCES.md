# Fuentes oficiales

Referencias para la adaptación OpenCode v2. Consultadas el 2026-09-30; verificar de nuevo antes de cambiar contratos del plugin.

- OpenCode v2 plugins: https://opencode.ai/v2/docs/build/plugins
- OpenCode v2 custom tools: https://opencode.ai/v2/docs/build/plugins
- OpenCode v2 agents: https://opencode.ai/v2/docs/agents
- OpenCode v2 permissions: https://opencode.ai/v2/docs/permissions
- OpenCode v2 skills: https://opencode.ai/v2/docs/skills
- OpenCode v2 commands: https://opencode.ai/v2/docs/commands
- Node.js: https://nodejs.org/docs/latest/api/

La documentación v2.0.20 y los tipos `@opencode/plugin` confirman `ctx.tool.transform()`/`editor.add()`. `Tool.Context` contiene `sessionID`; `Session.Info` expone `location.directory`. El handler consulta esa sesión por llamada, no la ubicación de carga global; worktrees/directorios se mantienen como validación live pendiente.
