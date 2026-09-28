# Cambios implementados

## Integración técnica

- Preservación P0 de `context.facts` y `context.references` desde prepare hasta el taskWire durable, con regresión de identidad y sin ejecución al preparar.
- Contratos estrictos adaptativos, kernels de grafo/plan, creación de WorkItems/dependencias/policies e intención idempotente en el core; migración SQLite de Work v6.
- Prompts OpenCode v2.1 aislados del renderer VS Code y ocho skills completas suministradas e instaladas como assets administrados.
- Reservas transaccionales en native journal, exclusividad de shell/legacy, límite global cuatro y guardas de efectos con identidad de binding, lease/fencing y rutas exactas.
- Preferencias revisionadas en `preferences.db`; loader propio y explícito de `PULSO.md`; snapshot del primario y facts/references de especialistas; catálogo genérico con observaciones separadas y manifiesto de descriptores aprobados en `capabilities.json`.
- Artefactos tipados bajo `.pulso/artifacts/`, JSON canónico + Markdown y `metadata.json` como commit marker; reconciliación tras reinicio desde el journal nativo, validaciones de ready/review y registro idempotente posterior al receipt aceptado.
- Fachada `pulso_prepare`, `pulso_inspect`, `pulso_work`, `pulso_preferences`, `pulso_artifact`; presentador de receipts y hook de compactación.
- Instalador OpenCode con hashes/manifest y preservación de AGENTS.md, CLAUDE.md y PULSO.md existentes.

## Cambios funcionales observados

- La ruta de preparación compuesta genera grafo, frontera lista y referencias para el `task` nativo. Las pruebas deterministas de kernel validan DAG, dependencias, conflictos de recursos y gates.
- Preferencias requieren CAS y procedencia de mensaje user rastreada por hook; el set global exige señal textual explícita de globalidad.
- Los descriptores se leen solo de la ruta exacta de `capabilities.json`, validan permisos de archivo y requieren aprobación más observación `allow` acotada a agent.
- Las reservas permiten archivos disjuntos solo en modo `files`; herramientas desconocidas y rutas fuera de política se deniegan.
- Aceptar/rechazar el receipt controla la publicación de artefactos; los outputs normales proyectan texto y conservan metadata de diagnóstico.

## Contenido

- Se incorporaron los seis prompts proporcionados y las ocho skills provistas sin delegar su rediseño.
- VS Code/Copilot mantiene su renderer y sus assets; los cambios de contenido v2.1 son específicos de OpenCode.

## Archivos principales

- Core/grafo: `packages/orchestration/src/adaptive/{types.ts,contracts.ts,decision-kernel.ts}`, `packages/working-system/src/domain/index.ts`, `packages/working-system/src/persistence/sqlite-store.ts`.
- Bridge/seguridad/contexto: `packages/capabilities-mcp/src/opencode/{native-delegation-service.ts,native-journal.ts,plugin.ts,tool-schemas.ts,evolution-facade.ts,receipt-presenter.ts,resource-reservations.ts,effect-guard.ts,preference-service.ts,capability-catalog.ts,session-context.ts,artifact-service.ts}`.
- Assets OpenCode: `packages/orchestration/src/agents/opencode-v21-prompts.ts`, `packages/orchestration/skills/pulso-*.md`, OpenCode runtime/protocol instructions/types.
- Instalador: `packages/installer/src/discovery/opencode/index.ts`, `packages/installer/src/runtimes/opencode-installer.ts`, OpenCode installer tests.
- Tests: `packages/capabilities-mcp/test/{context-forwarding.regression,evolution-artifacts,evolution-capabilities,evolution-effect-guard,evolution-facade,evolution-preferences,evolution-presenter,evolution-reservations}.test.ts`, `packages/orchestration/test/{decision-kernel,evolution-plan-readiness,evolution-prompts,evolution-schema-parity}.test.ts`, `packages/working-system/test/evolution-graph.test.ts`, `tests/evolution-v21/**`.
- Entrega: `reports/evolution-v21/{baseline,changes,metrics,acceptance-offline,acceptance,limitations,final,manifest,migration}.*`, `reports/evolution-v21/migration.md`.
- Scripts explícitos: `package.json` incluye `test:evolution:unit`, `test:evolution:integration`, `test:evolution:live` y `test:evolution:all`.

## Brechas de integración conocidas

- `pulso_prepare` → `task` no superó el smoke offline con OpenCode scripted provider (falla en la observación del handoff de la tarea preparada). No declarar el puente funcional completo.
- E07 no tiene todavía suite propia de fachada/presenter que cubra el ciclo completo de autorización y adopción de plan.
- Crash recovery de artefactos staged y receipts tiene prueba de reinicio/offline; una instalación/sesión OpenCode real aún no lo valida.
- Efectos shell exclusivos siguen sujetos a permisos del host y no constituyen sandbox de sistema operativo.
- Los descriptores se validan/cargan, pero discovery/probe de herramientas del host y permisos dinámicos por descriptor no están integrados; no se declara uso de una herramienta externa.
