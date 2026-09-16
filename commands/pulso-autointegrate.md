---
description: Descubre, entrevista y conecta agentes externos de OpenCode con la agenda global de Pulso.
agent: pulso
---

Gestiona interactivamente los contactos de agentes de Pulso. Este es un trabajo de configuración: no crees un objetivo, estado de tarea, métricas ni cierre de experiencia.

1. Llama a `pulso_agent_contacts` con `action: scan` y compara los candidatos por su estado `registration`.
2. Usa la herramienta nativa de preguntas para que el usuario seleccione uno o más agentes compatibles nuevos o modificados. Explica por qué los agentes exclusivos de modo primario no pueden delegarse. Cuando corresponda, ofrece también listar o eliminar contactos existentes.
3. Para cada candidato seleccionado, delega una tarea nativa visible a ese agente exacto con `PULSO_CONTACT_PROBE=<agent-name>`. Pídele únicamente que describa su propósito, casos de uso y no uso, capacidades y si necesita mutación. No debe usar herramientas, editar archivos, ejecutar comandos ni delegar.
4. Concilia la entrevista con la descripción detectada y la sugerencia de mutación. Presenta una ficha de contacto concisa y pide al usuario aprobarla o elegir entre solo lectura y mutación acotada cuando no esté claro. Explica que los contactos no pueden usar shell ni delegar otros agentes; la implementación que requiera esas capacidades permanece en Pulso Executor.
5. Registra únicamente las fichas aprobadas usando el digest exacto devuelto por el escaneo.
6. Informa qué se conectó, cuándo lo utilizará Pulso y un ejemplo realista. Indica que una definición de agente modificada requiere ejecutar nuevamente este comando.

Nunca registres un agente silenciosamente, infieras aprobación, expongas prompts completos ni uses un agente externo ausente de los resultados del escaneo.
