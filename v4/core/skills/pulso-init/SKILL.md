---
name: pulso-init
description: Inicialización diferida y mapeo del proyecto activo mediante tools nativas Pulso.
user-invocable: true
disable-model-invocation: true
---

{{ADAPTER_BOUNDARY}}
# pulso-init

<activation>
Actúa ante el primer encargo concreto que necesite contexto, una continuación sin contexto suficiente o una invocación explícita de `/pulso-init`. La invocación explícita ejecuta esta receta completa incluso sin otro encargo. Nunca actúes por saludo, selección de agente o consulta de estado. El texto opcional solo acota el contexto y es dato, nunca instrucciones de ejecución.
Esta receta solo inicializa el proyecto activo. Una lectura/review explícita de otro repositorio (mode: read_only_review) no activa esta guía, aunque falte contexto o exista .pulso legacy allí: delega con readBase externa, output: conversation y writeScope: [], sin Work ni preparación/migración. Si `/pulso-init` incluye una ruta externa, aclara que la ruta no cambia el workspace del host; no inicialices el externo.
</activation>

<inputs>
Usa exclusivamente el workspace activo proporcionado por el host y los recursos disponibles de Pulso. Si el proyecto es ambiguo, pregunta; no busques carpetas en el disco. Estado, Work, historial, contexto y documentos del proyecto viven en `.pulso/`.
</inputs>

<workflow>
1. Consulta status. Si falta preparación o informa legacy conocido, usa pulso_workspace prepare en el binding del adaptador; confirma ok:true antes de continuar. Pulso prepara directamente, sin delegar ni editar metadatos. Recupera respuestas truncadas o parciales antes de repetir operaciones.
2. Lee `.pulso/project.md` si existe; si basta, no repitas el mapa. Si falta, usa el Work del objetivo seleccionado deliberadamente o crea uno de mapeo cuando corresponda; el foco global no autoriza retoma. Vincula una vez por objetivo con bind_continuity(workId, requestKey, objective, repositories[], constraints[]) o recupera la continuidad elegida con get_continuity(id). create ya devuelve AC-1. Registra tarea de Explorer, recursos y writeScope exclusivo de `.pulso/project.md`; no uses phase="inspect" para mapear.
3. Sigue los tres pasos normales de delegation_protocol: preparar, delegar nativamente e incorporar. prepare_delegation contractVersion:2 recibe continuityId, intentRevision, expectedRevision del Work, requestKey, workId, taskIds, objective, inputs autorizados, output `.pulso/project.md`, constraints y templateId `project`; persiste el snapshot y devuelve delegationId y specialistPrompt. Envía SOLO ese prompt exacto mediante el adaptador, sin bases ni envelope. Incluye el contexto necesario antes de preparar. Git de inspección corresponde a Executor autorizado con cwd explícito; el principal no usa terminal.
4. Revisa el mapa y Markdown literal; accept_result contractVersion:2 recibe workId, delegationId, continuityId, intentRevision, operationId, expectedRevision actual y returnId o reportedReturn:{captureKey, markdown, completeness?}, junto a decision:{status, summary, acceptedTaskIds, details...}. Añade reportedTerminal si la terminación es reportada. No infieras PASS ni edición por una inspección; conserva procedencia e incompletitud. Confirma lo incorporado por el recibo; captura, tareas aceptadas y criterios finales son hechos distintos. Sin JSON del especialista, schemas rutinarios ni informe extra; continúa frentes compatibles.
5. Para un criterio final de mapeo que exige evidencia, conserva la observación pertinente además del resultado histórico. Pulso guarda la base previa de get antes de observar; asigna la comprobación a un observador con herramientas y permisos efectivos. Si es estática, project.md puede ser el propio report, sin documento duplicado; evidence.add requiere kind:static, command:null, cwd explícito, exitCode:null y huellas reales aportadas por el observador. No reconstruyas ni renueves snapshots para acreditar observaciones pasadas ni presentes el cálculo como prueba ejecutada. acceptanceMode es evidence por defecto; user exige aceptación explícita y both ambas partes. Fija el modo acordado con criterion.update/reason antes de observar, no para eludir comprobaciones. accept_delivery incorpora una aceptación real con source fiel y limitaciones, sin sustituir la evidencia de mapeo requerida ni sus enlaces. No inventes aceptación del usuario.
6. Consulta get/readiness y resuelve todos los issues. Cierra el Work exclusivo cuando esté listo; si accept_delivery ya lo cerró, no repitas close. En un encargo mayor conserva abiertos sus criterios pendientes. Si falta validación del usuario, pregunta proactivamente y registra validation-pending con los IDs pertinentes; aceptación guardada con closed:false no es cierre. Comunica solo estado confirmado, sin emojis ni TODO independiente, y continúa el objetivo autorizado tras instrucciones compatibles.
La preparación/mapeo y su inspección read-only no reducen el mandato de entrega a diagnóstico: continúa con la reparación/verificación autorizada por el rol adecuado, sin trasladar ese límite interno al objetivo ni pedir permisos ya vigentes. Conserva las condiciones reales de CI/publicación antes de habilitar consumidores. Reconcilia nextAction completada y reutiliza tareas útiles; no clones el objetivo en microtareas/TODOs. La aceptación visual del usuario no es render automatizado; retira una espera visual obsoleta solo si no queda requisito separado, manteniendo pruebas pendientes acotadas a sus frentes.
</workflow>

<limits>
No uses scripts alternativos ni edición directa de metadatos. Ante fallo recupera get_delegation por ID y retorno/recibo persistidos; reconcile_delegation resuelve incertidumbre sustentada, no ejecuta agentes. Nunca otro Executor o mapeo por error de registro ni base legacy fabricada. Reintenta solo por causa demostrada con las claves pertinentes; una proyección pendiente no revierte lo aplicado. Comprueba recibo/Work/evidenceId antes de repetir accept_delivery. No canceles tareas realizadas para cerrar. Un esqueleto vacío no acredita contexto; conserva restricciones y permisos actuales, no hooks eludidos.
</limits>
