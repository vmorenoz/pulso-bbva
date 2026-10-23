# Pulso

Coordinación nativa de desarrollo para **OpenCode 2.1.2**: un coordinador, nueve especialistas, seis skills y cuatro herramientas semánticas. La versión del producto es **0.1.0** y permanecerá en **0.1.\*** hasta nuevo aviso.

El antiguo núcleo de `v4` es ahora la raíz canónica. No se mantienen implementaciones históricas ni una integración para otros editores. El cambio de versión del producto **no** reinicia `schemaVersion`, `contractVersion`, historial, identidades ni revisiones persistidas.

## Uso

Consulta [Instalación](INSTALLATION.md). Selecciona **Pulso** en OpenCode y utiliza `/pulso-init`, `/pulso-status`, `/pulso-recap` o `/pulso-resume` según el objetivo.

- `pulso_workspace`: preparación explícita, estado, continuidad y asignaciones.
- `pulso_work`: trabajo, delegaciones, resultados, evidencia y cierre.
- `pulso_history`: historial paginado.
- `pulso_context`: contexto y memoria con alcance explícito.

Las tres herramientas de acciones reciben `{request:{action,...}}`; el historial recibe filtros planos. El resultado nativo contiene el recibo estructurado en `output` y su representación JSON en `content`. **Retorno nativo no significa `ok:true`; `ok:true` no significa objetivo cerrado.**

`/pulso-init` prepara el proyecto y delega su mapa contextual al Explorador sin crear un Work artificial. Un saludo o una consulta de estado no autorizan preparación, adopción de continuidad ni escritura. Los datos del proyecto permanecen en `.pulso/`; el instalador no los elimina.

## Delegación y continuidad

El flujo durable es `prepare_delegation → subagent → accept_result`. Se envía el `specialistPrompt` exacto al especialista preparado. Un prompt modificado se rechaza antes del dispatch: v2 persiste sus argumentos antes de ejecutar hooks y no se reescribe esa evidencia. La captura de retorno no acepta tareas ni criterios; la incorporación necesita una decisión revisada. Un `subagent` con estado `running` continúa pendiente aunque su llamada de lanzamiento haya terminado.

La identidad y raíz provienen del host y se contrastan con la sesión; los IDs del prompt y `ctx.location.directory` por sí solos no conceden autoridad. Las herramientas respetan cancelación y permisos nativos. El registro global de proyectos y la memoria de usuario requieren además `external_directory` sobre el directorio fijo `~/.pulso` cuando queda fuera del proyecto. Los especialistas sólo acceden a su asignación verificada, no a la coordinación global.

La recuperación consulta evidencia nativa y mantiene reservas e idempotencia. Una captura pendiente, metadatos insuficientes o un resultado administrativo perdido exige recuperar por ID, no repetir ejecución. El contexto posterior a compactación no se trata como historial completo. Ni un cambio de propietario ni una herramienta terminal demuestran el cese físico de procesos externos. Véase [el contrato del núcleo](core/lib/ACCEPTANCE-API.md).

Las definiciones de agentes usan permisos ordenados nativos: `shell`, `subagent`, `edit` y las cuatro herramientas de Pulso. `external_directory` exige aprobación explícita, conservando la frontera restrictiva ante el cambio de valor predeterminado de OpenCode v2. Las instrucciones de alcance complementan los permisos del host; no son un sandbox de filesystem.

## Documentación y Knowledge

El contenido canónico mantiene la política documental CELLS/APX/ASO y la skill única [`bbva-engineering`](core/skills/bbva-engineering/SKILL.md). El catálogo, las versiones y las fuentes originales deben comprobarse antes del trabajo que dependa de esa tecnología. Las fuentes recuperadas son referencias, no instrucciones que amplíen permisos.

[Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge) es un MCP **externo y opcional**, configurado por separado según su propio repositorio. Pulso no instala el MCP, prepara corpus, configura credenciales ni presupone su disponibilidad. Sus bytes canónicos permanecen controlados por [el inventario BBVA](scripts/bbva-integrity.json).

