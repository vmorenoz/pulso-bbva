# API de incorporación, continuidad y cierre

Se mantienen `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`.
La fuente pública ejecutable de contratos es `tool-contracts.mjs`:
`toolContracts.pulso_work.actionSchemas` y `mutatingActions`.
Los objetos siguientes son argumentos planos de la herramienta indicada en cada
sección, antes del envelope o binding nativo que añade cada adaptador.

## Contrato durable `contractVersion: 2`

Coexiste con las formas legacy descritas más abajo. El discriminante es obligatorio
en preparar/incorporar v2; no se infiere a partir de campos parciales. Todas las
variantes de `prepare_delegation` se clasifican globalmente como **mutación** para
permisos, aunque la forma legacy conserva su lectura efímera. Los hooks nuevos sólo
gestionan snapshots v2. No hay migración ni recreación de bases históricas.

### Continuidad: acciones de `pulso_workspace`

```text
bind_continuity {workId, requestKey, objective, repositories: string[],
                 constraints: string[], sourceText?, continuityId?}
get_continuity {continuityId}
update_intent {continuityId, expectedRevision, objective, constraints,
               repositories?, compatibleDelegationIds?}
status {continuityId?, ...paginación existente}
```

`repositories` son rutas relativas seguras a la raíz confiable; `.` representa esa
raíz. No admiten escapes ni symlinks, ni otorgan permisos de filesystem. Se pueden
declarar varios repositorios sin descubrimiento Git. Al preparar, escritura,
integración y lecturas estables deben quedar dentro de los repositorios declarados.
Se rechazan segmentos `.` salvo la raíz literal `.`: `./repo`, `repo/.` y
`repo/./a` son inválidos en repositories, integrationResources y stableReadScope.
Las comparaciones usan rutas normalizadas por segmentos, sin aliases textuales.

`bind_continuity` conserva identidad del proyecto, Work/ciclo, intención revisionada,
restricciones y fuente disponible. Misma requestKey/contenido recupera el mismo
handle. Otra carga con esa clave falla. `nativeContext:{sessionID,messageID,callID}`
se recibe exclusivamente en el tercer argumento de `executeTool`, desde el
adaptador; esos campos no se admiten en JSON del modelo. Si hay owner session,
consultas y mutaciones dirigidas exigen esa sesión. **Retomar deliberadamente**
desde otra sesión exige `bind_continuity` con `continuityId` explícito y los datos
de intención actuales; cambia el owner, no el snapshot ni la intención. Sin
identidad nativa, el handle sólo asegura coherencia: no autentica conversaciones.

`update_intent` usa revisión propia (también devuelta como `intentRevision`);
omite compatibilidad por defecto. Sólo `compatibleDelegationIds` explícitos
conservan encargos de esa continuidad que todavía eran vigentes. Una revisión
posterior debe volver a declarar la compatibilidad; no revive encargos ya obsoletos.
No modifica bases ni prompt original, ni afirma haber detenido trabajo nativo.
La compatibilidad no puede eludir scopes: escritura, lecturas estables e integración
del snapshot deben seguir contenidos en los nuevos repositories. Se comprueba al
actualizar intención y de nuevo al dispatch/incorporar.

La cápsula deriva accepted de Work y pending de los registros; incluye returnIds,
resultId, vigencia y resolución de reserva. `nextAction:null` evita adoptar acciones
globales antiguas. `status` sin continuidad es inventario; `navigationFocusWorkId`
conserva el foco global sólo como navegación y `focusWorkId:null` no activa un objetivo.
Las consultas get_continuity/status no crean ni adquieren el mutex escritor. Usan
archivos atómicos y hasta tres intentos optimistas si cambia Work/intención durante
la lectura. La cápsula devuelve como máximo 50 referencias por lista, los últimos
10 returnIds por encargo y 20 eventos históricos resumidos; `totals`, `returnCount`,
`historyTotal` y `truncated` indican contenido adicional sin volcar cuerpos antiguos.

### Preparación y recuperación

```text
prepare_delegation {
  contractVersion:2, continuityId, intentRevision, expectedRevision,
  requestKey, workId, taskIds, objective, inputs, output, constraints, templateId,
  integrationResources?: string[], stableReadScope?: string[]
}
get_delegation {workId, delegationId, continuityId?}
```

