# Pulso

Asistente de desarrollo que aclara objetivos, coordina nueve especialistas y conserva continuidad verificable en tu proyecto.

## Empezar

Instala el paquete mediante el instalador de Pulso y selecciona **Pulso** en OpenCode. Usa los comandos pulso-init, pulso-status, pulso-recap y pulso-resume para preparar, consultar y retomar trabajo.

Un saludo o una consulta de estado no prepara el proyecto ni escribe archivos. La preparación es una operación explícita. Los datos del proyecto se guardan en `.pulso/` y las preferencias personales se conservan entre proyectos.

## Trabajo y revisión

Cada operación respeta los permisos nativos. Pulso delega encargos acotados a especialistas y revisa sus resultados y evidencia antes de consolidar. Un retorno de una herramienta no significa que el trabajo haya sido aceptado.

Las herramientas de acciones reciben un objeto request con action y los campos de la operación. pulso_history recibe filtros planos. Las lecturas extensas se paginan mediante limit y cursor; sigue hasMore y nextCursor.

`pulso_work` consume los contratos comunes sin replicar sus reglas:

- `prepare_delegation` es lectura: devuelve encargo canónico, base previa y rutas efectivas del contexto confiable del adaptador. No lanza agentes.
- `accept_result` incorpora el resultado revisado con el encargo y la base originales, revisión actual y tareas seleccionadas; no satisface criterios automáticamente. Un resultado breve inline no exige otro Markdown.
- `accept_delivery` conserva aceptación manual declarada e intenta cerrar. No acredita ejecución ni completa tareas. Comprueba `data.acceptanceRecorded`, `data.closed`, `data.readiness` y posibles `closeError`/`persistence`; consulta Work antes de repetir tras un retorno perdido o parcial.

Las tres acciones usan el envelope `{request:{action,...}}` y el mismo permiso nativo `pulso_work` con patrón `action:workId`. Las mutaciones se identifican desde el contrato común. El retorno nativo contiene el recibo JSON en `output`: no equivale a `ok:true`, y `ok:true` confirma la operación, no el cierre del objetivo.

Los agentes generados publican un bloque simple de capacidades declaradas por rol, derivado de sus permisos: principal y Explorer sin bash; Executor y QA con bash `ask`; los demás especialistas sin bash. Son declaraciones, no garantías de disponibilidad del host. La inspección Git puede delegarse a Executor con alcance de sólo lectura y cwd explícito; una denegación expresa no se elude reasignando.

Cada recibo incluye `provenance.runtime` con adaptador, nombre y versión leídos del `package.json` del runtime cargado. `provenance.host` sólo aparece con los `sessionID`, `messageID` o `callID` que el host suministre en el contexto de la invocación. No se generan IDs sustitutivos ni se deducen del encargo; esta procedencia no acredita ejecución o aceptación de especialistas.

Si una operación informa de persistencia parcial, conserva el identificador y la revisión indicados y pide recuperación antes de repetirla. No edites manualmente los registros canónicos.

El paquete incluye el helper oficial de tools de @opencode-ai/plugin 1.18.2 y Zod 4.1.8. Sus avisos y licencias se conservan en plugin/vendor.
