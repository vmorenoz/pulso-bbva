# Desarrollo: una fuente por responsabilidad

Node 22+ para instalador y pruebas. El core y el plugin no tienen dependencias npm de
ejecución; el plugin exporta la definición nativa que carga OpenCode. No se modifica el
formato de los artefactos existentes.

| Se edita | Se genera / consume |
|---|---|
| `agents/*.md`, `agents/common.md`, `agents/catalog.json` | Agentes OpenCode v2 |
| `skills/` | Skills globales OpenCode y dispatchers de comandos |
| `plugins/opencode-v2/` | Custom tools y contrato del plugin; sin SDK importado en runtime |
| `lib/composition.mjs` | Composición OpenCode v2 en memoria, sin efectos al importarse |
| `lib/work-mutations.mjs`, `lib/receipts.mjs` | API semántica independiente del runtime |
| `scripts/build.mjs` | Comprobación de la composición; no escribe adaptadores |
| `templates/` y `schemas/` | Contratos de contenido y datos |
| `skills/bbva-*` | Copia exacta; no editar durante este correctivo |

Se elimina `agents/commands.json`: no debe sobrevivir como fuente ni copia de respaldo
cargada por el build. El generador lee el frontmatter de cada skill de operación y crea
un dispatcher mínimo que carga la skill; el cuerpo completo no se inserta en el comando.
`name` y `description` son literales de una línea; no se introduce un parser YAML general.
Los comandos usan el frontmatter actual v2 (`agent: pulso`, `subagent: false`) y tratan
`$ARGUMENTS` como datos.

Después de modificar una fuente:

```sh
npm run build
npm run verify
```

La instalación consume directamente `lib/composition.mjs`; no requiere ejecutar build
antes. Sobre un checkout/ZIP recibido, o en un CI ya existente:

```sh
npm run verify
```

El check existente valida composición en memoria, frontmatter v2, plugin, schemas y fuente
única de operaciones. No hay carpetas generadas que puedan quedar divergentes.
No se crea CI, una matriz automatizada, un modo nuevo de build ni un sistema de snapshots.

Se conservan `node:test` y los checks de SHA-256 de BBVA. Las pruebas cubren core semántico,
plugin assets y migración del instalador. No se simulan LLM, TUI, sesiones o aprobaciones.
El parser Python opcional sigue siendo opcional; no convertirlo en prerrequisito.

Los recursos completos solo aparecen en la configuración global después de instalar. No
se añade MCP ni coordinador de procesos.