Core genera `delegationId`. La respuesta pública v2 es compacta:

```text
data: {contractVersion:2, delegationId, workId, continuityId, intentRevision,
       preparedFromRevision, agent, specialistPrompt, state,
       readWith:{action:"get_delegation", workId, delegationId, continuityId}}
```

No retransmite `delegation`, `acceptanceBasis`, `hostContext` ni referencias nativas.
`agent` identifica el rol canónico para el dispatch nativo; se transmite el
`specialistPrompt` literal, sin añadir secciones ni retirar condiciones. El adaptador
informa discrepancias de prompt, rol, tareas o cabecera antes del dispatch; para el
prompt muestra posición de la primera diferencia, nunca su contenido. Recuperar el
snapshot no autoriza cambiarlo: un contrato corregido requiere preparación propia.
preparedFromRevision es la revisión original confirmada, no una revisión actual
inferida al repetir. El flujo normal incorpora por IDs sin consultar el snapshot.
get_delegation recupera los originales explícitamente; el export interno
prepareDelegation conserva su retorno completo para consumidores de core.
El encargo canónico interno mantiene schemaVersion 1 para
reutilizar la validación legacy; **contractVersion 2 pertenece al registro**.
Conserva `acceptanceBasis`, ciclo, `preparedFromRevision`, identidad durable,
`continuityId`, `intentRevision` (alias `intentionRevision` para adaptadores),
contexto nativo histórico, paths efectivos y fingerprints de catálogo/plantilla.
La preparación no cambia revisión del Work ni acredita dispatch.

Misma requestKey y payload recupera el snapshot aun con expectedRevision distinta;
esa revisión no forma parte del digest. Una clave nueva no elude solapamientos de
taskIds, incluidos conjuntos parcialmente solapados. Paths se comparan por segmentos
y ancestro/descendiente (`a` no solapa `ab`). `stableReadScope` reclama una lectura
estable frente a escritores; no es un permiso nuevo. `integrationResources` declara
paths de checkout de integración exclusiva, sin inferirlos por ejecutar Git.
El dominio de exclusión es una raíz de metadatos, no checkouts compartidos entre raíces.

Tareas ya realizadas requieren nueva tarea o una revisión deliberada de su
aceptación, conservada en Work y distinta de la base del último resultado aceptado.
Una tarea terminada sólo con evidencia, sin resultado previo comparable, requiere
una tarea nueva. Un error de incorporación nunca habilita repetir sus tareas.

### Cierre explícito y aprobación del usuario

```text
close_by_user {
  workId, expectedRevision, operationId, summary,
  source:{text, messageRef?}, limitations:[]
}
```

Solo se usa ante una petición explícita del usuario de cerrar el trabajo. El
coordinador transmite fielmente esa declaración; core exige la fuente, pero no
autentica su autoría a partir del texto. Consultar estado o recibir tests verdes
no autoriza esta vía. Para «todos», se seleccionan los IDs abiertos del workspace
con paginación y se cierra cada uno con su revisión confirmada.

La operación termina el Work como `done`, marca todas las tareas no canceladas
como `done` y aprueba todos los criterios/verificaciones por autoridad del usuario.
Limpia bloqueos, decisiones y siguiente acción. Devuelve `closed:true`,
`authority:"user"`, `verification:"user_approved"`, `approval` con los IDs cubiertos
y `readiness:{ready:true, issues:[], authority:"user", verification:"user_approved", ...}`.
No quedan verificaciones pendientes actuales. No se fabrican comandos, ejecuciones
de CI ni evidencias técnicas positivas; las evidencias y resultados previos se conservan.

`closure.mode:"user_requested"` y `closure.userRequest` conservan la petición,
operationId, aprobación completa, base de aceptación y diagnóstico/estados anteriores
como snapshot histórico, también en history. El recibo de sync conserva la fuente.
La misma operationId y contenido recupera el cierre sin duplicar historial; distinto
contenido o reutilización tras reopen se rechaza. Reopen inicia un ciclo que vuelve
a requerir la aceptación ordinaria. Los archivos históricos ausentes no bloquean
la recuperación de un cierre aprobado por usuario; las rutas inseguras y metadata
corrupta siguen rechazadas.