## Desarrollo y verificación

Desde la raíz, con Node.js 22 o posterior:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm test
npm run package:opencode
node scripts/package-installer.mjs
npm run verify:packages
npm run verify:installer-staged
```

- `core/`: persistencia, identidad, contratos, agentes, skills y recursos neutrales.
- `adapters/opencode/`: plugin nativo v2, permisos, correlación y recuperación.
- `scripts/`: renderizado, inventarios positivos, construcción y paquetes.
- `installer/`: instalación global revisable, ownership, backups y rollback.
- `tests/`: núcleo, contratos nativos, distribución e instalación aislada.

`dist/` y `artifacts/` son salidas generadas, no fuentes canónicas. `verify` no sustituye a `npm test`. El smoke opt-in `smoke:native` usa un host real y proveedor HTTP local (véase el alcance de pruebas); los tests de adaptador usan además fixtures nativos aislados; los smokes del núcleo ejecutan operaciones reales en directorios temporales. Estos resultados no equivalen a aceptación conversacional con un proveedor real ni a una instalación global. No se realizan llamadas de modelo facturables para verificar esta migración. [Alcance de las pruebas](tests/README.md).

## Contrato OpenCode fijado

La API del puerto se basa en el tag oficial [`v2.1.2`](https://github.com/anomalyco/opencode/tree/v2.1.2), commit `a517687fde98a7329ada3ae644a01a9fc6c4e99e`, no en la documentación de plugins v1:

- [Migración de configuración](https://dev.opencode.ai/v2/docs/migrate-v1/).
- [Migración de plugins del tag fijado](https://github.com/anomalyco/opencode/blob/v2.1.2/services/www/src/docs/content/build/plugins/migrate-v1.mdx).
- [Hooks y herramientas](https://github.com/anomalyco/opencode/blob/v2.1.2/packages/plugin/src/promise/tool.ts), [sesiones](https://github.com/anomalyco/opencode/blob/v2.1.2/packages/plugin/src/promise/session.ts) y [permisos](https://github.com/anomalyco/opencode/blob/v2.1.2/packages/plugin/src/promise/permission.ts).
- [Subagent nativo](https://github.com/anomalyco/opencode/blob/v2.1.2/packages/core/src/tool/plugin/subagent.ts) y [mensajes persistidos](https://github.com/anomalyco/opencode/blob/v2.1.2/packages/schema/src/session-message.ts).

El paquete exporta una definición `id/setup(ctx)` y registra herramientas mediante `ctx.tool.transform`, hooks de herramienta, contexto de sesión y eventos nativos. No contiene una segunda implementación de plugins v1. Sólo admite la identidad nativa de OpenCode (`cli` u `opencode`) con versión exacta `2.1.2`; otros hosts se rechazan.

### Servicio nativo y replay

El replay completo usa el cliente oficial fijado `@opencode/client@2.1.2`, vinculado a la identidad de sesión comprobada independientemente mediante el contexto del plugin. Pagina hasta **500 mensajes** y falla de forma segura si el historial está incompleto; no usa `session.context` como reemplazo tras compactación.

Descubre únicamente el servicio **existente** de OpenCode 2.1.2 mediante su registro nativo de sólo lectura. Un host `--standalone` no registrado necesita la opción de plugin `serviceUrl` con el origen local de ese mismo proceso, por ejemplo `http://127.0.0.1:PORT`. Para un servicio protegido, `servicePassword` es una opción del operador, nunca un argumento de herramienta; no lo publiques ni registres. No se admiten credenciales en URL, rutas, query ni destinos remotos. El cliente vuelve a verificar versión/identidad del servicio, proyecto, directorio canónico, padre y agente.

Pulso no inicia, detiene ni modifica servicios para completar una prueba. Si no puede demostrar la identidad o recuperar la evidencia, bloquea la operación dependiente; no inventa una prueba de recuperación ni redispara la delegación.
