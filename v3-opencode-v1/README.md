# Pulso · OpenCode v1

Pulso es un **Asistente IA para desarrollo** que orquesta especialistas nativos de OpenCode v1 y conserva planes, contexto, preferencias, aprendizaje, trabajos, estado e historial en `.pulso/`. Sus delegaciones siguen siendo llamadas nativas inspeccionables; el plugin ofrece cuatro tools semánticas con recibos breves para reducir ruido de escrituras.

El core valida y persiste artefactos localmente. Pulso no es runtime de agentes, MCP server, daemon, scheduler ni base de datos. OpenCode v1 es el único runtime distribuido; OpenCode v2 y VS Code quedan fuera.

## Instalar

Requiere Node.js 22+. La instalación no ejecuta ni valida el binario de OpenCode; está diseñada para OpenCode v1.

```sh
npm install --ignore-scripts
node install.mjs
```

Para comprobar la vista previa sin escribir:

```sh
node install.mjs --dry-run
```

Después reinicia OpenCode y selecciona `pulso` como agente principal. La instalación administra agentes, comandos, skills, plugin, core y su entrada propia en la configuración global de OpenCode; cada workspace conserva sus propios datos `.pulso/`. Para desinstalar recursos globales:

```sh
node install.mjs uninstall
```

El instalador usa un parser JSONC para registrar su plugin y agente principal y limpiar integraciones globales OpenCode de Pulso v1/v2/v3. Conserva entradas ajenas, skills BBVA compartidas, preferencias y registry de proyectos; respalda recursos modificados y revierte la operación si falla una escritura. No requiere OpenCode en `PATH` ni modifica credenciales, modelos o permisos del usuario. [Detalles y recuperación de respaldos](docs/INSTALLER.md).

## Uso

- `/pulso-status`: consultar el snapshot guardado.
- `/pulso-recap`: resumir cierres recientes y trabajos abiertos.
- `/pulso-resume`: retomar un Work existente.
- `/pulso-init`: solicitar contexto inicial cuando haga falta.

Las tools `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context` mantienen el estado canónico y devuelven recibos breves. Las mutaciones requieren revisión esperada; los lotes se validan y escriben una vez. Usa `/details` de OpenCode para reducir detalle nativo. El recibo no es una prueba de calidad ni de ejecución semántica.

Un saludo no inicia herramientas ni prepara el workspace. La preparación solo ocurre ante el primer encargo concreto o `/pulso-init`. Migra tareas legacy reconocidas conservando IDs y una copia íntegra del original; un estado legacy `schema_version: 1` también se migra cuando existen esas tareas y no hay artefactos actuales. Datos corruptos, incompatibles o incompletos se preservan y bloquean.

## Verificación y desarrollo

```sh
cd v3-opencode-v1
npm run build
npm run verify
npm run test:isolated
```

Las pruebas offline cubren core, schemas, plugin assets y migración del instalador. No equivalen a smoke test de TUI ni a aceptación live de modelos/tools; esos criterios quedan `NOT_RUN` hasta validarse en OpenCode v1 real.

`test:isolated` ejecuta la suite completa con `HOME` y configuración temporales. Usa el paquete `@opencode-ai/plugin` local en modo lectura para las pruebas del plugin instalado; permite indicar su carpeta de dependencias mediante `PULSO_TEST_PLUGIN_NODE_MODULES`. Si no está disponible, esas pruebas se reportan como omitidas. `build` comprueba en memoria la distribución global y los imports entre módulos del core; `jsonc-parser` solo es dependencia del instalador.

[Arquitectura](docs/ARCHITECTURE.md) · [Runtime](docs/RUNTIMES.md) · [Instalador](docs/INSTALLER.md) · [Operaciones](docs/OPERATIONS.md) · [Seguridad](docs/SECURITY.md) · [Procedencia BBVA](docs/bbva-provenance.json).
