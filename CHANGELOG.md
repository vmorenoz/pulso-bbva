# Changelog

## 0.1.0

- Promoción del núcleo de la antigua distribución `v4` a la raíz canónica y retirada de implementaciones históricas.
- Integración exclusiva con la API de OpenCode **2.1.2**, basada en el tag oficial y sus contratos nativos de plugin, herramientas, sesiones, permisos y subagentes.
- Eliminación del runtime, instalador y empaquetado de la integración del editor anterior; no se genera un VSIX.
- Versión de producto reiniciada a **0.1.0**. Sólo incrementos de parche **0.1.\*** hasta nuevo aviso. Las versiones de los esquemas y contratos persistidos no se reinician.
- Conservación de las cuatro herramientas semánticas, permisos y alcances, registros durables, revisiones, idempotencia y política documental; Knowledge continúa siendo un MCP externo opcional.
- Build, pruebas, CI e instalación adaptados a la raíz y al único runtime.

Las versiones y resultados anteriores permanecen en el historial Git. Sus conteos de pruebas, hashes e instalaciones no son evidencia de esta revisión. Consulta [el alcance de verificación actual](tests/README.md).
