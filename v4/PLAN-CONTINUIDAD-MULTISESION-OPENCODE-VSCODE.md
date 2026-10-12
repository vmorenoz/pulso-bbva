# Plan transversal: continuidad e aislamiento multisesión

## 0. Resultado buscado y estado

**Preservar la calidad, iniciativa, velocidad y especialización que el usuario valora en Pulso; corregir la pérdida de continuidad, la repetición de trabajo y la fragilidad del contexto compartido.** El objetivo no es añadir una fase de revisión, más agentes ni más confirmaciones por tarea.

Estado original: plan sobre 4.1.1. **Seguimiento: implementación integrada en 4.2.0 y paquetes comprobados; hosts reales pendientes y presupuesto relativo de latencia no satisfecho.** La [entrega 4.2.0](ENTREGA-4.2.0.md) distingue lo ejecutado de los criterios aún pendientes; las propuestas y objetivos siguientes no se convierten retroactivamente en PASS. Fuente de incidentes: [auditoría de las sesiones reales](AUDITORIA-MULTISESION-2026-10-09.md). El [plan anterior](PLAN-ROBUSTECIMIENTO-OPENCODE-VSCODE.md) conserva las decisiones e instalaciones históricas de 4.1.0/4.1.1.

Ámbito: `v4/core`, `v4/adapters/{opencode,vscode}`, generación, verificación, documentación y compatibilidad de su distribución. No usar otras versiones como base. Desarrollo con agentes y herramientas nativos; sin orquestación Pulso ni inicialización de `.pulso` en este repositorio.

### Éxito funcional

- Una petición nueva recibe una respuesta sobre esa petición, con resultados actuales y procedencia conservada.
- Un resultado recibido queda recuperable aunque su incorporación falle.
- Un error de registro no provoca otra implementación ni otro commit/push.
- Sesiones con objetivos diferentes comparten workspace sin heredar implícitamente su foco operativo.
- Encargos independientes siguen avanzando en paralelo; un conflicto bloquea solo los recursos afectados.
- VS Code obtiene las mismas garantías del core y garantías de binding propias, con sus límites nativos explícitos.

## 1. Diagnóstico que determina el alcance

La auditoría encontró 44 rechazos en 61 intentos de incorporar resultados. Hubo contratos reescritos, hashes/commits mezclados, respuestas antiguas y estado pendiente después de ejecutar. Los 58 pares de prompts/resultados nativos correspondían a sus hijos: **no se demostró intercambio de conversaciones ni colisión de archivos entre las familias auditadas**.

La concurrencia sí fue real, incluida una tercera sesión anterior al PR 118. El plan corrige tanto los fallos de continuidad dentro de una sesión como las debilidades de compartir contexto/metadatos entre sesiones; no atribuye todos los incidentes a una carrera no observada.

### Aplicabilidad por plataforma

| Criticidad | OpenCode | VS Code | Actuación |
| --- | --- | --- | --- |
| Encargo original efímero, base reenviada por el modelo | Fallos reales y código compartido | Mismo código: vulnerabilidad estructural confirmada | Snapshot durable y recuperación por ID en core |
| Reejecución tras rechazo de incorporación | Observada | Posible por el mismo protocolo; conducta no probada | Retorno persistido y reconciliación antes de nuevo intento |
| Respuesta antigua/compactación incorrecta | Observada | Riesgo conversacional, sin prueba nativa | Intención revisionada y cápsula de continuidad actual |
| Foco/memoria de workspace compartidos | Observado en contexto | Mismo core, más binding por ventana | Foco por continuidad; estado global solo informativo |
| Resultados alterados al reenviarlos | Observado | No existe captura del retorno de `agent` en el adaptador actual | Captura nativa donde esté disponible; procedencia reportada en el resto |
| Cambios de selección entre chats | La raíz procede del contexto nativo | Binding compartido por activación; lecturas no comprueban token esperado | Binding en lecturas dirigidas y generación de contexto |
| Escrituras concurrentes de metadatos | Riesgo entre procesos | Riesgo entre ventanas/procesos sobre la misma raíz | Exclusión breve y recuperación de proyecciones |
| Restricción nueva con un especialista en vuelo | Tests posteriores a prohibición, observados | Cancelación de la tool no acredita cancelar al especialista | Propagación nativa comprobada o estado desconocido explícito |

**VS Code se incluye en el robustecimiento.** La inspección estática no permite afirmar que ya haya reproducido los incidentes de OpenCode. Local agent y Copilot Agent Host tienen aceptación nativa separada, actualmente pendiente.

## 2. Decisiones y límites de diseño

