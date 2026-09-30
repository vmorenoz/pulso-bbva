/** The parent transports a lookup reference, never the specialist's serialized task. */
export const nativeDispatchPrefix = "pulso-dispatch/1:";
const referencePattern =
  /^pulso-dispatch\/1:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const taskKeys = ["description", "subagent_type", "prompt"] as const;

export type NativeDispatchTaskArgs = {
  description: string;
  subagent_type: string;
  prompt: string;
};

/** Strict: no trimming, URL decoding, envelope extraction, or fallback selection. */
export const parseNativeDispatchReference = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const match = referencePattern.exec(value);
  // JavaScript `$` may match before a final newline; require the whole match.
  return match?.[0] === value ? match[1] : undefined;
};

/** Detection, not authorization. Malformed reference-looking tasks fail closed. */
export const hasNativeDispatchReferenceMarker = (value: unknown) =>
  typeof value === "string" && /pulso-dispatch\//i.test(value);

export const renderNativeDispatchReference = (delegationId: string) => {
  const reference = `${nativeDispatchPrefix}${delegationId}`;
  if (parseNativeDispatchReference(reference) !== delegationId)
    throw new Error(
      "PREPARATION_REFERENCE_INVALID: expected a generated UUID v4",
    );
  return reference;
};

export const nativeDispatchDescription = (specialist: string) =>
  `Pulso ${specialist} task`;

export const nativeDispatchTaskArgs = (delegation: {
  delegationId: string;
  specialist: string;
}): NativeDispatchTaskArgs => ({
  description: nativeDispatchDescription(delegation.specialist),
  subagent_type: delegation.specialist,
  prompt: renderNativeDispatchReference(delegation.delegationId),
});

/** Check mutability BEFORE claiming/binding; no getters or hidden controls in host JSON arguments. */
export const assertNativeTaskArgsMutable: (
  value: unknown,
) => asserts value is NativeDispatchTaskArgs = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("NATIVE_DISPATCH: task arguments must be an object");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("NATIVE_DISPATCH: task arguments must be plain JSON");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== taskKeys.length ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !taskKeys.includes(key as (typeof taskKeys)[number]),
    )
  )
    throw new Error(
      "NATIVE_DISPATCH: only description, subagent_type and prompt are supported",
    );
  for (const key of taskKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      descriptor.writable !== true
    )
      throw new Error(
        `NATIVE_DISPATCH: ${key} must be a writable own string property`,
      );
  }
};

/**
 * Call only with a validated durable preparation after an authorized claim/bind.
 * OpenCode 1.18.32 executes the ORIGINAL args object, not a replacement output.args.
 * This function does not select a preparation or authorize a dispatch.
 */
export const hydrateNativeTaskArgsInPlace = (
  args: NativeDispatchTaskArgs,
  canonical: NativeDispatchTaskArgs,
) => {
  assertNativeTaskArgsMutable(args);
  if (args.subagent_type !== canonical.subagent_type)
    throw new Error(
      "IDENTITY_MISMATCH: hydration cannot change the requested specialist",
    );
  args.description = canonical.description;
  args.prompt = canonical.prompt;
};
