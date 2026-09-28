import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  NativeJournal,
  type NativeResource,
} from "../src/opencode/native-journal";

const prep = (id: string, session: string) => ({
  delegationId: id,
  workspaceId: "ws",
  parentSessionId: session,
  requestMessageId: `${id}-msg`,
  requestHash: id,
  workId: "work",
  workItemId: id,
  specialist: "executor" as const,
  taskWire: id,
  taskHash: id,
  preparedAt: "2026-01-01T00:00:00.000Z",
  preparationExpiresAt: "2026-01-01T00:02:00.000Z",
});
const resource = (path: string): NativeResource => ({
  path,
  coverage: "exact",
  access: "write",
  mode: "files",
});
const readResource = (path: string): NativeResource => ({
  path,
  coverage: "exact",
  access: "read",
  mode: "read",
});
const claim = (id: string, session: string, resources: NativeResource[]) => ({
  delegationId: id,
  workspaceId: "ws",
  parentSessionId: session,
  parentCallId: `call-${id}`,
  ownerInstanceId: `owner-${id}`,
  now: "2026-01-01T00:00:01.000Z",
  deadlineAt: "2026-01-01T00:30:01.000Z",
  resources,
});

test("independent connections serialize competing claims and allow disjoint file writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pulso-reservations-race-"));
  const path = join(dir, "runtime.db");
  const a = new NativeJournal(path),
    b = new NativeJournal(path);
  try {
    await Promise.all([
      a.createPreparation(prep("a", "s1")),
      b.createPreparation(prep("b", "s2")),
    ]);
    const outcomes = await Promise.allSettled([
      a.claim(claim("a", "s1", [resource("src/a.ts")])),
      b.claim(claim("b", "s2", [resource("src/b.ts")])),
    ]);
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    expect(await a.reservations("ws")).toHaveLength(2);
  } finally {
    b.close();
    a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same-file concurrent claims across sessions have exactly one winner", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pulso-reservations-same-file-race-"));
  const path = join(dir, "runtime.db");
  const a = new NativeJournal(path);
  const b = new NativeJournal(path);
  try {
    await Promise.all([
      a.createPreparation(prep("same-a", "session-a")),
      b.createPreparation(prep("same-b", "session-b")),
    ]);
    const results = await Promise.allSettled([
      a.claim(claim("same-a", "session-a", [resource("src/shared.ts")])),
      b.claim(claim("same-b", "session-b", [resource("src/shared.ts")])),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await a.reservations("ws")).toHaveLength(1);
  } finally {
    b.close();
    a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("overlapping read reservations coexist but reject a write reservation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pulso-reservations-read-read-"));
  const path = join(dir, "runtime.db");
  const a = new NativeJournal(path);
  const b = new NativeJournal(path);
  try {
    await Promise.all([
      a.createPreparation(prep("read-a", "read-session-a")),
      b.createPreparation(prep("read-b", "read-session-b")),
      a.createPreparation(prep("write-c", "write-session-c")),
    ]);
    const readResults = await Promise.all([
      a.claim(
        claim("read-a", "read-session-a", [readResource("src/shared.ts")]),
      ),
      b.claim(
        claim("read-b", "read-session-b", [readResource("src/shared.ts")]),
      ),
    ]);
    expect(readResults).toHaveLength(2);
    await expect(
      a.claim(claim("write-c", "write-session-c", [resource("src/shared.ts")])),
    ).rejects.toThrow("RESOURCE_CONFLICT");
    expect(await a.reservations("ws")).toHaveLength(2);
  } finally {
    b.close();
    a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("same path, read/write, workspace exclusive, and fifth active claim fail closed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pulso-reservations-conflict-"));
  const a = new NativeJournal(join(dir, "runtime.db"));
  try {
    for (let i = 0; i < 6; i++)
      await a.createPreparation(prep(`t${i}`, `s${i}`));
    const first = await a.claim(claim("t0", "s0", [resource("src/shared.ts")]));
    await expect(
      a.claim(claim("t1", "s1", [resource("src/shared.ts")])),
    ).rejects.toThrow("RESOURCE_CONFLICT");
    await expect(
      a.claim(
        claim("t1", "s1", [
          { path: "src", coverage: "tree", access: "read", mode: "read" },
        ]),
      ),
    ).rejects.toThrow("RESOURCE_CONFLICT");
    await a.claim(claim("t2", "s2", [resource("src/other.ts")]));
    await a.claim(claim("t3", "s3", [resource("src/third.ts")]));
    await a.claim(claim("t4", "s4", [resource("src/fourth.ts")]));
    await expect(
      a.claim(claim("t5", "s5", [resource("src/fifth.ts")])),
    ).rejects.toThrow("WORKSPACE_ACTIVE_LIMIT");
    await expect(a.releaseReservations("t0")).rejects.toThrow(
      "RESERVATION_AUTHORITY_ACTIVE",
    );
    if (!first.ownerInstanceId) throw new Error("claim owner missing");
    await a.finishReceipt({
      delegationId: "t0",
      ownerInstanceId: first.ownerInstanceId,
      version: first.version,
      phase: "applied",
    });
    expect(
      (await a.reservations("ws")).filter((r) => r.state === "active"),
    ).toHaveLength(3);
  } finally {
    a.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("expired preparation cannot obtain a reservation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pulso-reservations-expired-"));
  const journal = new NativeJournal(join(dir, "runtime.db"));
  try {
    await journal.createPreparation({
      ...prep("expired", "s"),
      preparationExpiresAt: "2025-01-01T00:00:00.000Z",
    });
    await expect(
      journal.claim(claim("expired", "s", [resource("src/a.ts")])),
    ).rejects.toThrow("PREPARATION_EXPIRED");
    expect(await journal.reservations("ws")).toHaveLength(0);
  } finally {
    journal.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
