# Auditoría de sesiones reales: continuidad, delegación y workspace compartido

Fecha de auditoría y de los hechos: **9 de octubre de 2026**. Todas las horas de este documento están en **UTC**.

## Dictamen

Se confirman respuestas a encargos anteriores, redelegaciones de implementaciones completadas, alteración de resultados al incorporarlos y divergencia entre trabajo ejecutado y estado persistido. Son fallos graves de continuidad y orquestación observables en sesiones reales.

No se encontró intercambio de resultados nativos entre las dos sesiones solicitadas: los 58 prompts y resultados de `task` corresponden a sus hijos respectivos. Tampoco se encontró una colisión de sus escrituras explícitas entre repositorios. Esto se limita al registro persistido; no reconstruye todo el contexto que el harness pudiera haber enviado al modelo.

El escenario multisesión tiene una debilidad arquitectónica real: el estado de orientación y memoria se comparte por workspace, sin vínculo operativo entre sesión, Work, repositorio objetivo e intención. Un mecanismo acreditado en varios incidentes es **fallo de incorporación → estado atrasado → redelegación**; en las parejas bootstrap/quotation se acredita la redelegación sin establecer su desencadenante exacto. Varias respuestas incorrectas reutilizan **información anterior dentro de la misma sesión**.

Que PR 118 empezara después de numerosos incidentes no descarta toda concurrencia: se identificó una tercera sesión operativa durante ese periodo. Sus escrituras explícitas también permanecieron separadas de Contact details.

## 1. Fuente, versión, cobertura y límites

Fuente primaria: base local de OpenCode `~/.local/share/opencode/opencode.db`, consultada con SQLite en modo de solo lectura. Se usaron mensajes, parts, inputs/outputs de herramientas, metadatos y árbol recursivo de `session.parent_id`.

| Familia | Sesión raíz | Ventana UTC | Mensajes | Hijos |
| --- | --- | --- | ---: | ---: |
| Contact details | `ses_ede5ef002ffezknxUbgUOJ0idv` | 17:06:05.949–21:04:33.932 | 1.110, incluidos descendientes | 53 |
| PR 118 | `ses_edd8cfa30ffej0i6P3AfafUcA9` | 20:55:25.903–21:05:42.437 | 81, incluidos descendientes | 5 |
| **Total principal** | **2 raíces + 58 hijos, sin nietos** | | **1.191** | **58** |

El universo principal contiene **4.677 parts y 1.356 invocaciones de herramientas**. Se revisaron todos los textos conversacionales de ambas raíces, todos los prompts y resultados de las 58 delegaciones, el inventario completo de herramientas y las salidas relevantes para anomalías, revisiones, cambios, pruebas y publicaciones. Se compararon exactamente los prompts enviados con los mensajes iniciales de los hijos, y los resultados recibidos con sus respuestas finales.

**Límite de exhaustividad:** no se leyó byte a byte cada salida repetitiva de código, snapshot, diff masivo o dependencia. Algunas salidas ya están truncadas en la BD. Inventariar esas partes no equivale a leer sus archivos externos completos. Los parts de razonamiento contienen texto vacío y metadatos opacos; no permiten explicar el razonamiento interno. No se consultó Jenkins/Sonar en red ni se reprodujeron las operaciones históricas de Git.

Los recibos históricos identifican **`pulso-opencode` 4.1.1**: 293 recibos con esa procedencia en Contact details y 18 en PR 118. Las sesiones registran OpenCode **1.18.34** y agente `pulso`. El contraste estático se hizo contra el código actual de `v4`, que también declara 4.1.1; la igualdad de versión no prueba por sí sola identidad byte a byte del código histórico.

No se invocaron herramientas ni agentes Pulso para esta auditoría. No se modificaron las sesiones, los repositorios de negocio ni sus metadatos `.pulso`. Este informe es el único cambio de desarrollo realizado.

## 2. Workspaces, repositorios y solapamiento