Los encargos pendientes deben reconciliarse antes de cerrar: aprobación del usuario
no equivale a detener un agente. Se mantienen revisiones, locks y permisos nativos.
`accept_delivery` conserva su semántica de aceptación ordinaria; `close` sin esta
petición sigue evaluando el cierre técnico. Cancelar un Work conserva las tareas
históricamente realizadas aunque su aceptación sea obsoleta, sin volverlas a aprobar
ni cancelar artificialmente.

### Retorno e incorporación

```text
accept_result {
  contractVersion:2, workId, delegationId, continuityId, intentRevision,
  operationId, expectedRevision,
  returnId XOR reportedReturn:{captureKey, markdown, completeness?},
  decision:{status, summary, acceptedTaskIds?, artifacts?, changedFiles?, checks?,
            findings?, questions?, limitations?, suggestedNextStep?},
  reportedTerminal?: boolean
}
```

La forma pública transporta `decision` como objeto JSON genérico acotado: **la
semántica estricta se valida después de conservar el reporte**. Los campos técnicos
reutilizan las reglas legacy; completed exige acceptedTaskIds explícitos. Campos
desconocidos, identidad o markdown dentro de decision fallan semánticamente sin
perder una captura válida. No se parsea el Markdown.

`decision.details` **no está admitido**. Los campos opcionales técnicos van al
mismo nivel que `status`, `summary` y `acceptedTaskIds`, por ejemplo:

```json
{"status":"completed","summary":"Revisión terminada","acceptedTaskIds":[],"limitations":["Sin ejecución en host real"]}
```

Este ejemplo no acepta tareas ni acredita criterios. Los checks y archivos que
se añadan deben corresponder a observaciones y recursos reales autorizados.

Límites: Markdown reportado hasta 1.000.000 caracteres, candidato decision hasta
64.000 unidades JSON, envelope v2 hasta 1.100.000 y profundidad JSON hasta 64.
`completeness` es `complete | truncated | unknown` (default unknown). Las capturas
conservan bytes UTF-8, hash, longitud, fecha y procedencia. Misma captureKey/carga
devuelve el mismo returnId; otra carga no reemplaza el original. Una recuperación
del reporte se conserva con nueva captureKey.

Orden: transporte/permiso/binding/identidad → captura (con declaración terminal
reportada coherente en el mismo commit administrativo cuando procede) → recibo
idempotente previo → comprobación terminal → revisión exacta → intención/ciclo/base/tareas/decisión →
commit canónico de Work. Capturas autorizadas sobreviven a decisión inválida,
revisión antigua/futura, base obsoleta o cambio de intención. El error devuelve
`persistence:{captured:true,returnId,workId,delegationId,...}`; get_delegation permite
recuperarlas si se pierde la respuesta. Denegación o envelope inválido no capturan.

`operationId` y el digest calculado por core se comprometen en **el mismo Work** que
las tareas. El hash liga proyecto, Work/ciclo, encargo, continuidad/revisión de intención,
returnId y decisión; excluye expectedRevision y la declaración reportedTerminal.
Un recibo duplicado no vuelve a procesar declaraciones terminales. Repetición idéntica
devuelve el hecho histórico incluso con revisión antigua/futura, sin escribir ni
revalidar como PASS. El recibo distingue `appliedRevision`, `currentRevision`,
`currentIntent`, `currentBasis`, `currentPass:false`. Otra carga con operationId
comprometida falla. La incorporación utiliza el encargo/base originales y el resultado
normalizado legacy; no renueva hashes para hacer pasar observaciones antiguas.

La reserva de paths puede resolverse por reportedTerminal aunque después falle la
decisión. La reserva de sus tareas pendientes de incorporación sigue impidiendo
prepararlas de nuevo. Un dispatch nativo unresolved contradice reportedTerminal y
no se libera por esa declaración. Captura, reserva resuelta y aceptación son hechos
distintos; ningún retorno se convierte en evidencia ejecutada ni satisface criterios.
En el flujo reportado normal, captura y reserva resuelta se publican juntas: no
se escribe un segundo estado/índice sólo para reportedTerminal. Una captura repetida
puede declarar terminal por primera vez, sin cambiar el literal ni duplicar la
reconciliación. Si existe intento nativo unresolved, primero se conserva la captura
y después se rechaza la declaración contradictoria; la reserva permanece sin resolver.
Los fsync y las guardas de escritura se conservan. Las repeticiones de una aceptación
comprometida siguen devolviendo su recibo histórico sin aplicar nuevas declaraciones.

