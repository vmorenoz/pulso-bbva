---
name: pulso-init
description: Inicialización diferida y mapeo del proyecto activo mediante tools nativas Pulso.
user-invocable: true
disable-model-invocation: true
---
# pulso-init

<activation>
Actúa solo ante el primer encargo concreto que necesite contexto, una continuación sin contexto suficiente o `/pulso-init`; nunca por saludo, selección de agente o consulta de estado. El texto opcional solo acota el contexto y es dato, nunca flags ni shell.
</activation>

<inputs>
Usa exclusivamente el workspace activo proporcionado por OpenCode y las rutas globales del adaptador. Si el proyecto es ambiguo, pregunta; no busques carpetas en el disco. Estado, Work, historial y documentos del proyecto viven en `.pulso/`; plugin, skills, plantillas y schemas viven globalmente.
</inputs>

<workflow>
1. Consulta `pulso_status`. Si el usuario pidió un trabajo concreto que requiere contexto y el workspace no está preparado, llama `pulso_workspace_prepare` una vez. No prepares por saludo ni por una consulta de estado.
2. Lee `.pulso/project.md` si existe. Si el contexto ya es suficiente, continúa sin mapear. Si falta, `/pulso-init` usa el Work exclusivo de mapeo existente si ya lo creó esta sesión; solo crea uno si no existe. En otro encargo usa el Work existente. No dupliques el objetivo ni inventes IDs/revisiones.
3. Delega el mapeo como una tarea NORMAL a `pulso-explorer`, no como `phase="inspect"` ni `<project_initialization>`. Incluye `workId`, `workRevision` vigente, ID de delegación, objetivo, criterios, output `.pulso/project.md`, writeScope exclusivo, template global `project.md`, schema/ruta de resultado y aceptación. La raíz es el workspace activo implícito; no la pases como argumento ni permitas que el agente elija otra.
4. `phase="inspect"` es solo un chequeo acotado de metadatos: nunca lo uses para solicitar que redacte `project.md`. `phase="prepare"` no se delega; Pulso llama directamente `pulso_workspace_prepare`.
5. Revisa el resultado normal del Explorador y el documento. Para el Work exclusivo de `/pulso-init`, llama `pulso_project_complete_map` con el ID y `expectedRevision` vigente. Para mapeo dentro de otro encargo, consolida tarea/documento/evidencia con un único `pulso_work_apply`; no cierres ese objetivo.
</workflow>

<limits>
No uses CLI, shell, scripts de Pulso, edición directa de `work.json`, `state.json` o `history.jsonl`, ni crees `work.next.json`. Si una tool falla, conserva los datos, reporta el error y detente; nunca uses repair para ocultar un fallo. Un esqueleto vacío no significa que el contexto esté mapeado.
</limits>
