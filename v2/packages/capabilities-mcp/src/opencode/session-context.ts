import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { CapabilityCatalog } from "./capability-catalog";
import type { Preference, PreferenceService } from "./preference-service";

export type TrustedSessionIdentity = Readonly<{
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
}>;
export type SessionContextSnapshot = Readonly<{
  workspaceId: string;
  sessionId: string;
  rules?: { hash: string; content: string };
  rulesStatus: "loaded" | "absent";
  preferences: readonly Preference[];
  preferenceRevision: number;
  capabilities: readonly ReturnType<CapabilityCatalog["list"]>[number][];
  hash: string;
}>;
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const maxRulesBytes = 32_768;

/** Reads only <validated root>/PULSO.md; never traverses parents or third-party files. */
export const loadPulsoRules = (workspaceRoot: string) => {
  const root = resolve(workspaceRoot),
    path = join(root, "PULSO.md");
  try {
    const actualRoot = realpathSync(root);
    const actualPath = realpathSync(path);
    const rel = relative(actualRoot, actualPath);
    if (
      rel.startsWith(`..${sep}`) ||
      rel === ".." ||
      resolve(actualRoot, rel) !== actualPath
    )
      throw new Error("PULSO_RULES_PATH_UNSAFE");
    const content = readFileSync(actualPath, "utf8");
    if (Buffer.byteLength(content) > maxRulesBytes)
      throw new Error("PULSO_RULES_TOO_LARGE");
    return { status: "loaded" as const, hash: sha256(content), content };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { status: "absent" as const };
    throw error;
  }
};

/** Identity must be assembled from trusted host hooks/bindings, never tool arguments. */
export const buildSessionContext = (input: {
  identity?: TrustedSessionIdentity;
  preferences: PreferenceService;
  capabilities: CapabilityCatalog;
}): SessionContextSnapshot | undefined => {
  const { identity } = input;
  if (!identity?.workspaceId || !identity.sessionId || !identity.workspaceRoot)
    return undefined;
  const rules = loadPulsoRules(identity.workspaceRoot);
  const preferences = input.preferences
    .list(identity.workspaceId)
    .filter((item) => item.status === "active");
  const capabilities = input.capabilities.list();
  const payload = {
    workspaceId: identity.workspaceId,
    sessionId: identity.sessionId,
    rules,
    preferences,
    capabilities,
  };
  return Object.freeze({
    workspaceId: identity.workspaceId,
    sessionId: identity.sessionId,
    ...(rules.status === "loaded"
      ? { rules: { hash: rules.hash, content: rules.content } }
      : {}),
    rulesStatus: rules.status,
    preferences,
    preferenceRevision: preferences.reduce(
      (max, item) => Math.max(max, item.revision),
      0,
    ),
    capabilities,
    hash: sha256(JSON.stringify(payload)),
  });
};

/** Compact only continuity identifiers/revisions; snapshots are reconstructed separately. */
export const compactSessionContext = (input: {
  workReference?: string;
  pendingBranches: readonly string[];
  decisions: readonly string[];
  preferenceRevision: number;
  rulesHash?: string;
}) => ({
  ...(input.workReference ? { workReference: input.workReference } : {}),
  pendingBranches: [...input.pendingBranches],
  decisions: [...input.decisions],
  preferenceRevision: input.preferenceRevision,
  ...(input.rulesHash ? { rulesHash: input.rulesHash } : {}),
});