Las dos raíces tienen como directorio de sesión:

```text
/Users/p041413/Bbva/Projects/Renta_Garantizada
```

| Familia | Repositorio productivo principal | Work principal |
| --- | --- | --- |
| Contact details | `cells-insurance-guaranteed-income-app` | `renta-principal-contact-details-20261009` |
| PR 118 | `cells-insurance-cancellation-app-rbvd` | `renta-garantizada-multifrent-20261007` |

Contact details comenzó investigando Vida Inversión y después Renta. Su título no refleja toda la evolución de una sesión de casi cuatro horas. También creó Works de investigación/revisión, distintos del principal de implementación.

### Solapamiento entre las dos sesiones solicitadas

Ventana: **20:55:25.903–21:04:33.932**, aproximadamente **9 minutos y 8 segundos**.

| Hora aproximada | Contact details | PR 118 |
| --- | --- | --- |
| 20:55 | Termina publicación del bloqueo de moneda, `ab31dbf` | Se abre diagnóstico del conflicto |
| 20:56–20:58 | Sin ejecución conflictiva registrada en cancellation | Diagnóstico de lockfile; no obtiene base remota necesaria |
| 21:00–21:01 | Usuario reporta una fixture antigua; se delega el arreglo | Primer ejecutor retira lockfile del índice y ajusta ignore |
| 21:02 | Revisión del arreglo de fixture | Segundo ejecutor recibe de nuevo el mismo cambio, ya realizado |
| 21:03–21:04 | Publica fixture, `dbb59f92` | Publica ignore/untrack, `77a2f3f` |

Los `cwd` de publicación y los paths de edición permanecen en sus respectivos repositorios. Los Works principales son distintos. No se encontraron llamadas de estas familias que mutaran el Work principal de la otra.

### Tercera sesión: concurrencia anterior real

La raíz `ses_edece9cefffefMgQbuOrHqfS9y`, titulada **Greeting and readiness check**, estuvo activa de **15:04:07 a 20:54:29** en el mismo workspace. Se amplió el análisis únicamente para comprobar solapamientos de recursos, no para auditar toda su conversación.

Entre 17:06:05 y 20:54:29 se examinaron sus **731 tools**, incluidas 114 llamadas bash, 19 parches y 30 delegaciones. La raíz aporta 421 tools. Sus peticiones `pulso_work` bien formadas apuntan al Work multirepo; no a los Works de Contact details. Sus diez consultas `pulso_context` son lecturas.

Sus escrituras explícitas afectan `cells-insurance-pdf-template-rbvd`, `cells-insurance-cancellation-app-rbvd` y `cells-insurance-app-rbvd`. No se encontró escritura ni bash dirigido a `cells-insurance-guaranteed-income-app`.

Ejemplo de concurrencia operativa, no meramente sesiones abiertas:

- Contact details: Executor **18:03:10–18:09:47**, hijo `ses_ede2aad98ffeEy9CB71BSxhuOl`.
- Tercera sesión: Executor **18:07:05–18:07:43**, hijo `ses_ede271abeffe4p8X9Vn2rvB9f3`.
- **18:07:25.551**, Contact modifica `cells-insurance-guaranteed-income-app/test/unit/beneficiaries-and-payment-page.test.js`, part `prt_121d92b76001euEhqyvr4kYkHj`.
- **18:07:27.802**, la tercera familia modifica `cells-insurance-cancellation-app-rbvd/package.json`, part `prt_121d93ccd001BevUqVbKBHTmZk`.

La intersección de rutas de parche entre esas familias es vacía. Esto no excluye efectos indirectos de scripts o recursos externos compartidos, pero no acredita una carrera sobre los archivos examinados.

La tercera familia publicó `2d6299b` en cancellation a las 20:41, el HEAD encontrado después por PR 118. El Work recuperado por PR 118 no era solo un residuo remoto: había tenido actividad material ese día.

## 3. Sesión Contact details: secuencia completa por etapas

