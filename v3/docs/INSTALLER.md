# Instalador de Pulso

Instalación exclusivamente global para OpenCode y Visual Studio Code Copilot.
Requiere Node.js 22+, sin `npm install`, sudo, extensión propia ni procesos de agentes.

## Instalar

```sh
node install.mjs
```

El único selector es Runtime: **OpenCode** o **Visual Studio Code (Copilot)**.
Flechas, Tab o números cambian la selección; Enter confirma y Esc/Ctrl+C cancela
antes de escribir. El comando puede ejecutarse desde cualquier directorio.

No se admiten `--scope`, `--target` ni `--vscode-harness`. La API rechaza
`scope: "project"`; VS Code global usa Copilot Agent Host.

## Rutas

| Recurso | Ubicación global |
|---|---|
| Agentes OpenCode | `~/.config/opencode/agents/` |
| Comandos OpenCode | `~/.config/opencode/commands/` |
| Agentes VS Code Copilot | `~/.copilot/agents/` |
| Skills | `~/.agents/skills/` |
| Utilidades, plantillas y schemas | `~/.pulso/` |

`OPENCODE_CONFIG_DIR` y `XDG_CONFIG_HOME` se respetan únicamente cuando resuelven
dentro de la carpeta del usuario. No se modifican configuraciones, credenciales,
modelos, MCP, permisos ni otros agentes.

## Datos por proyecto

La instalación global no crea estado en HOME. Con el primer encargo concreto o
`/pulso-init`, Pulso inspecciona el workspace y, si es nuevo, delega una única
ejecución de:

```sh
node ~/.pulso/bin/prepare.mjs --root /ruta/del/workspace
```

El helper crea únicamente datos ausentes bajo `<workspace>/.pulso/`:

- `state.json`
- `history.jsonl`
- `work/`
- `project.md`
- `decisions.md`

No copia agentes, skills, binarios, librerías, plantillas, schemas o documentación al
proyecto. El esqueleto vacío no equivale a contexto levantado. Datos legacy o formato
incierto bloquean la preparación sin migrar, reparar ni borrar automáticamente.

Las operaciones posteriores usan el CLI global con `--root` al workspace. El estado
siempre pertenece al proyecto activo; `~/.pulso` contiene recursos, no trabajo global.

## Actualizar

El manifest global `~/.pulso/installation.json` registra propiedad y hashes. El
preflight completo ocurre antes de escribir. Una reinstalación idéntica es idempotente;
una actualización retira solo archivos obsoletos registrados y no reclamados como
compartidos. Un archivo gestionado editado o una integración sin propiedad demostrable
cancela la operación. No existe `--force`.

Las instalaciones antiguas por proyecto no se migran ni desinstalan automáticamente.
La instalación global no recorre repositorios para encontrarlas.

## Desinstalar

```sh
node install.mjs uninstall
# equivalente
node uninstall.mjs
```

El único selector es Runtime. Se retira ese runtime de la instalación global. Si queda
el otro, se conservan los recursos comunes. Ningún proyecto se recorre o modifica;
estado, trabajos, contexto e historial permanecen intactos.

## Automatización

```sh
node install.mjs --runtime opencode
node install.mjs --runtime vscode --dry-run
node install.mjs uninstall --runtime opencode
```

La librería conserva `runtime: "both"` para instalar ambos en una operación. El wizard
selecciona uno por ejecución. Exit codes: éxito 0, error 1 y cancelación 130.
