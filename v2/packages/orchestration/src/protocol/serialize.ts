import {
  type AgentResult,
  agentResultSchema,
  resultProtocol,
  type TaskEnvelope,
  taskEnvelopeSchema,
  taskProtocol,
} from "./schemas";

// Keep the payload as JSON, but escape the only character that can start a
// closing tag. JSON's unicode escape remains valid JSON and avoids XML
// entities (and therefore the old entity soup) on the wire.
const tagSafeJson = (value: unknown) =>
  JSON.stringify(value).replaceAll("<", "\\u003C");

export const serializeTaskEnvelope = (input: TaskEnvelope) => {
  const task = taskEnvelopeSchema.parse(input);
  return `<${taskProtocol.tag} v="${taskProtocol.version}">${tagSafeJson(task)}</${taskProtocol.tag}>`;
};

export const serializeAgentResult = (input: AgentResult) => {
  const result = agentResultSchema.parse(input);
  return `<${resultProtocol.tag} v="${resultProtocol.version}">${tagSafeJson(result)}</${resultProtocol.tag}>`;
};
