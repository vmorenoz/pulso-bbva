import { semanticPrompt } from "../../agents/definitions";
import type {
  AgentDefinition,
  CanonicalSkill,
  RuntimeDefinition,
  RuntimeRenderOptions,
} from "../types";

export const OPENCODE_TASK_PROVIDER = "opencode" as const;

const managedPrimaryRuntime = `<runtime_contract>
Este perfil utiliza la fachada nativa gestionada de Pulso para OpenCode. Tus únicas herramientas operativas son pulso_native_work, pulso_native_prepare, pulso_native_status y task. Las operaciones de lease, binding y execution las realiza el adaptador en código.

Antes de trabajo técnico, consulta pulso_native_work con action="get". Si no existe Work para esta conversación, ábrelo con action="open", intent="continue", objective y title opcional. Si la persona introduce un objetivo realmente independiente, usa intent="new"; no cierres artificialmente el anterior. Si el Work reutilizado conserva otro objetivo, no lo renombres de hecho mediante un encargo distinto. action="use" recupera un workId ya asociado a esta conversación. action="resume" necesita workId y una razón concreta para reanudar un padre pausado o fallido.

Para delegar, llama pulso_native_prepare con specialist, objective, acceptanceCriteria no vacío y únicamente el contexto, scope, constraints, dependencies o requestedEvidence necesarios. workItemId es opcional: omítelo al crear una unidad nueva; úsalo solo para un item existente que esté ready. Nunca proporciones delegationId, bindingId, parentSessionId, childSessionId, leaseId o fencingToken: la fachada los obtiene o genera. Después, llama task usando nativeTaskArgs. Su prompt es únicamente una referencia corta pulso-dispatch/1:<delegationId>, no el JSON del especialista. Copia esa referencia sin alterarla y conserva subagent_type; description es una etiqueta breve, no instrucciones ni autoridad. El bridge verifica la preparación durable y coloca en código el prompt completo antes del despacho nativo. Nunca reconstruyas pulso-task/2 ni copies plantillas de salida al prompt de task. No añadas texto a la referencia ni task_id, command, background u otros argumentos. Si dispatchAllowed=false, no ejecutes task: consulta el estado o recibo que ya existe. Una referencia rechazada no autoriza buscar otra preparación, usar la más reciente ni inventar un ID. Si cambia el objetivo, modifica la solicitud de trabajo explícitamente; no intentes cambiarlo mediante description ni mediante la referencia.

La fachada valida y finaliza cada intento antes de devolverte pulso-receipt/1. Utiliza result solo cuando protocol sea pulso-receipt/1 y accepted sea true. El recibo incluye el resultado validado y la autoridad real del intento en state.authority; esos datos los produce el código, nunca debes inventarlos ni enviarlos para autorizarte. Un transporte completed no demuestra por sí solo aceptación, cumplimiento de criterios ni cierre del Work. Si recibes un wrapper nativo sin recibo gestionado, un rechazo, un error o una autoridad indeterminada, no lo presentes como éxito: consulta pulso_native_status con delegationId cuando lo tengas e informa el diagnóstico y lo que quedó sin comprobar. No repitas la tarea automáticamente, no reconstruyas un resultado a partir de una respuesta rechazada y no llames runtime_complete/fail para cambiar su estado. No necesitas consultar status después de cada recibo aceptado: esa consulta es para diagnóstico o inspección, no para que el intento consiga finalizar.

No ejecutes nuevamente una tarea solo porque su JSON fue rechazado. Un error de protocolo se informa con lo que quedó y no quedó comprobado. Para una nueva decisión explícita de reintento, consulta primero el recibo y los posibles efectos anteriores. action="retry_item" necesita workItemId, previousDelegationId, reviewedReceiptHash y reason; solamente prepara de nuevo el mismo item, nunca lo ejecuta. No reintentes un Executor sin examinar los efectos previos. El siguiente prepare genera otra delegación y conserva el histórico del intento anterior. No uses retry_item sobre items completed o cancelled.

No ejecutes Executor y Verifier simultáneamente en el mismo workspace: los comandos del Verifier también pueden escribir archivos. Las lecturas independientes pueden delegarse en paralelo cuando aporten valor y no dependan de una escritura en curso. No paralelices por ceremonia.

Para cerrar un objetivo usa pulso_native_work action="close" con workId, outcome y reason solo cuando corresponda a la entrega real o a la decisión explícita de fallar/cancelar el objetivo. No cierres el Work al final de cada turno. Si la fachada rechaza el cierre por trabajo incompleto, no cambies estados para ocultarlo. Un WorkItem de verificación completed con verdict fail no autoriza a declarar aprobado el producto.

Si las herramientas nativas faltan, el build es incompatible o no puede verificarse la identidad, explica que la instalación no está operativa. No retrocedas silenciosamente a un flujo manual ni simules una delegación. Mantén los detalles internos en el diagnóstico; ofrece a la persona el resultado útil o el bloqueo concreto en su idioma.
</runtime_contract>`;

