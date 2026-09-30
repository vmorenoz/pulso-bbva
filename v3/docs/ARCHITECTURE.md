# Arquitectura y límites

## Una capa, dos adaptaciones nativas

El núcleo es **contenido**: identidad, catálogo de especialistas, contratos, plantillas y convenciones. `lib/composition.mjs` compone los archivos nativos en memoria; el instalador escribe solo el runtime seleccionado e incluye las instrucciones necesarias dentro de cada definición. `scripts/build.mjs` comprueba esa composición sin generar salidas en la distribución.

OpenCode: `.opencode/agents/*.md` y comandos nativos `.opencode/commands/`. Copilot Agent Host: `.github/agents/*.agent.md` con herramientas/modelo heredados. Variante VS Code Local: misma ubicación, formato adaptado a herramientas Local y allowlist de subagentes. No se instalan ambas variantes VS Code simultáneamente porque el descubrimiento sería ambiguo.

Las skills comunes se instalan en `.agents/skills/`. El instalador copia las cinco skills BBVA sin transformación. Las capacidades de integración y entradas conversacionales de Pulso son nuevas.

## Inicialización diferida

La selección del agente no inicia trabajo. La puerta de intención del prompt evita
herramientas en saludos; las consultas de estado son de lectura sin bootstrap.
La única receta es `skills/pulso-init/SKILL.md`, reutilizada por ambos adaptadores:
inspección y mapeo son del Explorador; la preparación opcional usa el Ejecutor y
el helper existente. No se ha agregado un controlador de agentes, flag de sesión,
protocolo persistido de inicialización, base de datos ni hook.

Solo inspect/prepare, previos a un Work, admiten un informe corto correlacionado
con la llamada en vez de IDs de Work inventados. El mapeo posterior pertenece al
objetivo real y usa el contrato normal. Pulso sigue siendo el único que consolida
actualizaciones de work/state/history; el helper inicial solo crea datos ausentes.
La política conversacional requiere comprobación live; no es enforcement de código.

## Artefactos

```
<workspace>/.pulso/
  state.json                 # resumen actual de TODO trabajo abierto
  history.jsonl              # una entrada por cierre/ciclo
  project.md                 # contexto verificado
  decisions.md               # índice de acuerdos/decisiones
  work/<ID>/
    work.json                # un objetivo + criterios + tareas
    work.next.json           # candidato temporal de edición, no autoridad
    plan.md                  # solo cuando hace falta
    plans/<subplan>.md       # misma plantilla con parent
    spec.md                  # solo cuando hace falta
    evidence/<ID>.md          # reportes de comprobación
    ...                      # research/review/delivery según encargo
```

Los recursos ejecutables y de composición viven únicamente en la instalación global:
`~/.pulso/{templates,schemas,bin,lib,docs}`, `~/.agents/skills` y el manifest
`~/.pulso/installation.json`. El workspace conserva solo datos del proyecto.

`state.json` es proyección, no autoridad del detalle ni una lista de agentes vivos. Su única finalidad es orientación rápida sin escanear trabajos. Incluye abiertos pending/in_progress/blocked/paused. Guarda objetivo, avance resumido, último avance, bloqueo/decisión y siguiente acción.

`work.json` tiene un objetivo deliberado; tareas pueden cambiar con más frecuencia. Los planes no replican sus estados. IDs de criterios, tareas y evidencia dan trazabilidad. No hay copia editable TOON ni un estado paralelo en TODO nativo.

`history.jsonl` registra resultados por cierre, no cada acción. Las carpetas no se mueven al cerrar. Reapertura usa mismo ID y nuevo cycle; evidencia histórica permanece, aceptación/tareas se reinician a pending para revisión. El log no permite reconstruir una agenda diaria completa.

## Helpers, no runtime

`lib/artifacts.mjs` hace operaciones síncronas de documentos: leer, validar, guardar revisión, actualizar proyección, archivar y reconciliar. No sabe qué agentes están vivos, no llama modelos ni tools, no aplica rutas, no agenda, no observa sesiones ni corre recovery de procesos.

La utilidad `save` verifica revisión leída y aumenta el contador. **No es compare-and-swap transaccional multiproceso**. Requiere escritor único; protege contra candidato obsoleto secuencial, no contra escritores simultáneos. La escritura de cada archivo usa temporal+fsync+rename. La consistencia de varios archivos es reparable, no una transacción distribuida.

Cierre: canónico final → historial deduplicado por ID/cycle → retiro del índice. `sync ID` reanuda una actualización interrumpida, no una sesión de agente. `repair` explícito reconstruye el índice recorriendo carpetas; no corre en cada consulta. El historial nunca se regenera descartando cierres previos.

## Validación: tres cosas diferentes

1. Estructura: esquemas y tipos, campos/refs/dependencias, coherencia de índice.
2. Evidencia: archivo de reporte, enlaces criterio/tarea y hashes vigentes al cerrar. Ejecución PASS necesita comando y exitCode cero; not_run no aprueba.
3. Calidad/aceptación: decisión de Pulso/revisores/humano con código y evidencia real. **El validador no demuestra que un comando se ejecutó ni que una afirmación es verdadera**. Tampoco valida calidad por encabezados o palabras.

El intérprete de esquemas acepta solo el vocabulario de los schemas distribuidos; falla ante keywords desconocidas. No se presenta como implementación general JSON Schema ni como validador del schema nativo entero de OpenCode.

## Capas simultáneas

Jerarquía del trabajo, no jerarquía de líderes. Pulso puede planificar C, ejecutar A y verificar B simultáneamente si sus contratos, bases y recursos lo permiten. Los especialistas no delegan. Un resultado responde a una delegación y revisión concretas; una revisión global nueva por trabajo independiente no invalida por sí sola la respuesta, pero exige reconciliar scopes antes de consolidar.
