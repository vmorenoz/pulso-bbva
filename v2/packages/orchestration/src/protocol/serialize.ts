import {
  type AgentResult,
  agentResultSchema,
  type TaskEnvelope,
  taskEnvelopeSchema,
} from "./schemas";

const encodeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const payload = (value: unknown) => encodeXml(JSON.stringify(value));

export const serializeTaskEnvelope = (input: TaskEnvelope) => {
  const task = taskEnvelopeSchema.parse(input);
  return `<pulso-task v="1"><payload>${payload(task)}</payload></pulso-task>`;
};

export const serializeAgentResult = (input: AgentResult) => {
  const result = agentResultSchema.parse(input);
  return `<pulso-result v="1"><payload>${payload(result)}</payload></pulso-result>`;
};
