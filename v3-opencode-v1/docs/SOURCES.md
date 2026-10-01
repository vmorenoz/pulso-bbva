# Fuentes oficiales

Referencias para la adaptación OpenCode v1. Consultadas el 2026-10-01; verificar de nuevo antes de cambiar contratos del plugin.

- OpenCode v1 plugin tool API: https://raw.githubusercontent.com/anomalyco/opencode/v1.18.2/packages/plugin/src/tool.ts
- OpenCode v1 plugin hooks: https://raw.githubusercontent.com/anomalyco/opencode/v1.18.2/packages/plugin/src/index.ts
- OpenCode v1 plugin loader: https://raw.githubusercontent.com/anomalyco/opencode/v1.18.2/packages/opencode/src/plugin/index.ts
- Node.js: https://nodejs.org/docs/latest/api/

La documentación v2.0.20 y los tipos `@opencode/plugin` confirman `ctx.tool.transform()`/`editor.add()`. `Tool.Context` contiene `sessionID`; `Session.Info` expone `location.directory`. El handler consulta esa sesión por llamada, no la ubicación de carga global; worktrees/directorios se mantienen como validación live pendiente.
