# Historial de cambios de Pulso

Este historial reúne las etapas arquitectónicas y las versiones declaradas de **Pulso**.
Las fechas proceden de commits o registros documentados: no implican publicación de una release.
Los nombres OpenCode V1/V2 identifican al host, no la versión de Pulso; el nombre público es Pulso.
Los directorios históricos son fuentes de consulta, no entradas de construcción de V4.

## Cambios actuales · sin release publicada

- Consolidación de BBVA en `v4/core/skills/bbva-engineering/SKILL.md`: seis skills totales. Retiradas `bbva-apx`, `bbva-apx-testing`, `bbva-cells` y `bbva-cells-testing`; la migración elimina solo sus recursos obsoletos gestionados, preservando los prestados (`borrowed`) y ajenos.
- Política documental CELLS/APX/ASO reforzada en `<technology_knowledge_policy>` de `v4/core/agents/common.md` y `v4/core/agents/pulso.md`, junto con la skill consolidada: catálogo, consultas originales, lectura de fuentes y verificación de versiones, reutilización de evidencia vigente y bloqueo limitado al trabajo dependiente. Es una política de prompts, no enforcement de consultas por el runtime.
- Recomendación e instrucciones de acceso a [Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge), utilitario privado independiente cuyo README mantiene su instalación, corpus/modelo y configuración MCP del host. Pulso no lo incluye ni lo instala, tampoco mediante el VSIX.
- Regenerados y verificados los paquetes OpenCode, VSIX y standalone con versión declarada 4.2.0. Verificación acotada de distribución/instalador: 64 PASS y 1 skip; bootstrap explícito: 10 PASS; `npm run verify` y verificaciones de paquetes/staged: PASS. La suite global sigue con 408 PASS, 46 FAIL y 1 skip (455 pruebas); los 46 fallos se reprodujeron en `a7351bf`, que tenía 47 antes de corregir un fixture. No se declara la suite global aprobada; véanse los [límites técnicos](v4/README.md#verification-gates).
- Cierre por petición explícita con `close_by_user`: trabajo terminado, criterios/verificaciones y tareas no canceladas revisados y aprobados por usuario, sin pendientes actuales; conserva declaración, diagnóstico histórico, resultados y evidencias. Recuperación idempotente por operación y cierre normal técnico intacto. La cancelación del seguimiento preserva tareas históricamente realizadas cuya aceptación quedó obsoleta.
- Correcciones de orquestación tras auditoría de sesión: delegación de investigación desde el inicio, acuerdos vigentes conservados, revisión de conclusiones contra condiciones ejecutables y reconciliación de criterios/pendientes antes de comunicar entrega.
- `prepare_delegation` v2 devuelve el `agent` canónico junto al prompt literal; los rechazos de dispatch distinguen prompt, rol, tareas y cabecera, con posición de diferencia sin revelar contenido. Los errores de inputs muestran alcance efectivo y recuperación sin retirar requisitos necesarios.
- Instalación OpenCode con `node install.mjs` desde la raíz o `v4/`: consume el archivo standalone de la versión declarada, verifica SHA-256 y no requiere npm ni build. La guía standalone permite instalar también sin checkout.
- Limpieza de `model` y `variant` sólo para IDs exactos de agentes Pulso actuales y legacy reconocidos en los archivos globales `opencode.json` y `opencode.jsonc`, con respaldo. Se preservan el modelo global, otros agentes y el override explícito `OPENCODE_CONFIG`.
- `/pulso-init` prepara y delega el mapa contextual sin Work, tareas, continuidad de Work ni circuito QA/evidencia/cierre.
- Diagnóstico `anyOf` corregido para informar del hash inválido en la alternativa de evidencia pertinente, conservando la validación de las demás restricciones.
- Documentación de `accept_result` v2 alineada con los campos planos de `decision`: `decision.details` no está admitido.
- Builds de GitHub Actions tras push a `main` para los paquetes OpenCode, VS Code y el instalador standalone, descargables desde Artifacts de la ejecución; no publican una release.
- Documentación técnica y guías de instalación actualizadas; el historial de verificaciones se consolida aquí. Los resultados de versiones anteriores no acreditan estos cambios.
- Retirados los siete informes de desarrollo de v4. Consolidados nueve documentos breves de v2 y las dos guías de migración de v3 en sus guías de destino, con referencias actualizadas; corregidos contratos históricos de OpenCode v1 sin modificar su implementación ni los ADR de v2.

## 4.2.0 — 2026-10-12 · Registro histórico de preparación e instalación local

### Contratos, resultados y continuidad

- Snapshot del contrato original de delegación con `contractVersion:2`, separado de revisiones posteriores del trabajo.
- Respuestas administrativas compactas y Markdown natural para especialistas, conservando el contrato necesario para validar e incorporar resultados.
- Captura del resultado antes de su validación; la captura reportada y un `reportedTerminal` coherente se registran en el mismo commit administrativo.
- Aceptaciones idempotentes y continuidad vinculada al alcance y la intención del encargo.
- Reservas por tareas y rutas, con integración declarada para coordinar ámbitos de escritura.
- Correlación por sesión/llamada, sin convertir actividad observada en aceptación semántica.

### Persistencia y aislamiento

- Lock breve de metadatos, migración y recuperación explícita del estado.
- Registry por ID que evita leer cuerpos de trabajos ajenos para resolver la coordinación.
- Diagnóstico de preparación para cierre coherente con resultados, aceptación y estado persistido.
- Lectura y escritura legacy convivientes mediante el contrato legacy; no reciben las mismas garantías del contrato nuevo.

### Adaptadores nativos

- OpenCode interpreta las formas nativas de terminal y eventos, sin inventar metadatos de estado.
- VS Code utiliza bindings, lecturas dirigidas, generaciones y handles; estos mecanismos no autentican una identidad nativa de agente.
- Conversaciones reales de OpenCode, VS Code Local y Copilot Agent Host: **NOT_RUN**.
  Estos cambios no acreditan por sí solos continuidad conversacional ni concurrencia nativa resueltas.

### Rendimiento y verificación históricos

Comparación real de 12 pares contra [`daa72fc`](https://github.com/vmorenoz/pulso-bbva/commit/daa72fc):

| Medida | 4.2.0 | Base | Resultado |
| --- | ---: | ---: | --- |
| p95 del ciclo | 112,28 ms | 28,98 ms | Ratio 3,87; **FAIL** frente al umbral provisional ≤ 1,25 |
| Preparación individual p95 | 47,14 ms | 0,77 ms | < 100 ms |
| Aceptación individual p95 | 68,24 ms | 28,40 ms | < 100 ms |
| Bytes de entrada | 1592 | 2000 | −20,4 % |
| Bytes de salida | 3115 | 4026 | −22,6 % |

La reducción de bytes no compensa ni convierte en PASS la regresión del ciclo.
Versión fuente: `4.2.0`; nombres de paquetes: `pulso-opencode-4.2.0.tar.gz` y `pulso-4.2.0.vsix`.
En aquella revisión, ambos paquetes fueron comprobados con sus cores extraídos y la suite acotada terminó con **128 pruebas aprobadas**. Es un registro histórico, no un resultado de la fuente ni de los artefactos actuales. Posteriormente, por petición explícita, se instaló 4.2.0 en OpenCode global y se comprobaron versión, módulos y hashes. La instalación no acredita aceptación conversacional nativa; requiere reiniciar OpenCode para cargarla. Los comandos de comprobación vigentes se describen en la [guía técnica](v4/README.md#verification-gates).

## 4.1.1 — 2026-10-09

### Cambios

- Comunicación con especialistas mediante Markdown: `prepare_delegation` entrega `specialistPrompt`
  con objetivo, alcance, condiciones y entrega.
- Incorporación de resultados compactos conservando literalmente `result.markdown`, la identidad de la
  delegación original y su base de aceptación.
- `accept_result` exige `acceptedTaskIds` explícitos para resultados completados; aceptar una tarea
  no satisface automáticamente los criterios.
- Las entradas deben existir y estar autorizadas; las etiquetas descriptivas de recursos no conceden lectura.
- Tools y persistencia siguen usando JSON validado, revisiones y hashes. `schemaVersion` permanece en `1`;
  no se garantiza que runtimes anteriores comprendan los campos opcionales nuevos.

### Verificación histórica

- Builds, comprobaciones, smoke del core real, empaquetado y verificación de ambos paquetes extraídos documentados con exit 0.
- No se ejecutaron suites heredadas ni conversaciones nativas para el parche.
- La instalación real y el feedback cualitativo documentados no equivalen a aceptación conversacional automatizada.

Referencias: [contratos y verificación](v4/README.md#411-specialist-markdown-contract),
[commit daa72fc](https://github.com/vmorenoz/pulso-bbva/commit/daa72fc).

## 4.1.0 — 2026-10-09

- API común `prepare_delegation`, `accept_result` y `accept_delivery`; resultados inline mediante
  `output:"conversation"` y contexto de rutas confiable separado de los argumentos del modelo.
- Modos de aceptación `evidence`, `user` y `both`: aceptación explícita de usuario y evidencia técnica
  se evalúan por separado. Cambiar el modo invalida las bases y tareas afectadas.
- Registro de tareas completadas durante el ciclo para impedir eludir el cierre mediante cancelación o eliminación.
- Instrucciones de continuidad, delegación por capacidades, paralelismo por ámbitos y conservación de autorizaciones.
- Recibos con procedencia/versiones y diagnóstico de cierre. Esquema persistido conservado en versión `1`.
- Smoke del core real con proceso Node y evidencia observada, repetido contra ambos paquetes extraídos.
  Instalación real documentada en OpenCode y el perfil local predeterminado de VS Code.
- `accept_delivery`, conversaciones reales, continuidad y paralelismo nativos no quedan acreditados por ese smoke.

Referencias: [contratos de aceptación](v4/README.md#410-acceptance-contracts),
[commit 183ca80](https://github.com/vmorenoz/pulso-bbva/commit/183ca80).

## 4.0.0 — 2026-10-05 · Núcleo unificado

- Core canónico compartido para persistencia, memoria, recuperación, evidencia y contratos.
- Adaptadores independientes OpenCode V1 y VS Code, con paquetes autosuficientes que excluyen la integración hermana.
- Cuatro herramientas semánticas: `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`.
- Selector global de instalación con vista previa, propiedad de recursos, respaldos y recuperación acotada.
- Construcción desde `v4/`, sin consumir los directorios históricos; correcciones de selección de artefactos,
  comprobación del paquete instalado, evidencia/inicialización y recetas detalladas APX/CELLS.
- Lecturas públicas con `limit` y cursores ligados al snapshot/filtros, sustituyendo el anterior `offset` público.
- OpenCode usa `request` en las tres herramientas multiaction; VS Code usa argumentos planos y binding para mutaciones.
- `schemaVersion:1`; las revisiones optimistas de esta etapa no proporcionan bloqueo multiproceso del checkout.
- Registro histórico: 298 pruebas aprobadas, sin fallos ni omitidas; builds independientes, inventarios,
  extracción y paquete instalado en HOME temporal verificados. Conversaciones reales pendientes.

Referencias: [arquitectura y base revisada](v4/README.md),
[552cc00](https://github.com/vmorenoz/pulso-bbva/commit/552cc00),
[2834e67](https://github.com/vmorenoz/pulso-bbva/commit/2834e67),
[507ee68](https://github.com/vmorenoz/pulso-bbva/commit/507ee68),
[6621db3](https://github.com/vmorenoz/pulso-bbva/commit/6621db3).
Base de migración: `16cc3aa86fc47de02afeac6336bc5545012a3945`.

## VS Code 3.1.1–3.1.4 — 2026-10-05

- **3.1.1:** extensión nativa derivada de `v3-opencode-v1`, con cuatro herramientas, Pulso y nueve
  especialistas, diez skills, distribución VSIX privada y selección de proyecto por ventana.
- **3.1.2:** selección esperada antes de mutaciones, invalidación de aceptación al cambiar tareas/criterios,
  consultas paginadas, persistencia parcial explícita y bloqueo de preferencias compartidas.
- **3.1.3:** retirada de la imagen del README, conservando el icono de la extensión.
- **3.1.4:** contratos endurecidos, lecturas revisionadas, `validate_result`, `acceptanceBasis`, evidencia
  inmutable y prioridad `critical`; retirada de `complete_map` en favor de aceptación ordinaria.
- Requiere workspace local y confiable. El binding es compartido por ventana; no representa aislamiento por conversación.
- Para **3.1.1** hay smoke de Extension Host real con registro y tres consultas reales, sin conversación ni delegación.
- Para **3.1.4** se documentan build/check y 79 pruebas offline aprobadas; Extension Host y conversaciones
  Copilot/Local permanecen **NOT_RUN**. Evidencia histórica sin base observada requiere comprobación nueva para cerrar.

Referencias: [changelog específico](v3-vscode/CHANGELOG.md), [procedencia](v3-vscode/docs/BUILD.md),
[aceptación por versión](v3-vscode/docs/ACCEPTANCE.md);
[e547fe7](https://github.com/vmorenoz/pulso-bbva/commit/e547fe7),
[1ccdccc](https://github.com/vmorenoz/pulso-bbva/commit/1ccdccc),
[d279890](https://github.com/vmorenoz/pulso-bbva/commit/d279890),
[245c09f](https://github.com/vmorenoz/pulso-bbva/commit/245c09f).

## OpenCode V1: 3.0.4–3.1.1 — 2026-10-01 a 2026-10-05

- **3.0.4, 2026-10-01:** distribución nativa independiente para OpenCode V1, cuatro herramientas semánticas
  y artefactos por proyecto. Ajustes para shims de Windows y posterior retirada de la comprobación del binario/versionado del host.
- **3.1.0, 2026-10-02:** limpieza de integraciones globales legacy, edición JSONC preservadora y recuperación/migración
  de tareas reconocidas, conservando originales. Datos corruptos o no reconocidos se preservan y bloquean.
- **3.1.1, 2026-10-05:** evidencia observada con hashes y base de aceptación, memoria revisionada/paginada,
  validación de resultados, recuperación de preparación interrumpida, permisos nativos y bloqueo de preferencias globales.
- Contrato multiaction bajo `{request:{action:...}}`; historial con filtros directos. Retirada del cierre automático de mapas.
- Prioridades `low/normal/high/critical`, sin `urgent`. La evidencia anterior permanece legible, pero un nuevo cierre
  requiere observaciones conformes al contrato actual.
- 3.1.1 registra 204/204 pruebas aisladas aprobadas con SDK oficial 1.18.2 y Zod 4.1.8;
  TUI, modelo y permisos efectivos en sesión real **NOT_RUN**.

Referencias: [distribución](v3-opencode-v1/README.md), [endurecimiento y límites](v3-opencode-v1/docs/HARDENING-3.1.1.md);
[64dbccb](https://github.com/vmorenoz/pulso-bbva/commit/64dbccb),
[c98dd7c](https://github.com/vmorenoz/pulso-bbva/commit/c98dd7c),
[63f1e18](https://github.com/vmorenoz/pulso-bbva/commit/63f1e18),
[f4fbd37](https://github.com/vmorenoz/pulso-bbva/commit/f4fbd37).

## V3: prototipo nativo y OpenCode v2 — 2026-09-29 a 2026-09-30

- **2026-09-29:** propuesta inicial de orquestación nativa global OpenCode/VS Code, planes y contexto Markdown,
  trabajos JSON e historial en `.pulso/`; inicialización diferida y delegada, sin runtime propio, MCP, scheduler ni base de datos.
- **2026-09-30:** reorientación de `v3/` a OpenCode major 2, plugin de herramientas y core semántico;
  retirada de CLI operativa y adaptación VS Code de esa distribución, y rechazo de OpenCode V1.
- Ambas etapas inspeccionadas declaran **3.0.4**; no representan dos releases semver distintas comprobadas.
- Datos incompatibles preservados y bloqueados, sin migración automática. No confundir este prototipo
  ni su antiguo adaptador con la posterior extensión `v3-vscode`.
- El README inicial registra 94/94 pruebas offline; no acredita aceptación de saludo/inicialización por modelos.
  La distribución posterior mantiene TUI/modelos/tools reales en **NOT_RUN**.

Referencias: [README inicial en dd5158e](https://github.com/vmorenoz/pulso-bbva/blob/dd5158e/v3/README.md),
[distribución OpenCode v2](v3/README.md), [ruptura y migración](v3/docs/INSTALLER.md#migración-y-datos-del-proyecto),
[c6bbd29](https://github.com/vmorenoz/pulso-bbva/commit/c6bbd29).

## V2 y evolución V2.1 — 2026-09-23 a 2026-09-28

- Monorepo TypeScript/Bun con Work System autoritativo sobre SQLite, fachada MCP única y CLI administrativa;
  separación entre estado de Work y bindings externos, estado fuera del workspace e identidad por ruta resuelta.
- Definiciones canónicas, renderizadores OpenCode/VS Code, instalador local/global y contratos `pulso-task/2` y `pulso-result/2`.
- Guard de protocolo mediante hooks públicos de OpenCode y evolución de continuidad y seguridad del protocolo.
- Cambio arquitectónico respecto al plano de control V1; no se acredita migración automática entre sus almacenes.
- **V2/V2.1 son etapas**, no versiones `2.0.0`/`2.1.0` verificadas: la raíz carece de versión y `working-system` declara `0.1.0`.
- Se documentan descubrimiento y conexión MCP en OpenCode 1.18.32; un proveedor determinista no acredita modelos reales.
  OC-02.2 permanece **FAIL**, con turnos 3–8 **NOT_RUN**; retirar un criterio léxico no convirtió la ejecución en PASS.

Referencias: [arquitectura](v2/docs/architecture.md), [runtime y límites](v2/docs/runtime-opencode.md),
[b905f63](https://github.com/vmorenoz/pulso-bbva/commit/b905f63),
[085af69](https://github.com/vmorenoz/pulso-bbva/commit/085af69),
[6f135fe](https://github.com/vmorenoz/pulso-bbva/commit/6f135fe).

## V1: 0.1.0–0.3.0 — 2026-09-11 a 2026-09-23

- **0.1.0, 2026-09-11:** primera versión registrada para OpenCode, agentes, plugins, herramientas, circuit breaker y dashboard.
- **0.2.0, 2026-09-15:** adaptador GitHub Copilot CLI y perfiles de modelos; evolución posterior de contactos de agentes,
  aislamiento del plano de control, recuperación de leases y configuración de proveedores.
- **0.3.0, 2026-09-22:** migración de Copilot CLI a VS Code Agents y sustitución de comandos de instalación del adaptador.
- Estado histórico final: rutas adaptativas, contratos y leases, evidencia, experiencia SQLite, preferencias, métricas y diagnóstico.
- **2026-09-23:** traslado a `v1/` al introducir V2. El directorio no implica una release `1.0.0`.
- La integración VS Code Agents tiene límites propios de modelos, dashboard/métricas y contactos; no garantiza paridad total.

Referencias: [arquitectura V1](v1/README.md), [manifiesto 0.3.0](v1/package.json),
[a94b91e](https://github.com/vmorenoz/pulso-bbva/commit/a94b91e),
[c926272](https://github.com/vmorenoz/pulso-bbva/commit/c926272),
[81f597d](https://github.com/vmorenoz/pulso-bbva/commit/81f597d).

## Alcance de las evidencias históricas

Los PASS corresponden a su versión y entorno, no se heredan por versiones posteriores. En V4, `npm run verify`
documentado para 4.1.1 ejecuta build, check y happy path, no `npm test`; los 298 tests pertenecen al registro de 4.0.0.
Instalar, activar herramientas o extraer paquetes no demuestra conversación, delegación ni aceptación humana real.
La integridad BBVA se refiere a la base revisada de cada etapa: 3.1.1 documenta una discrepancia previa de
`bbva-engineering`; no se afirma identidad universal con un origen único durante toda la historia.
