# Pulso 4.2.0 · continuidad durable y aislamiento

**Fecha:** 2026-10-12. **Estado:** implementación y paquetes locales verificados; OpenCode instalado posteriormente por petición explícita, publicación no realizada. La aceptación conversacional real de los hosts y el presupuesto relativo de latencia siguen pendientes de satisfacción.

Referencias: [plan transversal](PLAN-CONTINUIDAD-MULTISESION-OPENCODE-VSCODE.md), [auditoría de las sesiones](AUDITORIA-MULTISESION-2026-10-09.md), [contratos](core/lib/ACCEPTANCE-API.md), [changelog desde V1](../CHANGELOG.md).

## Implementación

### Core compartido

- Preparación `contractVersion:2` con snapshot/base/prompt originales y respuesta pública compacta. `get_delegation` recupera los originales por ID.
- Captura reportada antes de validar decisión, revisión o base. Captura y declaración terminal coherente comparten commit administrativo; no se convierten en terminal nativo.
- Decisiones y aceptación declarada idempotentes; recibos distinguen revisión aplicada, revisión actual y validez histórica.
- Continuidad por objetivo, Work/ciclo, repositorios e intención. Retoma explícita entre sesiones nativas y compatibilidad deliberada de encargos, sin renovar bases.
- Claims por tareas, paths, lecturas estables e integración declarada. Aliases de paths y reducción de repositorios se validan estructuralmente.
- Readiness y cierre, incluidas APIs directas, comparten la comprobación de pendientes. La aceptación de una tarea no satisface automáticamente un criterio.
- Snapshots/estados/retornos inmutables por ID e índice administrativo compacto; no se leen cuerpos históricos ajenos para recuperar un encargo.
- Capturas huérfanas no permiten declarar `not_dispatched`; snapshots huérfanos no pueden resucitar tareas realizadas/canceladas ni Work cerrado.

### Persistencia

- Mutex síncrono, breve, reentrante y con propietario comprobable para metadatos del mismo workspace. No se mantiene durante delegación, red o aprobaciones.
- Lecturas de continuidad sin mutex escritor, con snapshots y comprobación optimista acotada.
- Protección de memoria y del registro global de ubicaciones por identidad; cleanup fallido conserva el hecho de una operación ya aplicada.
- Intento durable de migración fuera del árbol renombrado; recuperación antes de bootstrap y antes de reparar proyecciones.
- Los locks abandonados requieren recuperación manual explícita. No se roban por TTL ni se infiere actividad de agentes desde ellos.

### OpenCode

- Contexto nativo sesión/mensaje/llamada separado de los argumentos del modelo.
- Correlación de encargos v2 por snapshot, rol, prompt completo y todas sus tareas; identidad de llamada por el par sesión/call.
- Captura del literal original con wrapper terminal y correlación padre/hijo, sin exigir un `metadata.status` que no existía en las sesiones auditadas.
- Replay de eventos suministrados después de fallos de captura. No se usa la base privada del host como dependencia del producto.
- Telemetría legacy permanece pasiva y las tareas no gestionadas no se interceptan. Registro durable corrupto falla explícitamente.

### VS Code

- Binding y generación de contexto en mutaciones y lecturas dirigidas; solo el descubrimiento inicial de estado permite omitir el token.
- Cambios A→B→A, reselección, recarga y contexto postcommit conservan la raíz/recibo originales o rechazan la invocación obsoleta.
- Handles de continuidad explícitos; no se presentan como identidad autenticada de chat.
- `reportedReturn` permite capturar e incorporar en una llamada. Sin captura inventada de `agent` ni cancelación supuesta de especialistas.
- Continúa una raíz seleccionada por ventana; dentro de ella, continuidades distintas por objetivo/repositorios.

### Instrucciones

Se conserva Markdown natural, la especialización existente y la delegación nativa. El coordinador recupera registros en vez de reconstruir hashes o delegar de nuevo por un fallo administrativo. Se explicitan petición vigente, restricciones nuevas, atribución fiel de cambios y prohibición de saltar hooks para publicar. Son instrucciones y controles del protocolo, no una certificación de todas las futuras respuestas libres del modelo.

## Verificación ejecutada

Entorno: macOS arm64, Apple M5, Node **v24.18.0**. Fixtures con workspace/home temporales; sin activar Pulso sobre este repositorio ni alterar los repositorios de negocio auditados.

