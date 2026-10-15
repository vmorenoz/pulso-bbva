/** Finite JSON Schema → native Zod boundary; shared validation stays authoritative. */
function publicationSchema(schema) {
  const projected = structuredClone(schema);
  // Visit schema positions only: property names may themselves be keywords.
  if (schema.properties) projected.properties = Object.fromEntries(
    Object.entries(schema.properties).map(([name, child]) => [name, publicationSchema(child)]));
  if (schema.items) projected.items = publicationSchema(schema.items);
  if (schema.anyOf) projected.anyOf = schema.anyOf.map(publicationSchema);
  const values = Object.hasOwn(schema, 'const') ? [schema.const] : schema.enum;
  if (values && !values.length) throw new Error('Empty enum is unsupported');
  if (values?.some(value => typeof value !== 'string')) {
    delete projected.const;
    delete projected.enum;
    projected.description = [schema.description, `Allowed values: ${values.map(value => JSON.stringify(value)).join(', ')}.`].filter(Boolean).join('\n');
    if (!schema.type && !schema.anyOf) {
      const types = [...new Set(values.map(value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value))];
      if (types.length === 1) projected.type = types[0];
      else projected.anyOf = types.map(type => ({type}));
    }
  }
  return projected;
}

export function schemaToZod(schema, z, {checkSchemaVocabulary, validateSchema}) {
  checkSchemaVocabulary(schema);
  const published = publicationSchema(schema);
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
    // Parents must carry the recursive projection too, never original children.
    value = value.meta(structuredClone(current));
    return value;
  };
  // Runtime validation uses the exact original, including constraints relaxed
  // for publication, Unicode lengths, safe integers and nested alternatives.
  return convert(published).refine(input => validateSchema(schema, input).length === 0,
    {message: 'Input does not match the shared Pulso contract'}).meta(published);
}

export function nativeToolSchemas(toolContracts, z, validator, extensions = {}) {
  return Object.fromEntries(Object.entries(toolContracts).map(([name, definition]) => {
    const extra = extensions[name] || {};
    const actions = definition.actionSchemas ? {...definition.actionSchemas, ...extra} : null;
    const descriptor = actions ? {anyOf: Object.values(actions)} : definition.inputSchema;
    return [name, schemaToZod(descriptor, z, validator)];
  }));
}
