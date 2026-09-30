export interface WorkContinuityCandidate {
  workId: string;
  objective: string;
}

export type WorkContinuityDecision =
  | { action: "reuse"; workId: string }
  | { action: "create" };

/**
 * The host supplies the semantic objective comparison; routing never depends
 * on specialist keywords or a prescribed WorkItem count.
 */
export const resolveWorkContinuity = (input: {
  current?: WorkContinuityCandidate;
  recent?: WorkContinuityCandidate[];
  objective: string;
  continuesObjective: (
    candidate: WorkContinuityCandidate,
    objective: string,
  ) => boolean;
}): WorkContinuityDecision => {
  const candidates = [
    ...(input.current ? [input.current] : []),
    ...(input.recent ?? []),
  ];
  const match = candidates.find((candidate) =>
    input.continuesObjective(candidate, input.objective),
  );
  return match
    ? { action: "reuse", workId: match.workId }
    : { action: "create" };
};
