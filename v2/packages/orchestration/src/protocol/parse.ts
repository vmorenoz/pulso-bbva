import {
  type AgentResult,
  agentResultSchema,
  type ExpectedDelegationIdentity,
  resultProtocol,
  type TaskEnvelope,
  taskEnvelopeSchema,
  taskProtocol,
} from "./schemas";

const parsePayload = (
  source: string,
  protocol: typeof taskProtocol | typeof resultProtocol,
) => {
  const version = new RegExp(`^\\s*<${protocol.tag} v="([^"]+)">`).exec(
    source,
  )?.[1];
  if (version !== String(protocol.version))
    throw new Error("PROTOCOL_VERSION_MISMATCH");
  const rawMatch = new RegExp(
    `^\\s*<${protocol.tag} v="${protocol.version}">([\\s\\S]*)</${protocol.tag}>\\s*$`,
  ).exec(source);
  const body = rawMatch?.[1];
  if (body === undefined) throw new Error("PROTOCOL_MALFORMED");
  try {
    return JSON.parse(body);
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
