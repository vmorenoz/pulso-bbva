# Prueba breve en un proyecto de prueba

Compila el VSIX 3.1.4 desde esta rama y úsalo, en un perfil separado y con un proyecto desechable. Repite únicamente en los destinos Copilot y Local que vayas a utilizar. Anota versión de VS Code, destino y resultado; no registres secretos.

1. Instala el VSIX y comprueba versión, icono y la página de detalles. Selecciona Pulso. Pide el estado: no debe inicializar el proyecto.
2. Ejecuta /pulso-init. Comprueba que pide las aprobaciones normales y que el especialista devuelve su mapa; valida el resultado y acepta el mapa con tareas y evidencia observada antes del cierre; luego consulta el estado y el historial.
3. Crea dos objetivos pequeños. Cierra uno y pide estado en una conversación nueva: debe poder identificar y retomar el otro, aunque no tenga foco.
4. Pide una tarea sencilla con criterio comprobable, revisión y cierre. Cambia después su aceptación: debe exigir evidencia nueva antes de cerrar. Consulta el motivo del cambio y reabre el objetivo.
5. Abre dos carpetas A/B. Conserva la selección de A en una conversación, cambia a B con Pulso: Seleccionar proyecto y continúa la conversación anterior: debe detener la mutación y pedir confirmar destino, sin escribir en A ni B con el token antiguo.
6. Lee contexto con action=read, conserva su revisión y escribe una preferencia de prueba con scope, expectedRevision y source. Repite la escritura con revisión obsoleta: debe rechazarla sin perder datos. Elimina la preferencia con la revisión vigente.
7. Recarga la ventana y pide retomar el trabajo. Debe consultar el estado y conservar criterios, tareas, bloqueos y contexto. Revisa que no afirme haber reanudado una sesión de especialista.

Si falla, conserva el mensaje de error, el destino y los pasos mínimos. No edites los metadatos manualmente ni repitas una mutación que informó persistencia parcial. Estas comprobaciones reales no han sido ejecutadas automáticamente en tu instalación.
