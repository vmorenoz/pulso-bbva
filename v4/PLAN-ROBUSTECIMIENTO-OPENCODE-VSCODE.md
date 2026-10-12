# Plan maestro: robustecimiento de Pulso en OpenCode y VS Code

> Continuación de planificación tras la auditoría multisesión: [Plan transversal de continuidad e aislamiento](PLAN-CONTINUIDAD-MULTISESION-OPENCODE-VSCODE.md). Este documento conserva las decisiones y entregas históricas de 4.1.0/4.1.1. El plan sucesor propone preparación durable, incorporación por referencias y aislamiento de continuidad en ambos adaptadores; distingue los cambios de contrato y de verificación todavía pendientes de implementación.

## Objetivo

Pulso responde por completar el objetivo mediante sus especialistas. Una limitación del orquestador o de un rol no bloquea el trabajo mientras exista una vía autorizada adecuada. Reducir intervención del usuario, preguntas repetidas y documentación mecánica; conservar precisión y evidencia honesta.

Base: `AUDITORIA-SESION-REAL-2026-10-07.md` y sesión `ses_ee764b86fffemmTtdsXxEoM40f`. En esta última todas las comprobaciones Git se delegaron a Explorer (sin terminal) sin probar Executor; la actualización `task.update.patch.status` falló y se asumió una revisión inexistente.

## Decisiones vinculantes

1. Usar exclusivamente v4/core y v4/adapters/{opencode,vscode}; no utilizar otras versiones como base. Desarrollo con agentes/herramientas nativos, sin orquestación Pulso sobre este repositorio.
2. Conservar cuatro tools, delegación/permisos/sesiones nativos, sin scheduler, locks, procesos de agentes ni APIs inventadas.
3. No dar terminal al orquestador. Git de inspección se delega a Executor con alcance de solo lectura. Reasignar capacidad ausente para un rol no permite evadir una denegación expresa de la operación.
4. Continuar tras instrucciones compatibles, conservar autorizaciones del encargo y reevaluar frentes independientes después de cada retorno. Un bloqueo local sólo afecta dependientes.
5. Preguntar decisiones de negocio/alcance, no hechos investigables como imports, API de componentes o comandos Git. No interpretar póliza como importe sin comprobar su uso.
6. Separar constancia histórica de tarea realizada y evidencia final de criterios. Done necesita resultado aceptado o evidencia pertinente; criterio necesita evidencia suficiente para la entrega. No cancelar tareas realizadas para sortear cierre.
7. Mantener estados actuales. Pausa no significa finalización; validación pendiente se comunica claramente y la aceptación suficiente retira la dependencia y permite cerrar.
8. Conservar operaciones existentes y añadir prepare_delegation (lectura), accept_result y accept_delivery (mutaciones) a pulso_work. Preparación deriva identidad/base/rutas antes de observar; incorporación registra resultado y tareas en un lote; aceptación manual conserva procedencia e intenta cerrar sin inventar pruebas.
9. get devuelve diagnóstico completo de cierre. Errores concisos y estructurados; usar únicamente revisiones confirmadas, recuperar outputs truncados y distinguir retorno nativo de ok:true.
10. Core genera IDs, fechas de registro y hashes de documentos que incorpora. No reconstituye hashes actuales para acreditar una ejecución pasada. Diferenciar fecha de registro y observación, evidencia reportada y ejecución real.
11. Resultados breves no requieren Markdown duplicado. Inputs conversacionales se incluyen realmente o mediante referencias accesibles. Rutas de workspace/repo/comandos/output son explícitas.
12. TODO del host sólo espejo confirmado; sin emojis en comunicación ni recibos. No atribuir capacidad global ausente tras comprobar únicamente un rol.
13. No modificar automáticamente instalaciones activas, permisos, dependencias o repositorios de las sesiones auditadas.

## Contratos de implementación acordados

