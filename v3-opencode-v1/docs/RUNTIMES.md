# Runtime soportado: OpenCode v1

Pulso se distribuye únicamente para OpenCode v1. La instalación no ejecuta ni valida el binario de OpenCode, por lo que no requiere que esté en `PATH`; OpenCode v2 y VS Code no forman parte de esta distribución.

El bootstrap migra integraciones globales OpenCode de Pulso v1/v2/v3 y conserva los recursos de Copilot y VS Code aunque aparezcan en manifests históricos. La versión histórica de Pulso no determina la versión del host. El inventario, la edición JSONC, los respaldos y el rollback se describen en [INSTALLER.md](INSTALLER.md).

## Componentes instalados

| Recurso | Ubicación global |
|---|---|
| Agentes | `~/.config/opencode/agents/` |
| Comandos | `~/.config/opencode/commands/` |
| Skills | `~/.config/opencode/skills/` |
| Plugin de tools | `~/.config/opencode/plugins/pulso/` |
| Core, schemas, plantillas y docs | `~/.pulso/` |

El plugin registra custom tools mediante el mapa `tool` nativo. Las delegaciones usan la herramienta nativa `task`; no se inicia runtime Pulso, daemon, scheduler ni subproceso de agente.

## Tools

`pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`. Cada una devuelve título y resultado breve; los JSON canónicos no se muestran en la conversación.

El nombre del agente determina su ID. Pulso tiene modo `primary`; especialistas, `subagent`. Los frontmatter usan `permissions` v2 y deniegan a especialistas las tools de metadata Pulso y la delegación anidada. Las políticas del host siguen siendo autoridad; revisar permisos efectivos y ownership en una sesión live.

## Raíz del proyecto

Cada ejecución toma el `sessionID` del contexto nativo de la tool y consulta esa sesión con `ctx.session.get()`, usando `session.location.directory`; no captura la raíz al cargar el plugin. Ninguna tool acepta `root` desde el modelo. La semántica exacta debe validarse en sesión OpenCode v1 real, particularmente worktrees y directorios anidados; no se afirma aquí aceptación live.

## Compatibilidad y evidencia

La composición estática y las pruebas offline validan estructura, schemas y gestión de archivos, no la calidad de respuestas del modelo, el render final de TUI ni la carga real de plugins. Criterios live están en `REAL-SCENARIOS.md` y se mantienen `NOT_RUN` hasta una prueba observada.
