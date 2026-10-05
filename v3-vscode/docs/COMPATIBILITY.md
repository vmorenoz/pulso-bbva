# Compatibilidad de Pulso 3.1.4

Se requiere VS Code 1.139.1 o posterior y un workspace local confiable. La aceptación real en Copilot y Local sigue pendiente; consulta [prueba breve](LIVE-CHECK.md).

## Contratos actuales

- Integrada con main 72e7cd1 (PR #11). El árbol fuente OpenCode se conserva byte por byte.
- Los argumentos VS Code son planos: action, sin request. Contexto ofrece read con contenido, procedencia, revisions y nextCursor; sus escrituras exigen scope, expectedRevision y source explícito cuando corresponde.
- validate_result comprueba encargo/resultado contra catálogo y plantillas empaquetados. get expone acceptanceBasis para observaciones previas a las pruebas.
- priority admite low/normal/high/critical. Se rechaza urgent. No existe complete_map: el mapeo se acepta mediante tareas, evidencia observada y cierre ordinarios.
- Las observaciones de evidencia son inmutables; no se recalculan hashes para renovar un PASS antiguo. Cambiar aceptación requiere reason y nueva evidencia.

- Las cuatro tools usan la API pública de VS Code. Cada mutación exige expectedBindingId obtenido en una consulta del proyecto previsto; se comprueba antes de escribir. Cambiar proyecto, carpetas o recargar invalida el identificador.
- La selección es por ventana. Los tokens protegen conversaciones anteriores; no crean una raíz por sesión ni autorizan cambiar de destino silenciosamente.
- Las consultas incluyen payload estructurado y paginación. Los errores de persistencia parcial incluyen estado guardado y reparación.
- El almacén global de preferencias se protege con bloqueo multiproceso compartido con OpenCode (`.pulso/preferences.lock`). Un bloqueo abandonado se revisa tras cerrar las ventanas; no se roba por antigüedad.
- Las instrucciones de especialistas delimitan alcance pero no son un sandbox. Los permisos efectivos dependen del host.
- No hay observador de delegaciones en vivo, scheduler ni reanudación de sesiones.
- Cambios de aceptación añaden un registro append-only. Los trabajos anteriores se leen sin migración obligatoria; un trabajo con ese registro nuevo no debe abrirse con distribuciones antiguas que desconozcan el campo.

## Referencias oficiales revisadas el 5 de octubre de 2026

- [Language Model Tool API y confirmaciones](https://code.visualstudio.com/api/extension-guides/ai/tools)
- [Agentes personalizados y herramientas disponibles por harness](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [Empaquetado y restricciones de imágenes](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

Se mantiene el mínimo del manifiesto; consultar documentación actual no equivale a validar una conversación real en una instalación concreta.
