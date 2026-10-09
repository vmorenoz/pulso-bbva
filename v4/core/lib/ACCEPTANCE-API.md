# API de incorporación y cierre (E1)

Se mantienen `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`.
La fuente pública ejecutable de contratos es `tool-contracts.mjs`:
`toolContracts.pulso_work.actionSchemas` y `mutatingActions`.
Todos los objetos siguientes son el input de `pulso_work`, no un wrapper
`request`. Los adaptadores conservan su propio binding nativo.

## `prepare_delegation` — lectura

Campos obligatorios:

```text
action: "prepare_delegation"
workId: ID
taskIds: ID[1..50], sin duplicados
delegationId: ID
objective: texto no vacío, máximo 4000
inputs: ruta relativa[]
output: ruta relativa | "conversation"
constraints: texto[]
templateId: enum vigente de delegation.schema.json
```

Deriva agente único asignado, revisión, writeScope, resources, acceptance y
acceptanceBasis. Devuelve `data = {delegation, acceptanceBasis, hostContext,
note}`. `delegation` mantiene el esquema existente y `questions: []`.

`hostContext = {projectRoot, resourceRoot, readBase, cwd, paths: {inputs, output,
writeScope, readScope}}`: raíces exclusivamente del contexto confiable del
adaptador; rutas efectivas absolutas separadas del encargo relativo. `cwd` y
`readBase` son projectRoot. Para `output:"conversation"`, `paths.output` es null:
es retorno inline, no una ruta `root/conversation`, y admite `writeScope:[]`.
No descubre otro repositorio ni inventa una raíz de ejecución.

Inputs deben existir y estar dentro de los recursos relativos autorizados o
del alcance de escritura. Output de archivo y artefactos deben estar dentro del
alcance de escritura de las tareas; `conversation` no exige archivo ni concede
permisos adicionales. Recursos de capacidad que no sean rutas válidas
no conceden acceso de lectura. Se aplican las guardas existentes contra rutas
no normalizadas, escapes y symlinks. Los inputs conversacionales se incluyen
en objective/constraints o mediante archivos accesibles autorizados.
El catálogo y la plantilla se leen desde resourceRoot, nunca desde el input.

No escribe ni reserva IDs ni lanza agentes. Conservar delegation y
acceptanceBasis originales antes de observar el resultado.

## `accept_result` — mutación

Campos obligatorios:

```text
action: "accept_result"
workId: ID
expectedRevision: entero positivo actual
delegation: delegation original, esquema existente
acceptanceBasis: {criteria: [{id, sha256}], tasks: [{id, sha256}]} previa
result: resultado reportado, result.schema.json existente
acceptedTaskIds: ID[0..50], subconjunto sin duplicados de delegation.taskIds
summary: texto no vacío, máximo 2000
```

Valida identidad, asignación, ámbitos, catálogo, referencias y base pertinente.
La revisión global del encargo puede ser anterior si sus bases siguen vigentes;
expectedRevision sigue siendo la revisión actual de escritura. No recalcula una
base previa para acreditar un retorno pasado. Las bases no prueban identidad
nativa ni ejecución; el orquestador decide la aceptación semántica.

Sólo `result.status: completed` admite acceptedTaskIds no vacío. Otros retornos
se pueden conservar con `[]`. Marca done exclusivamente las tareas enumeradas,
conserva el resultado inmutable y no vincula evidencia a criterios.

Retorna recibo más `{resultId, report, acceptedTaskIds, duplicate, readiness}`.
Una repetición con la misma delegationId en el mismo ciclo y el mismo contenido
no escribe ni duplica; cambios de orden de claves JSON no alteran la identidad.
Para cambiar un resultado ya aceptado se necesita otro encargo identificable.
Repetir con una revisión antigua sigue produciendo conflicto de revisión.