### Exports fijos para adaptadores

Desde `delegation-registry.mjs`:

```text
readDelegation(root, {workId, delegationId}) -> registro v2
recordNativeDispatch(root,
  {workId, delegationId, sessionID, callID, agent, prompt}, {assertContext?}) -> intento
recordNativeReturn(root,
  {workId, delegationId, sessionID, callID, markdown, childSessionID?, completeness?},
  {assertContext?}) -> returnId (string)
```

readDelegation es helper de runtime: el adaptador comprueba binding/permiso; la tool
pública get_delegation comprueba además owner de continuidad. Dispatch comprueba
prompt/rol exactos, correlación, intención/base/ciclo y claims dentro del mutex.
La idempotencia de registrar una llamada **no autoriza volver a emitirla**; el hook
debe impedir reemisión tras un intento conservado. No hay TTL ni agente vivo inferido.

recordNativeReturn se llama **sólo ante terminal confirmado por el host**; recibe
el literal antes de anotarlo, conserva host_capture y resuelve el intento como
host_terminal. El helper no detecta por sí mismo running/terminal. Correlaciona la
sesión/llamada original y conserva retornos tardíos aun con intención/owner nuevos.
Completitud desconocida o truncada no se eleva a completa. Sin punto terminal
contrastado, usar reportedReturn, no este helper.

### Reconciliación, almacenamiento y límites

```text
reconcile_delegation {workId, delegationId, continuityId, intentRevision,
                      reason, resolution:"not_dispatched"|"reported_terminal"|"retired"|
                                         "explicitly_reconciled",
                      source?:{text,messageRef?}}
```

Conserva razón y procedencia reportada. not_dispatched no puede contradecir una
captura/dispatch. retired impide nuevos dispatch/aceptación pero **mantiene claims
si el intento nativo sigue unresolved**; no autostop ni cancelación física.
Retornos tardíos siguen recuperables. La acción pública close y accept_delivery
exigen reconciliar encargos pendientes antes del cierre; una declaración de usuario
se guarda aunque todavía no pueda cerrar. `completionReadiness` centraliza este
impedimento: get, accept_delivery y closeWork directo coinciden. También el cierre
cancelled exige resolver los encargos; el cálculo usa el Work recibido, sin llamar
recursivamente a readWork. Un índice inválido produce DELEGATIONS_INVALID y no permite
cerrar. Los cierres históricos siguen siendo legibles sin reinterpretar actividad posterior.

Cuando se perdió el evento terminal del host, `explicitly_reconciled` exige reason
y `source:{text,messageRef?}` con la declaración revisada/inspección que sustenta la
resolución administrativa. Conserva esa fuente y limitaciones, cambia intentos
unresolved a explicitly_reconciled y libera la reserva del protocolo. **No** la
convierte en host_terminal ni certifica cese físico. No es automática, no usa TTL
y no añade una llamada al flujo normal. Un retorno sin incorporar aún exige aceptar
o retirar deliberadamente su encargo antes de repetir sus tareas. Un terminal real
posterior puede capturarse por la llamada original y conservar su propia procedencia.

Almacenamiento format 2 del contrato durable (coexiste con Work schemaVersion 1):

- `.pulso/continuities-v2.json`: intención/ownership e historial administrativo.
- `.pulso/delegations-v2.json`: índice atómico ligero, autoridad del commit de
  claims/intentos/referencias; nunca contiene Markdown, prompt ni bases completas.
- `.pulso/delegations-v2/<delegationId>/snapshot.json`: contrato/base/prompt inmutables.
- `.../records/<contentHash>.json`: estados inmutables del encargo, con metadatos y
  referencias de retornos, nunca sus cuerpos. El índice selecciona el estado comprometido.
