# Pulso

Asistente de desarrollo que aclara objetivos, coordina nueve especialistas y conserva continuidad verificable en tu proyecto.

## Empezar

Instala el archivo VSIX, abre una carpeta local confiable y elige **Pulso** en el selector de agentes del chat. También puedes usar **Pulso: Abrir chat**.

Usa **Extensions: Install from VSIX…** para seleccionar `pulso-<versión>.vsix` y recarga la ventana cuando se solicite. El paquete preparado no requiere npm ni compilación. La instalación se aplica al perfil seleccionado; otros perfiles y hosts remotos requieren su propia instalación compatible.

Con varias carpetas abiertas, selecciona el proyecto cuando se solicite. **Pulso: Seleccionar proyecto** permite cambiarlo. Abre el worktree previsto como carpeta antes de trabajar en él.

Un saludo o una consulta de estado no prepara el proyecto ni escribe archivos. `/pulso-init` prepara el proyecto y delega el mapa contextual real de `project.md` sin crear Work, tareas ni continuidad de Work. No exige QA, evidencia formal, readiness o cierre; comunica el mapa confirmado y sus limitaciones. Reutiliza un mapa suficiente. Las guías pulso-status, pulso-recap y pulso-resume ayudan a consultar y retomar el trabajo.

## Trabajo y revisión

Pulso conserva objetivos, tareas, decisiones y evidencia en `.pulso/`. Los especialistas reciben un encargo acotado y Pulso revisa su resultado antes de consolidarlo. Sigue las aprobaciones del chat y confirma el proyecto antes de una escritura.

Si el proyecto cambia, consulta el estado de nuevo y confirma que es el previsto. Si una operación informa de persistencia parcial, conserva el identificador y la revisión indicados y pide recuperación antes de repetirla. No edites manualmente los registros canónicos.

Las lecturas extensas se paginan mediante limit y cursor. Sigue hasMore y nextCursor para recuperar el contenido restante.

## Contratos y capacidades nativas

Las cuatro tools consumen los contratos comunes del core. VS Code recibe campos planos, sin wrapper `request`; `pulso_history` recibe filtros sin `action`. Todas las operaciones requieren `expectedBindingId`, incluidas lecturas de Work, historial y contexto. Sólo el primer `pulso_workspace action=status` sin continuidad ni cursor permite descubrir el binding sin token. Las mutaciones identificadas por `isMutating` conservan aprobación nativa, también las preferencias de usuario. Workspace Trust, cancelación y el snapshot inmutable `{root,bindingId,generation}` se comprueban durante la invocación.

- `bind_continuity`, `get_continuity` y `update_intent` mantienen un handle explícito por objetivo. Dos chats pueden usar continuidades distintas sobre la misma raíz; el adaptador no mantiene un «chat actual» global.
- `prepare_delegation` v2 es una mutación durable: devuelve `delegationId` y `specialistPrompt` sin lanzar agentes. Los inputs conversacionales van en `objective`/`constraints` o archivos autorizados accesibles. Core conserva contrato y base; no se retransmiten hashes ni el encargo canónico.
- `accept_result` v2 recibe IDs y decisión, con `returnId` o `reportedReturn` mutuamente excluyentes. Este adaptador usa el reporte literal del coordinador en la misma llamada: no dispone de captura directa de `agent`. El flujo sigue siendo preparar → delegar → incorporar. `reportedTerminal` resuelve sólo la reserva lógica reportada, no demuestra cese físico. Una decisión inválida puede conservar el retorno: recupera por `get_delegation` y reconcilia sin repetir implementación, delegación ni publicación. Sólo completa las tareas aceptadas y no satisface automáticamente los criterios.
- `decision` exige `status` y `summary`; `completed` exige también `acceptedTaskIds` explícitos. Los campos opcionales admitidos, como `checks`, `findings` y `limitations`, van directamente en ese objeto. `decision.details` no se admite.
- `accept_delivery` conserva aceptación manual declarada e intenta cerrar. `ok:true` no implica cierre: consulta `data.closed`, `data.readiness` y posibles `closeError`/`persistence`. Ante una respuesta perdida, consulta Work antes de repetir.
- `get` incluye diagnóstico completo de cierre y permite `section=results`. `close` admite `outcome=done` o `cancelled`; una pausa o una validación pendiente no son finalización ni motivo para cancelar tareas realizadas.

El frontmatter y el bloque de capacidades de cada agente derivan de la misma lista de tools por rol. Pulso no tiene `edit` ni `execute`; Executor y QA son los únicos especialistas con `execute`. La inspección Git se encarga a Executor con alcance de sólo lectura y cwd explícito. Las tools declaradas no garantizan disponibilidad ni sustituyen las aprobaciones del host. Una denegación expresa no se evita cambiando de rol.

Los recibos incluyen `provenance.runtime` con adaptador, nombre y versión leídos del `package.json` de la extensión cargada. `bindingId` identifica el vínculo ventana/proyecto; no es una sesión. No se fabrican IDs de sesión, reanudación ni garantías de paralelismo: la delegación usa únicamente las capacidades nativas disponibles.

Se mantiene una raíz por ventana. Cambios públicos de carpetas o concesión de Trust invalidan la generación; reseleccionar la misma raíz también renueva el binding. Una invocación antigua no se redirige. Si cambia el contexto después del commit, el recibo conserva los datos, raíz y binding originales con `contextChanged:true`. Tras recarga u otra ventana, confirma el nuevo binding y retoma deliberadamente la continuidad durable. La cancelación de una tool no acredita cancelación de `agent`.

La lógica local se verifica con dobles deterministas. La aceptación conversacional en **Local agent** y **Copilot Agent Host**, incluida correspondencia de rutas/worktrees, sigue pendiente; esos tests no acreditan ejecución en host real.