El core escribe `.pulso/work/<workId>/results/<RES-UUID>.json` con el encargo,
resultado reportado, base previa, selección de tareas, resumen y registeredAt;
después obtiene el SHA-256 real del documento. Un resultado inline no requiere
un segundo Markdown ni que output figure en artifacts. Output puede ser
`conversation` o una ruta autorizada que core no escribe. Los artifacts/changedFiles que sí se
declaren deben existir; sus bytes actuales no se usan para acreditar ejecución
pasada. `validate_result` conserva su validación estricta de revisión y de output
de archivo; también admite `conversation` sin artifact de salida. accept_result
usa la identidad factorizada y las reglas anteriores.

`Work.results` es opcional al leer trabajos anteriores. Contiene índices
inmutables con IDs, ciclo, fechas, bases, tareas aceptadas y hash/ruta del informe.
`get section=results` los devuelve paginados; el contenido original está en report.

## `accept_delivery` — mutación

Campos obligatorios:

```text
action: "accept_delivery"
workId: ID
expectedRevision: entero positivo actual
summary: texto no vacío, máximo 2000
criterionIds: ID[1..50], sin duplicados
source: {text: texto no vacío hasta 8000, messageRef?: texto no vacío hasta 2000}
limitations: texto[0..30], cada texto no vacío hasta 1000
```

Registra evidencia `manual/pass`, `origin:"user_acceptance"`, `command:null`, `exitCode:null`, `taskIds:[]`,
con procedencia declarada por el orquestador. Genera ID, documento JSON propio,
fecha de registro y hash posterior a la escritura. checkedAt corresponde a la
incorporación de la declaración, no a una supuesta comprobación externa pasada.
La base es la de los criterios actuales aceptados en esta operación.

El informe `.pulso/work/<workId>/evidence/<EV-UUID>.json` conserva source completo,
limitaciones y esperas resueltas. Sólo acredita la aceptación manual declarada:
no ejecución, cobertura automatizada ni realización de tareas. **Añade** enlaces
a los criterios seleccionados sin reemplazar ninguno. Conserva todas las
observaciones anteriores, incluidas las archivadas. El campo origin es opcional
en evidencia persistida; `user_acceptance` lo genera accept_delivery, no
evidence.add. Una observación manual ordinaria no es aceptación explícita del usuario.

Puede retirar exclusivamente estas esperas explícitas, de blockers,
decisionsPending o nextAction:

- `validation-pending:AC-1,AC-2` cuando esos criterios quedan sustentados.
- `Pendiente de validación del usuario` y `Validación pendiente del usuario`
  cuando quedan sustentados todos los criterios.

No interpreta otra prosa ni retira decisiones técnicas. Los criterios sustentados
deben cumplir su acceptanceMode completo: una nueva declaración sólo resuelve
la parte de usuario, nunca faltas o fallos de evidencia ordinaria. No cambia
estado/asignación/dependencias de tareas ni requisitos. Una tarea abierta sigue
impidiendo cerrar aunque la declaración del usuario sea positiva.

Guarda la aceptación **antes** de intentar cierre. Retorna recibo más
`{acceptanceRecorded:true, evidenceId, report, resolvedWaits, closed, readiness}`.
Si el cierre encuentra impedimentos, la aceptación permanece y `closed:false`.
Si falla la persistencia del cierre, añade `closeError` y, cuando corresponde,
`persistence`. `closed:true` con un error de proyección significa que Work está
cerrado pero requiere sincronizar historia/índice. `ok:true` confirma la
incorporación, no que el objetivo esté cerrado: consultar closed y readiness.

No hay idempotencia implícita para accept_delivery: leer Work y confirmar el
evidenceId antes de repetir tras una respuesta parcial o perdida.

## Modo de aceptación y bases compatibles

Cada criterio admite `acceptanceMode?: "evidence" | "user" | "both"`:

- `evidence` es el valor por defecto para legacy y criterios sin campo. Mantiene
  las reglas de evidencia ordinaria, incluida observación manual, e ignora para
  el cierre la evidencia con `origin:"user_acceptance"`.
- `user` requiere al menos una aceptación explícita vigente con ese origin;
  una observación manual sin origin no la sustituye.
