import { parseAgentResult } from "./parse";

export const repairAgentResult = (source: string) => {
  const match = /^\s*```(?:xml)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(source);
  if (!match) throw new Error("PROTOCOL_PARSE_ERROR");
  return parseAgentResult(match[1]);
};
