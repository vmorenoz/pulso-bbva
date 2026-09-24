import type {
  Evidence,
  PriorResultReference,
  SpecialistId,
  TaskEnvelope,
} from "./schemas";
export const contextWarnings = (task: TaskEnvelope): string[] => {
  const warnings: string[] = [];
  const facts = task.context?.facts ?? [];
  const refs = task.context?.references ?? [];
  if (facts.length > 12) warnings.push("too many facts");
  if (
    task.context?.priorResults?.some((result) => result.summary.length > 1200)
  )
    warnings.push("large prior result");
  if (
    [...facts, ...refs.map((ref) => ref.ref)].some(
      (value) => value.length > 2000,
    )
  )
    warnings.push("large inline snippets");
  if (new Set(refs.map((ref) => ref.ref)).size !== refs.length)
    warnings.push("duplicated context");
  return warnings;
};

type PrioritizedValue = { value: string; priority?: number };
type PrioritizedReference = Evidence & { priority?: number };

export interface TaskContextInput {
  facts?: Array<string | PrioritizedValue>;
  references?: PrioritizedReference[];
  priorResults?: PriorResultReference[];
  constraints?: Array<string | PrioritizedValue>;
  acceptanceCriteria?: Array<string | PrioritizedValue>;
  scope?: { include?: string[]; exclude?: string[] };
  requestedEvidence?: Array<string | PrioritizedValue>;
}

export interface TaskContextBuildInput extends TaskContextInput {
  delegationId: string;
  specialist: SpecialistId;
  workId: string;
  workItemId: string;
  objective: string;
}

const compactValues = (values?: Array<string | PrioritizedValue>) => {
  const seen = new Set<string>();
  return (values ?? [])
    .map((item) =>
      typeof item === "string" ? { value: item, priority: 0 } : item,
    )
    .map((item) => ({ ...item, value: item.value.trim() }))
    .filter((item) => {
      if (!item.value.length || seen.has(item.value)) return false;
      seen.add(item.value);
      return true;
    })
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
    .map((item) => item.value);
};

const compactReferences = (references?: PrioritizedReference[]) => {
  const seen = new Set<string>();
  return (references ?? [])
    .map((reference) => ({
      ...reference,
      ref: reference.ref.trim(),
      note: reference.note?.trim(),
    }))
    .filter((reference) => {
      const key = `${reference.kind}:${reference.ref}:${reference.note ?? ""}`;
      if (!reference.ref || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
    .map(({ priority: _, note, ...reference }) =>
      note ? { ...reference, note } : reference,
    );
};

const compactPriorResults = (results?: PriorResultReference[]) => {
  const seen = new Set<string>();
  return (results ?? []).filter((result) => {
    const key = `${result.delegationId}:${result.specialist}`;
    if (!result.summary.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const optional = <T>(values: T[]) => (values.length ? values : undefined);

export const buildTaskEnvelope = (input: TaskContextBuildInput) => {
  const facts = compactValues(input.facts);
  const references = compactReferences(input.references);
  const priorResults = compactPriorResults(input.priorResults);
  const constraints = compactValues(input.constraints);
  const acceptanceCriteria = compactValues(input.acceptanceCriteria);
  const requestedEvidence = compactValues(input.requestedEvidence);
  const include = compactValues(input.scope?.include);
  const exclude = compactValues(input.scope?.exclude);
  const context = {
    ...(optional(facts) ? { facts } : {}),
    ...(optional(references) ? { references } : {}),
    ...(optional(priorResults) ? { priorResults } : {}),
  };
  const task: TaskEnvelope = {
    protocol: "pulso-task/1",
    delegationId: input.delegationId,
    specialist: input.specialist,
    work: { workId: input.workId, workItemId: input.workItemId },
    objective: input.objective.trim(),
    ...(Object.keys(context).length ? { context } : {}),
    ...(optional(constraints) ? { constraints } : {}),
    ...(optional(acceptanceCriteria) ? { acceptanceCriteria } : {}),
    ...(include.length || exclude.length
      ? {
          scope: {
            ...(optional(include) ? { include } : {}),
            ...(optional(exclude) ? { exclude } : {}),
          },
        }
      : {}),
    ...(optional(requestedEvidence) ? { requestedEvidence } : {}),
    output: { contract: "pulso-result/1" },
  };
  return { task, warnings: contextWarnings(task) };
};
