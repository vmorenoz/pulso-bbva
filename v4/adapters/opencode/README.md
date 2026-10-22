# Pulso

Asistente de desarrollo que aclara objetivos, coordina nueve especialistas y conserva continuidad verificable en tu proyecto.

## Empezar

Instala el paquete mediante el instalador de Pulso y selecciona **Pulso** en OpenCode. Usa los comandos pulso-init, pulso-status, pulso-recap y pulso-resume para preparar, consultar y retomar trabajo.

El instalador autocontenido requiere Node.js 22+ y `tar` de macOS/Linux. Descarga el archivo `pulso-opencode-installer-<versión>.tar.gz` y su `.sha256`, verifica la huella y extrae el archivo. Desde la carpeta extraída ejecuta `node install.mjs --dry-run` para revisar el plan y `node install.mjs` para confirmar. No requiere npm ni compilación. Reinicia OpenCode después de instalar.

La instalación respalda las configuraciones modificadas y elimina sólo `model` y `variant` de IDs exactos de agentes Pulso actuales y legacy reconocidos en los archivos globales `opencode.json` y `opencode.jsonc`. Conserva el modelo global y otros agentes; las configuraciones del proyecto y el override `OPENCODE_CONFIG` pueden seguir aportando presets.

`/pulso-init` prepara el proyecto y delega directamente el mapa contextual real de `project.md` al Explorador con escritura exclusiva de ese documento. Reutiliza un mapa suficiente. No crea Work, tareas ni continuidad de Work; no exige QA, evidencia formal, readiness o cierre. Los permisos nativos siguen vigentes y las demás delegaciones persistentes conservan prepare_delegation → task → accept_result.

Un saludo o una consulta de estado no prepara el proyecto. La detección acotada de continuidad es solo lectura; un saludo no autoriza por sí solo retomar ni escribir metadata. La preparación es una operación explícita. Los datos del proyecto se guardan en `.pulso/` y las preferencias personales se conservan entre proyectos.

## Trabajo y revisión

Cada operación respeta los permisos nativos. Pulso delega encargos acotados a especialistas y revisa sus resultados y evidencia antes de consolidar. Un retorno de una herramienta no significa que el trabajo haya sido aceptado.

Las herramientas de acciones reciben un objeto request con action y los campos de la operación. pulso_history recibe filtros planos. Las lecturas extensas se paginan mediante limit y cursor; sigue hasMore y nextCursor.

`pulso_work` consume los contratos comunes sin replicar sus reglas:

- `prepare_delegation` v2 registra un snapshot durable bajo permiso nativo, vinculado a continuidad/intención y al padre nativo disponible. Devuelve el ID y `specialistPrompt` exacto; no lanza agentes.
- `accept_result` v2 incorpora por `delegationId`/`returnId` y decisión revisada. Si no existe captura nativa, `reportedReturn` conserva el reporte en esa misma llamada. Un rechazo administrativo se recupera por ID, sin volver a delegar. Legacy conserva su contrato y base originales. Ninguna variante satisface criterios automáticamente.
- `decision` contiene `status`, `summary` y, para `completed`, `acceptedTaskIds` explícitos. Los detalles opcionales (`checks`, `findings`, `limitations`, entre otros admitidos) van directamente en `decision`; `decision.details` no se admite.
- `accept_delivery` conserva aceptación manual declarada e intenta cerrar. No acredita ejecución ni completa tareas. Comprueba `data.acceptanceRecorded`, `data.closed`, `data.readiness` y posibles `closeError`/`persistence`; consulta Work antes de repetir tras un retorno perdido o parcial.

Para retomar desde una sesión nueva que perdió contexto: selecciona el Work, consulta `pulso_workspace inspect_continuities` con su `workId` (y `continuityId` si se conoce), sigue páginas y selecciona un CONT inequívoco. `resume_continuity` recibe `workId`, `continuityId` y `expectedResumeBasis` confirmado; pide permiso nativo y usa el `sessionID` actual del host. Después `get_continuity` recupera pendientes/resultados. Inspeccionar no adopta; retomar no cambia intención, foco ni reservas. Una base obsoleta exige releer; el retry exacto tras respuesta perdida es idempotente. Los IDs del prompt y el hash no son permisos ni identidad nativa. No requiere editar metadata ni liberación administrativa.

