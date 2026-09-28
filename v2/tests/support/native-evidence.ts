import { createHash } from "node:crypto";

export type NativeAttemptEvidence = {
  workspaceId: string;
  parentSessionId: string;
  parentCallId: string;
  delegationId: string;
  workId: string;
  workItemId: string;
  specialist: string;
  childSessionId?: string;
  bindingId?: string;
  receiptPhase: string;
  accepted?: boolean;
  resultHash?: string;
  receiptHash?: string;
  workStatus?: string;
  workItemStatus?: string;
  bindingStatus?: string;
  sideEffectsMayContinue?: boolean;
  authority?: {
    executionId: string;
    executionStatus: string;
    leaseId: string;
    leaseStatus: string;
    fencingToken: number;
  };
  diagnostic?: { code: string; stage?: string };
  observedModel?: { providerId: string; modelId: string };
  buildId?: string;
};

export type NativeCallEvidence = {
  turn: number;
  parentSessionId?: string;
  parentCallId: string;
  taskStatus?: string;
  stage: "prepared" | "dispatched" | "rejected" | "unknown";
  parseError?: string;
  error?: string;
  delegationId?: string;
  attempts: NativeAttemptEvidence[];
};

export const sha256 = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

const safePath = (path: string[]) =>
  path
    .join(".")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase();

const secretKey = (key: string) =>
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|private[_-]?key|password|authorization|credential|cookie|token|secret)/i.test(
    key,
  );

/** Preserve fencing only under the typed authority projection; never blanket-allow token keys. */
export const sanitizeEvidence = (
  value: unknown,
  path: string[] = [],
): unknown => {
  if (typeof value === "string") {
    const redacted = value
      .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
      .replace(
        /\b(?:sk|sbp|sb_secret|plane_api)_[A-Za-z0-9_-]{8,}\b/g,
        "[REDACTED]",
      )
      .replace(
        /(access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|password)\s*[:=]\s*[^\s,;]+/gi,
        "$1=[REDACTED]",
      );
    // Parse embedded JSON so nested credential names are sanitized structurally.
    try {
      const parsed: unknown = JSON.parse(redacted);
      if (parsed && typeof parsed === "object")
        return JSON.stringify(sanitizeEvidence(parsed, path));
    } catch {
      // Ordinary text; redact the known token forms above.
    }
    return redacted;
  }
  if (Array.isArray(value))
    return value.map((entry) => sanitizeEvidence(entry, path));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const currentPath = [...path, key];
      if (
        key === "fencingToken" &&
        safePath(path).endsWith("authority") &&
        typeof child === "number"
      )
        return [key, child];
      if (secretKey(key)) return [key, "[REDACTED]"];
      return [key, sanitizeEvidence(child, currentPath)];
    }),
  );
};

export const consolidateNativeCalls = (calls: NativeCallEvidence[]) => {
  const grouped = new Map<string, NativeCallEvidence>();
  for (const call of calls) {
    const key = `${call.parentSessionId ?? "?"}\u0000${call.parentCallId}`;
    const prior = grouped.get(key);
    if (!prior) {
      grouped.set(key, { ...call, attempts: [...call.attempts] });
      continue;
    }
    // Keep every observation/event while merging the most complete call view.
    grouped.set(key, {
      ...prior,
      ...call,
      parseError: prior.parseError ?? call.parseError,
      error: prior.error ?? call.error,
      delegationId: prior.delegationId ?? call.delegationId,
      attempts: [...prior.attempts, ...call.attempts],
    });
  }
  return [...grouped.values()];
};

export const validateNativeDispatchIdentity = (calls: NativeCallEvidence[]) => {
  const delegationCalls = new Map<string, string>();
  for (const call of calls) {
    if (!call.delegationId) continue;
    const priorCallId = delegationCalls.get(call.delegationId);
    if (priorCallId && priorCallId !== call.parentCallId)
      throw new Error(`NATIVE_DELEGATION_REDISPATCHED:${call.delegationId}`);
    delegationCalls.set(call.delegationId, call.parentCallId);
  }
};

export const validateAttemptAuthority = (attempt: NativeAttemptEvidence) => {
  if (
    !attempt.workspaceId ||
    !attempt.parentSessionId ||
    !attempt.parentCallId ||
    !attempt.childSessionId ||
    !attempt.bindingId ||
    !attempt.authority
  )
    return { accepted: false, reason: "attempt_identity_or_authority_missing" };
  if (attempt.receiptPhase !== "applied" || attempt.accepted !== true)
    return { accepted: false, reason: "receipt_not_applied_and_accepted" };
  if (
    attempt.authority.executionStatus !== "completed" ||
    attempt.authority.leaseStatus !== "released" ||
    !Number.isSafeInteger(attempt.authority.fencingToken)
  )
    return { accepted: false, reason: "authority_not_terminal" };
  return { accepted: true as const };
};
