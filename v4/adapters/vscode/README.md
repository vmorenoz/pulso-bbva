# Pulso

Asistente de desarrollo que aclara objetivos, coordina nueve especialistas y conserva continuidad verificable en tu proyecto.

## Empezar

Instala el archivo VSIX, abre una carpeta local confiable y elige **Pulso** en el selector de agentes del chat. También puedes usar **Pulso: Abrir chat**.

Con varias carpetas abiertas, selecciona el proyecto cuando se solicite. **Pulso: Seleccionar proyecto** permite cambiarlo. Abre el worktree previsto como carpeta antes de trabajar en él.

Un saludo o una consulta de estado no prepara el proyecto ni escribe archivos. Pide la preparación explícitamente para iniciar la continuidad local. Las guías pulso-init, pulso-status, pulso-recap y pulso-resume ayudan a preparar, consultar y retomar el trabajo.

## Trabajo y revisión

Pulso conserva objetivos, tareas, decisiones y evidencia en `.pulso/`. Los especialistas reciben un encargo acotado y Pulso revisa su resultado antes de consolidarlo. Sigue las aprobaciones del chat y confirma el proyecto antes de una escritura.

Si el proyecto cambia, consulta el estado de nuevo y confirma que es el previsto. Si una operación informa de persistencia parcial, conserva el identificador y la revisión indicados y pide recuperación antes de repetirla. No edites manualmente los registros canónicos.

Las lecturas extensas se paginan mediante limit y cursor. Sigue hasMore y nextCursor para recuperar el contenido restante.