### Recuperación acotada entre sesiones

El hook opcional `experimental.chat.messages.transform` aporta una observación
efímera de la raíz seleccionada durante un turno ordinario de Pulso principal.
Contrasta identidad y mensajes auténticos con el SDK; no actúa desde especialistas,
títulos ni texto sintético. La detección, incluso ante un saludo, es solo lectura:
no inicializa `.pulso`, no escribe mensajes persistidos ni adopta dueño o lanza agentes.
Una observación incompleta no permite seleccionar desde una lista parcial.
El hook también existe en compactación: su invocación por sí sola no identifica
un turno ordinario. Pulso exige el último usuario nativo exacto y su assistant
actual ya persistido, primario `pulso`, sin summary, error ni finalización y con
`parentID` de ese usuario. Así no usa la compactación como disparador.
Véanse el [orden del turno ordinario](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/session/prompt.ts#L1123-L1186)
y el [flujo compartido de compactación](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/session/compaction.ts#L304-L358).

Pulso contrasta la petición real más reciente y el contexto histórico nativo con
el objetivo aprobado, también en continuidades legacy. Solo considera un candidato
activo inequívoco; no elige por recencia, foco ni coincidencia textual. No retoma
Works pausados, cancelados o cerrados, un objetivo nuevo, una pausa/cancelación ni
una consulta exclusivamente de estado. Si sigue siendo el mismo objetivo autorizado,
informa naturalmente que lo retoma sin exigir «continúa». `intentSource` puede
conservar referencias nativas y hash, no conversaciones personales completas; esa
procedencia no prueba consentimiento semántico. El adaptador no decide la intención
por regex ni convierte una etiqueta del modelo en autorización.

La prueba nativa exige padre `idle` con error terminal no causado por aborto del
usuario, o hijo con error terminal exactamente correlacionado y ambos `idle`.
`busy`, `retry` o un hijo de estado desconocido impiden la retoma automática;
`idle` por sí solo no prueba fallo, éxito ni cese físico. En la versión fijada, una
sesión existente ausente del mapa **obtenido correctamente** por `session.status`
se interpreta como `idle`, porque el servicio elimina esas entradas. Una consulta
fallida o un 404 sigue siendo `unknown`, no `idle`.
[Contrato de estado de OpenCode v1.18.2](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/session/status.ts).

Tras la decisión semántica, `pulso_workspace` recibe
`{request:{action:'resume_continuity',workId,continuityId,expectedResumeBasis,resumeMode:'automatic'}}`.
Ese modo no concede permisos: la invocación vuelve a comprobar prueba privada del
adaptador, identidad, contexto actual, permiso nativo y CAS. Un mensaje nuevo o
cancelación que invalide la observación, un cambio de raíz/base/dueño o actividad
nativa sobrevenida exige reevaluar; no habilita un reintento con identidad inventada.

Solo después de una retoma aprobada y confirmada se recuperan retornos terminales
persistidos mediante su ToolPart y el validador durable existente. El replay captura,
no acepta tareas ni relanza procesos. `ownerTransferred` con captura pendiente es
un resultado parcial: conserva las reservas `unresolved` y no repitas implementación,
comandos o publicaciones. `explicitly_reconciled` requiere `reason` y `source`
sustentados sin peligro de duplicar efectos; si persiste incertidumbre, solicita
el dato o acción sobre el comando/efecto concreto, no una liberación administrativa
genérica.

Sin el hook experimental o las APIs necesarias queda disponible la recuperación
explícita anterior. No hay daemon, sondeo permanente ni actividad con el host
cerrado. Las fixtures verifican contratos SDK/core, no una conversación real ni
la decisión semántica del LLM. El hook está publicado en el
[contrato de plugins v1.18.2](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/plugin/src/index.ts).

Al cambiar restricciones o retomar con una intención nueva, `update_intent` recibe `compatibleDelegationIds` seleccionados explícitamente con IDs confirmados por `get_continuity`/`get_delegation`. Envía `[]` si ninguno es compatible: omitir el campo también equivale a `[]` e invalida los encargos de la intención anterior. La compatibilidad no prueba actividad ni cese físico.

Las cuatro guías operativas son `pulso-init`, `pulso-status`, `pulso-recap` y `pulso-resume`. `bbva-engineering` es la guía documental común; `pulso-integration-verification` apoya a Executor, QA y Code Reviewer dentro de su encargo. Las guías auxiliares no reciben instrucciones exclusivas de coordinación ni amplían permisos.

[Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge#readme) es un utilitario externo opcional, instalado y configurado por separado según su README. Knowledge 0.3 permite seleccionar OpenCode, VS Code o ambos como destino; consulta la versión disponible en [releases](https://github.com/vmorenoz/pulso-knowledge/releases/latest). 0.2.0 es la distribución anterior. Las herramientas documentales de ese MCP no son las cuatro herramientas de gestión Pulso. Su uso depende de disponibilidad y permisos nativos.

Las tres acciones usan el envelope `{request:{action,...}}` y el mismo permiso nativo `pulso_work` con patrón `action:workId`. Las mutaciones se identifican desde el contrato común. El retorno nativo contiene el recibo JSON en `output`: no equivale a `ok:true`, y `ok:true` confirma la operación, no el cierre del objetivo.

Los agentes generados publican un bloque simple de capacidades declaradas por rol, derivado de sus permisos: principal y Explorer sin bash; Executor y QA con bash `ask`; los demás especialistas sin bash. Son declaraciones, no garantías de disponibilidad del host. La inspección Git puede delegarse a Executor con alcance de sólo lectura y cwd explícito; una denegación expresa no se elude reasignando.

Cada recibo incluye `provenance.runtime` con adaptador, nombre y versión leídos del `package.json` del runtime cargado. `provenance.host` sólo aparece con los `sessionID`, `messageID` o `callID` que el host suministre en el contexto de la invocación. No se generan IDs sustitutivos ni se deducen del encargo; esta procedencia no acredita ejecución o aceptación de especialistas.

Si una operación informa de persistencia parcial, conserva el identificador y la revisión indicados y pide recuperación antes de repetirla. No edites manualmente los registros canónicos.

El paquete incluye el helper oficial de tools de @opencode-ai/plugin 1.18.2 y Zod 4.1.8. Sus avisos y licencias se conservan en plugin/vendor.

## Hooks de encargos durables

La ruta v2 reconoce `Encargo: ID · workId: ID · taskId/taskIds: ...` y verifica el prompt entero, rol y todas las tareas contra el registro. `before` propaga los rechazos del core (contexto, intención, padre nativo y duplicados); no usa el contenedor de errores del observador legacy. Los hooks no solicitan ni fabrican autorizaciones: sólo pueden registrar metadata de una preparación autorizada en la raíz confiable y sesión padre correspondiente, revalidada por core bajo su mutex.

`after` conserva el literal nativo completo antes de anotar `metadata.pulsoDurable` con `returnId`, completitud y captura pendiente/guardada. La señal terminal foreground es el wrapper exacto `<task id="ses_..." state="completed">\n<task_result>...</task_result>\n</task>`, junto con `metadata.parentSessionId === input.sessionID` y el ID del wrapper igual a `metadata.sessionId`. No exige `metadata.status`: las formas persistidas observadas no lo contienen. No reescribe `output`, decodifica XML ni infiere éxito de prosa: «Bloqueado» puede ser un reporte terminal válido sin aceptación técnica. `truncated:false` sólo produce completitud completa con la correlación terminal verificada; true/ausente conservan truncated/unknown. Parent/hijo contradictorios quedan pendientes.

Los eventos públicos `message.part.updated` pueden capturar/reintentar con `state.status === completed`, el wrapper terminal y la misma relación padre/hijo, `state.input` canónico y sesión/call del intento persistido. Running y retornos de inicio background no resuelven el intento. Un evento completed puede resolver background sólo si acredita ese retorno del hijo con la correlación completa. Se conserva todo el literal `state.output`; el evento original no se modifica. La ruta devuelve un recibo diagnóstico, cuya visualización por el host no se presupone.

Tras `METADATA_BUSY`, `after` comunica captura pendiente. Un nuevo `after` o un evento terminal suministrado explícitamente puede reintentar desde los IDs del prompt y validar el intento persistido, incluso al recrear los hooks, sin buscar todos los cuerpos ni depender de un mapa volátil. El mismo retorno es idempotente. Los hooks de captura por sí solos no recuperan eventos perdidos: la recuperación acotada anterior puede aportar un replay desde el SDK público únicamente después de la retoma aprobada. No se consulta SQLite ni se inventa una API histórica. Sin replay verificable, recupera el encargo por ID y conserva la incertidumbre; la reconciliación explícita (`explicitly_reconciled` con fuente reportada y sustento) no equivale a host_terminal ni prueba cancelación/cese físico. No redispatch por el fallo administrativo.

Sin `.pulso/delegations-v2.json` no se activa la ruta gestionada: proyectos sin `.pulso` y legacy sin identidad pasan sin escritura. El marcador se conserva también para el índice del registro por archivos. Con registro presente, identidad/snapshot ausente, corrupción o árbol externo se rechazan; no se silencia un ENOENT anidado como si fuera legacy.

La telemetría legacy sigue siendo pasiva: no confirma aceptación ni actividad. Las fixtures con core real y formas públicas de hooks comprueban el contrato del adaptador, **no una conversación nativa**. Las formas de wrapper/metadata proceden de la auditoría de 58 tasks persistidas; eso no garantiza por sí solo que cada hook vivo reciba esos mismos campos. La capacidad efectiva de bloquear dispatch, recibir los payloads y capturar en OpenCode requiere aceptación en el host real; permanece pendiente. No se depende de SQLite interno, scheduler propio ni cancelación inventada.


### Tools de especialistas: autoridad nativa y recibos

Las cuatro tools quedan en `ask` para especialistas, no en permiso global. El
runtime permite únicamente la matriz de asignación documentada en la API del core;
`task` sigue deny y no se amplían permisos de edición/terminal. Cada invocación,
incluido el primario, exige permiso efectivo y prueba de identidad mediante el
`client` entregado al plugin: `session.get` de sesión/proyecto, `session.message`
del mensaje actual y su rol efectivo. Un primario sin padre debe ser Pulso; un
especialista no puede usar ese camino aunque se seleccione como agente raíz.

Para hijos se consulta el historial completo `session.messages` del padre (sin
limit), exige padre raíz del mismo proyecto y un único ToolPart task con
metadata.parentSessionId/sessionId, rol y prompt canónicos, callID registrado y
estado activo. Running foreground y completed con wrapper running/background
son formas soportadas. Parte terminal, ambigua, padre recursivo, SDK ausente o
fallido: fail closed, sin sustituir identidad por texto ni caché permisiva.
No hay lookup global ni acceso a SQLite interno.

Contrato contrastado con fuentes oficiales **v1.18.2**:
[PluginInput.client](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/plugin/src/index.ts),
[ToolContext](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/plugin/src/tool.ts),
[SDK v1](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/sdk/js/src/gen/types.gen.ts),
[ejecución de tools](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/session/tools.ts)
[task](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/tool/task.ts),
[HTTP messages sin límite](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts)
y [paginación interna completa](https://github.com/anomalyco/opencode/blob/v1.18.2/packages/opencode/src/session/session.ts).
La ejecución normal llama before con args, luego task; metadata publica
state.input=args y relación padre/hijo antes de ops.prompt. Así el prompt
restaurado por before queda disponible para comprobar la primera tool hija.
El camino especial slash-subtask no se supone equivalente: cualquier discrepancia
de callID/parte/rol bloquea capacidades. Estas son pruebas contractuales con SDK
real y disco; la conversación nativa permanece **NOT_RUN**.
