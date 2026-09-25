type Issue = {
  code?: string;
  path?: Array<string | number>;
  message?: string;
  expected?: string;
  keys?: string[];
};

const issueList = (error: unknown): Issue[] => {
  if (!error || typeof error !== "object" || !("issues" in error)) return [];
  const issues = (error as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as Issue[]) : [];
};

const pathName = (path: Issue["path"] = []) =>
  path.reduce<string>(
    (result, part) =>
      typeof part === "number"
        ? `${result}[${part}]`
        : result
          ? `${result}.${part}`
          : part,
    "",
  ) || "payload";

const issueMessage = (issue: Issue) => {
  const path = pathName(issue.path);
  if (issue.code === "unrecognized_keys")
    return `${path}: unexpected field${(issue.keys?.length ?? 0) === 1 ? "" : "s"} ${(issue.keys ?? []).join(", ")}`;
  if (
    issue.code === "invalid_type" &&
    issue.message?.includes("received undefined")
  )
    return `${path}: required`;
  if (issue.code === "invalid_value") return `${path}: invalid value`;
  if (issue.code === "invalid_type")
    return `${path}: expected ${issue.expected ?? "the declared type"}`;
  if (issue.message?.includes("too_small")) return `${path}: must not be empty`;
  return `${path}: invalid`;
};

export const summarizeValidationError = (
  error: unknown,
  maxIssues = 3,
): string => {
  const issues = issueList(error);
  if (!issues.length)
    return error instanceof Error ? error.message : String(error);
  const summaries = [...new Set(issues.map(issueMessage))];
  const shown = summaries.slice(0, maxIssues);
  const remaining = Math.max(0, issues.length - shown.length);
  return `${issues.length} contract issue${issues.length === 1 ? "" : "s"}: ${shown.join("; ")}${remaining ? `; +${remaining} more` : ""}`;
};

export const protocolIssueCode = (
  error: unknown,
  kind: "task" | "result",
): string => {
  const issues = issueList(error);
  const paths = issues.map((issue) => issue.path ?? []);
  const includes = (field: string) =>
    paths.some((path) => path.includes(field));
  if (includes("protocol")) return "PROTOCOL_VERSION_MISMATCH";
  if (includes("status")) return "STATUS_INVALID";
  if (includes("specialistResult")) return "SPECIALIST_PAYLOAD_INVALID";
  if (includes("specialist")) return "SPECIALIST_MISSING_OR_INVALID";
  if (includes("workItemId")) return "WORK_ITEM_ID_MISMATCH";
  if (includes("workId")) return "WORK_ID_MISMATCH";
  if (includes("delegationId")) return "DELEGATION_ID_MISMATCH";
  return kind === "task"
    ? "TASK_ENVELOPE_SCHEMA_INVALID"
    : "AGENT_RESULT_SCHEMA_INVALID";
};
