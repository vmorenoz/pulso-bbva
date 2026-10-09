/** Host-only extension: the opaque window binding is never a core argument. */
export const bindingSchema = Object.freeze({type: 'string', minLength: 1, maxLength: 80});
export function nativeDefinitions(definitions) {
  return definitions.map(definition => ({...definition,
    inputSchema: {...definition.inputSchema, properties: {...definition.inputSchema.properties,
      ...(definition.name === 'pulso_history' ? {} : {expectedBindingId: bindingSchema})}},
    modelDescription: `${definition.modelDescription} Inputs are flat, without a request wrapper. Mutations require expectedBindingId from a status read of the intended workspace; this opaque token does not replace native approval. ok:true confirms the operation, not closure; for accept_delivery inspect data.closed, data.readiness and closeError/persistence.`,
  }));
}
export function unwrapInput(definition, input, validateToolInput) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input: expected an object');
  const {expectedBindingId, ...semantic} = structuredClone(input);
  if (Object.hasOwn(input, 'expectedBindingId') && (definition.name === 'pulso_history'
      || typeof expectedBindingId !== 'string' || !expectedBindingId.length || expectedBindingId.length > 80)) {
    throw new Error('input.expectedBindingId: invalid binding token');
  }
  validateToolInput(definition.name, semantic);
  return {semantic, expectedBindingId};
}
