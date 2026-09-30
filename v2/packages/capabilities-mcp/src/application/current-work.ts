import { RuntimeWorkError } from "../runtime/errors";

type LegacyWork = {
  id: string;
  status: string;
};

const selectableStatuses = new Set(["pending", "active", "blocked", "waiting"]);

/** Conservative legacy selection: a transport without a session never guesses. */
export const resolveLegacyCurrentWork = <T extends LegacyWork>(
  works: T[],
  workId?: string,
): T | undefined => {
  if (workId) {
    const explicit = works.find((work) => work.id === workId);
    if (!explicit)
      throw new RuntimeWorkError(
        "WORK_NOT_FOUND",
        `Work '${workId}' does not belong to this workspace.`,
      );
    return explicit;
  }
  const candidates = works.filter((work) =>
    selectableStatuses.has(work.status),
  );
  if (candidates.length < 2) return candidates[0];
  throw new RuntimeWorkError(
    "WORK_AMBIGUOUS",
    `Multiple non-terminal Works require an explicit workId: ${candidates
      .map((work) => work.id)
      .join(", ")}`,
    undefined,
    { actual: candidates.map((work) => work.id).join(",") },
  );
};
