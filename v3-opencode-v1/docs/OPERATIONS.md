# Operaciones de Pulso en OpenCode v1

La interfaz operativa son las custom tools del plugin. No existe CLI de operaciones. El único CLI de Pulso es `install.mjs`/`uninstall.mjs`, que administra recursos globales y nunca datos del proyecto.

## Ciclo normal

1. `pulso_workspace` orienta sin escanear todos los Work.
2. `pulso_work` crea un objetivo con criterio verificable.
3. Especialistas trabajan mediante las delegaciones nativas visibles de OpenCode.
4. Pulso consolida el lote aceptado con `pulso_work` action `update`, pasando siempre `expectedRevision` actual.
5. `pulso_workspace` action `validate` comprueba estructura/referencias; `fresh: true` comprueba fingerprints.
6. `pulso_work` action `close` cierra solo después de revisar evidencia. Reabrir requiere motivo y `expectedRevision`.

## Revisión de otro repositorio, solo lectura

Una petición como `/ruta/otro-repo revisa mi mapper con últimas modificaciones` permite leer y revisar ese repo aunque el workspace activo sea otro. Pulso delega al Explorador o Code Reviewer con herramientas nativas, ruta base externa explícita y devolución en conversación. No activa `pulso-init`, no necesita un Work ni crea/migra `.pulso` en el externo. Tampoco prepara el proyecto activo solo para esa consulta. Las tools de metadata siguen vinculadas al workspace del host.

Ejemplo de encargo nativo (texto del prompt, no schema persistente):

```text
mode: read_only_review
readBase: /ruta/otro-repo
objective: Revisar el mapper con sus últimas modificaciones.
scope: Mapper y consumidores relevantes; inspeccionar cambios staged/unstaged.
inputs: Ruta del mapper si se conoce; base del diff confirmada si existe.
acceptance: Hallazgos con rutas/líneas, impacto, evidencia y límites.
output: conversation
writeScope: []
restrictions: Solo lectura; sin inicialización, metadata ni comandos con efectos laterales.
```

Usar rutas absolutas para lectura/búsqueda y resolver referencias del repo desde `readBase`. Inspección Git con directorio explícito y permisos efectivos (por ejemplo, `workdir` del host); no usar shell `cd` para esquivar límites. Si «últimas modificaciones» no distingue una base o archivos, aclarar lo necesario sin inventar commits ni atribuir autoría.

La composición **hereda `external_directory` del host**, sin añadir reglas `allow` ni sobrescribir sus patrones `ask`/`deny`. Si el host pide aprobación para la ruta, usar su mecanismo nativo; una aprobación de directorio no sustituye los permisos de lectura o comandos. Si deniega, informar ese bloqueo concreto. No modificar configuración global para habilitar la revisión. La ruta no cambia el workspace ni autoriza escritura. Edits multi-repo requieren alcance específico por repo y permisos, y no forman parte de esta excepción.

Verificación live pendiente en OpenCode v1: desde repo A sin contexto Pulso, pedir la revisión de repo B, aprobar el acceso externo cuando el host lo solicite y comprobar que el especialista recibe `readBase`, devuelve hallazgos en conversación, no inicializa A ni crea/migra metadata en B. El observador pasivo existente puede registrar el intento de delegación en A; eso no crea un Work, no prepara el proyecto ni guarda los hallazgos. Repetir con acceso denegado: debe informar el bloqueo sin workaround. Los tests locales de composición comprueban el contrato distribuido y la conservación de permisos; no prueban interacción del modelo ni aprobaciones reales del host.

Tras instalar los recursos actualizados, salir y reiniciar OpenCode para recargar agentes/skills/plugin.

## Contrato de mutación

`pulso_work` action `update` admite entre 1 y 20 acciones semánticas en una operación: `work.set_overview`, `criterion.add/update/remove`, `task.add/update/set_status/remove`, `document.register/unregister` y `evidence.add/update/remove`.

La entrada no admite una raíz de proyecto, JSON completo de Work, JSON Patch, hashes proporcionados por el modelo ni rutas absolutas. El core valida referencias, computes hashes desde archivos reales y guarda una vez. Las revisiones obsoletas fallan; se debe releer y reconciliar, nunca reintentar sobrescribiendo.

La tool devuelve un recibo breve con ID, revisión, estado, cambios y siguiente acción. Los archivos canónicos permanecen disponibles bajo `.pulso/` para auditoría; no se presentan completos en cada operación.

`pulso_work` action `create` permite omitir `workId`: el core asigna el ID y lo devuelve en el recibo. Las demás acciones requieren el ID explícito; nunca se infiere el último Work.

`pulso_workspace` action `sync` requiere `workId` y `expectedRevision` y llama a `syncWorkOperation(root,{workId,expectedRevision})`. Action `recover` llama a `recoverWorkspaceOperation(root)` exclusivamente por petición explícita. Son operaciones del core sobre artefactos, no recuperación de agentes o sesiones. Ante error se informa el fallo; una consulta `status` solo identifica legacy por una firma conocida (`schema_version: 1` sin `schemaVersion`), no por cualquier excepción de lectura o validación.

## Evidencia y cierre