- `.../returns/<returnId>.json`: cada captura literal inmutable, identificada de
  forma estable por encargo/procedencia/clave, con hash, longitud y checksum.

Cada blob comprueba checksum e identidad; una corrupción no se sobrescribe.
readDelegation carga sólo el snapshot/estado/capturas del ID elegido, conservando
Markdown en su API. listDelegations usa exclusivamente metadatos; filtra continuidad
antes de derivar Work y reutiliza cada Work leído. Ninguna escritura rutinaria copia
los cuerpos de retornos anteriores. Work sigue siendo autoridad única de aceptación.
El checksum detecta daño accidental, no autentica frente a escritores del filesystem.

Se escribe blob inmutable → estado inmutable → commit atómico del índice. Si falla
el último paso, no se declara dispatch comprometido y permanecen los claims anteriores.
La captura ya escrita devuelve persistence.returnId y se descubre en el directorio
del encargo mediante get_delegation, incluso huérfana del índice. Repetir **la misma
clave** enlaza el mismo blob/returnId y repara metadatos sin emitir un agente ni
reescribir el literal. La preparación también usa un ID generado determinísticamente
por continuidad/requestKey: puede recuperar el snapshot huérfano sin renovar su base,
revalidando intención/base/claims antes de incorporarlo al índice.
get_delegation puede consultar ese snapshot huérfano con `registered:false`; no
autoriza dispatch. El índice vacío inicial se establece antes de crear blobs.

El índice administrativo es autoridad, no se reconstruye automáticamente seleccionando
estados huérfanos o escaneando sólo parte del workspace. Corrupción/pérdida requiere
recuperación explícita de esa autoridad; no se publica un índice parcial que olvide
reservas. workspace.recover de Work no borra ni regenera este índice. Los blobs se
preservan para recuperación; la historia legacy no se migra.
Si faltase el índice pero existiesen blobs, se rechaza tratarlo como un workspace
vacío: readiness devuelve DELEGATIONS_INVALID y tampoco se permite cerrar cancelled.

Preparar, actualizar intención, capturar/reconciliar e incorporar usan
withWorkspaceLock síncrono/reentrante para releer/validar/escribir; assertContext
se vuelve a invocar en cada punto de mutación. Ningún mutex dura durante la ejecución
del especialista. Runtime antiguo y escrituras externas al protocolo no quedan
interceptados. El índice ligero sigue teniendo coste O(número de encargos/metadatos),
pero el tamaño de Markdown ajeno no interviene en consultar un ID ni en actualizar
claims. La regresión de rendimiento usa un cuerpo ajeno de 3 MB, lo corrompe y prueba
lecturas/escrituras independientes y cápsulas sin acceder a él; informa bytes del
índice y p50/p95 de lectura seleccionada. Es evidencia acotada, no certificación del
presupuesto global de todos los ciclos/hardware ni de hosts reales.

Los recibos finales de accept_result y accept_delivery (incluidos duplicados) se
validan contra work-receipt.schema.json. Sus campos v2 y persistence están enumerados
explícitamente; no se admite un objeto abierto para absorber campos desconocidos.

Pruebas core reales: `node --test tests/core/durable-delegations.test.mjs
tests/core/continuity.test.mjs`, desde v4; incluyen reinicio y contención entre procesos.
No acreditan conversaciones, cancelación, compactación ni hooks de hosts reales.
Cada host y modalidad de ejecución requieren aceptación nativa separada.
Estas pruebas no activan ninguna migración ni instalación de usuario.

## `update` — alta de tareas

La acción `task.add` admite este input dentro de `actions`:

```text
{type:"task.add", task:{id, title, criterionIds, agent, status, dependsOn,
 writeScope, resources, acceptance, evidenceIds?, summary?}}
```

Sólo en este input se pueden omitir `task.evidenceIds` y `task.summary`.
Core aplica respectivamente `[]` y `''` a la copia de la tarea en el candidato,
antes de validar y persistir Work. Los valores explícitos conservan su validación
y no se sustituyen. `task.schema.json` persistido sigue exigiendo ambos campos.
La declaración de tools deriva de `work-update.schema.json`, con esos dos campos
fuera de `required` para `task.add`.