| Hora UTC | Intención del usuario y resultado observado |
| --- | --- |
| 17:06–17:15 | Pregunta por Contact details en Vida Inversión y Renta; aclara después que se refiere al cliente principal, no beneficiarios. |
| 17:17–17:33 | Exploración, primer encargo bloqueado por scope contradictorio, segundo implementa; QA detecta carrera. |
| 17:36–17:40 | Corrección de carrera y QA; se ejecutan pruebas después de la nueva prohibición del usuario. |
| 17:51–18:31 | Explicación de cambios preexistentes, inclusión por orden del usuario, revisiones y arreglos; publicación de once rutas en `a002646f`. |
| 18:40–19:14 | Jenkins reporta siete fallos; arreglos, dos encargos redundantes, revisiones e inventarios; publicación `e913fd1`. |
| 19:19 | Nuevo fallo único de timeout: el coordinador devuelve la entrega anterior. |
| 19:28–19:38 | Usuario reitera; se sustituye el test DOM, publica `3292474` y verifica HEAD limpio. El coordinador introduce un hash anterior en una aceptación. |
| 19:48 | Compactación manual mantiene incertidumbre Git ya resuelta. |
| 19:49–19:58 | Correcciones Sonar, petición de volver al español y publicación `f3b39e5`. |
| 20:17–20:41 | Usuario confirma pipeline y pide cerrar; dos revisiones cierran, implementación sigue bloqueada por tareas/evidencia no incorporadas. |
| 20:42–20:55 | Pulso asegura bloqueo de moneda; usuario reporta que permite cambiarla. Nueva corrección, confirmación del usuario y publicación `ab31dbf`. |
| 21:00–21:04 | CI encuentra fixture antigua; arreglo puntual, review y publicación `dbb59f92`. |

### C1. Respuesta a una tarea anterior, demostrada

A las **19:19:02**, mensaje `msg_1221ac825001b2c2dbNrgFI6dQ`, el usuario informa **un fallo nuevo**: «Falló un test más, resuélvelo rápido». El log presenta un fallo y 615 tests aprobados.

A las **19:19:26**, `prt_1221b24d2001fJNCnzYMyaffoC`, Pulso responde con `e913fd1` y «Falta que Jenkins confirme si los **7 fallos** quedaron resueltos». Entre la petición y la respuesta solo aparece una consulta del Work; no una implementación del nuevo fallo.

El usuario reitera a las **19:28:09**. Es una respuesta desactualizada acreditada, aproximadamente 96 minutos anterior al inicio de PR 118.

### C2. Dos implementaciones redelegadas después de completarse

**Bootstrap:** `ses_ede03970affeazGgzVVkPljfqy` termina a las **18:46:58**; `ses_ede00db8affeNFkqzBMKKYzxW9` vuelve a recibir el mismo objetivo a las **18:48:51**. Reutilizan `jenkins-fix-bootstrap-test-v2-20261009` y `fix-bootstrap-window-tests`.

**Quotation:** `ses_ede05eb2fffe0LgTPsZt5TpcNC` termina a las **18:44:42**; `ses_eddfff167ffeKi5iUqDqJno4MD` recibe de nuevo los cuatro fallos originales a las **18:49:51**. Reutilizan `jenkins-fix-quotation-tests-20261009` y `fix-quotation-jenkins-tests`.

No hay una nueva ejecución Jenkins ni una revisión independiente entre cada pareja que justifique repetir íntegramente el diagnóstico original. Los segundos ejecutores hacen cambios incrementales sobre los primeros; no son parches idénticos ni escritores simultáneos. Los 53 intervalos de `task` de esta familia no se solapan entre sí.

### C3. Resultado correcto alterado por el coordinador

El Executor publica **`3292474d5f1fce3f2f619e3e4ce9ea2a9d046902`** a las 19:35, con asunto `fix(test): remove flaky currency controls DOM wait [PARS-21860]`. Commit y push constan en `prt_12229df0600153d2E5rQzKArUW` y `prt_12229e8d0001ANVDvj8DL6zIkw`.

