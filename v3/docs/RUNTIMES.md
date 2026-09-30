# Adaptadores nativos, capacidades y límites

Referencia documental: 2026-09-29. OpenCode instalado observado: v1.18.32; VS Code serie 1.139 como baseline documental. La disponibilidad real también depende del motor, modelo, políticas corporativas, herramientas habilitadas y extensiones. No se garantiza soporte futuro sin volver a verificar.

| Aspecto | OpenCode | VS Code Copilot Agent Host | VS Code Local opcional |
|---|---|---|---|
| Agentes | `.opencode/agents/*.md` | `.github/agents/*.agent.md` | `.github/agents/*.agent.md` |
| Principal | `mode: primary` | `user-invocable: true` | `user-invocable: true` |
| Especialistas | `mode: subagent`, hidden | `user-invocable: false` | `user-invocable: false`, `agents: []` |
| Delegación | `task` nativo | custom agents/tools nativos del host | `agent/runSubagent`, roster `agents` |
| Tools/modelos | omitidos; denegaciones task/question/todowrite en especialistas | omitidos, hereda capacidades del host y MCP existentes | tools Local enumeradas; model omitido |
| Skills comunes | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` |
| Accesos Pulso | comandos `.opencode/commands/` | skills invocables, no `.prompt.md` | skills invocables |
| Preguntas | Pulso usa question si existe | Pulso usa interacción disponible | Pulso usa preguntas nativas; child no interactúa con usuario |
| Paralelismo | tareas nativas disponibles | delegación nativa disponible | subagentes nativos disponibles |


## Estado de soporte y garantías

Las filas de capacidades que siguen describen el diseño documental, no sesiones
aceptadas. `documented_baseline` es referencia histórica, no detección de versión,
restricción de instalación ni prueba de compatibilidad. La selección del motor VS Code
es explícita y conserva las opciones existentes, sin crear perfiles.

| Superficie | Configuración disponible | Aceptación live de este correctivo |
|---|---|---|
| OpenCode | Sí | Caso inicial PASS en v1.18.32; delegación a `pulso-explorer` aceptada |
| VS Code Copilot Agent Host | Sí | NOT_RUN |
| VS Code Local | Sí, variante opcional existente | NOT_RUN |

| Se conserva | No se promete |
|---|---|
| Agentes y delegación nativos | Que todas las tools estén habilitadas por la organización |
| Skill fuente compartida; comandos generados | Igual identidad de herramienta o implementación en cada host |
| Modelos y aprobaciones existentes | Sandbox propio o ampliación de permisos |
| Índice global y detalle por trabajo | Actividad viva ni exclusión entre dos coordinadores |
| Check de archivos y formatos | Ejecución real o calidad semántica del modelo |

Una capacidad ausente se comunica; si no permite paralelismo, se secuencia. No se
implementan shims, scripts de agentes ni selección automática de herramientas para
sustituir al host. La aceptación breve está en `REAL-SCENARIOS.md`.

## OpenCode

En OpenCode 1.18.32 la llamada nativa `task` exige `description` como string breve,
`prompt` como string con el encargo completo y `subagent_type` con el ID exacto del
especialista. El contrato Pulso se incluye dentro de `prompt`; no reemplaza esos
argumentos. No se inventan `task_id` ni se habilita `background` experimental.

Se usa `permission`, no el campo `tools` deprecado. Solo se deniegan capacidades que contradicen la identidad del especialista; nunca se agrega allow/ask que reemplace restricciones heredadas. El LT conserva la selección de capacidades nativas del usuario. No se instala un plugin porque no hace falta para delegar o mantener documentos.

Las denegaciones no son aislamiento de archivo ni impiden que una shell amplia se abuse: el contrato de roles prohíbe ese bypass, pero la seguridad dura depende de los permisos del host. `opencode agent list` sirve para descubrimiento, no prueba qué agente está activo. Seleccionar `pulso` en la sesión real es necesario.

## Copilot Agent Host (predeterminado)

No se asume que las herramientas del motor Local existan. Los custom agents tienen name/description y omiten tools/model para heredar. En esta adaptación la prohibición de delegar de especialistas es una instrucción conductual; no se anuncia como enforcement de un campo Local no verificado en Copilot.

Los prompt files `.prompt.md` están deprecados y Agent Host no los carga; la distribución no los instala. Las skills invocables son la alternativa actual. Invocar una skill no cambia el agente efectivo. `disable-model-invocation: true` en Pulso expresa que no debe invocarse como especialista, no cambia autenticación ni permisos.

No se crea un SDK runtime propio. Que el host use un SDK es una decisión de su implementación nativa, no una dependencia de Pulso.

## Aislamiento y degradación

Sesiones/contextos separados no son worktrees. Si no hay paralelismo seguro, secuenciar. No lanzar procesos agent/SDK desde shell para simularlo. No cambiar a New Worktree cuando el host active Allow all sin decisión explícita; tampoco modificar approvals.

Node se usa solo para instalación y archivos. No hace falta API key adicional ni cuota distinta de la sesión existente. Doctor detecta versiones/integridad cuando los ejecutables están disponibles; si `code` no está en PATH pero VS Code está instalado, reporta NOT_DETECTED, no «no instalado».

No se promete detección de todos los agentes/skills globales. La aceptación live debe verificar lo que el host realmente carga. La instalación de VS Code soportada utiliza Copilot Agent Host; no mantiene una variante local por proyecto.
