import {
  type AgentResult,
  agentResultSchema,
  resultProtocol,
  type TaskEnvelope,
  taskEnvelopeSchema,
  taskProtocol,
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
  return `<${taskProtocol.tag} v="${taskProtocol.version}"><payload>${payload(task)}</payload></${taskProtocol.tag}>`;
};

export const serializeAgentResult = (input: AgentResult) => {
  const result = agentResultSchema.parse(input);
  return `<${resultProtocol.tag} v="${resultProtocol.version}"><payload>${payload(result)}</payload></${resultProtocol.tag}>`;
};
