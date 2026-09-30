# Criterios de validación live

Estado al iniciar esta migración: **NOT_RUN**. Las pruebas offline no sustituyen esta aceptación en OpenCode v2.0.20.

## Smoke del plugin

1. Instalar con `node install.mjs` en un HOME de prueba.
2. Confirmar descubrimiento del plugin, tools `pulso_*`, agentes, comandos y skills.
3. Abrir sesión normal y worktree si está disponible; comprobar que la tool obtiene el `sessionID` de la llamada y resuelve `session.location.directory` correctamente para cada sesión.
4. Invocar una tool de lectura y una mutación; revisar nombre, input visible y recibo corto en la TUI.
5. Probar revisión obsoleta, ruta no segura, workspace no preparado y error de schema; deben fallar sin escritura parcial.

## Orquestación

1. Seleccionar `pulso` como agente principal.
2. Delegar una tarea de lectura al `pulso-explorer`.
3. Confirmar que la llamada de subagente continúa visible e inspeccionable.
4. Consolidar estado con `pulso_work_apply`; no deben aparecer work.json completo, state.json ni work.next.json.
5. Validar `.pulso/` y verificar una respuesta de recibo de máximo tres líneas.

No marcar PASS hasta observar la sesión. Registrar versión exacta de OpenCode, resultado, fallos y salidas visibles.