`task.add` no requiere ni admite `reason`: sólo acepta `type` y `task`.
Las claves desconocidas, incluido `reason`, producen un error de schema que
identifica el campo; no se ignoran. `reason` corresponde a cambios de aceptación
mediante `task.update` o `criterion.update`, según sus reglas existentes.
`expectedRevision` sigue siendo obligatorio y actual; `status` sigue siendo
obligatorio y `done` conserva sus requisitos de sustento.

## `prepare_delegation` legacy — lectura compatible, permiso global de mutación

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
specialistPrompt, note}`. `delegation` mantiene el esquema existente y `questions: []`.

El orquestador conserva `delegation`, `acceptanceBasis` y `hostContext` internos
y envía `specialistPrompt` directamente a la task nativa. Este texto Markdown
tiene cuatro secciones: `## Objetivo`, `## Alcance`, `## Condiciones` y
`## Entrega`. Incluye únicamente encargo ID, workId y taskIds como metadatos de
correlación; una raíz absoluta de workspace y rutas relativas de inputs,
recursos existentes y escritura. Sólo incluye output cuando es un archivo.
No añade revisiones, hashes, rutas de esquemas ni resourceRoot al texto generado.
No copia instrucciones base ni plantillas; conserva el texto completo de las
condiciones y elimina duplicados exactos entre objetivo, restricciones y aceptación.

La entrega solicita Markdown con `## Resultado`, `## Cambios o hallazgos` y
`## Comprobación y pendientes`, con estado en lenguaje natural. El especialista
no tiene que producir JSON ni leer esquemas o calcular hashes por defecto.
Los encabezados orientan la comunicación: core no aplica un parser estricto.

`hostContext = {projectRoot, resourceRoot, readBase, cwd, paths: {inputs, output,
writeScope, readScope}}`: raíces exclusivamente del contexto confiable del
adaptador; rutas efectivas absolutas separadas del encargo relativo. `cwd` y
`readBase` son projectRoot. Para `output:"conversation"`, `paths.output` es null:
es retorno inline, no una ruta `root/conversation`, y admite `writeScope:[]`.
No descubre otro repositorio ni inventa una raíz de ejecución.

Inputs deben existir y estar dentro de los recursos relativos autorizados o
del alcance de escritura. Output de archivo y artefactos deben estar dentro del
alcance de escritura de las tareas; `conversation` no exige archivo ni concede
permisos adicionales. Sólo recursos que sean rutas relativas seguras y existentes
conceden acceso de lectura. Etiquetas como `CodeGraph MCP` no se convierten en
rutas inexistentes en readScope ni en specialistPrompt. `delegation.resources`
conserva sus valores canónicos para compatibilidad. Se aplican las guardas existentes contra rutas
no normalizadas, escapes y symlinks. Los inputs conversacionales se incluyen
en objective/constraints o mediante archivos accesibles autorizados.
El catálogo y la plantilla se leen desde resourceRoot, nunca desde el input.

No escribe ni reserva IDs ni lanza agentes. Conservar delegation y
acceptanceBasis originales antes de observar el resultado.

## `accept_result` legacy — mutación

Campos obligatorios:

```text
action: "accept_result"
workId: ID
expectedRevision: entero positivo actual
delegation: delegation original, esquema existente
acceptanceBasis: {criteria: [{id, sha256}], tasks: [{id, sha256}]} previa
result: resultado canónico legacy | resultado compacto descrito abajo
summary: texto no vacío, máximo 2000
```

`acceptedTaskIds?: ID[0..50]` es un subconjunto sin duplicados de delegation.taskIds.
Es obligatorio explícitamente para `completed` (puede ser `[]`); para los demás
estados puede omitirse, con valor por defecto `[]`, y no admite tareas.

Contrato compacto, cerrado a propiedades adicionales:

```text
{
  status: "completed" | "blocked" | "failed" | "cancelled",
  summary: string no vacío,
  markdown: string no blanco (reporte literal, sin límite adicional de longitud),
  artifacts?: string[],
  changedFiles?: string[],
  checks?: {description, status: "pass" | "fail" | "blocked" | "not_run", evidenceRef: ruta | null}[],
  findings?: {id, severity: "critical" | "high" | "medium" | "low" | "info", description, reference, recommendation}[],
  questions?: string[],
  limitations?: string[],
  suggestedNextStep?: string | null
}
```