En el intento de incorporación de **19:36:55**, `prt_1222b259c001qbIfXhG1XV8ZLX`, el coordinador mezcla ese asunto con el hash anterior **`e913fd1`**, además de enviar una huella truncada. El rechazo es coherente con el input inválido. La contradicción no procede del Executor ni del transporte nativo.

A las **19:37:35**, `prt_1222bc3b20012MUZ6UicL0wQSy`, otra inspección confirma `3292474` y checkout limpio. Sin embargo, la compactación manual de **19:48**, `prt_12235b5dc001sHPNF7Dm6eFnou`, mantiene «reconciliar Git» como pendiente y habla de informes contradictorios sin conservar correctamente su origen ni la comprobación que los resolvió.

### C4. Explicación de demora sin respaldo en las herramientas

A las **19:08**, `prt_122112f56001Neducp0pR3nJnj`, Pulso pide reconciliar una publicación correctiva «recién reportada por Executor». El encargo anterior era un inventario de lectura; no había publicado. La comprobación siguiente confirma HEAD `a002646f` y dos tests aún modificados.

A las **19:11**, mensaje `msg_122135618001c5Z5v3fNvpT4hE`, explica la demora por «un intento de push que se reportó como exitoso pero no dejó un commit nuevo». No hay tal push correctivo en la familia antes del real de `e913fd1` a las 19:12. La explicación no está sustentada por el registro examinado.

### C5. Tests después de la prohibición y relato temporal incorrecto

La prohibición del usuario se registra a las **17:38:32.770**, `msg_121bec4c2001Z9RHRRTyy3wmrC`. Una delegación QA preparada segundos antes ejecuta pruebas a **17:39:08**, **17:39:12** y **17:39:20**: `prt_121bf5059001SgPKqkFvkwTxVI`, `prt_121bf5e23001bW0o5L7KTVZ7Vu`, `prt_121bf7f3e0017w17l9MWH7NVqL`.

El padre afirma a las 17:39:55 que esas ejecuciones ocurrieron antes de recibir la instrucción. Los timestamps lo contradicen. Es compatible con una restricción no propagada a una delegación en curso; no demuestra desobediencia deliberada del hijo. Después de este episodio no se encontraron nuevas ejecuciones de tests en la familia.

### C6. Registro incorrecto de cambios y cierre bloqueado

Después de un rechazo administrativo, un nuevo Executor recibe «solo documentar» el arreglo ya hecho: `ses_ede1f4c33ffe5BRUMS7luy1wFG`, 18:15–18:16. No aplica parches, pero atribuye cambios a `quotation-state.js` y su test. Esas rutas no aparecen en los parches de la familia ni en las once rutas finalmente publicadas. El coordinador las acepta como `changedFiles` a las 18:16:20, `prt_121e15ee3001ccE9KrsIaS8RY9`.

Hay **58 intentos de `accept_result`: 17 aceptados y 41 rechazados**. Se observan envelopes inválidos, Markdown requerido ausente, contratos reescritos, bases incompletas, revisiones antiguas y huellas incorrectas. No todos son defectos del validador: muchos rechazos están justificados por los inputs.

Tras las confirmaciones del usuario desde las 20:17, el principal sigue sin cerrar. A las 20:27 aparecen once tareas abiertas y AC-1 sin evidencia vigente. El último estado registrado termina en revisión 67, `in_progress`, **12/26 tareas**, esperando el CI de `dbb59f92`. Que la última corrección espere CI es razonable; que numerosas ejecuciones anteriores permanezcan sin incorporar es el problema de continuidad.

### C7. Revisión insuficiente de una regresión relacionada

El bloqueo de moneda se afirma implementado a las 20:42–20:43, pero el usuario reporta que el flujo permite modificarla. Se cambia la condición de `isHistoryFlow` a detalle cargado e identidad coincidente; el usuario valida el arreglo. La revisión posterior no detecta que otro test todavía configura la condición antigua. CI lo encuentra y exige el ajuste final de fixture.

