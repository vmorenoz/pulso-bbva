# Desarrollo: una fuente por responsabilidad

Node 22+, cero dependencias npm. No se modifica el formato de los artefactos ni los
prompts de roles como parte de este correctivo.

| Se edita | Se genera / consume |
|---|---|
| `agents/*.md`, `agents/common.md`, `agents/catalog.json` | Agentes de los tres adaptadores |
| Las cuatro `skills/pulso-{init,status,resume,recap}/SKILL.md` | Comandos OpenCode; VS Code consume las mismas skills |
| `lib/composition.mjs` | Composición nativa en memoria, sin efectos al importarse |
| `scripts/build.mjs` | Comprobación de la composición; no escribe adaptadores |
| `templates/` y `schemas/` | Contratos de contenido y datos |
| `skills/bbva-*` | Copia exacta; no editar durante este correctivo |

Se elimina `agents/commands.json`: no debe sobrevivir como fuente ni copia de respaldo
cargada por el build. El generador lee el frontmatter de cada skill de operación y crea
un dispatcher mínimo que la carga por nombre; el cuerpo completo no se inserta en el
mensaje visible del comando. `name` y `description` son literales de una línea; no se
introduce un parser YAML general. Los comandos conservan `agent: pulso`,
`subtask: false`, omiten modelo y tratan `$ARGUMENTS` como datos.

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

El check existente valida la composición en memoria, frontmatter, selección de runtime y
fuente única de operaciones. No hay carpetas generadas que puedan quedar divergentes.
No se crea CI, una matriz automatizada, un modo nuevo de build ni un sistema de snapshots.

Se conservan `node:test`, las pruebas actuales y los checks de SHA-256 de BBVA.
Solo se añaden dos regresiones del instalador y se amplía el check existente de
skills/comandos. No se simulan LLM, ventanas de IDE, sesiones o aprobaciones.
El parser Python opcional sigue siendo opcional; no convertirlo en prerrequisito.

Los adaptadores completos solo aparecen en el proyecto destino después de instalar. No
añadir dependencias, SDK de hosts, plugins, MCP, detectores de harness ni coordinadores
de procesos.
