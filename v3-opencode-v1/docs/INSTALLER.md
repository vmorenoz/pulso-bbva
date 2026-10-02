# Instalador de Pulso

El CLI hace bootstrap global de OpenCode v1; no administra Work/State/History ni ejecuta operaciones de proyecto. Requiere Node.js 22+; no ejecuta ni valida OpenCode ni requiere que esté en `PATH`. Desde la distribución, instala primero la dependencia del parser JSONC:

```sh
npm install --ignore-scripts
node install.mjs
node install.mjs --dry-run
node install.mjs uninstall
node install.mjs uninstall --dry-run
```

El bootstrap no ejecuta npm ni sudo. Añade su plugin y `default_agent: "pulso"`, preservando el valor anterior para desinstalar. No modifica credenciales, modelos ni permisos. Solo retira un MCP Pulso histórico cuando el payload coincide exactamente con el hash registrado; conserva los MCP ajenos y las entradas modificadas.

Se edita `opencode.jsonc` cuando existe, o `opencode.json` si es la configuración existente; solo se crea JSONC si no existe ninguna. La limpieza revisa ambos archivos cuando coexisten. `jsonc-parser` valida sintaxis y claves duplicadas, admite comentarios y comas finales, y permite editar propiedades y entradas individuales conservando comentarios ajenos.

## Rutas globales

| Recurso | Ubicación |
|---|---|
| Agentes | `~/.config/opencode/agents/` |
| Comandos | `~/.config/opencode/commands/` |
| Skills | `~/.config/opencode/skills/` |
| Plugin | `~/.config/opencode/plugins/pulso/` |
| Core, schemas, plantillas y documentación | `~/.pulso/` |

Se respetan `OPENCODE_CONFIG_DIR` y `XDG_CONFIG_HOME` solo dentro de la carpeta del usuario administrada. Se rechazan symlinks en destinos administrados y rutas fuera de esa carpeta. El manifest registra hashes y ownership. Una instalación idéntica es idempotente, incluso después de reinstalar: no transforma entradas propias en prestadas ni pierde el agente predeterminado anterior.

Las skills BBVA preexistentes en OpenCode se conservan como prestadas. Cuando existe la skill correspondiente en `~/.agents/skills/`, se usa esa ubicación compartida y no se crea una copia OpenCode. El instalador no inspecciona skills de Copilot, Claude ni VS Code.

## Migración y datos del proyecto

La actualización inventaría manifiestos coexistentes en la ubicación OpenCode actual, la predeterminada y la anterior registrada:

| Generación | Manifest y formato |
|---|---|
| v1 | `.pulso-install.json`: `schema_version: 1`, `managed_by: "pulso"`, hashes y rutas relativas a OpenCode |
| v1 pre-manifest | `pulso-profile.json` con `managed_by: "pulso"` |
| v2 | `.pulso-manifest.json`: versiones 1–5, `runtime: "opencode"`, `scope: "global"`, hashes de archivos y `configEntries` históricos |
| v3 | `~/.pulso/installation.json`: `schemaVersion: 1`, versión, runtimes, hashes, recursos prestados y ownership de configuración |

Los recursos registrados se limitan a OpenCode `agents/commands/skills/plugins/lib/bin/tools` y recursos de distribución global `.pulso/{templates,schemas,lib,bin,docs}` y `catalog.json`. Datos OpenCode, dependencias y `package.json` permanecen aunque un manifest histórico los enumere; una ruta de configuración histórica dentro de datos `.pulso/` u otro host se rechaza. Para residuos sin manifest solo se usa un catálogo finito de rutas históricas comprobadas, nunca glob ni borrado recursivo de carpetas. Nombres desconocidos permanecen. Un archivo ajeno que colisione con un recurso nuevo y no pertenezca al catálogo cancela el preflight. Manifiestos desconocidos o inválidos también lo cancelan sin escrituras.

Se retiran plugins legacy por referencia exacta al archivo conocido y MCP por hash del payload exacto, conservando el orden y las entradas ajenas. Los manifiestos de VS Code, Copilot y runtime compartido no se limpian. Si el manifest v3 contiene ownership de otros hosts, se conserva en `preservedInstallations`; sus recursos permanecen intactos.

Se preservan `~/.pulso/preferences.json`, registry, `projects/`, archivos desconocidos y todos los datos de proyecto. No se siguen rutas de proyectos desde el registry. La migración de datos de workspace es una operación del core, independiente de este instalador global.

## Desinstalar

Retira recursos globales OpenCode y recursos de distribución propios, incluidos residuos históricos reconocidos. Los recursos prestados permanecen. Restaura el agente predeterminado anterior solo si sigue siendo `pulso`; un cambio posterior del usuario permanece. No recorre proyectos ni borra sus Work, estado, contexto o historial.

## Respaldos, rollback y vista previa

Antes de reemplazar o retirar recursos Pulso modificados o sin hash histórico, los copia a `~/.pulso/backups/opencode-<uuid>/files/`. También respalda configuraciones modificadas y manifiestos históricos retirados. El recibo devuelve `backup`; `index.json` enumera ruta original relativa al home, ruta de respaldo, SHA-256, permisos y motivo. Para recuperar una edición, verifica su hash y copia ese archivo a la ruta original, restaurando los permisos registrados. Los respaldos sobreviven a la desinstalación.

Una transacción cubre respaldos, recursos, configuraciones y manifests. Si una escritura falla, restaura contenido y permisos anteriores y retira los archivos/directorios creados por esa operación. Detecta cambios entre preflight y publicación; informa errores de rollback si alguna restauración falla. Es rollback síncrono en memoria, no recuperación automática tras interrupción del proceso ni bloqueo entre varios instaladores concurrentes.

`--dry-run` realiza el inventario y preflight y devuelve acciones, retiradas y ubicación propuesta de respaldo sin crear archivos, directorios, manifests ni respaldos, incluso cuando el home destino no existe.