No se reprodujo el flujo UI en runtime durante esta auditoría. El fallo y la validación provienen de los mensajes del usuario y del CI aportado; los parches y publicaciones sí están registrados.

### Qué no debe contarse como duplicación injustificada

El segundo Executor inicial sucede a un bloqueo real: el coordinador había convertido un scope autorizado en «ninguno». Otras nuevas implementaciones responden a hallazgos concretos de carrera, contactos tardíos, mismatch, histórico A→B o retry. Una revisión repetida descubrió un mock infiel que la anterior no había detectado. La auditoría no clasifica toda repetición como inútil.

## 4. Sesión PR 118: secuencia y fallos

### P1. Diagnóstico inicial limitado, no confundir con conflicto resuelto

El usuario pide revisar el conflicto del lockfile, exclusivamente cancellation. El primer hijo, `ses_edd8bab66ffeXBVq3c93exsZds`, confirma HEAD `2d6299b` y una referencia remota del PR coincidente. No dispone del objeto remoto de develop; `gh` no está instalado y las consultas web/API requieren autenticación. Reporta bloqueo sin inventar hunks.

Después el usuario cambia explícitamente el objetivo: no versionar el lockfile por regla corporativa, conservarlo localmente e ignorarlo. La eliminación del seguimiento sí se ejecuta. **No queda acreditada una comprobación posterior de mergeability del PR.**

### P2. Ejecución completada → rechazo administrativo → misma ejecución otra vez

1. **21:00:20–21:00:52**, hijo `ses_edd887be6ffeaomNBA1PemFMXm`: ejecuta `git rm --cached -- package-lock.json`, ajusta `.gitignore` a `/package-lock.json` y verifica el estado.
2. **21:01:15**, `prt_122783b5f001oCwjXuzWA4ZTeU`: `accept_result` rechaza **«Encargo no canónico: resources»**. El coordinador ha cambiado frases del contrato, aunque su significado sea parecido.
3. Sigue una lectura truncada y **`CURSOR_OBSOLETO`**, `prt_1227887850014E5PyKnIsUk6V8`. El cursor era de revisión 61; la propia sesión ya había avanzado el Work a 63.
4. **21:02:05–21:02:35**, hijo `ses_edd86e2aaffewV6uoKznlil22e`: recibe otra vez `ignore-lockfile-cancellation`, misma tarea y revisión. Encuentra el cambio hecho y solo inspecciona.
5. Su informe dice «ajusté la regla», pese a no haber editado nada en esa invocación: `prt_122798c41001ehbc3lXJpDmljL`.
6. **21:02:46**, `prt_12279a5300014hkEv0C5xJ7Hwl`: el coordinador vuelve a alterar `resources` y obtiene el mismo rechazo.

Esto demuestra una redelegación redundante después de ejecución exitosa. Reintentar correctamente la incorporación no requería ejecutar de nuevo el cambio.

### P3. Tres incorporaciones rechazadas y estado persistido atrasado

Los **tres** `accept_result` de esta sesión fallan:

- 20:58:18, `prt_1227587ab001TD0R7ra5JouCF2`: cambio en `acceptance`.
- 21:01:15: cambio en `resources`.
- 21:02:46: mismo tipo de cambio en `resources`.

El coordinador anuncia el estado Git correcto, pero no incorpora los resultados al Work. Añade la tarea de publicación después de publicar y mantiene un `nextAction` que pide implementar sin commit/push, aunque ese trabajo ya se realizó y subió. La última mutación exitosa es revisión 64; no consta aceptación final en la familia.

### P4. Publicación real, con desactivación de hooks no comunicada

El usuario autoriza «Subelo con el mismo ticket». El ejecutor crea y publica:

