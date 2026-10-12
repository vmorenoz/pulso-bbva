/** Host-only extension: the opaque window binding is never a core argument. */
export const bindingSchema = Object.freeze({type: 'string', minLength: 1, maxLength: 80});
// Only the first, unanchored status page is bootstrap discovery. History and
// memory are project reads too, even when their filters omit a Work ID.
export function requiresBinding(name, input) {
  return !(name === 'pulso_workspace' && input.action === 'status'
    && input.continuityId === undefined && input.cursor === undefined && input.workId === undefined);
}
export function nativeDefinitions(definitions) {
  return definitions.map(definition => ({...definition,
    inputSchema: {...definition.inputSchema, properties: {...definition.inputSchema.properties,
      expectedBindingId: bindingSchema}},
    modelDescription: `${definition.modelDescription} Inputs are flat, without a request wrapper. All operations, including Work/history/context reads and continuity-anchored or paginated status, require expectedBindingId from discovery status of the intended workspace. Only initial unanchored status may omit it. Durable prepare_delegation is a mutation requiring native approval. The opaque binding is not a chat identity or continuityId and does not replace approval. ok:true confirms the operation, not closure; for accept_delivery inspect data.closed, data.readiness and closeError/persistence.`,
  }));
}
export function unwrapInput(definition, input, validateToolInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input: expected an object');
  const {expectedBindingId, ...semantic} = structuredClone(input);
  if (Object.hasOwn(input, 'expectedBindingId') && (typeof expectedBindingId !== 'string' || !expectedBindingId.length || expectedBindingId.length > 80)) {
    throw new Error('input.expectedBindingId: invalid binding token');
  }
  validateToolInput(definition.name, semantic);
  return {semantic, expectedBindingId};
}