1. Mantener las cuatro tools públicas, especialistas y delegación nativos. Añadir acciones pequeñas dentro de las tools existentes cuando sean necesarias.
2. Mantener Markdown natural entre coordinador y especialista. El modelo deja de transportar contratos canónicos, bases y hashes administrativos para aceptar.
3. El core conserva los hechos administrativos; el host conserva ejecución, permisos, sesión y cancelación. No crear scheduler, motor de agentes, polling permanente, heartbeats ni leases de actividad.
4. Preparar pasa de lectura efímera a **mutación de registro**. Actualizar simultáneamente schema, clasificación de permisos, descripción y adaptadores.
5. Una captura, una aceptación, una tarea realizada y un criterio validado siguen siendo hechos distintos. No parsear prosa para producir PASS, permisos o autoría de cambios.
6. Introducir **exclusión breve de escrituras de metadatos**, no locks mantenidos mientras trabajan agentes. Esta precisión sustituye para el nuevo diseño la prohibición genérica de locks del plan anterior.
7. La sesión nativa, el vínculo de proyecto y la continuidad del objetivo son identidades diferentes. No extraer identidad de tokens opacos de VS Code ni fabricar una sesión nativa.
8. Las protecciones de duplicados se aplican al protocolo y a los puntos nativos realmente integrados. No prometer ejecución exactamente una vez ni un sandbox para todos los scripts.
9. El fallo administrativo se recupera por ID; no se deriva automáticamente un nuevo encargo. Cambiar de rol tampoco permite repetir una operación denegada.
10. Ningún lock, control de base o revisión se elimina para agilizar un resultado inválido. La mejora de rendimiento procede de evitar reconstrucciones, lecturas grandes y repeticiones.
11. Conservar compatibilidad de lectura e historia. Migración de datos, instalación real y validación conversacional son actividades distintas de redactar/implementar este plan.

### Alcance deliberadamente acotado

No rediseñar el catálogo, la calidad técnica de los especialistas, las skills BBVA, el modelo de ejecución ni el producto de negocio. No introducir una base de datos o un daemon como requisito de este arreglo. No tipificar todos los recursos históricos ni reconstruir sus hashes: los snapshots nuevos preservan la representación canónica actual. Cualquier ampliación posterior necesita una necesidad demostrada.

## 3. Arquitectura: separar seis identidades

| Identidad | Procedencia y uso | Lo que no significa |
| --- | --- | --- |
| Proyecto | Raíz canónica confirmada por el adaptador + identidad persistida | El modelo no elige una raíz mediante un ID |
| Binding | Vínculo efímero de invocación/proyecto y generación, sobre todo VS Code | No identifica un chat ni autoriza por sí solo |
| Continuidad | Handle durable de objetivo, Work/ciclo, repositorios e intención | No es una sesión sintética ni una credencial |
| Sesión/llamada nativa | Solo datos proporcionados de forma confiable por el host | Ausencia de estos datos no se rellena por inferencia |
| Encargo | Snapshot inmutable preparado por core | Preparado no equivale a lanzado |
| Retorno/decisión | Bytes conservados y decisión semántica posterior por IDs | Reporte recibido no equivale a ejecución verificada |

### Registro de continuidad

Guardar `continuityId`, identidad de proyecto, `workId/cycle`, repositorios o subrutas objetivo autorizadas, `intentId/intentRevision`, texto breve de intención y restricciones vigentes, referencias de procedencia disponibles y encargos pendientes de reconciliación. Versionar este registro independientemente del Work.

- Un objetivo puede abarcar varios repositorios cuando el usuario lo encargue; no imponer artificialmente uno solo.
- Sesiones independientes tienen continuidades independientes, aunque vean el mismo índice global.
- Retomar una continuidad en otra sesión exige selección deliberada, no elegir el Work más reciente ni el foco global.
- Las referencias de repositorio se resuelven dentro de la raíz confiable y scopes autorizados. No conceden acceso por sí mismas.
- La memoria de proyecto sigue compartida para contexto/preferencias; no se usa para decidir silenciosamente el objetivo activo.
- El foco global pasa a ser un dato de navegación. `status` anclado devuelve primero la continuidad solicitada; los otros Works aparecen como información de workspace, sin activar sus siguientes pasos.

En OpenCode se vincula con `sessionID` cuando el host lo entrega. En VS Code se transporta el handle explícito entre llamadas, sin un único handle activo global por ventana. Copiar un handle no acredita ser el mismo chat: la garantía allí es coherencia del protocolo, no aislamiento autenticado entre interlocutores.

## 4. Encargo y retorno durables: contrato objetivo

Los nombres y campos siguientes son la propuesta a fijar en P0, no APIs disponibles hoy.

### 4.1 Preparación

`pulso_work.prepare_delegation` recibe la continuidad/intención vigente, Work/tareas, revisión esperada y los datos de objetivo que ya aporta el coordinador. La raíz e identidad nativa quedan fuera de los argumentos elegibles por el modelo.

Core genera y conserva:

```text
delegationId, contractVersion, preparedAt
projectIdentity, workId, cycle, preparedFromRevision
continuityId, intentId, intentRevision
delegation canónica + acceptanceBasis original
specialistPrompt exacto + versión de recursos usados
contexto confiable y rutas efectivas
clave idempotente de preparación y hash calculado por core
```

La respuesta habitual entrega ID, prompt, referencias y revisiones confirmadas; el contrato completo se recupera bajo demanda. La preparación no marca tareas ejecutadas ni cambia la base. El registro tiene su propia revisión: capturar transporte no debe avanzar la revisión semántica del Work ni invalidar evidencias.

El binding y contexto observados al preparar son procedencia histórica. Cada consulta, recuperación o aceptación vuelve a validar el binding **actual** y la identidad durable del proyecto del registro. No exigir que el token efímero sobreviva a una recarga ni reutilizarlo como autoridad para escribir.

Idempotencia: misma clave y mismo contenido devuelve el mismo encargo; misma clave con otro contenido produce conflicto. Una nueva clave no permite preparar otra vez tareas ya cubiertas por un encargo sin resolver, incluidas selecciones parcialmente solapadas. No deduplicar por similitud de prosa.