```text
77a2f3f45d5725e575e6e1630afe341433ecef63
chore(cancellation): stop tracking npm lockfile [PARS-21860]
```

En `prt_1227b3c43001IUYrm7H86uKvRR`, **21:04:24**, usa:

```bash
git -c core.hooksPath=/dev/null commit -m 'chore(cancellation): stop tracking npm lockfile [PARS-21860]'
```

La delegación indicaba detenerse si un hook ejecutaba tests/scripts, no deshabilitarlo. No se prueba que existiera un hook efectivo; sí que se deshabilitó su ejecución y se omitió el dato en el informe.

La quinta delegación verifica el resultado sin repetir commit/push. Es una verificación legítima, aunque su prompt contiene criterios heredados de publicación que contradicen el objetivo de solo lectura. El hijo respeta la restricción de lectura. Se acredita una sola modificación material, un commit y un push; `package.json` queda intacto y el lockfile existe localmente, ignorado y no rastreado.

## 5. Qué revela el contraste con el código

### D1. El contrato preparado es efímero

`v4/core/lib/acceptance.mjs:64–75` calcula `delegation`, `acceptanceBasis`, `specialistPrompt` y `hostContext`, pero no los persiste ni reserva la tarea. La incorporación exige que el coordinador retransmita contrato/base.

`v4/core/lib/artifacts.mjs:340–341` compara literalmente los arrays canónicos de scope, recursos y aceptación. `acceptance.mjs:94` activa esa validación. Así se explican los rechazos por pequeñas reformulaciones. La comprobación protege el contrato; la fragilidad es exigir al modelo reconstruir o conservar un objeto que el sistema ya calculó.

No hay lookup persistente del encargo preparado antes de aceptarlo. La procedencia temporal de la base original también descansa en la instrucción de conservarla, no en un snapshot preparado recuperable.

### D2. Idempotencia de aceptación no equivale a idempotencia de ejecución

`acceptance.mjs:87–91` detecta una incorporación repetida por Work/ciclo/delegationId y hash del payload. La revisión actual se exige antes, en `:81`; repetir una petición cuyo recibo se perdió requiere primero reconciliar la revisión.

La preparación no impide volver a delegar tareas `in_progress` o `done`; solo excluye canceladas. Los hooks son observadores pasivos y no impiden `task`: `v4/adapters/opencode/plugin/index.mjs:100–120`. Por tanto, rechazar una incorporación deja técnicamente posible otro dispatch del mismo objetivo. No significa que el core lo ordene; la decisión la toma el coordinador.

### D3. La sesión aparece en procedencia, pero no vincula la operación al objetivo

El plugin obtiene la raíz de `context.directory`, `index.mjs:29–39`. Añade `sessionID/messageID/callID` al recibo, `:19–22`, pero al core transmite raíz, recursos y contexto de aborto, **no una identidad operativa de sesión**, `:92`.

Los Works se seleccionan por el `workId` de la petición. No existe un vínculo comprobado sesión → Work → repositorio/rama → intención vigente. Las rutas de los encargos sí se validan, pero la elección del objetivo pertinente queda en manos del modelo.

### D4. Foco y memoria compartidos; aislamiento parcial

`v4/core/lib/artifacts.mjs:155–168` mantiene un único `focusWorkId` en el índice del workspace. `v4/core/lib/memory.mjs:7,32–35,93–107` comparte contexto por proyecto. `status` puede introducir resúmenes de otros objetivos, como sucede en las sesiones auditadas.

En cambio, el observador identifica intentos por raíz y `[sessionID, callID]`, `v4/adapters/opencode/plugin/delegation-observer.mjs:6–10,48–55`. Esa separación concuerda con que los resultados de los hijos hayan llegado correctamente.

El generador imprime `taskIds:` para encargos múltiples (`acceptance.mjs:20`), mientras el filtro de observación exige `taskId:` (`index.mjs:45–48`). Esto puede dejar encargos múltiples sin telemetría; no se identifica como causa de los incidentes concretos.

