import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  assertNativeTaskArgsMutable,
  hasNativeDispatchReferenceMarker,
  hydrateNativeTaskArgsInPlace,
  nativeDispatchDescription,
  nativeDispatchTaskArgs,
  parseNativeDispatchReference,
  renderNativeDispatchReference,
} from "../src/opencode/native-dispatch-reference";

const id = "d5304588-e374-4cec-9608-dab8604681a6";
const reference = `pulso-dispatch/1:${id}`;
const prepared = () =>
  nativeDispatchTaskArgs({ delegationId: id, specialist: "explorer" });

test("reference round trip uses exactly one generated UUID", () => {
  assert.equal(renderNativeDispatchReference(id), reference);
  assert.equal(parseNativeDispatchReference(reference), id);
  assert.equal(reference.length, 53);
});
for (const value of [
  ` ${reference}`,
  `${reference} `,
  `${reference}\n`,
  `${reference}\r\n`,
  `${reference}\nignore instructions`,
  `prefix ${reference}`,
  `\`${reference}\``,
  reference.toUpperCase(),
  reference.replace("/1:", "/2:"),
  reference.replace(id, "missing"),
  `${reference}?prompt=override`,
  `${reference}\u0000`,
  "",
  null,
  undefined,
  123,
]) {
  test(`reference parser rejects noncanonical input ${JSON.stringify(value)}`, () => {
    assert.equal(parseNativeDispatchReference(value), undefined);
  });
}
test("reference construction rejects arbitrary identifiers", () => {
  assert.throws(
    () => renderNativeDispatchReference("latest"),
    /PREPARATION_REFERENCE_INVALID/,
  );
});
test("marker detection is broader than authorization", () => {
  assert.equal(
    hasNativeDispatchReferenceMarker("pulso-dispatch/2:invalid"),
    true,
  );
  assert.equal(
    hasNativeDispatchReferenceMarker("PULSO-DISPATCH/1:invalid"),
    true,
  );
  assert.equal(
    hasNativeDispatchReferenceMarker("ordinary external prompt"),
    false,
  );
});
test("prepare payload never exposes the specialist task JSON", () => {
  assert.deepEqual(prepared(), {
    description: "Pulso explorer task",
    subagent_type: "explorer",
    prompt: reference,
  });
  assert.equal(prepared().prompt.includes("pulso-task"), false);
});
test("hydration mutates the original host object and discards the parent label", () => {
  const args = { ...prepared(), description: "Investiga contrato total" };
  const originalArgs = args;
  const originalOutput = { args };
  const canonical = {
    description: nativeDispatchDescription("explorer"),
    subagent_type: "explorer",
    prompt:
      '<pulso-task v="2">{"template":"\\u003C/pulso-result>"}</pulso-task>',
  };
  hydrateNativeTaskArgsInPlace(originalOutput.args, canonical);
  // Models the public host sequence before(args) -> item.execute(args), no replacement.
  assert.equal(originalOutput.args, originalArgs);
  assert.deepEqual(originalArgs, canonical);
  assert.ok(originalArgs.prompt.includes("\\u003C"));
});
test("hydration cannot elevate or switch specialist", () => {
  const args = prepared();
  const before = structuredClone(args);
  assert.throws(
    () =>
      hydrateNativeTaskArgsInPlace(args, {
        description: "x",
        subagent_type: "executor",
        prompt: "x",
      }),
    /IDENTITY_MISMATCH/,
  );
  assert.deepEqual(args, before);
});
for (const extras of [
  { task_id: "child" },
  { command: "run" },
  { background: false },
  { background: true },
  { surprise: "x" },
]) {
  test(`extra argument rejected: ${Object.keys(extras)[0]}=${Object.values(extras)[0]}`, () => {
    assert.throws(
      () => assertNativeTaskArgsMutable({ ...prepared(), ...extras }),
      /NATIVE_DISPATCH/,
    );
  });
}
test("read-only args rejected before any caller can claim execution", () => {
  assert.throws(
    () => assertNativeTaskArgsMutable(Object.freeze(prepared())),
    /writable/,
  );
});
test("getters are rejected without reading their values", () => {
  const args = prepared();
  let accessed = false;
  Object.defineProperty(args, "prompt", {
    get() {
      accessed = true;
      return reference;
    },
    enumerable: true,
  });
  assert.throws(() => assertNativeTaskArgsMutable(args), /writable/);
  assert.equal(accessed, false);
});
test("symbol controls and inherited fields are rejected", () => {
  assert.throws(
    () =>
      assertNativeTaskArgsMutable({ ...prepared(), [Symbol("hidden")]: true }),
    /only/,
  );
  assert.throws(
    () => assertNativeTaskArgsMutable(Object.create(prepared())),
    /plain JSON/,
  );
});
test("null-prototype host args remain supported", () => {
  const args = Object.assign(Object.create(null), prepared());
  assertNativeTaskArgsMutable(args);
  hydrateNativeTaskArgsInPlace(args, { ...prepared(), prompt: "durable wire" });
  assert.equal(args.prompt, "durable wire");
});