El protocolo solo autoriza una nueva preparación de una tarea terminada tras cambio de intención/aceptación o necesidad de reparación explícita y enlazada. Un error de incorporación no satisface esa condición. Impedir además una invocación nativa requiere un punto de control comprobado; sin él, no se garantiza interceptar llamadas del host realizadas fuera del protocolo.

### 4.2 Intento de invocación

Registrar la correlación antes de emitir, en el hook nativo cuando exista y su capacidad esté comprobada. Guardar llamada/hijo si el host los proporciona y el tipo de procedencia.

`dispatch_recorded` acredita un registro de intención de invocación, no que un agente esté vivo. Si el host rechaza o el proceso se interrumpe en la frontera de ejecución, puede quedar `unresolved`. No reemitir por antigüedad ni liberar por un TTL.

VS Code no ofrece actualmente ese punto a través del código utilizado: la preparación y el intento declarado se conservan, sin elevar una declaración del coordinador a confirmación nativa.

### 4.3 Captura antes de aceptación

Conservar `returnId`, `delegationId`, clave de captura, texto íntegro, hash/longitud, `receivedAt`, completitud y procedencia. Fechas de observación o refs de comandos se guardan solo si se conocen realmente.

Procedencias separadas:

- `host_capture`: bytes obtenidos directamente en un punto nativo contrastado.
- `orchestrator_reported`: bytes reenviados por el coordinador.
- `artifact_read`: bytes leídos de una referencia autorizada; no acreditan quién escribió el archivo.
- `legacy_import`: conservación posterior sin inventar un snapshot previo.

Un retorno truncado no se marca completo. Una recuperación genera una captura enlazada, sin sobrescribir la anterior. Una anotación o corrección del coordinador tampoco reemplaza el reporte original.

### 4.4 Incorporación por referencia y sin nuevas llamadas rutinarias

`pulso_work.accept_result` v2 recibe IDs de encargo/retorno, clave idempotente de decisión, revisión actual y decisión semántica (`status`, tareas aceptadas, resumen y datos técnicos sustentados). Recupera contrato y base desde el snapshot.

Dos variantes de transporte, mutuamente excluyentes:

1. `returnId`, cuando el adaptador ya conservó el retorno.
2. `reportedReturn`, cuando no existe captura nativa. El core conserva primero el retorno y después intenta la incorporación, **en la misma llamada**. La respuesta de error semántico devuelve también `returnId` y lo efectivamente persistido.

Así, VS Code conserva el flujo **preparar → delegar → incorporar**, sin obligar al modelo a una llamada adicional de captura en cada tarea. Recuperaciones usan el ID devuelto. Un input de transporte inválido, una denegación o un binding incorrecto no autorizan persistir: no se promete capturar una llamada que nunca pudo ejecutarse.

Orden de validación:

1. Validar transporte acotado, permiso, proyecto/binding actuales e identidad de los registros.
2. Resolver idempotentemente la captura o **persistir `reportedReturn`**, antes de validar la decisión semántica. Obtener `returnId` recuperable también por clave de captura o encargo si se pierde la respuesta.
3. Recuperar una decisión ya comprometida con su clave, ligada a proyecto, Work/ciclo, encargo y retorno; el digest de contenido lo calcula core.
4. Si coincide, devolver el hecho histórico sin nueva escritura, aunque la revisión aportada sea antigua o futura; diferenciar `appliedRevision`, `currentRevision` y vigencia actual. El recibo histórico no acredita PASS actual ni renueva una base obsoleta.
5. Misma clave con decisión distinta: conflicto; no sobrescribir.
6. Para decisiones nuevas, comprobar revisión, ciclo, intención pertinente, base y tareas. Revisión futura produce rechazo explícito; no se aplica como una actualización válida.
7. Commit de decisión y tareas en una única escritura canónica del Work.
8. Actualizar proyecciones o devolver `applied:true` con recuperación pendiente.

El contrato de transporte debe admitir un candidato de decisión acotado y separarlo de su validación semántica estricta. Un estado o selección de tareas inválidos no deben impedir conservar bytes de reporte válidos y autorizados. No parsear el contenido del Markdown para guardarlo. Esto exige cambiar el punto de validación actual: validar todo el esquema de aceptación antes de entrar al handler reproduciría la pérdida del retorno. Un envelope de transporte inválido sigue rechazándose sin escritura.

La revisión esperada no forma parte del hash idempotente de la decisión. No actualizar hashes de aceptación para hacer pasar resultados obsoletos. Un cambio de overview ajeno a la aceptación permite reconciliar la revisión; un criterio cambiado exige reevaluar o volver a observar lo pertinente.

### 4.5 Acciones de recuperación

- `get_delegation`: lectura directa por ID, con secciones snapshot, retorno, decisión y diagnóstico.
- `reconcile_delegation`: decisión explícita sustentada de no emisión, terminación, necesidad de inspección o supersesión; no ejecuta agentes.
- Continuidad: acciones de crear/vincular, consultar y actualizar intención dentro de `pulso_workspace`, con revisión propia.
- Registro de dispatch/captura: helpers internos para adaptadores; cualquier variante pública solo puede declarar su propia procedencia.

El detalle final se publica en `core/lib/ACCEPTANCE-API.md` y `tool-contracts.mjs` antes de implementar consumidores. `accept_delivery` reutilizará el mecanismo de clave idempotente para no duplicar la misma aceptación declarada tras perder un recibo; conserva sus reglas de evidencia/cierre.

