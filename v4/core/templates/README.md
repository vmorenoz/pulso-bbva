# Catálogo de plantillas · versión 1.0
Una plantilla guía el contenido, no obliga a crear el archivo ni a conservar todos
sus apartados/tablas. Omite lo irrelevante; no rellenes con «no aplica» mecánico.
Una respuesta breve en conversación basta salvo documento expresamente requerido.
Los marcadores `{{...}}`
son instrucciones de autoría, no un lenguaje ejecutable. Una entrega final no conserva
marcadores pendientes: usa «pendiente» con motivo y responsable cuando falte una decisión.

| Archivo | Autor habitual | Uso |
|---|---|---|
| project.md | Explorador con encargo normal | Contexto global verificable |
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

## Encargos, resultados y evidencia

`prepare_delegation` deriva identidad/base desde tareas actuales. Conserva delegation y
acceptanceBasis originales; no copies IDs, revisiones, fechas ni hashes de ejemplos.
hostContext se entrega separado: projectRoot/resourceRoot/cwd absolutos y paths efectivos
de inputs/output/writeScope/readScope. El repositorio de comandos debe ser inequívoco;
los recursos empaquetados se leen desde resourceRoot, no desde inputs. Los inputs de
conversación van realmente en objective/constraints o archivos autorizados accesibles.

Un resultado persistente puede devolverse inline en conversación con `result.json` como
guía estructural; `accept_result` genera su documento, ID, fecha de registro y hash.
No requiere Markdown duplicado ni incluir output en artifacts. El output canónico sigue
siendo una ruta autorizada, aunque no se cree. `output: conversation` literal corresponde
a la excepción read_only_review (readBase explícita, writeScope vacío, sin Work/JSON
persistente). No confundir esta entrega con `validate_result`, que conserva validación
estricta de revisión/output. artifacts/changedFiles declarados deben existir.

La incorporación de resultados puede sustentar tareas aceptadas; no acredita criterios
finales automáticamente. `evidence.json` ilustra evidence.add, no un requisito para cada
retorno: requiere informe y huellas auténticas. Core calcula acceptanceBasis de tareas y
criterios; conservar la base previa recibida sin recalcularla. Los snapshots de archivos,
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
y desplegada no son intercambiables. Póliza/polis requiere comprobar identificador frente
a importe; SQL sin descriptor de conexión, alias claros, IDs deduplicados y cardinalidad.
Verificación con scope/base/versión y métricas con objeto/denominador; pruebas textuales
nombradas como tales. Git indica cwd, rama/upstream/destino y frescura remota; Maven,
reactor/módulos/perfiles pertinentes. Reintentar requiere información nueva, no limpieza
ni ampliación automática de scope. Mantener patrones/controles y comunicar sin emojis.

Antes de finalizar, el autor y Pulso revisan que las instrucciones de plantilla fueron
sustituidas por contenido específico. «No aplica» o «pendiente» requieren motivo. No
marcar como incompleto código legítimo que usa dobles llaves. No se añade un detector
léxico ni un evaluador automático de calidad. Ejemplos terminados y contrastes de buena
/mala evidencia: consulta `docs/EXAMPLES.md` en la instalación global.
