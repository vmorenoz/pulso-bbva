# Exploración · {{work-id}} · {{alcance}}
<!-- template: exploration@1.0 -->
Guía para documento solicitado, sin tabla obligatoria. El retorno en conversación usa las tres secciones de result.md.
## Preguntas resueltas
{{Pregunta concreta y respuesta con evidencia.}}
## Mapa del repositorio
| Área | Archivos/símbolos | Responsabilidad | Relación con el cambio |
|---|---|---|---|
| {{área}} | {{referencia}} | {{función}} | {{impacto}} |
## Contratos y dependencias
{{Productores, consumidores, helpers, persistencia, eventos y fronteras relevantes.
SQL: método→clave→recurso activo→versión/configuración; separar suministrada, checkout y
despliegue conocido. Póliza/polis: verificar identificador frente a importe. Consulta sin
descriptor de conexión; alias claros, unidad de conteo, IDs deduplicados y cardinalidad.}}
## Patrones, comandos y pruebas existentes
{{Lo observado, su fuente y qué se ejecutó realmente; no suponer comandos estándar.}}
## Impacto, limitaciones y siguiente paso
{{Hechos e hipótesis separados, contradicciones y cómo resolverlas. Decisiones humanas
frente a hechos investigables. Capacidad faltante en este rol, no imposibilidad global;
Git read-only pendiente puede asignarse a Executor autorizado con cwd y base explícitos.}}
