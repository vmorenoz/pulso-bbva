import { semanticPrompt } from "../../agents/definitions";
import { openCodeV21PromptTexts } from "../../agents/opencode-v21-prompts";
import { commonSpecialistInstructions } from "../../agents/prompt-texts";
import type {
  AgentDefinition,
  CanonicalSkill,
  RuntimeDefinition,
  RuntimeRenderOptions,
} from "../types";

export const OPENCODE_TASK_PROVIDER = "opencode" as const;

const managedPrimaryV21Runtime = `<runtime_contract>
Este perfil es Pulso v2.1 en OpenCode. Sus herramientas de trabajo son pulso_prepare, pulso_inspect, pulso_work, pulso_preferences, pulso_artifact y task nativo. Las herramientas pulso_native_* heredadas no forman parte del flujo normal.

pulso_prepare resuelve el Work de esta conversación, publica o continúa su grafo y devuelve referencias cortas para nodos listos. No consultes get/open previamente. El código deriva workspace/session/message y genera identidades. Para cada referencia confirmada llama task con el subagent_type devuelto y la referencia pulso-dispatch/1 íntegra. No envíes task_id, command o background. La descripción es una etiqueta breve; no transporta autoridad. No reconstruyas envelopes.

Una llamada puede preparar varias referencias independientes. Despáchalas en paralelo dentro del mismo turno nativo cuando los permisos y la frontera lo permitan. El límite global es cuatro y el host devuelve la tanda foreground antes de la siguiente decisión. No crees un bucle de llamadas de estado ni un segundo orquestador.

Los resultados legibles se generan solo después de aceptar o rechazar durablemente el resultado del hijo. Distingue aceptación de protocolo y cumplimiento. Un resultado rechazado no se convierte en evidencia por reformularlo. Para diagnóstico usa pulso_inspect con la referencia exacta del encargo. No reintentes una ejecución que pudo haber tenido efectos sin revisión explícita.

Usa pulso_artifact para leer/publicar entregables gestionados; pulso_work adopta un plan solo tras la autorización de implementación aplicable y verifica los gates de cierre. No cierres Work al final de cada turno. No cambies el historial de un Work terminal. pulso_preferences persiste únicamente solicitudes explícitas y devuelve revisión/estado; nunca conceder permisos por preferencia.

Los especialistas reciben contratos estrictos pulso-task/2 y devuelven pulso-result/2. Pueden publicar solo los tipos de artefacto permitidos de su encargo. Eso no les concede control de Work ni edición general. Una herramienta ausente, denegada o pendiente de recarga se informa como tal; continuar por un fallback permitido no debe bloquear ramas independientes.
El contexto duradero propio procede de PULSO.md cargado explícitamente por el plugin, preferencias revisionadas y artefactos bajo .pulso/artifacts/. No crees ni edites AGENTS.md/CLAUDE.md para recordar una regla; no son un fallback del loader de Pulso. La compatibilidad de OpenCode no cambia esa decisión. Si PULSO.md no existe, aplica defaults seguros y solicita creación solo cuando sea necesaria y esté autorizada; no inventes fuentes cargadas. Las preferencias explícitas se guardan mediante pulso_preferences con lectura de comprobación. Para diagnosticar carga usa fuentes/hash/revisión del contexto efectivo, no solo la existencia de un archivo.
</runtime_contract>`;

const permissions = (agent: AgentDefinition) => {
  const result: Record<
    string,
    "allow" | "deny" | Record<string, "allow" | "deny">
  > = {};
  result["*"] = "deny";
  if (agent.role === "primary") {
    for (const action of [
      "pulso_prepare",
      "pulso_inspect",
      "pulso_work",
      "pulso_preferences",
      "pulso_artifact",
      "question",
      "read",
      "glob",
      "grep",
      "skill",
    ])
      result[action] = "allow";
    for (const action of [
      "pulso_native_work",
      "pulso_native_prepare",
      "pulso_native_status",
      "edit",
      "bash",
    ])
      result[action] = "deny";
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
  for (const action of [
    "pulso_native_work",
    "pulso_native_prepare",
    "pulso_native_status",
    "pulso_prepare",
    "pulso_inspect",
    "pulso_work",
    "pulso_preferences",
  ])
    result[action] = "deny";
  result.pulso_artifact = agent.role === "specialist" ? "allow" : "deny";
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
      content: `---\n${frontmatter.join("\n")}\n---\n${semanticPrompt(
        { ...agent, prompt: openCodeV21PromptTexts[agent.id] },
        {
          runtimeMode: "managed-opencode",
        },
      ).replace(
        commonSpecialistInstructions,
        commonSpecialistInstructions.replace(
          "No delegues, no uses herramientas de Work, runtime, bindings, leases ni otras herramientas de control de Pulso.",
          "No delegues, no uses herramientas de Work, runtime, bindings, leases ni otras herramientas de control de Pulso. La única excepción es pulso_artifact para publicar o leer artefactos permitidos por este encargo; no concede control de Work ni delegación.",
        ),
      )}${agent.role === "primary" ? `\n${contract ? `<runtime_contract>${contract}</runtime_contract>` : managedPrimaryV21Runtime}` : contract ? `\n<runtime_contract>${contract}</runtime_contract>` : ""}${options.buildId ? `\n<!-- pulso-build-id:${options.buildId} -->` : ""}\n`,
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
