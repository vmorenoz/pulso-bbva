# Instalador de Pulso

El único comando CLI de Pulso es bootstrap global de OpenCode v2; no administra Work/State/History ni ejecuta operaciones de proyecto. Requiere Node.js 22+ y OpenCode major 2 detectable en `PATH`.

```sh
node install.mjs
node install.mjs --dry-run
node install.mjs uninstall
```

La instalación configura los archivos gestionados de Pulso en el directorio global de OpenCode y `~/.pulso/`. No usa `npm install`, sudo ni modifica `opencode.json(c)`, credenciales, modelos, MCP o configuración de permisos del usuario. Si el ejecutable reporta major 1, se cancela antes de escribir.

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

Esta distribución sustituye las adaptaciones anteriores por OpenCode v2, su plugin de tools y el core semántico. Ya no distribuye CLI de operaciones ni adaptación VS Code.

La actualización acepta el manifest previo conocido solo para retirar o reemplazar archivos que hash y rutas permiten atribuir con seguridad a Pulso. Retira recursos legacy de agentes, comandos y skills, VS Code y herramientas de línea de comandos solo si están registrados e intactos. Un archivo modificado, un manifest inválido o una integración sin propiedad demostrable bloquean el preflight antes de escribir; nunca se hace borrado a ciegas ni se cambia `opencode.json(c)` o recursos ajenos.

Se exige OpenCode major 2. Si falla el preflight, resuelve explícitamente el archivo modificado o la incompatibilidad y vuelve a ejecutar el instalador; no borres la configuración de usuario como atajo.

El primer encargo concreto puede llamar `pulso_workspace_prepare`, que crea `.pulso/state.json`, `history.jsonl`, `work/`, `project.md` y `decisions.md` solo cuando no hay datos existentes. No se recorren otros proyectos. Los datos incompatibles o legacy se conservan y bloquean la preparación.

El instalador no actualiza ni convierte Work/State/History. El plugin usa los formatos canónicos existentes, sin migración ni reparación automática de datos legacy. Los cinco archivos de skills BBVA conservan procedencia y bytes originales según `bbva-provenance.json`.

## Desinstalar

```sh
node install.mjs uninstall
```

Retira recursos globales gestionados por Pulso. No recorre proyectos ni borra sus Work, estado, contexto o historial. Un recurso modificado cancela la desinstalación.
