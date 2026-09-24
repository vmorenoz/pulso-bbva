import { semanticPrompt } from "../../agents/definitions";
import type {
  AgentDefinition,
  CanonicalSkill,
  RuntimeDefinition,
  RuntimeRenderOptions,
} from "../types";

const toolNames: Record<string, string> = {
  read: "read",
  search: "search",
  edit: "edit",
  shell: "terminal",
  skill: "skill",
  delegate: "agent",
  mcp: "pulso/*",
};
const list = (values: string[]) =>
  `[${values.map((value) => `'${value}'`).join(", ")}]`;

export const vscodeCopilotRuntime: RuntimeDefinition = {
  id: "vscode-copilot",
  displayName: "VS Code / GitHub Copilot",
  capabilities: {
    customAgents: true,
    subagents: true,
    agentSkills: true,
    mcp: true,
    perAgentModel: false,
    inheritedAgentModel: true,
  },
  renderAgent(agent: AgentDefinition, _options?: RuntimeRenderOptions) {
    const tools = [
      ...new Set(
        agent.capabilities.allow
          .map((capability) => toolNames[capability])
          .filter(Boolean),
      ),
    ];
    const delegation =
      agent.delegation?.allowedSpecialists.map(
        (id) => agentDefinitions[id].displayName,
      ) ?? [];
    const frontmatter = [
      `name: ${agent.displayName}`,
      `description: ${agent.description}`,
      `tools: ${list(tools)}`,
      `agents: ${list(delegation)}`,
      `user-invocable: ${agent.role === "primary"}`,
    ];
    if (agent.role === "specialist")
      frontmatter.push("disable-model-invocation: false");
    const contract =
      agent.role === "primary"
        ? "Delegate through VS Code's native agent/subagent tool."
        : "This specialist is stateless and must not delegate.";
    return {
      path: `${agent.id}.agent.md`,
      content: `---\n${frontmatter.join("\n")}\n---\n${semanticPrompt(agent)}\n<runtime_contract>${contract}</runtime_contract>\n`,
    };
  },
  renderSkill(skill: CanonicalSkill) {
    return { path: `${skill.id}/SKILL.md`, content: skill.content };
  },
  buildRuntimeConfig(options) {
    const path =
      options.scope === "local"
        ? ".vscode/mcp.json"
        : "<discovered-vscode-user-mcp-config>";
    const command = options.mcpCommand[0];
    if (!command) throw new Error("VSCODE_MCP_COMMAND_EMPTY");
    const artifact = {
      servers: {
        pulso: {
          type: "stdio",
          command,
          args: options.mcpCommand.slice(1),
          env: { PULSO_WORKSPACE: "$" + "{workspaceFolder}" },
        },
      },
    };
    return [
      {
        path,
        content: `${JSON.stringify(artifact, null, 2)}\n`,
        format: "json",
      },
    ];
  },
};

import { agentDefinitions } from "../../agents/definitions";