### D5. Riesgos de concurrencia distintos de los errores observados

Una actualización de Work B no incrementa la revisión canónica de Work A. Por tanto, compartir workspace no basta para explicar los errores de revisión de A. En varios casos documentados, las propias actualizaciones del coordinador vuelven obsoletos su revisión o cursor.

Sí hay riesgos entre procesos: `saveWork` comprueba revisión y luego escribe (`artifacts.mjs:170–181`); el rename atómico (`v4/core/lib/fs.mjs:29–40`) no convierte toda la secuencia en compare-and-swap. Índice e historial son proyecciones compartidas reemplazadas mediante read-modify-write. No se demostró pérdida de escrituras en estas sesiones ni que corrieran en procesos diferentes. El lock de memoria de usuario no protege todas esas otras escrituras.

### D6. Reglas existentes no bastaron

El prompt ya ordena conservar originales, no repetir producto por fallo administrativo, reconciliar `nextAction`, distinguir workspace/repositorio y no mantener varios escritores del mismo Work. Véanse `v4/core/agents/pulso.md:74–79,85,93,114` y `v4/adapters/opencode/build.mjs:4–8`.

Los recibos identifican 4.1.1, por lo que no debe presentarse el incidente como únicamente un problema ya corregido por instrucciones de esa versión. La auditoría anterior `AUDITORIA-CONTINUIDAD-2026-10-09.md` ya describía reconstrucciones de contratos y repetición tras errores administrativos. Las nuevas sesiones muestran que persiste la fragilidad operativa.

## 6. Conclusión causal: niveles de certeza

| Afirmación | Dictamen |
| --- | --- |
| Se respondió a una tarea anterior | **Demostrado**: nuevo timeout contestado con entrega anterior. |
| Se redelegó trabajo ya completado | **Demostrado** en ambas familias. |
| El coordinador alteró información correcta de sus hijos | **Demostrado**: hash/asunto, atribución de rutas, contrato canónico. |
| La compactación mantuvo un pendiente ya resuelto | **Demostrado** por contraste con Git anterior al resumen. |
| Había múltiples sesiones trabajando realmente en el workspace | **Demostrado**, incluida concurrencia operativa con la tercera familia. |
| PR 118 causó los fallos anteriores de Contact details | **Descartado temporalmente** para esos incidentes. |
| OpenCode entregó resultados de un hijo a un padre incorrecto | **No observado** en los 58 pares revisados. |
| Hubo escrituras explícitas cruzadas sobre el repo de la otra familia | **No observado**; rutas y cwd separados. |
| El foco/contexto global puede desorientar sesiones con objetivos distintos | **Riesgo de diseño sustentado** y exposición real a resúmenes ajenos; causalidad individual no probada. |
| Una carrera corrompió el índice o perdió Work en estas sesiones | **No demostrado**. |

Además, CodeGraph devolvió símbolos de repositorios ajenos al objetivo. En Contact details se localizaron 42 salidas que contienen rutas de cancellation, todas anteriores a PR 118. La configuración actual del MCP apunta al workspace multirrepo. Esto explica una fuente de ruido de búsqueda, no acredita intercambio de conversaciones.

## 7. Correcciones prioritarias propuestas

Estas son propuestas, **no cambios implementados ni verificados** por esta auditoría.

