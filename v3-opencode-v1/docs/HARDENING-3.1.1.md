# Endurecimiento 3.1.1 para OpenCode v1

Base: main `6bf3da9b66f43ff331faea923380ada3b37be628`. Alcance exclusivo: `v3-opencode-v1`. Sin MCP, base de datos, scheduler ni runtime añadido. No se modifica ninguna versión histórica.

## Qué cambia

- F1: rollback restaura primero los recursos; si una restauración falla, conserva respaldo e índice y muestra sus rutas.
- F2–F3: skills aplicables por rol; LT sin edit/bash y delegación limitada al catálogo; especialistas sin task/tools canónicas, con protección de rutas raíz/anidadas. Shell de Executor/QA bajo aprobación efectiva.
- F4–F5: evidencia nueva incluye hashes observados del código/configuración y del informe, fecha de observación y huellas de aceptación. No se renuevan hashes/resultado al editar un resumen. Cambiar aceptación/scope exige motivo persistido e invalida aceptación relacionada. Repetir una comprobación requiere otro ID de evidencia.
- F6: eliminado el cierre automático de mapas. Mapeo y producto siguen las operaciones normales y su aceptación.
- F7–F9: lectura real de contexto, preferencias, aprendizaje y coordinación de Work, con filtros, páginas, revisión y cursores que rechazan bases obsoletas. No se atribuye source=user por defecto.
- F10: un marcador propio permite retomar semillas intactas de preparación interrumpida; datos ambiguos o modificados se preservan y bloquean.
- F11: cuatro prioridades coherentes (`low/normal/high/critical`), acciones estrictas y contratos nativos discriminados. `urgent` no está admitida.
- F12: `pulso_work request.action=validate_result` verifica Work/revisión/agente/tareas/scope y lee la plantilla real desde el catálogo global. El resultado queda `PENDING_REVIEW` semántico.
- F13: configuración JSONC acepta plugins string y `[referencia, opciones]`, preservando opciones/comentarios ajenos.
- F14: guías, HELP y rutas corresponden a las tools actuales; continuidad dentro del objetivo autorizado, sin retomar por saludo ni ampliar alcance.
- F15–F16: las cuatro tools consultan `context.ask` antes de efectos; falta/rechazo bloquea. Status mantiene el guard de rutas también al detectar legacy y no incluye contenido JSON inválido en errores.
- F17: preferencias globales usan lock exclusivo corto con token y revisión comprobada dentro del lock. Contención/conflicto exige releer y reconciliar; no se descartan cambios silenciosamente.

Telemetría limitada a delegaciones Pulso con Work/tarea asignados en un workspace preparado. CLI muestra el respaldo. Los cinco archivos BBVA son idénticos al main fijado; la discrepancia histórica de bbva-engineering con su manifiesto de procedencia permanece documentada, sin cambiar los hashes históricos para ocultarla.

## Compatibilidad

Las tools multiaction ahora reciben `{ "request": { "action": "..." } }`; `pulso_history` conserva filtros directos. El esquema publicado describe cada acción. Reinicia OpenCode para recargar tools, agentes y skills.

Los cierres históricos siguen siendo legibles. Para cerrar nuevamente un Work abierto, la evidencia anterior sin base observada requiere una nueva comprobación. Los registros de memoria incompletos se conservan y bloquean actualizaciones hasta recuperación explícita. No se inventa procedencia humana retroactiva.

## Descargar e instalar

Desde un checkout sin cambios propios pendientes, usa el commit histórico de la entrega 3.1.1:

```sh
git fetch origin
git switch --detach f4fbd372ec8fa12af80daba16c7c9445a13a6976
cd v3-opencode-v1
npm ci --ignore-scripts
node install.mjs --dry-run
node install.mjs
```

Este checkout queda en HEAD separado, fijado a la entrega histórica. No uses reset/clean para perder cambios propios. La instalación es global y modifica su entrada plugin/default_agent, conservando configuración ajena y respaldos. Reinicia OpenCode y selecciona `pulso`.

## Prueba live breve

1. Registrar versión instalada de OpenCode; el contrato comprobado aquí es `@opencode-ai/plugin 1.18.2` con Zod 4.1.8. La TUI y permisos efectivos todavía requieren prueba en tu instalación.
2. Saludo/status no crean `.pulso`. Primer encargo prepara y delega mapeo a Explorer. Un mapa anterior no cierra una corrección nueva.
3. Encargo APX/CELLS pequeño: Executor/QA cargan sus skills; LT no edita ni usa shell; no hay generalista ni subdelegación. Un script aprobado puede escribir: los permisos no equivalen a sandbox de procesos ni confinamiento dinámico de writeScope.
4. Probar regla efectiva ask sobre una tool: rechazar deja cero cambios; permitir sigue el flujo; deny no debe eludirse. No relajar permisos globales para conseguir un resultado verde.
5. Crear dos Work, bloquear uno y consultar estado. Guardar una preferencia global, cambiar de sesión/proyecto y leer su valor. Al cambiar aceptación después de PASS, el cierre exige nueva evidencia.
6. Review externa solo lectura: sin crear Work ni `.pulso` externo. Ningún completed de especialista es aprobación semántica automática.

Los fallos de rollback/preparación se inyectan solo en fixtures con HOME temporal, nunca sobre tus datos reales.

## Verificación reproducible

```sh
npm run build
npm run check
PULSO_TEST_PLUGIN_NODE_MODULES=/ruta/a/dependencias/opencode/node_modules npm run test:isolated
```

Se usa el arnés `node:test` existente, sin framework nuevo. Las pruebas del plugin invocan el paquete oficial instalado y un callback de aprobación controlado; no prueban la TUI, decisiones del modelo ni la resolución efectiva de permisos de una sesión live. Si faltan dependencias del host, esos tests se omiten explícitamente; una omisión no significa PASS.

### Resultado de esta entrega (5 de octubre de 2026)

- Node 24.19.0; `npm run build`: PASS, distribución de 82 recursos.
- `npm run check`: PASS, incluidos cinco hashes BBVA contra main fijado.
- `npm run test:isolated`: 204/204 PASS, 0 fallos, 0 omitidos. HOME temporal, paquete oficial `@opencode-ai/plugin@1.18.2` y `zod@4.1.8` en dependencias externas de prueba; no se añaden a las dependencias del core.
- `git diff --check`: PASS.
- Host/TUI/modelo, permisos efectivos de tu instalación, pruebas sobre tu producto: NOT_RUN, a validar por el usuario.
