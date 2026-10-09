---
name: pulso-resume
description: Retomar un objetivo usando artefactos y el estado real del repositorio.
user-invocable: true
disable-model-invocation: true
---

{{ADAPTER_BOUNDARY}}
# pulso-resume
Esta skill es una entrada conversacional para Pulso, no un nuevo agente ni un script autónomo. Solo actúa como LT si el agente principal efectivo es pulso; de lo contrario indica que debe seleccionarse pulso. Una skill no cambia por sí sola la identidad del agente.

Consulta status y get del Work sobre el workspace activo; nunca HOME. Recupera resultados aceptados mediante get section=results y sus report cuando sean pertinentes, junto con evidencia y readiness completo. Sigue hasMore/nextCursor en el alcance necesario. Un estado guardado no prueba agentes vivos ni ejecución actual. Un Work cerrado necesita reapertura explícita con motivo y revisión confirmada; conserva su ID e historia.

El argumento es texto natural opcional con el ID de Work y, si hace falta, una indicación de continuidad, por ejemplo `work-checkout` o `work-checkout, retoma desde las pruebas`. Para reabrir uno cerrado debe incluir el motivo. Sin argumento, retoma el foco actual solo si es inequívoco; de lo contrario pregunta cuál. No espera flags ni sintaxis de shell.

No crees un Work ni inicialices por no encontrar el solicitado. Primero confirma la existencia del Work con las tools. Si ese Work necesita contexto faltante, aplica la receta pulso-init manteniendo el mismo objetivo e ID; ante esta continuación explícita, prepare puede migrar legacy reconocido conservando respaldo; corrupción o mezcla ambigua bloquean sin sobrescribir.

Antes de repetir acciones, contrasta efectos y cambios posteriores: Explorer para lectura técnica y Executor para inspección Git con cwd de repositorio explícito y alcance de solo lectura. Pulso no usa terminal. Reasigna una capacidad ausente del rol, nunca una operación denegada. Investiga imports, APIs y comandos; pregunta solo decisiones pendientes. No reimplementes trabajo ya aceptado ni fabriques resultados para tareas antiguas.

Conserva acuerdos y autorización del encargo actual con texto/referencia, operación, alcance y límites en el resumen confirmado del Work, sin documento adicional; no conviertas autorizaciones históricas en permisos nuevos. Integra steering compatible y continúa. Tras cada retorno reevalúa y delega los frentes compatibles mediante paralelismo nativo; un bloqueo afecta solo sus dependientes.

Para nuevas delegaciones registra tareas y usa prepare_delegation; conserva delegation y acceptanceBasis previas y pasa hostContext separado e inputs realmente accesibles. Revisa el retorno antes de accept_result con expectedRevision actual confirmada y acceptedTaskIds explícitos. No reconstruyas bases ni descartes resultados independientes solo por revisión global avanzada. Un resultado inline no necesita Markdown duplicado; core genera su registro y hash. La tarea aceptada no acredita automáticamente criterios finales.

Comprueba acceptanceMode: evidence (por defecto), user o both. Si el usuario confirma aceptación suficiente, usa accept_delivery con criterionIds pertinentes, source fiel y limitations; añade aceptación explícita sin reemplazar evidencia ni satisfacer su parte técnica pendiente. Si falta validación, incluida la del despliegue, pregunta proactivamente y registra validation-pending con los IDs; no inventes despliegue ni ejecución. Confirma ok:true/revisión y distingue acceptanceRecorded de closed: con closed:false conserva la aceptación y resuelve todos los issues de readiness, sin volver a pedirla ni cancelar/eliminar tareas de completedTaskIds aunque hayan vuelto a pending. Cierra naturalmente cuando proceda; pausa no es cierre.

Solo recibos ok:true y revisiones confirmadas actualizan el estado comunicado o un TODO espejo. Ante error o salida truncada recupera Work/resultados/evidencia y persistence antes de reintentar; accept_delivery no es idempotente. sync/recover reconcilian metadatos, no sesiones nativas. No lances automatizaciones alternativas ni cambies configuración global. Comunica avances, límites y próxima acción sin emojis.
