# Pulso

Asistente de desarrollo que aclara objetivos, coordina nueve especialistas y conserva continuidad verificable en tu proyecto.

## Empezar

Instala el paquete mediante el instalador de Pulso y selecciona **Pulso** en OpenCode. Usa los comandos pulso-init, pulso-status, pulso-recap y pulso-resume para preparar, consultar y retomar trabajo.

Un saludo o una consulta de estado no prepara el proyecto ni escribe archivos. La preparación es una operación explícita. Los datos del proyecto se guardan en `.pulso/` y las preferencias personales se conservan entre proyectos.

## Trabajo y revisión

Cada operación respeta los permisos nativos. Pulso delega encargos acotados a especialistas y revisa sus resultados y evidencia antes de consolidar. Un retorno de una herramienta no significa que el trabajo haya sido aceptado.

Las herramientas de acciones reciben un objeto request con action y los campos de la operación. pulso_history recibe filtros planos. Las lecturas extensas se paginan mediante limit y cursor; sigue hasMore y nextCursor.

Si una operación informa de persistencia parcial, conserva el identificador y la revisión indicados y pide recuperación antes de repetirla. No edites manualmente los registros canónicos.

El paquete incluye el helper oficial de tools de @opencode-ai/plugin 1.18.2 y Zod 4.1.8. Sus avisos y licencias se conservan en plugin/vendor.
