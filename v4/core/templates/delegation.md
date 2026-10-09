<!-- template: delegation.md@1.0; guía de prompt, no JSON canónico ni formulario obligatorio -->

## Encargo
{{delegation original de prepare_delegation: identidad/revisión confirmadas, objetivo,
inputs accesibles, scopes, restricciones y aceptación. Incluir aquí o en objective/constraints
el contenido conversacional necesario; no referenciar mensajes inaccesibles.}}

## Contexto del host — separado de delegation
{{hostContext recibido: projectRoot, resourceRoot, cwd y paths efectivos absolutos de
inputs/output/writeScope/readScope. Recursos/schema/plantilla desde resourceRoot.
Repositorio y cwd de comandos explícitos si difieren; no inferir otras raíces.}}
{{acceptanceBasis original previa a la observación, derivada por core; no calcularla ni inventarla.}}

## Entrega
{{Resultado breve inline conforme a result.json permitido. Crear documento solo si se requiere.
Output persistente sigue siendo ruta autorizada, sin obligación de materializarla ni listar
un archivo inexistente en artifacts. Para read_only_review: readBase absoluta explícita,
output: conversation y writeScope: [], sin identidad Work/JSON persistente.}}

## Restricciones pertinentes
{{Solo las necesarias: no delegar, permisos efectivos, cambios ajenos/recursos compartidos.
Git de inspección puede asignarse a Executor read-only con cwd, rama/upstream/destino y
frescura requerida; fetch/mutaciones no implícitos. No eludir denegaciones.}}
{{Omitir si no se solicita commit: autorización expresa de integración, ticket Jira válido,
asunto requerido y rutas de stage. No convertir inspección en integración.}}

## Retorno
{{Identidad del encargo, conclusión, referencias/checks reales y límites. Sin Markdown
duplicado ni relleno obligatorio. Pulso revisa y core incorpora con accept_result;
el especialista no inventa revisión de escritura ni declara cerrado el Work.}}
