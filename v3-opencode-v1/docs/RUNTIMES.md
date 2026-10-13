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

`pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`. Las tres tools multiaction reciben `{ "request": { "action": "..." } }`; `pulso_history` recibe filtros directos. Devuelven título y resultado: recibos breves de mutación o datos de consulta, paginados donde corresponde.

El nombre del agente determina su ID. Pulso tiene modo `primary`; especialistas, `subagent`. Los frontmatter usan `permission` singular de v1 y deniegan a especialistas las cuatro tools de metadata Pulso y la delegación anidada mediante `task`. Las políticas del host siguen siendo autoridad; cada tool consulta `context.ask` antes de la operación. Revisar permisos efectivos y ownership en una sesión live.

## Raíz del proyecto

Cada ejecución de una tool usa `context.directory`, proporcionado por OpenCode v1 en esa llamada. Ninguna tool acepta `root` desde el modelo. El observador pasivo de delegaciones usa por separado `directory` recibido al inicializar el plugin. La semántica exacta debe validarse en sesión OpenCode v1 real, particularmente worktrees y directorios anidados; no se afirma aquí aceptación live.

## Compatibilidad y evidencia

La composición estática y las pruebas offline validan estructura, schemas y gestión de archivos, no la calidad de respuestas del modelo, el render final de TUI ni la carga real de plugins. Criterios live están en `REAL-SCENARIOS.md` y se mantienen `NOT_RUN` hasta una prueba observada.
