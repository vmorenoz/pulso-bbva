# Cambios

## 3.1.4

- Integra main tras PR #11 sin modificar el árbol OpenCode ni sus skills BBVA.
- Adapta instrucciones al contrato plano VS Code; añade read revisionado, validate_result y acceptanceBasis.
- Usa contratos canónicos de memoria, bloqueo compartido, prioridad critical y evidencia observada inmutable.
- Retira complete_map: el mapeo requiere aceptación por el flujo ordinario, nunca un PASS sintético por marcador.
- Conserva bindings, resultados paginados, recuperación parcial, iconos y README sin imagen.
- Verificación de conversación Copilot/Local pendiente (NOT_RUN).

## 3.1.3

- Retirada la imagen del README de la extensión; se conserva el icono de Pulso.

## 3.1.2

- Selección esperada obligatoria antes de las mutaciones para evitar escrituras entre proyectos de una misma ventana.
- Invalidación de aceptación y registro de su motivo al cambiar tareas o criterios.
- Consultas estructuradas por secciones y páginas, conservando contexto e historial.
- Persistencia parcial explícita y mapeo reintentable; prevalidación de entradas.
- Referencias históricas ausentes no bloquean trabajo nuevo no relacionado.
- Exclusión multiproceso para preferencias compartidas entre ventanas.
- README para instalación y uso, con logo oficial Pulso y PNG de extensión.
- Prompts y plantillas alineados con herramientas disponibles y ejemplos empaquetados.

Las conversaciones reales en Copilot y Local requieren la comprobación manual indicada en la guía de uso.
