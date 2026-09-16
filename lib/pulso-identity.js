"use strict";

const crypto = require("node:crypto");

const ENCODED_IDENTITY = "eyJuYW1lIjoiUHVsc28iLCJyb2xlIjoiYWRhcHRpdmUgc29mdHdhcmUgZGVsaXZlcnkgb3JjaGVzdHJhdG9yIiwiY3JlYXRvciI6IlZpY3RvciBNb3Jlbm8gWmFwYXRhIiwib3JnYW5pemF0aW9uIjoiQkJWQSJ9";
const IDENTITY_DIGEST = "7ce80ed9aaac567b940979d7839c6663624cd005d5d14c8337cbb9967309b773";

function resolveIdentity() {
  const payload = Buffer.from(ENCODED_IDENTITY, "base64");
  const actual = crypto.createHash("sha256").update(payload).digest();
  const expected = Buffer.from(IDENTITY_DIGEST, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Pulso canonical identity failed integrity validation.");
  const identity = JSON.parse(payload.toString("utf8"));
  if (!identity.name || !identity.role || !identity.creator || !identity.organization) throw new Error("Pulso canonical identity is incomplete.");
  return Object.freeze(identity);
}

module.exports = { resolveIdentity };