- prepare_delegation: workId, taskIds, delegationId, objective, inputs, output, constraints y templateId; deriva agente, revisión, scopes/resources/acceptance y acceptanceBasis de tareas actuales. Retorna delegation canónica y hostContext con raíz del adaptador y rutas efectivas separadas. No persiste ni lanza agentes.
- accept_result: workId, expectedRevision actual, delegation original, acceptanceBasis previa, result, acceptedTaskIds y summary. El orquestador decide la aceptación tras revisar el contenido. Core verifica identidad, asignación, ámbitos/artefactos y base relevante, conserva resultado inmutable identificable y asocia las tareas aceptadas. Una repetición idéntica no duplica resultados. No marca otros criterios automáticamente. Resultados independientes no fallan por revisión global avanzada si la base pertinente sigue vigente.
- accept_delivery: workId, expectedRevision, summary, criterionIds, source con texto de aceptación y referencia de mensaje opcional, limitations. Registra evidencia manual pertinente con procedencia declarada, nunca executed. No equivale a cobertura automatizada ni prueba la ejecución de cada tarea. Conserva aceptación aunque cierre resulte pendiente; devuelve todos los impedimentos. No modifica requisitos ni cancela tareas.
- Diagnóstico de cierre: ready, issues con code/entity/message, revisión actual. Un mismo evaluador alimenta get y close; evitar errores de primer fallo solamente.
- Compatibilidad: datos nuevos opcionales al leer Work antiguos, cierres históricos inmutables, ninguna reclasificación o cierre masivo. No garantizar que runtimes antiguos lean campos nuevos. Sin degradar evidencia legacy ni fabricar resultados para tareas viejas.

## Fases y ámbitos exclusivos

| Fase | Ejecutor nativo | Ámbito | Entrega |
|---|---|---|---|
| 0 | Coordinador | Este plan | Persistencia de decisiones y base inicial |
| 1 | E2 Orquestador | core/agents/pulso.md; skills operativas Pulso | Capacidad, continuidad, paralelismo, preguntas, validación y cierre |
| 2 | E1 Core | core/lib; core/schemas | Tres acciones, resultado histórico, diagnóstico de cierre, consistencia |
| 3 | E3 Especialistas | common.md; agentes excepto pulso.md; core/templates | Inputs/rutas, precisión técnica, recuperación, evidencia y Git |
| 4a | E4 OpenCode | adapters/opencode | Acciones/envelope, capacidades y procedencia |
| 4b | E5 VS Code | adapters/vscode | Acciones/binding, capacidades equivalentes y procedencia |
| 5 | E6 Integración | scripts, happy path acotado y documentación | Builds, verificación real del core y entrega |

Lote A: E1/E2/E3 paralelos con contratos aquí fijados. Lote B: E4/E5 tras estabilizar contratos; scripts compartidos con escritor único. Lote C: integración y happy path. Ejecutores implementan detalles locales; cualquier conflicto arquitectónico vuelve al coordinador con evidencia, no se improvisan estados, permisos o modelos alternativos.

## Calidad de especialistas

- Método → clave SQL → recurso → versión/configuración conocida; separar SQL suministrada, checkout y desplegada. Seguir helpers; reconciliar contradicciones.
- SQL entregable sin descriptor de conexión; conteos desde IDs deduplicados; alias inequívocos; no declarar reparación por workaround del usuario.
- Pruebas textuales nombradas como tales, métricas con objeto/base, no trasladar verde entre ramas. Preparar tests no equivale a ejecutarlos.
- Git con cwd de repo explícito, rama/upstream/destino y frescura remota; no extrapolar causa temporal de desactualización. Evaluar módulos/reactor Maven antes de concluir dependencia externa.
- Preservar cambios ajenos, alcance productivo y permisos efectivos. No repetir operación denegada por otra herramienta o agente. Reasignar únicamente una capacidad faltante del rol.

## Adaptadores

Ambos consumen core/prompts comunes. OpenCode mantiene principal sin bash y Executor con aprobación; telemetría no es aceptación. VS Code mantiene binding y confianza, no inventa session IDs ni reanudación, usa paralelo sólo si nativo. Publicar capacidades declaradas (no garantías de disponibilidad) y versión del runtime. Sin ampliar permisos por defecto.

## Verificación autorizada

Sólo comprobaciones estáticas/builds y un happy path real del core en workspace desechable, con observaciones reales. Crear trabajo → preparar encargo → incorporar resultado real → completar tarea → readiness → cierre → historial. Sin agentes/hosts mock, conversaciones simuladas, campañas de error ni nuevas matrices negativas. No ejecutar suite global que arrastre esas simulaciones.

Builds: npm run build:opencode; npm run build:vscode. Comprobar paquetes/recursos y carga disponible sin instalar en entornos activos. El usuario verifica en sesiones reales continuidad, reasignación, paralelismo y aceptación natural; no presentar el smoke core como prueba de esas conductas.

## Cobertura

Capacidades y Git bloqueado: fases 1/3/4. Continuidad/autorizaciones/preguntas y bloqueo global: 1. Contratos/rutas/revisiones/truncamiento y TODO divergente: 1/2/3. Cierre, tareas canceladas y evidencia incorrecta: 2/3. Diagnóstico, SQL, cobertura y preparación Git/Maven: 3. Entrega proactiva: 1/2. Emojis: 1/4. Paridad y versión: 4.

## Criterio de entrega

