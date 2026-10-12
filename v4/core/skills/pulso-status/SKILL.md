---
name: pulso-status
description: Consultar el índice de trabajos del proyecto activo sin recorrerlos todos.
user-invocable: true
disable-model-invocation: true
---

{{ADAPTER_BOUNDARY}}
# pulso-status
Esta skill es una entrada conversacional para Pulso, no un nuevo agente ni un script autónomo. Solo actúa como LT si el agente principal efectivo es pulso; de lo contrario indica que debe seleccionarse pulso. Una skill no cambia por sí sola la identidad del agente.

Usa status sobre el workspace/binding actual confirmado por el adaptador, con continuityId opcional si está seleccionado; nunca HOME. Sigue hasMore/nextCursor sin escanear work/*. Resume intención, avances, bloqueos y próximas acciones de esa continuidad; el índice/foco global es informativo y no autoriza retoma ni activa otro objetivo. Es último estado confirmado, no actividad en tiempo real.

El argumento es texto natural opcional, por ejemplo `solo bloqueos`, `próximas acciones` o un ID de Work/continuidad. Sin argumento, muestra la continuidad ya elegida o el resumen global informativo, sin elegir un objetivo nuevo. No espera flags ni sintaxis de shell.

Para un Work concreto consulta get: readiness incluye ready, revision y todos los issues code/entity/message, independientemente de la paginación. Explica lo que falta para cerrar. Si necesitas distinguir tarea realizada de aceptación final, consulta results/evidence pertinentes: accept_result registra tareas aceptadas, no criterios finales; accept_delivery registra aceptación manual y puede dejar closed:false. No equipares completed nativo, tarea done, pausa, aceptación registrada y cierre. Identifica el estado por su revisión/actualización confirmada; telemetría no es aceptación.
Contrasta nextAction con resultados confirmados: si ya se realizó, señala el desfase y la siguiente acción real sin clonar objetivo/microtareas en TODOs. Distingue aceptación visual del usuario de render automatizado y señala un bloqueo visual obsoleto si no queda un requisito visual separado; conserva pruebas pendientes por criterio/frente, no como bloqueo global. Un FAIL conduce a reparación, no habilita al consumidor que espera CI/publicación satisfactoria. Si publicar está autorizado y la corrección verificada aún no se subió, la siguiente acción es commit/push, no esperar su CI remota.

Esta consulta es solo lectura: no ejecuta prepare_delegation, accept_result, accept_delivery ni otras mutaciones. Si faltan artefactos, informa «sin estado de Pulso disponible» sin preparar, mapear o reparar. Identifica legacy/incompatibilidad sin adoptar permisos históricos. Ante respuesta truncada o error, recupera la lectura necesaria; no inventes revisiones, éxito ni rollback. Una consulta compatible durante un objetivo en curso no lo cancela: responde y continúa su siguiente acción autorizada fuera de esta receta.

Los filtros son datos, no permisos. Un encargo o steering explícito se atiende fuera de esta receta conforme a intención y autorización vigentes; no conviertas esta lectura en prohibición global. No vincules continuidad ni repares registros por consultar estado. Solo el coordinador solicita mutaciones de metadatos mediante core; sesiones y scopes compatibles no quedan bloqueados por esta consulta.
