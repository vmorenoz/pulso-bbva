import { semanticPrompt } from "../../agents/definitions";
import type {
  AgentDefinition,
  CanonicalSkill,
  RuntimeDefinition,
  RuntimeRenderOptions,
} from "../types";

export const OPENCODE_TASK_PROVIDER = "opencode" as const;

const runtimeContract = (agent: AgentDefinition) =>
  agent.role === "primary"
    ? `Invoke only OpenCode's native Task tool with subagent_type set to the selected canonical specialist ID. Use provider "${OPENCODE_TASK_PROVIDER}" and set externalExecutionId to the same fresh delegationId placed in the canonical TaskEnvelope. Task.prompt must contain exactly the generated serialized envelope, not bare JSON or additional fields. Omit unused optional Task fields and never send null. Task state completed is transport status only. If Task errors or the guard reports PULSO_PROTOCOL_INVALID_TASK/RESULT, call pulso_runtime_fail with a concise protocol/task error reason before responding.`
    : "OpenCode invokes this stateless specialist through its native Task tool; follow the generated communication_protocol exactly, omit unused optional fields, and never send null for an omitted field.";

const permissions = (agent: AgentDefinition) => {
  const result: Record<
    string,
    "allow" | "deny" | Record<string, "allow" | "deny">
  > = {};
  for (const capability of agent.capabilities.allow) {
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
    result[action] = "allow";
    if (capability === "search") result.grep = "allow";
  }
  for (const capability of agent.capabilities.deny) {
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
    result[action] = "deny";
    if (capability === "search") result.grep = "deny";
  }
  if (agent.role === "primary") {
    const taskRules: Record<string, "allow" | "deny"> = { "*": "deny" };
    for (const id of agent.delegation?.allowedSpecialists ?? [])
      taskRules[id] = "allow";
    result.task = taskRules;
  }
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
    mcp: true,
    perAgentModel: true,
    inheritedAgentModel: true,
  },
  renderAgent(agent: AgentDefinition, options: RuntimeRenderOptions = {}) {
    const frontmatter = [
      `description: ${JSON.stringify(agent.description)}`,
      `mode: ${agent.role === "primary" ? "primary" : "subagent"}`,
      `permission:\n${Object.entries(permissions(agent))
        .map(([action, effect]) =>
          typeof effect === "string"
            ? `  ${action}: ${effect}`
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
    const contract = options.runtimeContract ?? runtimeContract(agent);
    return {
      path: `${agent.id}.md`,
      content: `---\n${frontmatter.join("\n")}\n---\n${semanticPrompt(agent, { guarded: true })}\n<runtime_contract>${contract}</runtime_contract>\n`,
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
      mcp: {
        pulso: {
          type: "local",
          command: options.mcpCommand,
          ...(options.mcpCwd ? { cwd: options.mcpCwd } : {}),
        },
      },
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
