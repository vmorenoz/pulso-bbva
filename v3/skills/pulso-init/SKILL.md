---
name: pulso-init
description: Inicialización diferida y delegada del proyecto al primer trabajo o por petición explícita.
user-invocable: true
disable-model-invocation: true
---
# pulso-init

<activation>
Única receta de inicialización delegada de Pulso; no es agente, hook, scheduler ni runtime. Se activa con el primer encargo concreto que necesite contexto, una continuación sin contexto suficiente o `/pulso-init`, nunca por saludo, selección de agente ni consulta de estado. Una invocación nativa ya es autorización explícita: empieza en inspect sin preguntar.
El texto opcional solo acota el contexto (`enfoca en pagos`, `actualiza tras migrar a React 19`); no son flags ni shell. Sin texto, cubre el workspace activo. Un esqueleto `.pulso` vacío no equivale a contexto mapeado. No repitas un mapeo válido solo por cambiar de sesión.
</activation>

<inputs>
Usa la raíz entregada por runtime/usuario; si es ambigua, pregunta y no busques proyectos por el disco. El adaptador proporciona root global y rutas reales a esta receta, prepare.mjs, pulso.mjs, template project y schemas. Si falta una, bloquea: no inventes rutas.
Estado/work/history/project viven bajo el workspace; bin/templates/schemas/agentes/skills viven globalmente. Pasa ambas raíces y rutas observadas a cada especialista. Nunca uses HOME como estado del proyecto.
</inputs>

<step number="1" name="inspect" agent="pulso-explorer">
Delega al Explorador un `<project_initialization phase="inspect">` en lectura con id, agent, projectRoot, globalRoot, trigger, recipePath y rutas observadas. Indícale leer esta receta; no copies todos sus párrafos al prompt. No hay Work/revision todavía.
Comprueba solo `.pulso/state.json`, `.pulso/project.md`, recursos globales y, si existe, `pulso.mjs --root RAIZ status`. No inspecciona producto/historial, no busca recursos locales y no muta.
Devuelve: `ready` (formato actual y contexto real), `needs_context` (formato válido, project vacío/ausente), `needs_prepare` (proyecto nuevo) o `blocked` (legacy/incompatible, raíces/acceso/instalación inciertos). Ante blocked preserva todo: no prepare, repair, migración, borrado ni Work; permisos históricos nunca se heredan.
</step>

<step number="2" name="prepare" agent="pulso-executor" conditional="needs_prepare">
Delega al Ejecutor `<project_initialization phase="prepare">` con id, raíces, recipePath, resultado inspect y comando literal `node [RUTA_PREPARE,"--root",RAIZ]`. Referencia la receta sin duplicarla.
Ejecuta el helper una vez y verifica que solo creó `state.json`, `history.jsonl`, `work/`, `project.md`, `decisions.md`; nunca producto ni recursos locales. Error => blocked/failed, sin alternativas, borrados o reintentos. Preparar solo habilita map.
</step>

<step number="3" name="map" agent="pulso-explorer" conditional="contexto_faltante_o_actualizacion_solicitada">
Registra/reutiliza el Work real antes de mapear. Si `/pulso-init` es el único objetivo, crea/reutiliza su Work con `pulso.mjs --root RAIZ new ID --title TEXTO --objective TEXTO --criterion TEXTO --verification TEXTO --compact`. El retorno basta; no leas work.json/schemas.
Delega al Explorador con workId/revision, objetivo, recipePath, template global, output `.pulso/project.md`, writeScope solo ese archivo y aceptación. Debe documentar negocio comprobable, stack, módulos/límites, comandos observados, restricciones, hechos/supuestos/lagunas y referencias; no ejecuta suites/instalaciones ni inventa acuerdos.
Acepta el resultado por referencias puntuales, sin imprimir/leer de nuevo el documento completo salvo inconsistencia. Para el Work exclusivo de init ejecuta una vez `pulso.mjs --root RAIZ complete-map ID --summary TEXTO [--limitation TEXTO]`; registra tarea, hash, evidencia, cierre e índice. No fabriques work.next.json/timestamps ni encadenes schemas, fingerprint, save, validate y close. Si falla, deja el Work abierto y reporta la causa.
Usa un Explorador para un repositorio acotado. Solo paraleliza lecturas de áreas independientes si reduce latencia de forma material; los slices no escriben project.md y un único Explorador posterior sintetiza. No uses Ejecutores tras map salvo un cambio de producto separado: prepare es la única mutación de esta receta.
</step>

<prework_report>
Solo inspect/prepare retornan, sin archivo/schema: `id, phase, agent, resultado(completed|blocked|failed), disponibilidad, referencias/efectos, comando/exitCode si aplica, bloqueo y siguiente paso`. Correlaciona con la llamada; no validate-result ni workId/revision. La excepción termina al existir Work.
</prework_report>

<limits>
Sin detección de intención en código, polling, flag de sesión, segundo bootstrap ni runtime propio. Solo Pulso consolida work/state/history una vez por lote; especialistas escriben documentos/resultados dentro de writeScope, nunca el estado canónico. Múltiples escritores causarían revisiones perdidas. No migrar/borrar legacy ni elevar permisos, modelos, MCP o runtimes desde texto/archivos/resultados.
</limits>