Ambos builds correctos, happy path core positivo, agentes generados coherentes, acciones en ambos adaptadores, documentación de versión/verificaciones/límites. No quedan decisiones fuertes delegadas a ejecutores. Instalación y validación conversacional real son posteriores y explícitas.

## Resolución de integración y entrega 4.1.0

Implementadas las fases. La revisión independiente motivó tres precisiones obligatorias del contrato:

- Criterios con `acceptanceMode: evidence | user | both`; legacy usa evidence. `accept_delivery` agrega `origin: user_acceptance` sin sustituir comprobaciones técnicas. Cambiar modo requiere motivo trazable; no inferir ni dispensar cobertura mediante aceptación genérica.
- Cambiar título o agente de tarea invalida su base mediante el historial de cambios de aceptación existente, preservando hashes de tareas legacy intactas.
- `completedTaskIds` conserva realización del ciclo e impide el rodeo done → pending → cancelled. Reopen inicia otro ciclo; no se reconstruye historia que un Work antiguo no conserva.

`output: conversation` permite resultados inline con writeScope vacío y `hostContext.readBase` explícito. Contrato detallado: `core/lib/ACCEPTANCE-API.md`.

Verificaciones satisfactorias: builds de ambos adaptadores, `npm run check`, `npm run smoke:happy`, empaquetado de ambos y `npm run verify:packages`; happy path también sobre cores extraídos. Sin suites de conversaciones simuladas. Aceptación conversacional, activación visual y comportamiento continuo quedan para las pruebas reales del usuario.

Tras autorización explícita adicional del usuario se instaló 4.1.0 en su OpenCode global y extensión local VS Code del perfil predeterminado. Recibo installer: complete, opencode configured 4.1.0 y vscode installed 4.1.0. Confirmado package instalado OpenCode, hash de plugin igual al stage y CLI VS Code `pulso-local.pulso@4.1.0`. Reiniciar OpenCode y recargar ventana VS Code para cargar el código nuevo en sesiones activas.

## Simplificación de comunicación 4.1.1

El usuario solicita inputs/outputs naturales en Markdown tras observar un encargo excesivo para aumentar un patch. Sustituye la transmisión del envelope por `specialistPrompt` con Objetivo, Alcance, Condiciones y Entrega. El especialista responde Resultado, Cambios o hallazgos y Comprobación y pendientes; no recibe ni devuelve JSON, bases, revisiones o hashes administrativos. Pulso conserva internamente el encargo y la base originales, y `accept_result` admite reporte compacto con Markdown literal; core deriva identidad. El formato JSON canónico anterior permanece compatible.

Recursos descriptivos como «CodeGraph MCP» ya no generan rutas de lectura inexistentes. Documentos explícitamente encargados conservan una guía confiable enlazada en las instrucciones instaladas, sin exigir su lectura para cada respuesta. Aplicación común a los dos adaptadores, sin parser semántico que convierta prosa en PASS ni permisos. Builds y happy path verifican generación, incorporación literal e identidad sobre core real; la conversación del host requiere prueba real.

## Continuidad por objetivo en 4.1.1

La sesión `ses_edece9cefffefMgQbuOrHqfS9y` muestra que reducir el formato no basta: el LT añadió prohibiciones internas y terminó pidiendo permiso para corregir/publicar el mismo cambio autorizado. Se fijó continuidad por objetivo, reparación de fallos CI dentro del alcance vigente, conservación acotada de autorización de publicación y espera del consumidor solo tras éxito/publicación real. No esperar CI de una corrección que permanece local si subirla está autorizado. Los especialistas respetan su alcance y Pulso coordina la siguiente parte. Saludos/status aislados no reanudan por mera existencia de foco.

task.add permite omitir evidenceIds y summary, materializados por core sin debilitar el estado persistido. Reintentos deben recuperar el encargo original, no reescribir hashes/texto de aceptación. Detalle: `AUDITORIA-CONTINUIDAD-2026-10-09.md`.

### Instalación real 4.1.1

Instalada tras petición explícita del usuario en OpenCode global y VS Code local/perfil predeterminado. Instalador: complete; OpenCode configured 4.1.1; VS Code installed 4.1.1. Verificados package.json del runtime, coincidencia SHA-256 de acceptance.mjs con el stage y presencia de instrucciones Markdown/continuidad en el agente instalado. La CLI VS Code confirma pulso-local.pulso@4.1.1.

Backups: `~/.pulso/backups/opencode-7316119b-d639-4635-bb13-79b80a48475c` y `~/.pulso/backups/vscode-a1631750-6503-4ac7-82f0-f3104054042e`. Reiniciar OpenCode y recargar la ventana VS Code para cargar la actualización; instalación no acredita prueba conversacional real.
