# Entrega Pulso 4.1.0

## Cambios

- Orquestación por capacidad: Git de inspección al Executor; una limitación de Explorer no significa ausencia de terminal global. Recuperación sin eludir denegaciones.
- Continuidad, paralelismo por ámbitos, conservación de autorizaciones y preguntas limitadas a decisiones genuinas.
- `prepare_delegation`, `accept_result`, `accept_delivery` comunes a ambos adaptadores; resultados inline, base previa y rutas normalizadas.
- Resultados históricos para tareas, evidencia final para criterios, diagnóstico completo de cierre y errores compactos.
- Aceptación de usuario diferenciada de evidencia técnica mediante acceptanceMode; historial de tareas realizadas protegido.
- Recibos con procedencia/versiones y prompts sin emojis; builds OpenCode y VS Code desde core común.

## Verificaciones realizadas

Todos terminaron con exit code 0:

- `npm run build:opencode`
- `npm run build:vscode`
- `npm run check`
- `npm run smoke:happy`
- `npm run package:opencode`
- `npm run package:vscode`
- `npm run verify:packages`
- `git diff --check`

Happy path del core real con workspace/home desechables, comando de comprobación ejecutado y evidencia auténtica. Repetido contra ambos paquetes extraídos. No se ejecutaron suites de mocks ni conversaciones simuladas. La operación de aceptación conversacional `accept_delivery` y la conducta de los agentes en hosts reales no se declaran verificadas por este smoke.

## Paquetes

`artifacts/pulso-opencode-4.1.0.tar.gz`

SHA-256: `9d94c9eae24d449e8f5403915ba7cb521793cd84586a1705be91d575771ae45b`

`artifacts/pulso-4.1.0.vsix`

SHA-256: `96d9e8efac87877cb63fb4cad6a37a6568670a9e8df2e25b9031660d296d644f`

## Instalación real autorizada

Instalador ejecutado con targets opencode,vscode, CLI de la instalación local de VS Code y `--yes`, después de inspeccionar dry-run. Resultado `complete`.

- OpenCode: paquete global `~/.pulso/runtimes/opencode-v1/package.json` declara 4.1.0; hash del plugin instalado coincide con stage. El nombre histórico del directorio no indica versión 1 del producto.
- VS Code: CLI 1.140.0 confirma `pulso-local.pulso@4.1.0` en perfil local predeterminado.
- Backup de OpenCode: `~/.pulso/backups/opencode-a21eb9bc-d890-4dc2-8ae3-f3d491b6049e`.
- No se verificaron perfiles alternativos ni instalaciones remotas.

Cerrar y volver a abrir OpenCode; recargar la ventana VS Code. Instalación en disco no demuestra que las sesiones que estaban abiertas ya hayan recargado prompts/plugin.

## Referencias

- `PLAN-ROBUSTECIMIENTO-OPENCODE-VSCODE.md`
- `AUDITORIA-SESION-REAL-2026-10-07.md`
- `core/lib/ACCEPTANCE-API.md`

Cambios sin commit. Los trabajos reales del usuario no se cerraron ni reclasificaron durante esta entrega.
