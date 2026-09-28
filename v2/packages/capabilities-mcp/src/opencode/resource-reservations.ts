import type { NativeJournal, NativeResource } from "./native-journal";

/** The caller supplies policy-derived paths; the journal rechecks conflicts atomically. */
export const reserveNativeResources = async (input: {
  journal: NativeJournal;
  claim: Parameters<NativeJournal["claim"]>[0];
  resources: NativeResource[];
}) => input.journal.claim({ ...input.claim, resources: input.resources });

export const releaseNativeResources = (
  journal: NativeJournal,
  delegationId: string,
) => journal.releaseReservations(delegationId);
