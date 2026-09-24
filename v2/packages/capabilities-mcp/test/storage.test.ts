import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteBindingStore } from "../src/runtime/bindings/sqlite-binding-store";

describe("runtime binding storage", () => {
  test("persists and uniquely indexes external references", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pulso-bindings-"));
    const store = new SqliteBindingStore(join(dir, "bindings.db"));
    try {
      await store.reserve({
        bindingId: "binding-a",
        runtime: { provider: "test-runtime", executionId: "execution-a" },
        workItemId: "item-a",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      const duplicate = await store.reserve({
        bindingId: "binding-b",
        runtime: { provider: "test-runtime", executionId: "execution-a" },
        workItemId: "item-a",
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      expect(duplicate?.bindingId).toBe("binding-a");
      expect(store.diagnostics()).toEqual({
        database: true,
        schema: true,
        runtimeReferenceUniqueness: true,
      });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