| Comprobación | Resultado observado | Alcance |
| --- | --- | --- |
| `npm run test:continuity` | **128 PASS, 0 FAIL, 0 skipped**, exit 0 | 53 pruebas core/persistencia, 37 contrato OpenCode y 38 lógica/contrato VS Code |
| `npm run build` y `npm run check` | Exit 0 | Ambos adaptadores; inventarios, imports y cinco recursos BBVA por paquete |
| `npm run smoke:happy` | PASS | Compatibilidad legacy con proceso Node real |
| `npm run smoke:durable` | PASS | Flujo v2 con proceso Node real, captura/reintento y recuperación |
| `npm run package:opencode` | Exit 0 | Archivo local 4.2.0 |
| `npm run package:vscode` | Exit 0 | VSIX local 4.2.0 |
| `npm run verify:packages` | **PASS en ambos**, exit 0 | Extracción real, hashes/inventarios y ambos smokes contra cada core extraído |
| Benchmark histórico | Ejecutado; ver apartado siguiente | 12 pares secuenciales y 2 de calentamiento excluidos |

La ejecución final de la suite y de paquetes se repitió después de corregir los dos casos de huérfanos detectados en revisión independiente. Los checks de adaptador usan SDK o formas públicas/fixtures con dobles locales: **no equivalen a probar la conversación del host**. No se ejecutó la suite global histórica por defecto.

El smoke durable acredita:

1. Preparación y captura anteriores a la incorporación, con bases y bytes preservados.
2. Decisión inválida que deja retorno recuperable; reintento por ID.
3. Repeticiones con revisiones antiguas/futuras que conservan un único resultado.
4. **Una sola ejecución** del programa fixture a través de esos reintentos.
5. Dos procesos compitiendo por una reserva y dos continuidades independientes en repositorios separados.
6. Evidencia observada → readiness → cierre → historial y recuperación pública.
7. Once recibos comprobados contra su schema estricto.

Las fronteras de migración se reconstruyeron en filesystem real y se recuperaron desde procesos nuevos. No se presentan como un ensayo de muerte exactamente durante `rename`. Sí se ensayó muerte del dueño del mutex y conservación del lock para recuperación explícita.

## Rendimiento: coste medido, no ocultado

Comando reproducible desde `v4`:

```sh
node scripts/continuity-benchmark.mjs
```

Puede fijarse `PULSO_SMOKE_TMP` a un directorio temporal existente. El script extrae localmente el core histórico de `daa72fcd3c23d69ea220acc0ec1e51c4070babfc` y lo compara con el working tree. No descarga dependencias ni cambia el checkout.

Última medición, sin ejecutar simultáneamente otras comprobaciones de este trabajo:

| Métrica | 4.1.1 histórica | 4.2.0 actual |
| --- | ---: | ---: |
| Preparación p95 | 0,77 ms | **47,14 ms** |
| Incorporación p95 | 28,40 ms | **68,24 ms** |
| Ciclo preparar + incorporar p50 | 24,74 ms | **106,56 ms** |
| Ciclo preparar + incorporar p95 | 28,98 ms | **112,28 ms** |
| Entrada por ciclo p95 | 2.000 bytes | **1.592 bytes, −20,4 %** |
| Salida por ciclo p95 | 4.026 bytes | **3.115 bytes, −22,6 %** |
| Llamadas administrativas medidas por ciclo | 2 | **2** |

**El presupuesto provisional relativo ≤1,25× no se cumple: ratio p95 3,87× y aproximadamente 83 ms adicionales por ciclo medido.** Los límites individuales de 100 ms pasan en este entorno y fixture. El coste agrega garantías de durabilidad/exclusión ausentes del baseline; reducir payload o evitar reejecuciones no convierte ese FAIL en PASS.

Se optimizaron dos fuentes de trabajo redundante: reporte y terminal coherentes se registran juntos, y la preparación pública ya no retransmite contrato/base/contexto. Se mantiene fsync y la recuperación; no se relajan controles para aparentar rapidez.

El benchmark excluye imports, preparación de fixtures, vinculación inicial de continuidad, comprobaciones, modelo/red y delegación. Los bytes son JSON de API, no tokens exactos ni I/O total. No mide rapidez o calidad conversacional. Los tiempos puntuales de smokes ejecutados junto a tests de integración no se usan como percentiles.

Huellas de los árboles comparados, antes de esta documentación de entrega:

```text
4.1.1 core: a34d53ea108965a749ac0cf8bd3d584e6b3f9d13eb6659296afb3a574b4bbf9a
4.2.0 core: a99b908a30bb6c44e2ce895d1b72e143f7a0698be0f16a3928d3ac1e189ea0eb
```