## 5. Estados administrativos y reconciliación

No añadir estados artificiales al ciclo productivo de las tareas. Registro mínimo:

```text
prepared → dispatch_recorded → return_stored → accepted
    └────────────────────────────────────────→ retired
```

Mantener por separado la resolución del intento: `unresolved`, `not_dispatched`, `host_terminal` o `explicitly_reconciled`, con su procedencia. El estado aceptado se deriva de la decisión comprometida en Work; no crear dos autoridades que necesiten una transacción imposible entre archivos.

Autoridades: **continuidad** conserva intención y compatibilidad; **registro** conserva snapshot/capturas/intentos; **Work** conserva decisión y tareas. Pendientes de incorporación, cápsula y estado derivado `accepted` son proyecciones por referencias. Su actualización fallida no revierte una aceptación ni permite resucitar como pendiente una ejecución ya incorporada. Preparar, reclamar recursos y aceptar releen dentro del mismo mutex las revisiones pertinentes de continuidad, registro y Work.

- Un rechazo administrativo conserva `return_stored` y su diagnóstico.
- Retirar/superseder no acredita que el especialista haya parado; un resultado tardío se conserva y se clasifica.
- Un resultado útil con registro fallido permite avanzar frentes independientes; no declarar la tarea incorporada ni reiniciarla.
- El TODO nativo refleja hechos confirmados. `nextAction` referencia intención/encargo/decisión y no prevalece sobre un resultado posterior.
- Cierre: reconciliar resultados pendientes antes de pedir nuevamente aceptación del usuario. No cancelar tareas realizadas ni relajar criterios para cerrar.

## 6. Intención vigente, steering y compactación

La continuidad guarda qué petición se está atendiendo y qué cambió. Nuevo fallo de CI, cambio de repo o nueva restricción incrementa la revisión de intención pertinente. Una conversación compatible no cancela automáticamente todo el objetivo ni exige volver a autorizar una publicación ya cubierta.

Para preservar paralelismo, un cambio que solo afecta una tarea no invalida todos los encargos del Work. Registrar la relación entre intención anterior y nueva: compatible, restringida o sustituida, con fuente. El coordinador decide la semántica; core conserva y exige consistencia de esa decisión, sin deducir permisos de lenguaje natural.

Producir una **cápsula de continuidad** compacta: intención vigente, repo/Work, resultados recientes por ID, operaciones pendientes de incorporación, restricciones y siguiente acción aún válida. Generarla desde registros, no pedir al modelo que reconstruya hashes/commits. No volcar toda la historia en cada turno.

OpenCode: aprovechar mensajes/hooks de compactación solo después de verificar la API pública y su comportamiento en la versión soportada. VS Code: recuperar la cápsula mediante tools; no prometer un hook de compactación que el adaptador no usa. Las respuestas de aceptación y consulta ya incluyen los datos suficientes para evitar una tool extra al finalizar cada microtarea.

**Límite:** el core puede detectar intención antigua en una operación, no garantizar por sí solo que toda frase final libre del modelo sea correcta. La regresión «nuevo timeout → respuesta de los siete fallos anteriores» requiere aceptación conversacional real en cada host.

Ante una prohibición nueva con trabajo en vuelo: registrar el momento, impedir nuevas preparaciones/autorizaciones afectadas del protocolo y bloquear dispatch nativo solo donde exista control comprobado; solicitar modificación/cancelación por la vía nativa si existe. Comunicar por separado instrucción recibida, cancelación solicitada, cancelación confirmada y ejecuciones posteriores observadas. No afirmar que se detuvo por haber actualizado metadata.

## 7. Concurrencia sin frenar a los especialistas

### 7.1 Escrituras de metadatos

Mutex breve por workspace para **releer → verificar revisión/idempotencia → commit → proyectar**. No mantenerlo durante delegación, comandos, llamadas de red, aprobaciones ni intervención del usuario. La memoria de usuario conserva su dominio separado; fijar orden de adquisición o evitar adquirir ambos a la vez.

Cubrir todas las entradas escritoras, incluidas APIs directas: create/update, incorporación, close/reopen, memoria de proyecto, preparación/migración y recuperación. Solo proteger `executeTool` dejaría rutas sin garantías.

- Propiedad verificable del lock y liberación solo por su dueño.
- Espera acotada; conflicto devuelve referencias recuperables, no bucle infinito.
- Sin robo automático por antigüedad. Recuperación de abandono explícita y conservadora.
- Documentos inmutables completos antes de referenciarlos; un huérfano no significa aceptación.
- Work como autoridad de decisiones; índices e historial como proyecciones reconstruibles sin perder cierres previos al reabrir.
- Una interrupción después del commit no puede provocar un segundo commit lógico al reintentar.

### 7.2 Conflictos de trabajo

Guardar claims lógicos de escritura e integración, sin locks de filesystem de larga duración. Comparar rutas canónicas por segmentos y ancestro/descendiente, no por prefijos de texto. El protocolo no autoriza dos escritores de una misma tarea o paths incompatibles; una revisión que necesita snapshot estable tampoco comparte una escritura incompatible. La exclusión de escrituras reales fuera del protocolo solo existe si el host la proporciona: estos claims no interceptan por sí mismos `agent`, edición o terminal.

