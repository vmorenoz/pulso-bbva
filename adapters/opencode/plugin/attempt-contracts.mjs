/** Passive telemetry is a native extension, never part of shared Work. */
const properties = {
  workId: {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'},
  sessionID: {type: 'string', minLength: 1, maxLength: 160},
  limit: {type: 'integer', minimum: 1, maximum: 100},
};
export const attemptActionSchemas = Object.freeze(Object.fromEntries(['attempts', 'reconcile_attempts'].map(action => [action, {
  type: 'object', properties: {action: {const: action}, ...properties}, required: ['action'], additionalProperties: false,
}])));
