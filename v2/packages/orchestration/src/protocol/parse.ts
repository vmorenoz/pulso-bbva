import {
  type AgentResult,
  agentResultSchema,
  type ExpectedDelegationIdentity,
  resultProtocol,
  type TaskEnvelope,
  taskEnvelopeSchema,
  taskProtocol,
} from "./schemas";

const decodeXml = (value: string) =>
  value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

const parsePayload = (
  source: string,
  protocol: typeof taskProtocol | typeof resultProtocol,
) => {
  const match = new RegExp(
    `^\\s*<${protocol.tag} v="([^"]+)"><payload>([\\s\\S]*)</payload></${protocol.tag}>\\s*$`,
  ).exec(source);
  if (match?.[1] !== String(protocol.version))
    throw new Error("PROTOCOL_VERSION_MISMATCH");
  try {
    return JSON.parse(decodeXml(match[2]));
  } catch {
    throw new Error("PROTOCOL_MALFORMED");
  }
};

export const validateAgentResultIdentity = (
  result: AgentResult,
  expected: ExpectedDelegationIdentity,
) => {
  if (result.protocol !== resultProtocol.id)
    throw new Error("PROTOCOL_VERSION_MISMATCH");
  if (result.delegationId !== expected.delegationId)
    throw new Error("DELEGATION_ID_MISMATCH");
  if (result.workId !== expected.workId) throw new Error("WORK_ID_MISMATCH");
  if (result.workItemId !== expected.workItemId)
    throw new Error("WORK_ITEM_ID_MISMATCH");
  if (result.specialist !== expected.specialist)
    throw new Error("SPECIALIST_MISMATCH");
  return result;
};

export const parseTaskEnvelope = (source: string): TaskEnvelope =>
  taskEnvelopeSchema.parse(parsePayload(source, taskProtocol));

export const parseAgentResult = (
  source: string,
  expected?: ExpectedDelegationIdentity,
): AgentResult => {
  const result = agentResultSchema.parse(parsePayload(source, resultProtocol));
  return expected ? validateAgentResultIdentity(result, expected) : result;
};