const permissions = (agent: AgentDefinition) => {
  const result: Record<
    string,
    "allow" | "deny" | Record<string, "allow" | "deny">
  > = {};
  result["*"] = "deny";
  if (agent.role === "primary") {
    result.pulso_native_work = "allow";
    result.pulso_native_prepare = "allow";
    result.pulso_native_status = "allow";
    result.task = Object.fromEntries([
      ["*", "deny"],
      ...[
        "planner",
        "explorer",
        "executor",
        "verifier",
        "security-auditor",
      ].map((id) => [id, "allow"]),
    ]) as Record<string, "allow" | "deny">;
    return result;
  }
  const add = (capability: string, effect: "allow" | "deny") => {
    const action =
      capability === "search"
        ? "glob"
        : capability === "shell"
          ? "bash"
          : capability === "delegate"
            ? "task"
            : capability === "mcp"
              ? "pulso_*"
              : capability;
    result[action] = effect;
    if (capability === "search") result.grep = effect;
  };
  for (const capability of agent.capabilities.deny) add(capability, "deny");
  for (const capability of agent.capabilities.allow) add(capability, "allow");
  result.task = "deny";
  result.pulso_native_work = "deny";
  result.pulso_native_prepare = "deny";
  result.pulso_native_status = "deny";
  return result;
};

export const openCodeRuntime: RuntimeDefinition = {
  id: OPENCODE_TASK_PROVIDER,
  displayName: "OpenCode",
  protocolEnforcement: { supported: true, mode: "plugin-hooks" },
  capabilities: {
    customAgents: true,
    subagents: true,
    agentSkills: true,
    mcp: false,
    perAgentModel: true,
    inheritedAgentModel: true,
  },
  renderAgent(agent: AgentDefinition, options: RuntimeRenderOptions = {}) {
    const frontmatter = [
      `description: ${JSON.stringify(agent.description)}`,
      `mode: ${agent.role === "primary" ? "primary" : "subagent"}`,
      ...(agent.role === "specialist" ? ["hidden: true"] : []),
      `permission:\n${Object.entries(permissions(agent))
        .map(([action, effect]) =>
          typeof effect === "string"
            ? `  ${JSON.stringify(action)}: ${effect}`
            : `  ${action}:\n${Object.entries(effect)
                .map(
                  ([resource, rule]) =>
                    `    ${JSON.stringify(resource)}: ${rule}`,
                )
                .join("\n")}`,
        )
        .join("\n")}`,
    ];
    if (options.model) frontmatter.push(`model: ${options.model}`);
    const contract = options.runtimeContract;
    return {
      path: `${agent.id}.md`,
      content: `---\n${frontmatter.join("\n")}\n---\n${semanticPrompt(agent, {
        runtimeMode: "managed-opencode",
      })}${agent.role === "primary" ? `\n${managedPrimaryRuntime}` : contract ? `\n<runtime_contract>${contract}</runtime_contract>` : ""}${options.buildId ? `\n<!-- pulso-build-id:${options.buildId} -->` : ""}\n`,
    };
  },
  renderSkill(skill: CanonicalSkill) {
    return { path: `${skill.id}/SKILL.md`, content: skill.content };
  },
  buildRuntimeConfig(options) {
    const configPath =
      options.scope === "local" ? ".opencode/opencode.json" : "opencode.json";
    const config = {
      $schema: "https://opencode.ai/config.json",
      plugin: ["./plugins/pulso-protocol-guard.js"],
    };
    return [
      {
        path: configPath,
        content: `${JSON.stringify(config, null, 2)}\n`,
        format: "jsonc",
      },
    ];
  },
};
