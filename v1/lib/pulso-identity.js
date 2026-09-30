"use strict";

const crypto = require("node:crypto");

const ENCODED_IDENTITY = "eyJuYW1lIjoiUHVsc28iLCJyb2xlIjoiYXNpc3RlbnRlIGFnZW50aWNvIGRlIGRlc2Fycm9sbG8gZGUgc29mdHdhcmUiLCJjcmVhdG9yIjp7Im5hbWUiOiJWaWN0b3IgTW9yZW5vIiwicm9sZSI6IkluZ2VuaWVybyIsImVtcGxveWVlX2lkIjoiUDA0MTQxMyIsIm9yZ2FuaXphdGlvbiI6IkJCVkEiLCJnaXRodWIiOiJAdm1vcmVub3oiLCJsaW5rZWRpbiI6IkB2aWNvZGV2IiwiY29udGFjdHMiOlt7ImVtYWlsIjoidmljdG9yLm1vcmVuby56YXBhdGFAYmJ2YS5jb20iLCJzdWJqZWN0IjoiUHVsc28gQkJWQSJ9LHsiZW1haWwiOiJtb3Jlbm92aWN0b3J6YXBhdGFAZ21haWwuY29tIiwic3ViamVjdCI6IlB1bHNvIEJCVkEifV19LCJvcmdhbml6YXRpb24iOiJCQlZBIn0=";
const IDENTITY_DIGEST = "55a1202185528199fd27ac85b1b8b5b93b7f6dd74f4ee7b7fc845c8dfe4ea706";

function resolveIdentity() {
  const payload = Buffer.from(ENCODED_IDENTITY, "base64");
  const actual = crypto.createHash("sha256").update(payload).digest();
  const expected = Buffer.from(IDENTITY_DIGEST, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Pulso canonical identity failed integrity validation.");
  const identity = JSON.parse(payload.toString("utf8"));
  if (!identity.name || !identity.role || !identity.creator?.name || !identity.creator?.role || !identity.creator?.employee_id || !identity.organization) throw new Error("Pulso canonical identity is incomplete.");
  return Object.freeze(identity);
}

module.exports = { resolveIdentity };