- `both` exige ambas partes. Una aceptación global nunca dispensa tests, cobertura
  u otra evidencia ordinaria pendiente.

No se infiere el modo a partir de descripción, verification o texto conversacional.
Las acciones públicas de `update` admiten:

```text
{type:"criterion.add", criterion:{id, description, verification, acceptanceMode?}}
{type:"criterion.update", criterionId, reason, decisionRef?,
 description?, verification?, acceptanceMode?}
```

Cambiar el modo requiere reason e invalida los enlaces y las tareas afectadas
mediante el mecanismo existente. `create` continúa creando AC-1 con modo
implícito evidence; cambiarlo exige criterion.update explícito.

La base normaliza ausencia/evidence al mismo significado y **omite** ese modo
por defecto del payload del hash, preservando exactamente los hashes legacy.
Los modos user/both sí forman parte del hash. El contador de cambios evita que
volver a un modo anterior reactive evidencia antigua.

`task.update` también detecta cambios de title y agent, exige reason y registra
ambos campos en los snapshots before/after. El contador ya presente en el hash
de tarea invalida bases del encargo y dependientes, sin cambiar la forma del hash
ni invalidar evidencia legacy intacta. Los nuevos campos de snapshots son
opcionales al leer registros anteriores.

## Diagnóstico, errores y persistencia

`get` incluye readiness completo en todas sus secciones, independiente de la
paginación: `{ready, revision, issues:[{code,entity,message}], evidenceIds}`.
El mismo evaluador alimenta close. Un cierre rechazado devuelve
`ok:false`, `error.code: CLOSURE_NOT_READY`, todos los issues y
`data.readiness`. Se mantienen estados existentes y cierres históricos.

Una tarea done requiere resultado aceptado o evidencia pertinente con base
vigente e informe íntegro. No exige que todos los archivos de implementación
conserven sus bytes históricos. Los criterios finales sí comprueban la frescura
de los archivos de la evidencia requerida por su modo. Readiness usa también
`USER_ACCEPTANCE_REQUIRED` y `USER_ACCEPTANCE_STALE` para la parte de usuario.
Nuevas transiciones a done sin sustento se rechazan.

`Work.completedTaskIds?: ID[]` conserva la huella de realización del ciclo actual.
Al guardar se unen las tareas done legacy, la huella previa y las tareas de
resultados inmutables aceptados del ciclo. Cambiar a pending, retirar evidencia
o invalidar aceptación no borra esa huella. No se permite cancelar ni eliminar
esas tareas; done → pending → cancelled se rechaza también entre mutaciones
separadas, con `TASK_ALREADY_COMPLETED` para cancelación. El cierre cancelled
tampoco convierte en cancelled una tarea realizada que volvió a pending.
Reopen incrementa el ciclo, vacía la huella y conserva los resultados históricos;
las tareas se pueden reinterpretar en el ciclo nuevo. No se reconstruyen estados
pasados que un Work legacy ya no conserva ni se reclasifican cierres históricos.

Errores de schema: `error = {code:"SCHEMA_INVALID", message, issues, issueCount}`,
como máximo ocho detalles concisos; se elige la alternativa pertinente en vez
de imprimir todas las variantes. Otros errores tienen code/message y detalles
cuando existen. Los diagnósticos de cierre no se truncan al primer impedimento.
Esquemas de salida: `tool-error.schema.json`, `closure-readiness.schema.json` y
los campos opcionales nuevos de `work-receipt.schema.json`.

Se conserva la persistencia síncrona existente: Work canónico, historia e índice
reparables. **No hay transacción multifichero.** Un documento puede quedar escrito
sin incorporación; una revisión de Work puede estar persistida con proyecciones
incompletas. Los errores incluyen rutas/IDs y persistence para reconciliar sin
reintento ciego. La recuperación existente no borra documentos huérfanos.
No se añaden sesiones, scheduler, locks ni estados. No se garantiza que runtimes
antiguos acepten los campos nuevos.