Cada evidencia requiere un informe existente, enlaces a IDs existentes y archivos fingerprintados. `done` exige criterios y tareas terminadas cubiertas por evidencia positiva y vigente; la estructura por sí sola no prueba la calidad semántica ni que una afirmación de ejecución sea cierta. Las tareas y los criterios con dependencias no se pueden quitar; los cierres archivados son inmutables.

`pulso_history` devuelve cierres filtrables y limitados. El mapeo usa las acciones ordinarias tipadas de `pulso_work`: create/update, validate_result y close solo tras aceptación; no existe un cierre automático de mapas.

## Preparación

`pulso_workspace` action `prepare` solo se invoca ante un primer encargo concreto o `/pulso-init`. Crea el esqueleto ausente, incluidos memoria, preferencias y aprendizaje; migra legacy reconocido y, si encuentra datos incompatibles o una preparación incompleta, preserva y reporta el error. Consultar estado/historial no prepara automáticamente.

`prepare` migra tareas legacy reconocidas en staging, mantiene IDs y criterios, deja resultados anteriores pendientes de revisión y conserva un backup íntegro `.pulso-legacy-<uuid>`. Admite estado `schema_version: 1` junto con esas tareas, sin Work/historial actuales; corrupción o versiones desconocidas no autorizan migración. Registra una identidad UUID local en `.pulso/project.json` y sus ubicaciones en `~/.pulso/projects/<uuid>.json`. El plugin pasa el home del runtime al core; las pruebas pueden inyectar `homeDir` y `coreDir` en la inicialización del plugin, sin exponerlos como argumentos de tools.

## Límites de consistencia

El core usa validación y escrituras atómicas por archivo, pero no es una transacción multiproceso. Debe existir un coordinador escritor por checkout. No hay daemon, scheduler, locks, actividad en tiempo real ni procesos de agentes propios.

## Observación pasiva de delegaciones

El plugin implementa los hooks reales OpenCode v1 `tool.execute.before`, `tool.execute.after` y `event` para `message.part.updated`, `session.error` y `session.status`, conforme a los tipos locales de `@opencode-ai/plugin` y `@opencode-ai/sdk`. Solo observa la herramienta nativa `task`. No hay polling, timers ni scheduler. Una falla de telemetría no bloquea la delegación ni modifica sus argumentos o resultados.

Los intentos se guardan separados de Work/state/history en `.pulso/delegation-attempts/<sha256 de sessionID/callID>.json`, con identidad nativa y, si se observa en metadata, `childSessionID`. Para correlacionar incluye `workId: ID` y `taskId: ID` inequívocos en el prompt. Se extraen únicamente IDs con formato acotado; se omiten etiquetas ambiguas y prompts superiores a 64 KiB. No se conserva el prompt, output, título, texto de error ni mensajes de retry. No se consulta el foco ni el último Work. Cada registro es pequeño y se escribe atómicamente; no es un lock multiproceso. No se crean archivos al arrancar, al saludar, para herramientas ajenas o eventos sin intentos relacionados.

- `completed`: retorno de `task` o ToolPart completed; no prueba aceptación del contenido ni termina tareas canónicas.
- `error`: ToolPart error o error de sesión relacionado; no se deduce cancelación de un texto libre.
- `cancelled`: confirmación nativa `session.error` con `error.name = MessageAbortedError` para una sesión relacionada con un intento abierto (o fallido). No hay estado cancelled de ToolPart en estos tipos v1.
- `in_progress`: observación no terminal, nunca prueba vida. `session.status` idle/busy/retry se conserva solo como última observación, sin promover éxito.

Eventos repetidos son idempotentes. Eventos no terminales tardíos no revierten resultados terminales; ante resultados contradictorios del mismo callID se conserva conservadoramente cancelled > error > completed. Si eventos de la misma llamada dan IDs explícitos contradictorios, se elimina esa correlación y se registra el nombre del campo en conflicto, sin escoger un Work. Una confirmación de aborto tardía puede precisar un error; los errores de sesión no alteran llamadas ya completadas. Un error de sesión sin sessionID, sin intento conocido o anterior a toda correlación no se atribuye a un Work. No se reconstruyen eventos perdidos.

`pulso_workspace` actions `attempts` y `reconcile_attempts` ofrecen lectura filtrada por `workId` o `sessionID`, con `limit` (1–100, por defecto 20). Reconciliar aquí es una lectura conservadora, sin escribir ni convertir desconocido en cancelado: vida siempre desconocida, incluidos reinicios. Los intentos abiertos requieren revisar artefactos, diff, cambios manuales y evidencia antes de decidir una nueva delegación. No se reimplementa por defecto ni se inventa un host capaz de reanudar sesiones.

Las pruebas temporales reproducen firmas de hooks, errores, abortos, duplicados y desorden de eventos. Esta evidencia demuestra comportamiento local del adaptador; no demuestra una sesión live, entrega garantizada de eventos, ni soporte de host/modelo/permisos. El instalador debe distribuir también `lib/delegation-observer.mjs` para activar telemetría; si falta, los hooks no bloquean `task` y la consulta informa el fallo. Tras actualizar plugin o agente, salir y reiniciar OpenCode para cargar los cambios.