Añadir un recurso de integración por checkout para operaciones que comparten índice Git/commit/push. Dos cambios de archivos disjuntos en el mismo checkout no autorizan dos integraciones simultáneas. Trabajos en repositorios diferentes y lecturas compatibles siguen en paralelo.

No hacer exploración Git automática desde core: el repositorio/cwd y las dependencias se declaran desde evidencia disponible y se validan dentro de los scopes confiables. Los claims no son un sandbox ni prueban ejecución. Un intento incierto se reconcilia; no se libera con un timeout o una marca administrativa de done.

Dos rutas de resolución para evitar bloquear permanentemente VS Code:

- **Observada:** la reserva de tarea empieza al preparar; el claim de actividad queda asociado al intento nativo al registrar dispatch. Su resolución usa hechos del host o reconciliación explícita sustentada; una declaración no contradice un hecho nativo conocido.
- **Reportada:** la reserva lógica del protocolo empieza al preparar. El coordinador puede incluir una declaración explícita de terminación en la misma llamada de incorporación; si es consistente y no hay hechos contradictorios, resuelve esa reserva con procedencia reportada, incluso si después falla la aceptación semántica. No se convierte en `host_terminal` ni demuestra cese físico.

Ausencia de declaración, interrupción o contradicción exige reconciliación. No imponer una inspección adicional ni cuarta llamada rutinaria a cada tarea terminada en modo reportado. Conservar por separado reserva resuelta, resultado capturado y decisión aceptada.

Dominio inicial: **misma raíz canónica de metadatos**. Workspaces diferentes que apuntan al mismo checkout quedan fuera de la exclusión cruzada; no anunciar cobertura universal. Worktrees/rutas de Agent Host requieren correspondencia nativa comprobada.

## 8. OpenCode: integración específica

Archivos principales: `adapters/opencode/plugin/index.mjs`, `delegation-observer.mjs`, contratos nativos, builder y guías generadas.

1. Pasar al core contexto nativo confiable de sesión/mensaje/llamada, separado del JSON del modelo.
2. Correlacionar por `delegationId` con el snapshot, incluyendo todas las `taskIds`. Verificar prompt/rol frente al encargo emitido; una modificación necesaria exige nueva preparación, no edición informal del contrato.
3. Separar el observador pasivo existente de una ruta crítica mínima para **encargos gestionados por el nuevo protocolo**. No convertir todo evento o cualquier task del host en mutación Pulso.
4. Validar y registrar antes de dispatch en el hook solo si la prueba de capacidad demuestra que puede impedir correctamente la llamada. Si esa capacidad no existe, declarar modo reportado/reconciliable, sin anunciar bloqueo preventivo nativo.
5. Capturar el retorno completo en el punto nativo disponible, persistirlo antes de que el coordinador lo reformule y comunicar la referencia recuperable. Un error de captura no se silencia como éxito; distinguir retorno recibido de incorporación pendiente.
6. No usar una regex de texto libre para identificar éxito, cancelación o agente vivo. Resultado running/errores/cancelación y eventos reordenados conservan su semántica nativa conocida.
7. Recuperación de transcripción o llamadas perdidas solo mediante referencias/API disponibles y permisos efectivos, no leyendo una base interna del host como dependencia del producto.
8. Permisos: la preparación durable y el registro asociado se describen en la operación aprobada; ningún hook amplía permisos ni escribe tras revocación/contexto inválido. Donde el host exija aprobación adicional se mantiene.

Los incidentes reales son casos de regresión. No cambiar terminal del coordinador ni permisos de especialistas para compensar fallos de administración.

## 9. VS Code: integración y límites específicos

### Evidencia estática

- `src/extension.cjs:20–51` registra las cuatro LM tools; no intercepta `agent` ni usa identidad autenticada del chat.
- `src/workspace.mjs:54–115` conserva un binding por activación/ventana.
- `extension.cjs:33–35` exige binding esperado solo en mutaciones.
- `src/native-contracts.mjs:5–15` ni siquiera admite ese token en historial.
- `build.mjs:7–12` delega mediante instrucciones y la tool nativa; pide al coordinador reenviar el Markdown.

### Cambios obligatorios

1. Capturar `{root, bindingId, generation}` al entrar y revalidarlo después de fronteras asíncronas, en lecturas dirigidas y mutaciones. Suscribirse al evento público de cambios de carpetas tras comprobar su contrato; incrementar generación también en selección/reselección.
2. Cubrir A→B→A y reselección de A: igualdad de raíz al finalizar no implica continuidad del binding.
3. Admitir/comprobar `expectedBindingId` también en lecturas que usan Work/continuidad, incluido historial dirigido. Solo descubrimiento inicial de estado/selección permite ausencia de vínculo; no adoptar automáticamente el nuevo token tras conflicto.
4. Preparación durable solicita aprobación y binding como cualquier mutación. Conservar Trust, cancelación y raíz abierta; no elegir desde editor activo ni texto del modelo.
5. Handle de continuidad explícito por objetivo; nunca una variable global que indique «chat actual». Retomar tras recarga/otra ventana usa identidad durable y un binding local nuevo confirmado.
6. Implementar `reportedReturn` en la misma incorporación, con procedencia inequívoca. No denominarlo captura directa del especialista. No añadir JSON administrativo a la comunicación con especialistas.
7. Cambio de binding antes de escribir: no aplicar a la nueva raíz. Cambio después de commit: devolver el recibo de la raíz original y `contextChanged`, sin repetir automáticamente.
8. Un token de cancelación de LM tool no demuestra cancelación de `agent` ni del terminal. Aplicar el protocolo de steering con sus límites.

