# Catálogo de plantillas · versión 1.0
Una plantilla guía el contenido, no obliga a crear el archivo ni a conservar todos
sus apartados/tablas. Omite lo irrelevante; no rellenes con «no aplica» mecánico.
Una respuesta breve en conversación basta salvo documento expresamente requerido.
Los marcadores `{{...}}`
son instrucciones de autoría, no un lenguaje ejecutable. Una entrega final no conserva
marcadores pendientes: usa «pendiente» con motivo y responsable cuando falte una decisión.

| Archivo | Autor habitual | Uso |
|---|---|---|
| project.md | Explorador con encargo nativo project_initialization | Contexto global verificable, sin Work |
| work.md | Pulso | Narrativa opcional del trabajo; estado canónico en work.json |
| objective.json / task.json | Pulso | Ejemplos de datos y esquemas asociados |
| spec.md | Researcher / Planificador, según encargo | Comportamiento y contratos |
| plan.md | Planificador | Plan maestro y subplan: mismo formato |
| research.md | Researcher | Incertidumbres, fuentes, preguntas |
| exploration.md | Explorador | Mapa real del repositorio |
| implementation.md | Ejecutor | Cambios y comprobaciones del encargo |
| review.md | Auditores y Code Reviewer | Hallazgos y límites de revisión |
| evidence.md / evidence.json | QA | Verificación documentada y referencias estructuradas |
| ui-review.md | UI Auditor | Revisión visual, funcional y accesible |
| decision.md | Pulso | Decisión humana/técnica confirmada |
| delivery.md | Pulso | Entrega preparada para revisión humana |
| delegation.json | Pulso | Ejemplo canónico interno; nunca adjuntarlo a task |
| delegation.md | Pulso | Guía de envío de specialistPrompt y ejemplo bump patch |
| result.md | Cada especialista | Reporte conversacional Markdown de tres secciones |
| result.json | Pulso | Ejemplo de result compacto para accept_result, no respuesta del especialista |

Las rutas de los ejemplos son relativas a la raíz del proyecto. Sustituirlas por rutas
reales; el esquema valida estructura, no inventa el contenido. No duplicar estados de
tareas en los planes. Cada plan enlaza los IDs de tareas canónicos tras su aceptación.

## Encargos, resultados y evidencia

La inicialización pulso-init es una excepción acotada: delegación nativa directa
mode: project_initialization, sin Work, tareas, continuidad, prepare_delegation ni
accept_result. Explorer lee recursos explícitos del workspace confirmado y solo
escribe .pulso/project.md con la guía project. Pulso revisa el mapa y el retorno
Markdown sin QA, evidence/readiness/cierre ni bloqueos de Work. Los permisos nativos
siguen vigentes; el protocolo siguiente rige las demás delegaciones persistentes.

`prepare_delegation` deriva identidad/base desde tareas actuales. En `contractVersion:2`,
core conserva el snapshot y devuelve IDs y `specialistPrompt`; `get_delegation` recupera
el original cuando hace falta. En legacy, Pulso conserva delegation, acceptanceBasis y
hostContext originales internamente antes de observar. No copia IDs, revisiones, fechas
ni hashes de ejemplos. Envía a la herramienta nativa de delegación SOLO `specialistPrompt`
exacto, que ya renderiza objetivo, alcance, condiciones y entrega. No adjunta JSON canónico,
base, hostContext, schemas ni instrucciones instaladas. El contexto indispensable debe
estar en objective/constraints o inputs autorizados antes de preparar el prompt; modificar
el prompt preparado rompe su correspondencia con el snapshot durable. Los recursos
instalados proceden del contexto confiable.

El especialista devuelve Markdown natural con `## Resultado`, `## Cambios o hallazgos`
y `## Comprobación y pendientes`; usa Completado/Bloqueado/Fallido/Cancelado y hechos reales,
sin JSON, arrays vacíos, apartados vacíos ni lectura habitual de schemas. `result.md` guía
esta conversación; las demás plantillas especializadas guían documentos requeridos,
no añaden secciones obligatorias al retorno. `output: conversation` sirve TAMBIÉN para
delegaciones persistentes: no crea archivo ni concede escritura. La excepción
read_only_review conserva readBase explícita, writeScope vacío y ausencia de Work.

