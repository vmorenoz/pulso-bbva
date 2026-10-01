# Instalador de Pulso

El único comando CLI de Pulso es bootstrap global de OpenCode v1; no administra Work/State/History ni ejecuta operaciones de proyecto. Requiere Node.js 22+; no ejecuta ni valida el binario de OpenCode.

```sh
node install.mjs
node install.mjs --dry-run
node install.mjs uninstall
```

La instalación configura los archivos gestionados de Pulso en el directorio global de OpenCode y `~/.pulso/`. No usa `npm install`, sudo ni modifica credenciales, modelos, MCP o configuración de permisos del usuario. Añade su plugin y `default_agent: "pulso"` a `opencode.jsonc`, preservando el valor anterior para desinstalar.

## Rutas globales

| Recurso | Ubicación |
|---|---|
| Agentes | `~/.config/opencode/agents/` |
| Comandos | `~/.config/opencode/commands/` |
| Skills | `~/.config/opencode/skills/` |
| Plugin | `~/.config/opencode/plugins/pulso/` |
| Core, schemas, plantillas y documentación | `~/.pulso/` |

Se respetan `OPENCODE_CONFIG_DIR` y `XDG_CONFIG_HOME` solo dentro de la carpeta del usuario que el instalador administra. El manifest global registra hashes y ownership. Instalación idéntica es idempotente. Archivos ajenos, editados o con propiedad no demostrable detienen el preflight.

## Migración y datos del proyecto

La actualización acepta el manifest previo conocido solo para retirar o reemplazar archivos que hash y rutas permiten atribuir con seguridad a Pulso. Retira recursos legacy de agentes y skills, VS Code y herramientas de línea de comandos solo si están registrados e intactos. Un archivo modificado aborta; nunca se hace borrado a ciegas.

El primer encargo concreto puede llamar `pulso_workspace_prepare`, que crea `.pulso/state.json`, `history.jsonl`, `work/`, `project.md` y `decisions.md` solo cuando no hay datos existentes. No se recorren otros proyectos. Los datos incompatibles o legacy se conservan y bloquean la preparación.

## Desinstalar

```sh
node install.mjs uninstall
```

Retira recursos globales gestionados por Pulso. No recorre proyectos ni borra sus Work, estado, contexto o historial. Un recurso modificado cancela la desinstalación.
