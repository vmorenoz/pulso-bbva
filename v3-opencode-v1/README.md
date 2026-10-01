# Pulso · OpenCode v1

Pulso es un **Asistente IA para desarrollo** que orquesta especialistas nativos de OpenCode v1 y conserva planes, contexto, preferencias, aprendizaje, trabajos, estado e historial en `.pulso/`. Sus delegaciones siguen siendo llamadas nativas inspeccionables; el plugin ofrece cuatro tools semánticas con recibos breves para reducir ruido de escrituras.

El core valida y persiste artefactos localmente. Pulso no es runtime de agentes, MCP server, daemon, scheduler ni base de datos. OpenCode v1 es el único runtime distribuido; OpenCode v2 y VS Code quedan fuera.

## Instalar

Requiere Node.js 22+ y OpenCode v1 disponible en `PATH`:

```sh
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

El instalador no modifica la configuración del host, MCP, credenciales, modelos ni permisos del usuario. [Detalles](docs/INSTALLER.md).

## Uso

- `/pulso-status`: consultar el snapshot guardado.
- `/pulso-recap`: resumir cierres recientes y trabajos abiertos.
- `/pulso-resume`: retomar un Work existente.
- `/pulso-init`: solicitar contexto inicial cuando haga falta.

Las tools `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context` mantienen el estado canónico y devuelven recibos breves. Las mutaciones requieren revisión esperada; los lotes se validan y escriben una vez. Usa `/details` de OpenCode para reducir detalle nativo. El recibo no es una prueba de calidad ni de ejecución semántica.

Un saludo no inicia herramientas ni prepara el workspace. La preparación solo ocurre ante el primer encargo concreto o `/pulso-init`. Datos legacy o incompatibles se preservan y bloquean; no se migran automáticamente.

## Verificación y desarrollo

```sh
cd v3
npm run build
npm run verify
```

Las pruebas offline cubren core, schemas, plugin assets y migración del instalador. No equivalen a smoke test de TUI ni a aceptación live de modelos/tools; esos criterios quedan `NOT_RUN` hasta validarse en OpenCode v1 real.

[Arquitectura](docs/ARCHITECTURE.md) · [Runtime](docs/RUNTIMES.md) · [Instalador](docs/INSTALLER.md) · [Operaciones](docs/OPERATIONS.md) · [Seguridad](docs/SECURITY.md) · [Procedencia BBVA](docs/bbva-provenance.json).
