# Catálogo de plantillas · versión 1.0
Una plantilla define la entrega, no obliga a crear el archivo. Las secciones marcadas
«condicional» se omiten si no aplican; no rellenar con ficción. Los marcadores `{{...}}`
son instrucciones de autoría, no un lenguaje ejecutable. Una entrega final no conserva
marcadores pendientes: usa «pendiente» con motivo y responsable cuando falte una decisión.

| Archivo | Autor habitual | Uso |
|---|---|---|
| project.md | Pulso con hallazgos del Explorador | Contexto global verificable |
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
| delegation.json / delegation.md | Pulso | Encargo autosuficiente al especialista |
| result.json | Cada especialista | Respuesta compacta, nunca una instrucción para ejecutar |

Las rutas de los ejemplos son relativas a la raíz del proyecto. Sustituirlas por rutas
reales; el esquema valida estructura, no inventa el contenido. No duplicar estados de
tareas en los planes. Cada plan enlaza los IDs de tareas canónicos tras su aceptación.

`state.json` y `history-entry.json` ilustran la proyección global y un cierre. No copiar ejemplos al estado real: las utilidades crean y sincronizan esos archivos a partir del work canónico.

## Profundidad y revisión humana

Una corrección pequeña requiere párrafos breves y referencias precisas, no todos los
documentos. Para varios módulos detalla contratos, dependencias y evidencia; no añadas
secciones vacías para aparentar cobertura. Referencia código como `ruta:línea` más su
revisión cuando sea relevante; comandos con directorio y resultado real; documentación
con enlace oficial y fecha. Los IDs de tarea/criterio apuntan al work canónico.

Antes de finalizar, el autor y Pulso revisan que las instrucciones de plantilla fueron
sustituidas por contenido específico. «No aplica» o «pendiente» requieren motivo. No
marcar como incompleto código legítimo que usa dobles llaves. No se añade un detector
léxico ni un evaluador automático de calidad. Ejemplos terminados y contrastes de buena
/mala evidencia: consulta `docs/EXAMPLES.md` en la instalación global.
