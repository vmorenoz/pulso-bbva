# Continuidad de entrega: sesión del 9 de octubre

Fuente: transcripción aportada por el usuario de `ses_edece9cefffefMgQbuOrHqfS9y`. Los recibos identifican Pulso 4.1.0. Esta revisión no ejecuta acciones sobre el proyecto auditado ni afirma comprobar las pruebas del PDF de forma independiente.

## Hallazgo principal

El orquestador sustituyó el objetivo de entrega por microencargos: incrementar versión, reproducir tests, corregir tests, publicar. Creó límites propios como «no corregir todavía» y «no commit/push» y luego pidió autorización para superarlos, aunque la publicación del mismo cambio estaba encargada. El especialista respetó el encargo limitado; la decisión de detener el ciclo era del orquestador.

Tras corregir los tests y reportar 70/70, dejó la corrección local sin publicar y pasó a esperar CI/publicación. Es una dependencia circular: el CI remoto no puede validar una corrección que sigue en local. La respuesta esperada era verificar el diff, publicar la corrección bajo la autorización vigente para esa entrega y entonces esperar la confirmación externa correspondiente.

## Matices y fallos adicionales

- Saludo y consulta inicial de estado: respuesta y lectura sin reanudación automática fueron correctas; el foco guardado por sí solo no autoriza ejecutar.
- Ticket Jira: la política instalada exigía ticket; pedir el dato ausente no equivale a pedir nuevamente autorización para un push ya solicitado. Cuando el usuario señaló el commit anterior, correspondía extraer literalmente esa referencia, sin inferir tickets de otros trabajos.
- Reporte de fallo y comando de prueba dentro de una implementación activa: habilita diagnóstico y reparación necesarios dentro del alcance, salvo instrucción expresa de solo diagnóstico. Un especialista de prueba puede ser read-only; el LT debe encargar después la reparación cubierta, no preguntar por una nueva fase ceremonial.
- La aplicación consumidora seguía condicionada a la publicación satisfactoria del paquete. Un FAIL activa reparación, no permite actualizar el consumidor con una versión no publicada.
- El archivo PDF previamente modificado dentro del mismo Work se describió como ajeno por ser anterior a la nueva delegación. La pertenencia debe contrastarse con diff, resultados y aceptación, no con antigüedad.
- Se mantuvo un bloqueo de validación visual después de que el usuario aceptara el PDF. La aceptación manual no equivale a render automatizado, pero tampoco debe ignorarse ni convertirse en una exigencia nueva.
- Las actualizaciones conservaron nextAction ya realizada y TODOs administrativos completados mientras la entrega seguía pendiente.
- Reintentos de incorporación reescribieron el encargo: cambiaron acceptance, workId y hashes. Los errores estaban justificados; repetir a mano bloques grandes agravó la recuperación. Markdown resuelve la comunicación con el especialista, pero el LT sigue obligado a conservar internamente el encargo/base originales para la API, sin reconstruirlos.
- task.add volvió a fallar por evidenceIds/summary vacíos omitidos y reason fuera de contrato. No es razonable exigir al modelo esos dos campos vacíos al crear una tarea; el core puede materializarlos.

## Corrección aplicada a 4.1.1 en preparación

1. Mandato por objetivo: reproducir → diagnosticar → corregir según contrato → verificar → publicar si cubierto por la autorización vigente. No preguntar de nuevo sin decisión real de alcance o negocio.
2. Autorización explícita de publicación conserva vigencia para correcciones relacionadas de la misma entrega/repo/rama/ticket, salvo límite de una sola operación, snapshot, revocación, cierre o cambio de alcance. No concede force-push, amend, operaciones destructivas, despliegue ni evasión de permisos nativos.
3. Los límites internos de un especialista no sustituyen al mandato del LT. El LT reasigna la siguiente parte al rol capaz sin autorizar al especialista a exceder su propio scope.
4. No terminar el turno esperando una dependencia externa cuyo requisito previo todavía puede ejecutar el equipo. Distinguir espera válida de pausa solicitada; continuar frentes independientes.
5. Reconciliar bloqueos y siguiente acción con hechos actuales. No renovar pruebas antiguas ni fingir aceptación técnica por haber resuelto la tarea administrativa.
6. Input task.add acepta omitir evidenceIds/summary y persiste []/"". El schema persistido sigue completo; reason desconocido continúa rechazado y los cambios de aceptación siguen exigiendo motivo.
7. Ante error administrativo, recuperar originales y corregir la causa concreta; no repetir mutaciones equivalentes ni operaciones de producto ya realizadas. Sin éxito confirmado no se anuncia incorporación.

Aplicación mediante instrucciones compartidas del orquestador, Executor/QA, common y skills operativas: ambos adaptadores generan estas reglas. Verificación limitada a build/check y happy path del core real; no se simula una conversación para declarar resuelta la proactividad. El usuario la comprobará en entornos reales.

Verificación ejecutada después del cambio: `npm run package:opencode`, `npm run package:vscode`, `npm run check`, `npm run verify:packages` (smoke real de ambos cores extraídos) y `git diff --check`: exit 0. El happy path cubre también defaults omitidos de task.add. Esta revisión no instala 4.1.1 ni publica los cambios Git.