Pulso extrae `status` y `summary` y conserva el reporte íntegro literal. En v2 incorpora
por `delegationId`, `returnId` o `reportedReturn` y `decision`, con continuidad/intención,
operationId y expectedRevision. Los detalles admitidos (`checks`, `findings`,
`limitations`, etc.) van directamente en `decision`: **`decision.details` no se admite**.
En legacy envía delegation/base originales, expectedRevision actual y el result compacto
con `markdown` (`result.json` es un ejemplo interno de esa forma).

No inventa comandos ni convierte prosa de éxito en PASS. Cada check necesita observación
concreta, estado real y evidenceRef existente o null. Los archivos declarados en
artifacts/changedFiles deben existir y estar autorizados. Para completed selecciona
acceptedTaskIds explícitos; para otros estados los omite o usa []. Core deriva identidad
y revisión del encargo original y conserva el reporte sin exigir otro archivo Markdown.
Ante un rechazo administrativo v2, recupera la captura por ID y corrige la incorporación;
no repite el trabajo ni la delegación. Los descriptores de las herramientas publican
los campos admitidos para cada forma.
`validate_result` conserva el contrato canónico legacy estricto; no recibe el compacto
ni es un paso obligatorio. Un archivo output solo se pide cuando el documento aporta valor.

La incorporación de resultados puede sustentar tareas aceptadas; no acredita criterios
finales automáticamente. `evidence.json` ilustra evidence.add, no un requisito para cada
retorno: cuando el criterio exige evidencia formal, requiere un observador con herramientas
y permisos efectivos, informe y huellas auténticas. Core calcula acceptanceBasis de tareas y
criterios; Pulso conserva la base previa de get sin transmitirla ni recalcularla. Los snapshots de archivos,
comandos, salida y checkedAt de ejecución son observaciones del verificador: core no los
reconstruye con bytes actuales. Nunca renovar PASS antiguo con huellas o fecha nuevas.
`accept_delivery` registra aceptación manual con procedencia, no pruebas automatizadas;
consultar closed/readiness antes de anunciar cierre. No cancelar tareas hechas para cerrar.

`state.json` y `history-entry.json` ilustran la proyección global y un cierre. No copiar ejemplos al estado real: las utilidades crean y sincronizan esos archivos a partir del work canónico.

## Profundidad y revisión humana

Una corrección pequeña requiere párrafos breves y referencias precisas, no todos los
documentos. Para varios módulos detalla contratos, dependencias y evidencia; no añadas
secciones vacías para aparentar cobertura. Referencia código como `ruta:línea` más su
revisión cuando sea relevante; comandos con directorio y resultado real; documentación
con enlace oficial y fecha. Los IDs de tarea/criterio apuntan al work canónico.

Describe hechos frente a hipótesis y límites del rol frente a capacidades globales.
Para diagnósticos sigue helpers y fuente activa/configuración; SQL suministrada, checkout
y desplegada no son intercambiables. SQL sin descriptor de conexión, alias claros,
IDs deduplicados y cardinalidad.
Verificación con scope/base/versión y métricas con objeto/denominador; pruebas textuales
nombradas como tales. Git indica cwd, rama/upstream/destino y frescura remota; Maven,
reactor/módulos/perfiles pertinentes. Reintentar requiere información nueva, no limpieza
ni ampliación automática de scope. Mantener patrones/controles y comunicar sin emojis.

Antes de finalizar, el autor y Pulso revisan que las instrucciones de plantilla fueron
sustituidas por contenido específico. «No aplica» o «pendiente» requieren motivo. No
marcar como incompleto código legítimo que usa dobles llaves. No se añade un detector
léxico ni un evaluador automático de calidad. Ejemplos terminados y contrastes de buena
/mala evidencia: consulta `docs/EXAMPLES.md` en la instalación global.
