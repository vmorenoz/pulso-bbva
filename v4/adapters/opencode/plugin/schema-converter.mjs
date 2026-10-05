/** Finite JSON Schema → native Zod boundary; shared validation stays authoritative. */
export function schemaToZod(schema, z, {checkSchemaVocabulary, validateSchema}) {
  checkSchemaVocabulary(schema);
  const convert = current => {
    let value;
    if (current.anyOf) {
      if (!current.anyOf.length) throw new Error('Empty anyOf is unsupported');
      const alternatives = current.anyOf.map(convert);
      value = alternatives.length === 1 ? alternatives[0] : z.union(alternatives);
    } else if (Object.hasOwn(current, 'const')) value = z.literal(current.const);
    else if (current.enum) {
      if (!current.enum.length) throw new Error('Empty enum is unsupported');
      const alternatives = current.enum.map(item => z.literal(item));
      value = alternatives.length === 1 ? alternatives[0] : z.union(alternatives);
    } else if (current.type === 'object') {
      const required = new Set(current.required || []);
      const shape = Object.fromEntries(Object.entries(current.properties || {}).map(([name, property]) => {
        const inner = convert(property);
        return [name, required.has(name) ? inner : inner.optional()];
      }));
      value = z.object(shape);
      value = current.additionalProperties === false ? value.strict() : value.passthrough();
    } else if (current.type === 'array') value = z.array(current.items ? convert(current.items) : z.unknown());
    else if (current.type === 'string') value = z.string();
    else if (current.type === 'integer' || current.type === 'number') value = z.number();
    else if (current.type === 'boolean') value = z.boolean();
    else if (current.type === 'null') value = z.null();
    else if (current.type !== undefined) throw new Error(`Unsupported type: ${current.type}`);
    else value = z.unknown();
    // Reuse exact shared Unicode length, safe-integer, datetime and nested
    // constraints rather than a subtly different native validation dialect.
    value = value.refine(input => validateSchema(current, input).length === 0,
      {message: 'Input does not match the shared Pulso contract'});
    // Publish the original finite descriptor as Zod JSON Schema metadata.
    // This preserves exact advertised bounds (including Unicode lengths)
    // while the shared validator governs native parsing without dialect drift.
    value = value.meta(structuredClone(current));
    return value;
  };
  return convert(schema);
}

export function nativeToolSchemas(toolContracts, z, validator, extensions = {}) {
  return Object.fromEntries(Object.entries(toolContracts).map(([name, definition]) => {
    const extra = extensions[name] || {};
    const actions = definition.actionSchemas ? {...definition.actionSchemas, ...extra} : null;
    const descriptor = actions ? {anyOf: Object.values(actions)} : definition.inputSchema;
    return [name, schemaToZod(descriptor, z, validator)];
  }));
}
