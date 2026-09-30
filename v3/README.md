# Pulso · OpenCode v2

Pulso es un **Asistente IA para desarrollo** que orquesta especialistas nativos de OpenCode v2 y conserva planes, contexto, trabajos, estado e historial en `.pulso/`. Sus delegaciones siguen siendo llamadas nativas inspeccionables; el plugin ofrece tools semánticas con recibos breves para reducir ruido de escrituras.

El core valida y persiste artefactos localmente. Pulso no es runtime de agentes, MCP server, daemon, scheduler ni base de datos. OpenCode v2 es el único runtime distribuido; OpenCode v1 se rechaza y VS Code queda fuera hasta tener un adaptador propio.

## Instalar

Requiere Node.js 22+ y OpenCode v2 disponible en `PATH`:

```sh
node install.mjs
```

Para comprobar la vista previa sin escribir:

```sh
node install.mjs --dry-run
```

Después reinicia OpenCode y selecciona `pulso` como agente principal. La instalación administra agentes, comandos, skills, plugin y core globales; cada workspace conserva sus propios datos `.pulso/`. Para desinstalar recursos globales:

```sh
node install.mjs uninstall
```

El instalador no modifica la configuración del host, MCP, credenciales, modelos ni permisos del usuario. [Detalles](docs/INSTALLER.md).

## Uso

- `/pulso-status`: consultar el snapshot guardado.
- `/pulso-recap`: resumir cierres recientes y trabajos abiertos.
- `/pulso-resume`: retomar un Work existente.
- `/pulso-init`: solicitar contexto inicial cuando haga falta.

Las tools `pulso_work_create`, `pulso_work_apply`, `pulso_work_close` y `pulso_work_reopen` mantienen el estado canónico. Las mutaciones requieren revisión esperada; los lotes se validan y escriben una vez. Las delegaciones a especialistas permanecen visibles. El recibo no es una prueba de calidad ni de ejecución semántica.

Un saludo no inicia herramientas ni prepara el workspace. La preparación solo ocurre ante el primer encargo concreto o `/pulso-init`. Datos legacy o incompatibles se preservan y bloquean; no se migran automáticamente.

## Verificación y desarrollo

```sh
cd v3
npm run build
npm run verify
```

Las pruebas offline cubren core, schemas, plugin assets y migración del instalador. No equivalen a smoke test de TUI ni a aceptación live de modelos/tools; esos criterios quedan `NOT_RUN` hasta validarse en OpenCode v2 real.

[Arquitectura](docs/ARCHITECTURE.md) · [Runtime](docs/RUNTIMES.md) · [Instalador](docs/INSTALLER.md) · [Operaciones](docs/OPERATIONS.md) · [Seguridad](docs/SECURITY.md) · [Procedencia BBVA](docs/bbva-provenance.json).
