# Runtime soportado: OpenCode v2

Pulso se distribuye únicamente para OpenCode v2. La instalación exige una versión major 2 detectable en `PATH`; OpenCode v1 se rechaza. VS Code no forma parte de esta distribución hasta disponer de un adaptador propio de tools.

## Componentes instalados

| Recurso | Ubicación global |
|---|---|
| Agentes | `~/.config/opencode/agents/` |
| Comandos | `~/.config/opencode/commands/` |
| Skills | `~/.config/opencode/skills/` |
| Plugin de tools | `~/.config/opencode/plugins/pulso/` |
| Core, schemas, plantillas y docs | `~/.pulso/` |

El plugin registra custom tools mediante `ctx.tool.transform()`/`editor.add()`. Las delegaciones usan el agente nativo `subagent`; no se inicia runtime Pulso, daemon, scheduler ni subproceso de agente.

## Tools

`pulso_workspace_prepare`, `pulso_status`, `pulso_work_get`, `pulso_work_create`, `pulso_work_apply`, `pulso_work_close`, `pulso_work_reopen`, `pulso_history`, `pulso_work_validate` y `pulso_project_complete_map`.

El nombre del agente determina su ID. Pulso tiene modo `primary`; especialistas, `subagent`. Los frontmatter usan `permissions` v2 y deniegan a especialistas las tools de metadata Pulso y la delegación anidada. Las políticas del host siguen siendo autoridad; revisar permisos efectivos y ownership en una sesión live.

## Raíz del proyecto

Cada ejecución toma el `sessionID` del contexto nativo de la tool y consulta esa sesión con `ctx.session.get()`, usando `session.location.directory`; no captura la raíz al cargar el plugin. Ninguna tool acepta `root` desde el modelo. La semántica exacta debe validarse en sesión v2 real, particularmente worktrees y directorios anidados; no se afirma aquí aceptación live.

## Compatibilidad y evidencia

La composición estática y las pruebas offline validan estructura, schemas y gestión de archivos, no la calidad de respuestas del modelo, el render final de TUI ni la carga real de plugins. Criterios live están en `REAL-SCENARIOS.md` y se mantienen `NOT_RUN` hasta una prueba observada.
