import { parseAgentResult } from "./parse";
export const repairAgentResult = (source: string) => {
  const candidate = source
    .trim()
    .replace(/^```(?:xml)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return parseAgentResult(candidate);
  } catch {
    throw new Error("Protocol repair failed after one compact normalization");
  }
};