Se conserva inicialmente la selección de **una raíz por ventana**. Varios chats sobre repositorios dentro de esa raíz usan continuidades distintas. El cambio de raíz en la ventana invalida operaciones anteriores; para raíces simultáneas independientes se usan ventanas separadas, sin convertir este arreglo en un rediseño de la interfaz multirroot.

### Local agent y Copilot Agent Host

Comprobar por separado herramientas, agentes, aprobaciones, delegación, resultados y correspondencia de rutas. Una ruta local accesible a la extensión no demuestra que el destino Agent Host pueda usarla. Si no hay correspondencia, limitar el alcance soportado con diagnóstico preciso, sin traducción supuesta ni runtime propio.

El comportamiento frente a tareas repetidas y respuestas antiguas queda **NOT_RUN** hasta ejecutar las pruebas nativas de ese modo. Un paquete válido o una instalación correcta no cambia ese estado.

## 10. Rendimiento y calidad: criterios de no regresión

Preservar el flujo corto y los resultados útiles. No añadir reviews obligatorios por defecto ni convertir cada incidencia en un plan separado.

| Aspecto | Criterio de aceptación |
| --- | --- |
| Llamadas del coordinador por encargo normal | No aumentar las tres transiciones existentes: preparar, delegar nativamente, incorporar. Vincular/cambiar intención se amortiza por objetivo, no por cada tool. |
| Contenido transportado | Eliminar retransmisión de contrato/base/hashes; respuestas administrativas compactas y recuperables por ID. Medir bytes/tokens aproximados frente a 4.1.1. |
| Paralelismo | Dos encargos sin recursos incompatibles avanzan mientras el otro espera resultado. Ningún lock administrativo cubre esa espera. |
| Trabajo repetido | En las regresiones, cero segundos dispatch/commit causados únicamente por rechazo o pérdida del recibo administrativo. |
| Contexto | No leer todas las conversaciones, Works ni diffs para recuperar un resultado conocido por ID. Sin polling de agentes. |
| Calidad/evidencia | Mismos requisitos de scope y aceptación; ninguna promoción automática de reported a executed ni de tests preparados a tests ejecutados. |
| Latencia administrativa | Medir p50/p95 y bytes de I/O con fixtures iguales, sin llamadas de modelo/red. Presupuesto provisional: p95 ≤ 100 ms por operación en fixture pequeño local y ciclo administrativo ≤ 1,25× el baseline; investigar cualquier incumplimiento antes de aprobar. No son mediciones ya obtenidas. |

Fijar hardware, volumen y tamaño de fixture en P0; usar el mismo entorno para la comparación. Si la durabilidad imprescindible excede el presupuesto, presentar el coste medido y una decisión explícita, sin quitar integridad a escondidas. No prometer I/O constante mientras Work crece y se reescribe; evitar escaneos históricos nuevos en el camino normal.

## 11. Plan de ejecución y propiedad de archivos

| ID / prioridad | Entrega y ámbito de escritura | Depende de | Criterio de salida |
| --- | --- | --- | --- |
| **P0 / crítica** | Contratos y contraste de capacidad: `ACCEPTANCE-API.md`, registros/acciones, versiones de almacenamiento/transición, lector legacy, escritor mínimo y ubicación de mutex; fuentes públicas de hooks; diseño del baseline | — | Inputs/recibos y autoridades fijados; capacidades conocidas/pendientes separadas; pruebas adicionales delimitadas |
| **P1 / crítica** | Persistencia breve: `core/lib/fs.mjs`, `artifacts.mjs`, `memory.mjs`, `workspace.mjs`, `work-mutations.mjs` | P0 | Revisiones/commit protegidos; proyecciones recuperables; ningún lock durante agente/permiso |
| **P2 / crítica** | Registro/snapshot/retornos/idempotencia: `acceptance.mjs`, nuevos helpers core, schemas, `tool-contracts.mjs`, `semantic-tools.mjs`, `receipts.mjs` | P0, P1 | Preparación y retorno recuperables; aceptación por ID; error semántico conserva captura; idempotencia sin segundo efecto |
| **P3 / alta** | Continuidad, intención, claims, cápsula y cierre: core y schemas bajo el mismo responsable de P2 | P2 | Foco por continuidad; steering pertinente; recuperación por ID y conflictos de scope aislados |
| **P4-OC / crítica** | `adapters/opencode/**` y su validación acotada | P0; integración final P2–P3 | Correlación completa; captura y guard nativo solo donde demostrados; permisos y raíces preservados |
| **P4-VSC / crítica** | `adapters/vscode/**` y su validación acotada | P0; integración final P2–P3 | Binding en lecturas/escrituras; generación; continuidad explícita; captura reportada honesta |
| **P5 / alta** | `core/agents`, skills operativas y documentación común de protocolo | P0; versión final P2–P4 | Instrucciones más cortas, sin retransmisión ni bucles; especialistas no adquieren tareas administrativas |
| **P6 / alta** | Comprobación del corte/migración definidos en P0 e implementados con P1/P2; empaquetado/documentación y ajustes de instalador solo si son necesarios | P1–P5 | Historia preservada; compatibilidad explícita; archivos nuevos y rollback de datos documentados |
| **P7 / crítica** | Fixtures reales, scripts de verificación, paquetes y evidencia | Incremental desde P1; cierre P6 | AC técnicos satisfechos en source y cores extraídos; aceptación real separada por host/modo |

