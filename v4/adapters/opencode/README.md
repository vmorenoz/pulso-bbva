# Pulso

Asistente de desarrollo que aclara objetivos, coordina nueve especialistas y conserva continuidad verificable en tu proyecto.

## Empezar

Instala el paquete mediante el instalador de Pulso y selecciona **Pulso** en OpenCode. Usa los comandos pulso-init, pulso-status, pulso-recap y pulso-resume para preparar, consultar y retomar trabajo.

`/pulso-init` prepara el proyecto y delega directamente el mapa contextual real de `project.md` al Explorador con escritura exclusiva de ese documento. Reutiliza un mapa suficiente. No crea Work, tareas ni continuidad de Work; no exige QA, evidencia formal, readiness o cierre. Los permisos nativos siguen vigentes y las demás delegaciones persistentes conservan prepare_delegation → task → accept_result.

Un saludo o una consulta de estado no prepara el proyecto ni escribe archivos. La preparación es una operación explícita. Los datos del proyecto se guardan en `.pulso/` y las preferencias personales se conservan entre proyectos.

## Trabajo y revisión

Cada operación respeta los permisos nativos. Pulso delega encargos acotados a especialistas y revisa sus resultados y evidencia antes de consolidar. Un retorno de una herramienta no significa que el trabajo haya sido aceptado.

Las herramientas de acciones reciben un objeto request con action y los campos de la operación. pulso_history recibe filtros planos. Las lecturas extensas se paginan mediante limit y cursor; sigue hasMore y nextCursor.

`pulso_work` consume los contratos comunes sin replicar sus reglas:

- `prepare_delegation` v2 registra un snapshot durable bajo permiso nativo, vinculado a continuidad/intención y al padre nativo disponible. Devuelve el ID y `specialistPrompt` exacto; no lanza agentes.
- `accept_result` v2 incorpora por `delegationId`/`returnId` y decisión revisada. Si no existe captura nativa, `reportedReturn` conserva el reporte en esa misma llamada. Un rechazo administrativo se recupera por ID, sin volver a delegar. Legacy conserva su contrato y base originales. Ninguna variante satisface criterios automáticamente.
- `accept_delivery` conserva aceptación manual declarada e intenta cerrar. No acredita ejecución ni completa tareas. Comprueba `data.acceptanceRecorded`, `data.closed`, `data.readiness` y posibles `closeError`/`persistence`; consulta Work antes de repetir tras un retorno perdido o parcial.

Las tres acciones usan el envelope `{request:{action,...}}` y el mismo permiso nativo `pulso_work` con patrón `action:workId`. Las mutaciones se identifican desde el contrato común. El retorno nativo contiene el recibo JSON en `output`: no equivale a `ok:true`, y `ok:true` confirma la operación, no el cierre del objetivo.

Los agentes generados publican un bloque simple de capacidades declaradas por rol, derivado de sus permisos: principal y Explorer sin bash; Executor y QA con bash `ask`; los demás especialistas sin bash. Son declaraciones, no garantías de disponibilidad del host. La inspección Git puede delegarse a Executor con alcance de sólo lectura y cwd explícito; una denegación expresa no se elude reasignando.

Cada recibo incluye `provenance.runtime` con adaptador, nombre y versión leídos del `package.json` del runtime cargado. `provenance.host` sólo aparece con los `sessionID`, `messageID` o `callID` que el host suministre en el contexto de la invocación. No se generan IDs sustitutivos ni se deducen del encargo; esta procedencia no acredita ejecución o aceptación de especialistas.

Si una operación informa de persistencia parcial, conserva el identificador y la revisión indicados y pide recuperación antes de repetirla. No edites manualmente los registros canónicos.

El paquete incluye el helper oficial de tools de @opencode-ai/plugin 1.18.2 y Zod 4.1.8. Sus avisos y licencias se conservan en plugin/vendor.

## Hooks de encargos durables

La ruta v2 reconoce `Encargo: ID · workId: ID · taskId/taskIds: ...` y verifica el prompt entero, rol y todas las tareas contra el registro. `before` propaga los rechazos del core (contexto, intención, padre nativo y duplicados); no usa el contenedor de errores del observador legacy. Los hooks no solicitan ni fabrican autorizaciones: sólo pueden registrar metadata de una preparación autorizada en la raíz confiable y sesión padre correspondiente, revalidada por core bajo su mutex.

`after` conserva el literal nativo completo antes de anotar `metadata.pulsoDurable` con `returnId`, completitud y captura pendiente/guardada. La señal terminal foreground es el wrapper exacto `<task id="ses_..." state="completed">\n<task_result>...</task_result>\n</task>`, junto con `metadata.parentSessionId === input.sessionID` y el ID del wrapper igual a `metadata.sessionId`. No exige `metadata.status`: las formas persistidas observadas no lo contienen. No reescribe `output`, decodifica XML ni infiere éxito de prosa: «Bloqueado» puede ser un reporte terminal válido sin aceptación técnica. `truncated:false` sólo produce completitud completa con la correlación terminal verificada; true/ausente conservan truncated/unknown. Parent/hijo contradictorios quedan pendientes.

Los eventos públicos `message.part.updated` pueden capturar/reintentar con `state.status === completed`, el wrapper terminal y la misma relación padre/hijo, `state.input` canónico y sesión/call del intento persistido. Running y retornos de inicio background no resuelven el intento. Un evento completed puede resolver background sólo si acredita ese retorno del hijo con la correlación completa. Se conserva todo el literal `state.output`; el evento original no se modifica. La ruta devuelve un recibo diagnóstico, cuya visualización por el host no se presupone.

Tras `METADATA_BUSY`, `after` comunica captura pendiente. Un nuevo `after` o un evento terminal suministrado explícitamente puede reintentar desde los IDs del prompt y validar el intento persistido, incluso al recrear los hooks, sin buscar todos los cuerpos ni depender de un mapa volátil. El mismo retorno es idempotente. **No hay recuperación automática de eventos perdidos al reiniciar:** sólo se procesan eventos recibidos/suministrados; no se consulta SQLite ni se inventa una API histórica. Si no llega un replay verificable, recuperar el encargo por ID y usar la reconciliación explícita del core (`explicitly_reconciled` con fuente reportada y sustento según su contrato). No equivale a host_terminal ni prueba cancelación/cese físico; no redispatch por el fallo administrativo.

Sin `.pulso/delegations-v2.json` no se activa la ruta gestionada: proyectos sin `.pulso` y legacy sin identidad pasan sin escritura. El marcador se conserva también para el índice del registro por archivos. Con registro presente, identidad/snapshot ausente, corrupción o árbol externo se rechazan; no se silencia un ENOENT anidado como si fuera legacy.

La telemetría legacy sigue siendo pasiva: no confirma aceptación ni actividad. Las fixtures con core real y formas públicas de hooks comprueban el contrato del adaptador, **no una conversación nativa**. Las formas de wrapper/metadata proceden de la auditoría de 58 tasks persistidas; eso no garantiza por sí solo que cada hook vivo reciba esos mismos campos. La capacidad efectiva de bloquear dispatch, recibir los payloads y capturar en OpenCode requiere aceptación en el host real; permanece pendiente. No se depende de SQLite interno, scheduler propio ni cancelación inventada.
