# Pulso · integración nativa v2

Pulso 0.1.0 coordina nueve especialistas y conserva continuidad verificable. Esta distribución utiliza exclusivamente la API nativa v2: admite únicamente OpenCode 2.1.2; utiliza una definición de plugin `id/setup(ctx)`, herramientas JSON Schema y permisos ordenados.

## Instalación y uso

Usa el instalador autocontenido de Pulso con Node.js 22+ y `tar` en macOS/Linux. Verifica el `.sha256`, extrae el archivo, ejecuta `node install.mjs --dry-run`, revisa el plan y confirma con `node install.mjs`. Reinicia OpenCode y selecciona **Pulso**. El instalador no instala el host ni configura proveedores o credenciales.

Los comandos `/pulso-init`, `/pulso-status`, `/pulso-recap` y `/pulso-resume` cargan las guías canónicas. Un saludo o una consulta no autorizan preparación ni adopción de continuidad. `/pulso-init` delega el mapa contextual al Explorador sin crear un Work artificial. Los datos de proyecto permanecen en `.pulso/`.

## Herramientas y delegación

`pulso_workspace`, `pulso_work` y `pulso_context` reciben `{request:{action,...}}`; `pulso_history` recibe filtros planos. `output` es el recibo estructurado y `content` contiene su JSON. Retorno nativo no equivale a `ok:true`, ni `ok:true` a objetivo cerrado. Sigue `hasMore` y `nextCursor` y conserva IDs/revisiones ante persistencia parcial.

El flujo durable es `prepare_delegation → subagent → accept_result`. Envía el `specialistPrompt` exacto y conserva el contrato original. La captura queda separada de la decisión semántica. `running` significa pendiente, incluso cuando terminó la llamada que lanzó al especialista en background. La identidad proviene de sesión, mensaje y llamada nativos verificados, no de los argumentos del modelo.

Si se pierde una respuesta o falla una incorporación administrativa, recupera por `delegationId`/`returnId`; no repitas la ejecución. Si falta captura, `reportedReturn` conserva el reporte literal sin inventar procedencia nativa. `accept_delivery` registra aceptación manual declarada; no acredita ejecución ni evidencia ausente. Comprueba `data.closed`, readiness y fallos parciales.

La recuperación es acotada y exige evidencia nativa fresca y permiso. No confunde contexto después de compactación con historial completo, un estado idle con éxito, ni un cambio de propietario con terminación de procesos. Si falta evidencia, usa inspección o reconciliación explícita, sin redisparar encargos. El plugin no continúa trabajando con OpenCode apagado.

## Permisos y documentación

Las cuatro herramientas respetan permisos efectivos y cancelación. Los especialistas sólo acceden a su asignación verificada. `shell` y `subagent` sustituyen los nombres nativos anteriores; `external_directory` requiere aprobación explícita. Las restricciones del prompt no sustituyen el sandbox del host.

La skill `bbva-engineering` y los agentes mantienen la política documental CELLS/APX/ASO. [Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge) es un MCP externo opcional: consulta su documentación para instalarlo y configurar el host. Pulso no instala ni modifica ese servicio o su corpus.

Este paquete fija la API de OpenCode 2.1.2. Otros hosts se rechazan aunque declaren una versión similar. La validación de módulos, fixtures y archivos extraídos no prueba aceptación conversacional con un proveedor real. Comprueba la versión y el plugin activo, las cuatro herramientas, denegación/cancelación, delegaciones y recuperación en un proyecto aislado antes de adoptarlo.

## Servicio y recuperación verificable

El cliente oficial fijado obtiene el historial nativo completo, con paginación acotada a 500 mensajes. El contexto disponible después de compactación no sustituye ese historial. El servicio debe corresponder a la misma sesión, proyecto, directorio canónico, padre y agente.

OpenCode usa el descubrimiento de su servicio existente 2.1.2 mediante un registro nativo de sólo lectura. En modo `--standalone`, las opciones del paquete pueden señalar `serviceUrl:"http://127.0.0.1:PORT"` al mismo servidor local ya activo. Un servicio protegido admite `servicePassword` como opción privada del operador. No se admiten URLs remotas, credenciales dentro de la URL, query ni rutas. Un servicio inexistente o incompatible deja la operación dependiente bloqueada, sin arranque automático ni captura inventada.