**Lotes seguros:** P0 primero; P1 y los cambios de binding VSC independientes pueden prepararse en paralelo con scopes exclusivos; P2/P3 comparten escritor de core; ambos adaptadores se desarrollan en paralelo tras fijar contrato; prompts se ajustan después de cerrar la forma pública; integración/paquetes tienen escritor único. No editar `tool-contracts.mjs`, schemas o scripts compartidos desde varios frentes simultáneos.

Entregas parciales útiles: la corrección de binding VSC no exige esperar a probar Agent Host; snapshot/retorno pueden verificarse en core antes del host. Ninguna entrega parcial se presenta como garantía multisesión completa.

P0 documental puede completarse con fuentes y decisiones de contrato. Las pruebas de hooks, baseline y sesiones nativas se ejecutan según el alcance de verificación acordado, sin bloquear el desarrollo del registro core ni del binding Local porque un modo de host no esté disponible. Lectura legacy, formatos y autoridad de cierres se implementan con la persistencia, no se posponen a P6.

## 12. Criterios de aceptación y verificación

| AC | Escenario verificable | Evidencia exigida |
| --- | --- | --- |
| **AC-01** | Reinicio tras preparar: mismo contrato/base/prompt por ID | Core real en fixture; igualdad de bytes/hashes, sin reconstrucción |
| **AC-02** | Reporte válido + decisión mal formada o rechazo por base/revisión | Retorno recuperable y diagnóstico en fixture real; un solo efecto en esa fixture. La ausencia de nueva delegación del modelo se comprueba además en host real |
| **AC-03** | Recibo perdido/reintento con revisión antigua | Mismo ID/decisión, una incorporación; revisión aplicada distinta de actual cuando corresponda |
| **AC-04** | Avance de overview frente a cambio de criterio | Primero reconciliable con base original; segundo obsoleto sin renovar hashes |
| **AC-05** | Dos sesiones/continuidades, mismo workspace y repos distintos | Focos/encargos separados; cambiar B no cambia objetivo ni nextAction de A |
| **AC-06** | Dos procesos escriben Works distintos y el mismo Work | Sin pérdida silenciosa de índice/historial; serialización breve o conflicto recuperable |
| **AC-07** | Segundo encargo de tarea/paths cubiertos, incluidos taskIds múltiples | Reutilización/reconciliación o conflicto; scopes independientes siguen disponibles |
| **AC-08** | Nuevo timeout tras publicar arreglo anterior | En host real se atiende el fallo nuevo; no se presenta commit previo como su corrección |
| **AC-09** | Compactación/retoma después de confirmar Git | Conserva última comprobación y procedencia; no reinventa contradicción resuelta |
| **AC-10** | Prohibición de tests durante delegación | Cronología fiel y capacidad de cancelación documentada; no ejecución posterior encubierta como anterior |
| **AC-11** | VSC dos chats, A→B→A, reselección, recarga y dos ventanas sobre la misma raíz | Binding/generación invalidan operaciones antiguas; bindings de ventana independientes; token ajeno rechazado; retoma deliberada con binding local; focos separados y escrituras sin pérdida |
| **AC-12** | Cambio de raíz antes/después de commit | Ninguna escritura redirigida; recibo identifica persistencia y raíz originales |
| **AC-13** | Aceptación del usuario después de realizar trabajo | Declaración conservada sin repetición ceremonial; no cierra con evidencia/tareas técnicas ausentes |
| **AC-14** | Preparación/captura denegada o cancelada | Permisos conservados; no bypass, ni falsa captura ni supuesto rollback |
| **AC-15** | Publicación acotada | No nuevo commit/push por error administrativo; no deshabilitar hooks; asunto/hash/reportes concordantes |
| **AC-16** | Rendimiento y comportamiento útil | Métricas de §10; misma iniciativa, Markdown natural y paralelismo permitido |
| **AC-17** | Datos legacy y resultado tardío | Historia intacta; sin identidades/bases/ejecuciones retroactivas; resultado preservado con procedencia |

### Tres niveles de evidencia, sin sustituir uno por otro

**A. Contrato/persistencia reales:** extender el happy path de Node y añadir reproducciones acotadas en directorios temporales, con core real y procesos reales. Cubrir reintentos, concurrencia, cambios de base e interrupciones en fronteras definidas. No simular conversaciones ni respuestas de proveedor para declarar resuelta la conducta del modelo.

**B. Adaptadores y distribución:** builds y chequeos de ambos, SDK/esquemas reales disponibles, inventarios y cores extraídos. Si se usan dobles para lógica local de UI, etiquetarlos solo como tests de esa lógica; no como aceptación del host. La revisión estática encontró fixtures VS Code desfasadas (manifest de activación ausente y expectativa 4.0.0): repararlas o excluirlas justificadamente antes de citar sus resultados. No ejecutar por defecto la suite global histórica de mocks.

**C. Hosts reales:** OpenCode; VS Code Local agent; VS Code Copilot Agent Host, cada uno con versión, modelo/destino, permisos y raíces anotados. Probar dos conversaciones/objetivos en repos temporales, una repetición administrativa, un steering en vuelo y retoma. Publicaciones se verifican contra remotos locales de fixture cuando sea viable; no usar repos de negocio para ensayos de fallos. Estado por escenario: pass/fail/blocked/not_run con evidencia, sin extrapolar éxito entre modos.