## Paquetes finales

Generados y verificados localmente después de las correcciones finales:

```text
1bec1d37e2cf5b7bb72d28d1c8bd03e8ca9c73537e8edf9d0aa07f4f15375f1f  artifacts/pulso-opencode-4.2.0.tar.gz
6f6a76f3201fecec8365ded2022f415a7a24ff94b17732ec364e7c33f92afaf0  artifacts/pulso-4.2.0.vsix
```

OpenCode: 158 archivos de inventario. VS Code: 82. Cada paquete conserva las cinco skills BBVA verificadas. El verificador carga el plugin/SDK y schemas de OpenCode sin activar un host; en VS Code comprueba descriptores y sintaxis sin activar una conversación.

Al entregar inicialmente los paquetes no se instalaron en los hosts activos. Posteriormente se instaló únicamente OpenCode, como registra el apartado siguiente. No se publicaron releases; los cambios del repositorio permanecen sin commit.

### Instalación solicitada: OpenCode 4.2.0

Ejecutado después de comprobar el paquete y revisar el dry-run:

```sh
node installer/cli.mjs --targets opencode --opencode-package "/Users/p041413/Bbva/Projects/Pulso/v4/dist/opencode" --yes
```

El instalador terminó con exit 0, `status: complete`, `runtime: opencode`, `status: configured`, `version: 4.2.0` y `nativeSession: NOT_RUN`.

- Runtime: `~/.pulso/runtimes/opencode-v1`.
- Configuración: `~/.config/opencode/opencode.jsonc`, con el plugin de ese runtime y `default_agent: pulso`.
- Backup: `~/.pulso/backups/opencode-2cc8720d-6b8f-47be-b7ae-53e6f88a8d07`.
- Verificado el manifest instalado 4.2.0 y la coincidencia SHA-256 con el stage de `plugin/index.mjs`, `plugin/durable-hooks.mjs`, `resources/lib/delegation-registry.mjs` y `resources/lib/continuity.mjs`.
- Importación del plugin y contratos durables instalados: PASS, sin invocar tools Pulso ni preparar un proyecto.

Cerrar y reiniciar las instancias antiguas de OpenCode antes de retomar trabajo: los procesos ya abiertos conservan la configuración y módulos cargados. La instalación no acredita las pruebas conversacionales pendientes.

## Compatibilidad y uso posterior

- Contrato legacy admitido para compatibilidad; no recibe las garantías durables de la ruta v2.
- Work/evidencia permanecen en schema 1 con campos opcionales. Continuidad/registro usan formato 2. No se inventan capturas, sesiones ni bases de aceptación históricas.
- Antes de una instalación posterior, detener las sesiones/ventanas escritoras antiguas del workspace; un runtime antiguo ignora el protocolo de mutex y los nuevos registros.
- No hay downgrade automático de datos ni coexistencia garantizada con escritores antiguos. Conservar backups y progreso nuevo al cambiar de runtime.
- Claims cubren el dominio de la misma raíz de metadatos. No son sandbox ni exclusión universal entre dos workspaces distintos que apuntan al mismo checkout.
- Una captura ausente no se transforma en éxito: recuperar por referencias/evento nativo disponible o realizar reconciliación explícita con fuente. Un lock abandonado tampoco se roba por tiempo.

## Validaciones aún pendientes

| Área | Estado |
| --- | --- |
| Mensajes reales: nuevo fallo → respuesta pertinente, sin reutilizar entrega anterior | **NOT_RUN** en los hosts con 4.2.0 |
| Compactación/retoma y propagación de una restricción a especialista en vuelo | **NOT_RUN** conversacional |
| Bloqueo efectivo de dispatch y exposición de recibos metadata en OpenCode vivo | **NOT_RUN**; formas observadas cubiertas por pruebas de contrato |
| Dos chats y dos ventanas reales de VS Code | **NOT_RUN**; lógica de binding cubierta por fixtures |
| Copilot Agent Host: tools, delegación, permisos y correspondencia de rutas | **NOT_RUN**; no se extrapola desde Local |
| Instalación OpenCode | **PASS**; reinicio de sesiones y prueba conversacional pendientes |
| Instalación VS Code 4.2.0 | **NOT_RUN** en este trabajo |
| Presupuesto relativo de latencia ≤1,25× | **FAIL provisional**, coste documentado |

Por tanto, se entrega implementación y distribución verificadas técnicamente, **no aceptación integral de todas las conductas conversacionales ni una afirmación de rendimiento idéntico al anterior**.
