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
        workId: "work-a",
        workItemId: "item-a",
        executorId: "executor-a",
        assigneeId: "executor-a",
        requestHash: "request-a",
        managedBy: "mcp",
        creationToken: "token-a",
        createdAt: "2026-01-01T00:00:00.000Z",
        creationExpiresAt: "2026-01-01T00:02:00.000Z",
      });
      const duplicate = await store.reserve({
        bindingId: "binding-b",
        runtime: { provider: "test-runtime", executionId: "execution-a" },
        workId: "work-a",
        workItemId: "item-a",
        executorId: "executor-a",
        assigneeId: "executor-a",
        requestHash: "request-a",
        managedBy: "mcp",
        creationToken: "token-b",
        createdAt: "2026-01-01T00:00:01.000Z",
        creationExpiresAt: "2026-01-01T00:02:01.000Z",
      });
      expect(duplicate?.bindingId).toBe("binding-a");
      if (!duplicate) throw new Error("DUPLICATE_RESERVATION_MISSING");
      await expect(
        store.finalize(
          {
            ...duplicate,
            executionId: "execution-internal",
            leaseId: "lease-a",
            fencingToken: 1,
            expiresAt: "2026-01-01T00:05:00.000Z",
            status: "active",
          },
          "wrong-token",
        ),
      ).rejects.toThrow("BINDING_RESERVATION_LOST");
      expect((await store.get("binding-a"))?.status).toBe("creating");
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