**Cambio de alcance respecto al plan histórico:** la validación A de errores/concurrencia es una ampliación propuesta y necesaria para demostrar estas garantías. El plan anterior autorizaba solo builds y happy path positivo. Antes de ejecutar ampliaciones, acordar casos y entornos acotados: incluye pruebas de hooks, procesos concurrentes, nuevos dobles locales si se proponen y sesiones nativas del nivel C. Este documento no las presenta como ejecutadas ni habilita campañas generales, instalaciones o sesiones sobre proyectos reales. Una fixture core acredita sus efectos y decisiones, no que el modelo nunca redelegue; esa conducta requiere evidencia nativa.

Comandos existentes que se mantienen, desde `v4`:

```text
npm run build:opencode
npm run build:vscode
npm run check
npm run smoke:happy
npm run smoke:happy -- vscode
npm run package:opencode
npm run package:vscode
npm run verify:packages
```

Las nuevas comprobaciones tendrán comandos explícitos propios, registrados en P0/P7; no inventar un comando disponible antes de añadirlo. Un build verde no satisface AC-08/09/10 ni prueba conversación multisesión.

## 13. Compatibilidad, migración y despliegue

Nueva versión de contrato/registro para los encargos durables; versionar el algoritmo de base independientemente. No decidir una versión comercial ni actualizar manifests durante esta planificación.

1. Lectura legacy: preservar resultados aceptados, cierres, bases e IDs; no agregar retrospectivamente sesión o captura nativa.
2. Encargos legacy pendientes: conservar lo recuperado como importación con origen y límites. No reconstruir una base previa usando archivos actuales.
3. Migración explícita y recuperable, con copia verificable y requisito mínimo de escritor. No transformar `in_progress` en agente vivo.
4. Mantener lectura del formato anterior; no prometer que un runtime antiguo entienda registros nuevos o respete el nuevo mutex.
5. Antes de activar formato nuevo, detener/reabrir las sesiones y ventanas escritoras antiguas que usan ese workspace. Un marker nuevo no puede impedir por sí solo a un binario antiguo que lo ignore. No prometer convivencia segura con esos escritores.
6. Paquetes independientes y autocontenidos; misma semántica de core, límites de host explícitos. Sin instalar automáticamente en las instancias activas del usuario.
7. Piloto aislado por host/modo, después instalación solicitada y validación real del usuario. Conservar las mejoras de rendimiento percibidas como requisito de aceptación cualitativa, junto a métricas.
8. Rollback de código no equivale a downgrade de datos: preservar copia de los datos nuevos; no sobrescribir silenciosamente progreso posterior con un backup antiguo. Elegir continuidad con runtime compatible o restauración deliberada en entorno aislado.

## 14. Puertas de decisión y riesgos residuales

| Puerta | Resolución prevista |
| --- | --- |
| Hook público OpenCode permite impedir dispatch/capturar retorno en versión soportada | Probar en P0; habilitar garantía nativa solo si se acredita. Si no, modo reconciliable y limitar la declaración de prevención. |
| VS Code proporciona identidad/captura nuevas en alguna versión | No son requisito del diseño inicial; usar handle y reporte explícitos. Adoptarlas solo tras verificación pública y real. |
| Agent Host no comparte rutas o tools efectivas | No inferir equivalencia con Local; declarar ese modo bloqueado/no soportado para el escenario, no “probado”. |
| Claims/lock dejan incertidumbre tras interrupción | Recuperar registros, estado Git y host disponibles. No liberar por tiempo ni relanzar como primera respuesta. |
| Prueba acotada de errores/concurrencia pendiente de acuerdo | No marcar terminadas las garantías afectadas con el happy path positivo. |
| Coste administrativo excede baseline | Optimizar el camino de registro/lectura por ID; no añadir revisión de agentes ni quitar controles. |

La única dependencia que no debe ocultarse con instrucciones es la observabilidad nativa: sin acceso al retorno o al mensaje del host, core conserva reportes y coherencia, pero no certifica captura original ni comportamiento de una respuesta libre. La aceptación final debe expresar esas diferencias, manteniendo una experiencia sencilla para el usuario.

## 15. Trazabilidad de fuentes

- Auditoría real: `AUDITORIA-MULTISESION-2026-10-09.md`.
- Contrato vigente: `core/lib/ACCEPTANCE-API.md`; `acceptance.mjs:64–104`.
- Canonicalidad y persistencia: `core/lib/artifacts.mjs:148–201,330–370`; `fs.mjs`; `memory.mjs`.
- OpenCode: `adapters/opencode/plugin/index.mjs:19–48,69–120`; `delegation-observer.mjs:12–21,48–110`.
- VS Code: `adapters/vscode/src/extension.cjs:20–51`; `workspace.mjs:54–115`; `native-contracts.mjs`; `build.mjs:6–12`.
- Verificación vigente y límites: `README.md:62–78,92–112`; `scripts/happy-path.mjs`; suites de adaptadores, sin atribuirles ejecución en esta planificación.

**Orden recomendado:** fijar contrato/capacidades → persistencia y retorno recuperable → continuidad y conflictos → ambos adaptadores → migración y validación real. El resultado debe ser menos esfuerzo administrativo y más fiabilidad, manteniendo el trabajo técnico que ya funciona bien.