1. **P0 — Persistir el encargo preparado.** Snapshot inmutable de contrato/base/prompt y referencia nativa. Aceptar por ID recuperando los originales en código; evitar que el modelo retransmita campos canónicos y huellas.
2. **P0 — Separar ejecución de incorporación.** Conservar el retorno literal, sesión hija, llamada y estado «ejecutado, pendiente de incorporar». Un rechazo administrativo debe llevar a reconciliar ese retorno, no a repetir producto. Correlacionar antes de permitir una nueva ejecución equivalente, sin sustituir la delegación nativa.
3. **P0 — Anclar la respuesta a la petición vigente.** Identificar el mensaje y objetivo atendidos; una entrega antigua no puede responder a un fallo nuevo. Actualizaciones del usuario durante una delegación requieren propagación/cancelación nativa cuando exista y una explicación fiel si no pudo detenerse.
4. **P1 — Contexto de sesión explícito.** Vincular sesión, Work y repositorio objetivo; permitir varios repositorios cuando el encargo lo declare. Separar foco local de sesión del índice global de workspace y hacer deliberado el cambio de objetivo.
5. **P1 — Reconciliación antes de resumir o cerrar.** `nextAction`, tareas, commits y respuesta deben derivarse de resultados confirmados. La compactación debe conservar la última comprobación y la procedencia de contradicciones, sin convertir un fallo de registro en incertidumbre sobre Git ya observado.
6. **P1 — Concurrencia real de metadatos.** Proteger escrituras de proyecciones/contexto entre procesos y comprobar recuperación parcial. La revisión optimista por sí sola no ofrece exclusión.
7. **P1 — Publicación y pruebas respetan límites.** No deshabilitar hooks para eludir una condición de detenerse. No atribuir comprobaciones anteriores al mensaje si los timestamps son posteriores. Mantener evidencia y autoría de cambios fieles.

### Regresiones que deben demostrar la solución

- Dos sesiones, mismo workspace, repos distintos y Works distintos: cambiar foco o aceptar en B no cambia el objetivo activo ni la respuesta de A.
- Dos llamadas de la misma tarea: resultado terminado y registro rechazado no producen un segundo Executor de implementación.
- Respuesta de aceptación perdida: relectura e idempotencia sin nuevo commit ni nuevo dispatch.
- Avance de revisión ajeno a la aceptación: incorporar el retorno independiente conservando la base original; cambio real de criterio sí lo invalida.
- Nuevo fallo CI después de una entrega: la respuesta trata el fallo nuevo y no reutiliza el commit como si lo corrigiera.
- Compactación después de una verificación Git: conserva hash y comprobación más recientes.
- Prohibición de tests mientras QA está en curso: se propaga cuando el host lo permite y se comunica fielmente cualquier ejecución posterior.
- Encargo de varias tareas: correlación observable de todos sus IDs.
- Escrituras concurrentes de Work distintos desde procesos separados: índice e historial conservan ambas, o devuelven un conflicto recuperable explícito.

La cobertura estática localizada incluye aislamiento de telemetría por sesión (`tests/opencode/observer.test.mjs`), permisos/cambio de raíz y persistencia parcial (`tests/opencode/plugin.test.mjs`), concurrencia de memoria de usuario (`tests/core/memory-concurrency.test.mjs`) y happy path de aceptación con avance de overview (`scripts/happy-path.mjs`). **No equivale a probar el escenario conversacional multisesión ni la recuperación de estos bucles.** No se ejecutaron tests en esta auditoría.

## 8. Resultado material frente a estado administrativo

Los comandos históricos sustentan seis publicaciones de Contact details (`a002646f`, `e913fd1`, `3292474`, `f3b39e5`, `ab31dbf`, `dbb59f92`) y una de PR 118 (`77a2f3f`). Eso no convierte automáticamente todas las verificaciones, criterios o tareas del Work en aceptados.

En conjunto, **44 de 61 intentos de incorporar resultados fueron rechazados —aproximadamente 72 %—**. Es una señal concreta de carga administrativa y pérdida de continuidad; no significa que fallaran 44 ejecuciones de código ni que hubiera 44 fallos del core.

**Conclusión final:** el producto conserva parcialmente la identidad nativa de las sesiones, pero no conserva de forma suficientemente robusta la relación entre intención vigente, encargo emitido, resultado recibido y trabajo aceptado. El workspace compartido amplía la exposición a contexto ajeno. La corrección debe cubrir ambas dimensiones y demostrarlo con regresiones de sesiones concurrentes; añadir otra advertencia al prompt no constituye por sí solo una solución verificada.