Los campos compartidos reutilizan exactamente las reglas de `result.schema.json`
en `tool-contracts.mjs`. Todos los arrays omitidos se normalizan a `[]` y
suggestedNextStep a `null`. El compacto no admite campos de identidad.
Core deriva schemaVersion, delegationId, workId, workRevision y agent del encargo
**original**, nunca del Markdown ni de la revisión actual de Work.

Pulso, como orquestador, extrae del reporte los campos técnicos mínimos status y
summary y adjunta el Markdown literal; puede incorporar detalles estructurados
observados. Core no interpreta prosa como PASS, permisos, evidencia o selección
de tareas. Un resultado `completed` sin checks no inventa comprobaciones.

Valida identidad, asignación, ámbitos, catálogo, referencias y base pertinente.
La revisión global del encargo puede ser anterior si sus bases siguen vigentes;
expectedRevision sigue siendo la revisión actual de escritura. No recalcula una
base previa para acreditar un retorno pasado. Las bases no prueban identidad
nativa ni ejecución; el orquestador decide la aceptación semántica.

Sólo `result.status: completed` admite acceptedTaskIds no vacío. Otros retornos
se pueden conservar con `[]` o sin el campo. Marca done exclusivamente las tareas enumeradas,
conserva el resultado inmutable y no vincula evidencia a criterios.

Retorna recibo más `{resultId, report, acceptedTaskIds, duplicate, readiness}`.
Una repetición con la misma delegationId en el mismo ciclo y el mismo contenido
no escribe ni duplica; cambios de orden de claves JSON no alteran la identidad.
El digest del compacto incluye el Markdown literal junto al resultado canónico
normalizado: cambiar sólo ese texto también es otro contenido. El payload legacy
no incorpora campos nuevos ni undefined y conserva su digest anterior.
Para cambiar un resultado ya aceptado se necesita otro encargo identificable.
Repetir con una revisión antigua sigue produciendo conflicto de revisión.

El core escribe `.pulso/work/<workId>/results/<RES-UUID>.json` con el encargo,
resultado canónico normalizado en `result`, base previa, selección de tareas,
resumen y registeredAt; para el compacto añade `markdown` literal al mismo
documento como procedencia, sin generar un segundo archivo;
después obtiene el SHA-256 real del documento. Un resultado inline no requiere
un segundo Markdown ni que output figure en artifacts. Output puede ser
`conversation` o una ruta autorizada que core no escribe. Los artifacts/changedFiles que sí se
declaren deben existir; sus bytes actuales no se usan para acreditar ejecución
pasada. `validate_result` sigue recibiendo sólo el resultado canónico y conserva
su validación estricta de revisión y de output
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

`operationId?: ID` añade idempotencia explícita a accept_delivery. Mismo contenido
(sin expectedRevision en el hash) devuelve el evidenceId y appliedRevision
históricos, currentRevision y currentPass:false, incluso con revisión antigua/futura
o Work cerrado; no repite el cierre. Otra carga con la misma clave falla. El recibo
se recupera desde la evidencia canónica del Work, no de una proyección. Sin operationId
no hay idempotencia implícita: confirmar evidenceId antes de repetir.

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

En alternativas `anyOf`, el diagnóstico conserva la rama pertinente a los
discriminantes de la operación/evidencia. Un SHA-256 inválido en la base de una
evidencia `static` o `manual` se señala en su ruta de hash; no se presenta como
una exigencia de comando o exit code de la variante `executed`. Esto mejora el
diagnóstico, sin relajar la validación ni calcular una base nueva por el usuario.

Se conserva la persistencia síncrona existente: Work canónico, historia e índice
reparables. **No hay transacción multifichero.** Un documento puede quedar escrito
sin incorporación; una revisión de Work puede estar persistida con proyecciones
incompletas. Los errores incluyen rutas/IDs y persistence para reconciliar sin
reintento ciego. La recuperación existente no borra documentos huérfanos.
El contrato durable usa los mutexes breves de metadatos descritos arriba; no son
locks sobre la ejecución de especialistas ni un scheduler. No se garantiza que
runtimes antiguos acepten los campos nuevos.
