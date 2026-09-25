import { agentDefinitions } from "../agents/definitions";
import type { TaskContextBuildInput } from "../protocol/context-budget";
import { buildTaskEnvelope } from "../protocol/context-budget";
import { renderAgentProtocolInstructions } from "../protocol/instructions";
import { serializeTaskEnvelope } from "../protocol/serialize";
import type { AgentId, SpecialistDefinition } from "../runtimes/types";

export const getSpecialistDefinition = (
  id: Exclude<AgentId, "pulso">,
): SpecialistDefinition => {
  const definition = agentDefinitions[id];
  if (definition.role !== "specialist" || !definition.taskContract)
    throw new Error(`SPECIALIST_DEFINITION_INCOMPLETE:${id}`);
  return definition as SpecialistDefinition;
};

export const renderSpecialistInstructions = (id: Exclude<AgentId, "pulso">) => {
  const definition = getSpecialistDefinition(id);
  return renderAgentProtocolInstructions(id, definition.taskContract);
};

/**
 * Programmatic, host-neutral Task assembly. Native OpenCode and VS Code
 * orchestration still ask their LLM to issue the native subagent tool call;
 * the installed prompts explain this wire contract and runtime guards validate it.
 */
export const assembleSpecialistPrompt = (input: TaskContextBuildInput) => {
  const definition = getSpecialistDefinition(input.specialist);
  const { task, warnings } = buildTaskEnvelope(input);
  return {
    specialist: definition,
    instructions: renderSpecialistInstructions(input.specialist),
    task,
    serializedTask: serializeTaskEnvelope(task),
    warnings,
  };
};
