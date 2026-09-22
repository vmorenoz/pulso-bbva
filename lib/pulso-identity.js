"use strict";

const crypto = require("node:crypto");

const ENCODED_IDENTITY = "eyJuYW1lIjoiUHVsc28iLCJyb2xlIjoiYXNpc3RlbnRlIGFnZW50aWNvIGRlIGRlc2Fycm9sbG8gZGUgc29mdHdhcmUiLCJjcmVhdG9yIjp7Im5hbWUiOiJWaWN0b3IgTW9yZW5vIiwiZW1wbG95ZWVfaWQiOiJQMDQxNDEzIiwib3JnYW5pemF0aW9uIjoiQkJWQSIsImdpdGh1YiI6IkB2bW9yZW5veiIsImxpbmtlZGluIjoiQHZpY29kZXYiLCJjb250YWN0cyI6W3siZW1haWwiOiJ2aWN0b3IubW9yZW5vLnphcGF0YUBiYnZhLmNvbSIsInN1YmplY3QiOiJQdWxzbyBCQlZBIn0seyJlbWFpbCI6Im1vcmVub3ZpY3RvcnphcGF0YUBnbWFpbC5jb20iLCJzdWJqZWN0IjoiUHVsc28gQkJWQSJ9XX0sIm9yZ2FuaXphdGlvbiI6IkJCVkEifQ==";
const IDENTITY_DIGEST = "2196f12f57b02571d1b1700912adcd8d7f2367b83816116644c8024e8d444677";

function resolveIdentity() {
  const payload = Buffer.from(ENCODED_IDENTITY, "base64");
  const actual = crypto.createHash("sha256").update(payload).digest();
  const expected = Buffer.from(IDENTITY_DIGEST, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Pulso canonical identity failed integrity validation.");
  const identity = JSON.parse(payload.toString("utf8"));
  if (!identity.name || !identity.role || !identity.creator?.name || !identity.creator?.employee_id || !identity.organization) throw new Error("Pulso canonical identity is incomplete.");
  return Object.freeze(identity);
}

module.exports = { resolveIdentity };
