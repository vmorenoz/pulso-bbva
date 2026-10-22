import assert from 'node:assert/strict';

// Match structured diagnostics, not a localized top-level summary. Every expected
// issue must identify the rejected field/entity; unrelated exceptions cannot pass.
export function schemaIssue(entity, message) {
  return error => {
    assert.equal(error.code, 'SCHEMA_INVALID');
    const issue = error.issues?.find(issue => issue.entity === entity);
    assert.ok(issue, `Missing schema issue ${entity}: ${JSON.stringify(error.issues)}`);
    if (message) assert.match(issue.message, message);
    return true;
  };
}
export function closureIssue(code, entity, message) {
  return error => {
    assert.equal(error.code, 'CLOSURE_NOT_READY');
    assert.equal(error.readiness.ready, false);
    const issue = error.issues?.find(issue => issue.code === code && issue.entity === entity);
    assert.ok(issue, `Missing ${code}/${entity}: ${JSON.stringify(error.issues)}`);
    if (message) assert.match(issue.message, message);
    return true;
  };
}
