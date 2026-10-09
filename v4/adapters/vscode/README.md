# Pulso

Asistente de desarrollo que aclara objetivos, coordina nueve especialistas y conserva continuidad verificable en tu proyecto.

## Empezar

Instala el archivo VSIX, abre una carpeta local confiable y elige **Pulso** en el selector de agentes del chat. También puedes usar **Pulso: Abrir chat**.

Con varias carpetas abiertas, selecciona el proyecto cuando se solicite. **Pulso: Seleccionar proyecto** permite cambiarlo. Abre el worktree previsto como carpeta antes de trabajar en él.

Un saludo o una consulta de estado no prepara el proyecto ni escribe archivos. Pide la preparación explícitamente para iniciar la continuidad local. Las guías pulso-init, pulso-status, pulso-recap y pulso-resume ayudan a preparar, consultar y retomar el trabajo.

## Trabajo y revisión

Pulso conserva objetivos, tareas, decisiones y evidencia en `.pulso/`. Los especialistas reciben un encargo acotado y Pulso revisa su resultado antes de consolidarlo. Sigue las aprobaciones del chat y confirma el proyecto antes de una escritura.

Si el proyecto cambia, consulta el estado de nuevo y confirma que es el previsto. Si una operación informa de persistencia parcial, conserva el identificador y la revisión indicados y pide recuperación antes de repetirla. No edites manualmente los registros canónicos.

Las lecturas extensas se paginan mediante limit y cursor. Sigue hasMore y nextCursor para recuperar el contenido restante.

## Contratos y capacidades nativas

Las cuatro tools consumen los contratos comunes del core. VS Code recibe campos planos, sin wrapper `request`; `pulso_history` recibe filtros sin `action`. Todas las mutaciones identificadas por `isMutating` conservan aprobación nativa y `expectedBindingId` obtenido de `pulso_workspace` con `action=status`, también las preferencias de usuario. Workspace Trust y la carpeta local vinculada se comprueban durante la invocación.

- `prepare_delegation` es lectura: devuelve encargo, base previa y contexto de rutas confiable sin lanzar agentes. Los inputs conversacionales van en `objective`/`constraints` o archivos autorizados accesibles.
- `accept_result` incorpora el resultado revisado con su encargo y base originales; sólo completa las tareas seleccionadas y no satisface automáticamente los criterios.
- `accept_delivery` conserva aceptación manual declarada e intenta cerrar. `ok:true` no implica cierre: consulta `data.closed`, `data.readiness` y posibles `closeError`/`persistence`. Ante una respuesta perdida, consulta Work antes de repetir.
- `get` incluye diagnóstico completo de cierre y permite `section=results`. `close` admite `outcome=done` o `cancelled`; una pausa o una validación pendiente no son finalización ni motivo para cancelar tareas realizadas.

El frontmatter y el bloque de capacidades de cada agente derivan de la misma lista de tools por rol. Pulso no tiene `edit` ni `execute`; Executor y QA son los únicos especialistas con `execute`. La inspección Git se encarga a Executor con alcance de sólo lectura y cwd explícito. Las tools declaradas no garantizan disponibilidad ni sustituyen las aprobaciones del host. Una denegación expresa no se evita cambiando de rol.

Los recibos incluyen `provenance.runtime` con adaptador, nombre y versión leídos del `package.json` de la extensión cargada. `bindingId` identifica el vínculo ventana/proyecto; no es una sesión. No se fabrican IDs de sesión, reanudación ni garantías de paralelismo: la delegación usa únicamente las capacidades nativas disponibles.
