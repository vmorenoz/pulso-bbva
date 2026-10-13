# Criterios de validación live

Estado al iniciar esta migración: **NOT_RUN**. Las pruebas offline no sustituyen esta aceptación en OpenCode v1.18 real.

## Smoke del plugin

1. Instalar con `node install.mjs` en un HOME de prueba.
2. Confirmar descubrimiento del plugin, las cuatro tools `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`, agentes, comandos y skills.
3. Abrir sesión normal y worktree si está disponible; comprobar que `context.directory` dirige cada tool al proyecto esperado. Comprobar por separado el destino del observador, que usa `directory` de inicialización del plugin.
4. Invocar una tool de lectura y una mutación; revisar nombre, input visible y recibo corto en la TUI.
5. Probar revisión obsoleta, ruta no segura, workspace no preparado y error de schema; deben fallar sin escritura parcial.

## Orquestación

1. Seleccionar `pulso` como agente principal.
2. Delegar una tarea de lectura al `pulso-explorer`.
3. Confirmar que la llamada de subagente continúa visible e inspeccionable.
4. Consolidar estado con `pulso_work`, usando `request.action: "update"`, `workId`, `expectedRevision` y acciones semánticas; no enviar work.json completo, state.json ni work.next.json.
5. Validar `.pulso/` con `pulso_workspace` y `request.action: "validate"`; revisar recibos breves de mutación y paginación de consultas, sin exigir que todas las respuestas tengan tres líneas.

No marcar PASS hasta observar la sesión. Registrar versión exacta de OpenCode, resultado, fallos y salidas visibles.
