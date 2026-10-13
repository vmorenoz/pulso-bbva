# Fuentes oficiales

Referencias para la adaptación OpenCode v1. Consultadas el 2026-10-01; verificar de nuevo antes de cambiar contratos del plugin.

- OpenCode v1 plugin tool API: https://raw.githubusercontent.com/anomalyco/opencode/v1.18.2/packages/plugin/src/tool.ts
- OpenCode v1 plugin hooks: https://raw.githubusercontent.com/anomalyco/opencode/v1.18.2/packages/plugin/src/index.ts
- OpenCode v1 plugin loader: https://raw.githubusercontent.com/anomalyco/opencode/v1.18.2/packages/opencode/src/plugin/index.ts
- Node.js: https://nodejs.org/docs/latest/api/

La implementación de esta distribución en `plugins/opencode-v1/index.mjs` importa `tool` de `@opencode-ai/plugin` y Zod, y devuelve el mapa nativo `tool` con cuatro entradas. Los handlers usan `context.directory` y solicitan aprobación mediante `context.ask`; los hooks de observación usan el `directory` de inicialización. `lib/composition.mjs` emite `permission` singular, delegación `task` y comandos con `subtask: false`. Worktrees, directorios y permisos efectivos se mantienen como validación live pendiente; las referencias de consulta no constituyen aceptación del host.
