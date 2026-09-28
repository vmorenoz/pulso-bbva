import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { SpecialistId } from "../../../orchestration/src/protocol/schemas";

export type TransportPhase = "prepared" | "claimed" | "closed" | "expired";
export type ReceiptPhase = "none" | "captured" | "applied" | "rejected";

export type NativeDelegation = {
  delegationId: string;
  workspaceId: string;
  parentSessionId: string;
  requestMessageId: string;
  requestHash: string;
  workId: string;
  workItemId: string;
  specialist: SpecialistId;
  taskWire: string;
  taskHash: string;
  preparedAt: string;
  preparationExpiresAt: string;
  transportPhase: TransportPhase;
  ownerInstanceId?: string;
  parentCallId?: string;
  childSessionId?: string;
  bindingId?: string;
  dispatchedAt?: string;
  deadlineAt?: string;
  lastNativeObservationAt?: string;
  lastHeartbeatAt?: string;
  sideEffectsMayContinue: boolean;
  resultHash?: string;
  receiptHash?: string;
  receiptJson?: string;
  receiptPhase: ReceiptPhase;
  errorJson?: string;
  version: number;
};

/** A host hook replay may inspect its claim, but it never authorizes task dispatch. */
export type NativeClaim = NativeDelegation & { dispatchAllowed: boolean };

export type NativeResource = {
  path: string;
  coverage: "exact" | "tree" | "workspace";
  access: "read" | "write";
  mode: "read" | "files" | "exclusive";
};

type Row = Record<string, unknown>;
type Preparation = Omit<
  NativeDelegation,
  "transportPhase" | "receiptPhase" | "sideEffectsMayContinue" | "version"
>;

const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

export const nativeReceiptHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const rejectedNativeReceiptHash = (input: {
  delegationId: string;
  stage: string;
  code: string;
  rawResultHash: string;
}) =>
  nativeReceiptHash({
    delegationId: input.delegationId,
    stage: input.stage,
    code: input.code,
    rawResultHash: input.rawResultHash,
  });

const decode = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const pathsOverlap = (
  left: string,
  leftCoverage: string,
  right: string,
  rightCoverage: string,
) => {
  if (!left || !right || left === right) return true;
  const leftPrefix = left.endsWith("/") ? left : `${left}/`;
  const rightPrefix = right.endsWith("/") ? right : `${right}/`;
  return (
    (leftCoverage === "tree" && right.startsWith(leftPrefix)) ||
    (rightCoverage === "tree" && left.startsWith(rightPrefix))
  );
};

/**
 * Transport-only durable state. Work state remains exclusively in work.db.
 * This connection deliberately points at runtime-bindings.db, not another DB.
 */
export class NativeJournal {
  private readonly db: Database;
  private transactionTail = Promise.resolve();

  constructor(readonly databasePath: string) {
    this.db = new Database(databasePath, { create: true });
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 100;",
    );
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS native_journal_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const initialMigration = this.db
      .query("SELECT 1 FROM native_journal_migrations WHERE version = 1")
      .get();
    if (!initialMigration) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(`
        CREATE TABLE native_session_works (
          workspace_id TEXT NOT NULL,
          parent_session_id TEXT NOT NULL,
          work_id TEXT NOT NULL,
          associated_at TEXT NOT NULL,
          PRIMARY KEY(workspace_id, parent_session_id, work_id)
        );
        CREATE TABLE native_current_work (
          workspace_id TEXT NOT NULL,
          parent_session_id TEXT NOT NULL,
          work_id TEXT NOT NULL,
          PRIMARY KEY(workspace_id, parent_session_id),
          FOREIGN KEY(workspace_id, parent_session_id, work_id)
            REFERENCES native_session_works(workspace_id, parent_session_id, work_id)
        );
        CREATE TABLE native_delegations (
          delegation_id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          parent_session_id TEXT NOT NULL,
          request_message_id TEXT NOT NULL,
          request_hash TEXT NOT NULL,
          work_id TEXT NOT NULL,
          work_item_id TEXT NOT NULL,
          specialist TEXT NOT NULL,
          task_wire TEXT NOT NULL,
          task_hash TEXT NOT NULL,
          prepared_at TEXT NOT NULL,
          preparation_expires_at TEXT NOT NULL,
          transport_phase TEXT NOT NULL CHECK(transport_phase IN ('prepared','claimed','closed','expired')),
          owner_instance_id TEXT,
          parent_call_id TEXT,
          child_session_id TEXT,
          binding_id TEXT,
          dispatched_at TEXT,
           deadline_at TEXT,
           last_native_observation_at TEXT,
           receipt_hash TEXT,
          receipt_json TEXT,
          receipt_phase TEXT NOT NULL CHECK(receipt_phase IN ('none','captured','applied','rejected')),
          error_json TEXT,
          version INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX idx_native_delegations_request
          ON native_delegations(workspace_id, parent_session_id, request_message_id, request_hash);
        CREATE UNIQUE INDEX idx_native_delegations_call
          ON native_delegations(workspace_id, parent_session_id, parent_call_id)
          WHERE parent_call_id IS NOT NULL;
        CREATE UNIQUE INDEX idx_native_delegations_open_item
          ON native_delegations(workspace_id, work_item_id)
          WHERE transport_phase IN ('prepared','claimed');
        CREATE UNIQUE INDEX idx_native_delegations_shell_claim
          ON native_delegations(workspace_id)
          WHERE transport_phase = 'claimed' AND specialist IN ('executor','verifier');
        CREATE INDEX idx_native_delegations_work
          ON native_delegations(workspace_id, work_id, prepared_at);
      `);
        this.db
          .query(
            "INSERT INTO native_journal_migrations(version, applied_at) VALUES(1, datetime('now'))",
          )
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const recoveryMigration = this.db
      .query("SELECT 1 FROM native_journal_migrations WHERE version = 2")
      .get();
    if (!recoveryMigration) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(`
          ALTER TABLE native_delegations
            ADD COLUMN last_heartbeat_at TEXT;
          ALTER TABLE native_delegations
            ADD COLUMN side_effects_may_continue INTEGER NOT NULL DEFAULT 0;
        `);
        this.db
          .query(
            "INSERT INTO native_journal_migrations(version, applied_at) VALUES(2, datetime('now'))",
          )
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const requestIdentityMigration = this.db
      .query("SELECT 1 FROM native_journal_migrations WHERE version = 3")
      .get();
    if (!requestIdentityMigration) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(`
          DROP INDEX IF EXISTS idx_native_delegations_request;
          CREATE UNIQUE INDEX idx_native_delegations_request
            ON native_delegations(workspace_id, parent_session_id, request_message_id, request_hash);
        `);
        this.db
          .query(
            "INSERT INTO native_journal_migrations(version, applied_at) VALUES(3, datetime('now'))",
          )
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    const receiptHashMigration = this.db
      .query("SELECT 1 FROM native_journal_migrations WHERE version = 4")
      .get();
    if (!receiptHashMigration) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(`
          ALTER TABLE native_delegations
            ADD COLUMN result_hash TEXT;
        `);
        this.db
          .query(
            "INSERT INTO native_journal_migrations(version, applied_at) VALUES(4, datetime('now'))",
          )
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    // The unique shell-claim index is replaced only alongside transactional
    // reservations. Keeping both would silently retain the old one-writer rule.
    const reservationsMigration = this.db
      .query("SELECT 1 FROM native_journal_migrations WHERE version = 5")
      .get();
    if (!reservationsMigration) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec(`
          CREATE TABLE native_resource_reservations (
            delegation_id TEXT NOT NULL REFERENCES native_delegations(delegation_id) ON DELETE CASCADE,
            workspace_id TEXT NOT NULL,
            path TEXT NOT NULL,
            coverage TEXT NOT NULL CHECK(coverage IN ('exact','tree','workspace')),
            access TEXT NOT NULL CHECK(access IN ('read','write')),
            mode TEXT NOT NULL CHECK(mode IN ('read','files','exclusive')),
            state TEXT NOT NULL CHECK(state IN ('active','released')),
            created_at TEXT NOT NULL,
            PRIMARY KEY(delegation_id,path)
          );
          CREATE INDEX idx_native_reservations_workspace
            ON native_resource_reservations(workspace_id,state);
          DROP INDEX IF EXISTS idx_native_delegations_shell_claim;
        `);
        this.db
          .query(
            "INSERT INTO native_journal_migrations(version, applied_at) VALUES(5, datetime('now'))",
          )
          .run();
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  async associateWork(input: {
    workspaceId: string;
    parentSessionId: string;
    workId: string;
    associatedAt: string;
    current?: boolean;
  }) {
    return this.transaction(() => {
      this.db
        .query(
          `INSERT OR IGNORE INTO native_session_works
           (workspace_id,parent_session_id,work_id,associated_at) VALUES(?,?,?,?)`,
        )
        .run(
          input.workspaceId,
          input.parentSessionId,
          input.workId,
          input.associatedAt,
        );
      if (input.current !== false)
        this.db
          .query(
            `INSERT INTO native_current_work(workspace_id,parent_session_id,work_id)
             VALUES(?,?,?)
             ON CONFLICT(workspace_id,parent_session_id) DO UPDATE SET work_id=excluded.work_id`,
          )
          .run(input.workspaceId, input.parentSessionId, input.workId);
    });
  }

  async currentWork(workspaceId: string, parentSessionId: string) {
    const row = this.db
      .query(
        "SELECT work_id FROM native_current_work WHERE workspace_id=? AND parent_session_id=?",
      )
      .get(workspaceId, parentSessionId) as Row | null;
    return decode(row?.work_id);
  }

  async ownsWork(workspaceId: string, parentSessionId: string, workId: string) {
    return Boolean(
      this.db
        .query(
          `SELECT 1 FROM native_session_works
           WHERE workspace_id=? AND parent_session_id=? AND work_id=?`,
        )
        .get(workspaceId, parentSessionId, workId),
    );
  }

  async createPreparation(input: Preparation): Promise<NativeDelegation> {
    return this.transaction(() => {
      const request = this.db
        .query(
          `SELECT * FROM native_delegations
           WHERE workspace_id=? AND parent_session_id=? AND request_message_id=? AND request_hash=?`,
        )
        .get(
          input.workspaceId,
          input.parentSessionId,
          input.requestMessageId,
          input.requestHash,
        ) as Row | null;
      if (request) return this.row(request);
      const open = this.db
        .query(
          `SELECT delegation_id FROM native_delegations
           WHERE workspace_id=? AND work_item_id=? AND transport_phase IN ('prepared','claimed')`,
        )
        .get(input.workspaceId, input.workItemId) as Row | null;
      if (open) throw new Error("PREPARATION_CONFLICT");
      this.db
        .query(
          `INSERT INTO native_delegations(
            delegation_id,workspace_id,parent_session_id,request_message_id,request_hash,
            work_id,work_item_id,specialist,task_wire,task_hash,prepared_at,
            preparation_expires_at,transport_phase,receipt_phase,version)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'none',1)`,
        )
        .run(
          input.delegationId,
          input.workspaceId,
          input.parentSessionId,
          input.requestMessageId,
          input.requestHash,
          input.workId,
          input.workItemId,
          input.specialist,
          input.taskWire,
          input.taskHash,
          input.preparedAt,
          input.preparationExpiresAt,
          "prepared",
        );
      return this.require(input.delegationId);
    });
  }

  async expirePreparations(now: string) {
    return this.transaction(() => {
      const result = this.db
        .query(
          `UPDATE native_delegations SET transport_phase='expired', version=version+1
           WHERE transport_phase='prepared' AND preparation_expires_at<=?`,
        )
        .run(now) as { changes: number };
      return result.changes;
    });
  }

  async claim(input: {
    delegationId: string;
    workspaceId: string;
    parentSessionId: string;
    parentCallId: string;
    ownerInstanceId: string;
    now: string;
    deadlineAt: string;
    resources?: NativeResource[];
  }): Promise<NativeClaim> {
    return this.transaction(() => {
      const current = this.require(input.delegationId);
      if (
        current.workspaceId !== input.workspaceId ||
        current.parentSessionId !== input.parentSessionId
      )
        throw new Error("PREPARATION_OWNERSHIP_MISMATCH");
      if (current.transportPhase !== "prepared") {
        if (current.parentCallId === input.parentCallId)
          return {
            ...(current.transportPhase === "claimed"
              ? this.adoptClaimInTransaction(current, input.ownerInstanceId)
              : current),
            dispatchAllowed: false,
          };
        throw new Error("PREPARATION_ALREADY_CONSUMED");
      }
      if (current.preparationExpiresAt <= input.now) {
        this.db
          .query(
            `UPDATE native_delegations SET transport_phase='expired',version=version+1
             WHERE delegation_id=? AND transport_phase='prepared' AND version=?`,
          )
          .run(input.delegationId, current.version);
        throw new Error("PREPARATION_EXPIRED");
      }
      const resources = input.resources?.length
        ? input.resources
        : [
            {
              path: "",
              coverage: "workspace",
              access: "write",
              mode: "exclusive",
            } satisfies NativeResource,
          ];
      if (
        resources.some(
          (resource) =>
            resource.mode === "files" &&
            (resource.coverage !== "exact" || resource.access !== "write"),
        )
      )
        throw new Error("RESOURCE_POLICY_INVALID");
      if (
        resources.some((resource) => resource.mode === "exclusive") &&
        resources.length !== 1
      )
        throw new Error("RESOURCE_POLICY_INVALID");
      const activeCount = this.db
        .query(`SELECT COUNT(DISTINCT d.delegation_id) AS count
        FROM native_delegations d LEFT JOIN native_resource_reservations r
        ON r.delegation_id=d.delegation_id AND r.state='active'
        WHERE d.workspace_id=? AND d.transport_phase='claimed'`)
        .get(input.workspaceId) as Row;
      if (Number(activeCount.count) >= 4)
        throw new Error("WORKSPACE_ACTIVE_LIMIT");
      const active = this.db
        .query(`SELECT d.delegation_id,r.path,r.coverage,r.access,r.mode
        FROM native_delegations d LEFT JOIN native_resource_reservations r
        ON r.delegation_id=d.delegation_id AND r.state='active'
        WHERE d.workspace_id=? AND d.transport_phase='claimed' AND d.delegation_id<>?`)
        .all(input.workspaceId, input.delegationId) as Row[];
      for (const wanted of resources) {
        for (const existing of active) {
          const existingMode = String(existing.mode ?? "exclusive");
          const existingPath = String(existing.path ?? "");
          if (wanted.mode === "exclusive" || existingMode === "exclusive") {
            if (
              !input.resources?.length &&
              (current.specialist === "executor" ||
                current.specialist === "verifier")
            )
              throw new Error("SHELL_SPECIALIST_LIMIT");
            throw new Error("RESOURCE_CONFLICT");
          }
          if (
            (wanted.mode !== "read" || existingMode !== "read") &&
            pathsOverlap(
              wanted.path,
              wanted.coverage,
              existingPath,
              String(existing.coverage ?? "workspace"),
            )
          )
            throw new Error("RESOURCE_CONFLICT");
          if (
            wanted.mode === "files" &&
            existingMode === "files" &&
            pathsOverlap(
              wanted.path,
              wanted.coverage,
              existingPath,
              String(existing.coverage),
            )
          )
            throw new Error("RESOURCE_CONFLICT");
        }
      }
      try {
        const result = this.db
          .query(
            `UPDATE native_delegations
             SET transport_phase='claimed',owner_instance_id=?,parent_call_id=?,dispatched_at=?,deadline_at=?,version=version+1
             WHERE delegation_id=? AND transport_phase='prepared' AND version=?`,
          )
          .run(
            input.ownerInstanceId,
            input.parentCallId,
            input.now,
            input.deadlineAt,
            input.delegationId,
            current.version,
          ) as { changes: number };
        if (result.changes !== 1) throw new Error("CLAIM_LOST");
        for (const resource of resources)
          this.db
            .query(`INSERT INTO native_resource_reservations
        (delegation_id,workspace_id,path,coverage,access,mode,state,created_at)
        VALUES(?,?,?,?,?,?,'active',?)`)
            .run(
              input.delegationId,
              input.workspaceId,
              resource.path,
              resource.coverage,
              resource.access,
              resource.mode,
              input.now,
            );
      } catch (error) {
        if (String(error).includes("UNIQUE constraint failed"))
          throw new Error("SHELL_SPECIALIST_LIMIT");
        throw error;
      }
      return { ...this.require(input.delegationId), dispatchAllowed: true };
    });
  }

  async releaseReservations(delegationId: string) {
    return this.transaction(() => {
      const delegation = this.require(delegationId);
      if (
        delegation.transportPhase !== "closed" ||
        delegation.sideEffectsMayContinue
      )
        throw new Error("RESERVATION_AUTHORITY_ACTIVE");
      return this.db
        .query(`UPDATE native_resource_reservations
          SET state='released' WHERE delegation_id=? AND state='active'`)
        .run(delegationId);
    });
  }

  async reservations(workspaceId: string) {
    return this.db
      .query(`SELECT delegation_id AS delegationId,path,coverage,access,mode,state,created_at AS createdAt
      FROM native_resource_reservations WHERE workspace_id=? ORDER BY created_at,delegation_id,path`)
      .all(workspaceId) as Array<Record<string, unknown>>;
  }

  async attachBinding(input: {
    delegationId: string;
    ownerInstanceId: string;
    bindingId: string;
    version: number;
  }) {
    return this.compareAndSet(
      input.delegationId,
      input.ownerInstanceId,
      input.version,
      {
        bindingId: input.bindingId,
      },
    );
  }

  /** A restart may fence an old in-memory owner only for its exact host call. */
  async adoptClaim(input: {
    delegationId: string;
    workspaceId: string;
    parentSessionId: string;
    parentCallId: string;
    ownerInstanceId: string;
  }) {
    return this.transaction(() => {
      const current = this.require(input.delegationId);
      if (
        current.workspaceId !== input.workspaceId ||
        current.parentSessionId !== input.parentSessionId ||
        current.parentCallId !== input.parentCallId
      )
        throw new Error("PREPARATION_OWNERSHIP_MISMATCH");
      if (current.transportPhase !== "claimed") return current;
      return this.adoptClaimInTransaction(current, input.ownerInstanceId);
    });
  }

  async observe(input: {
    delegationId: string;
    ownerInstanceId: string;
    version: number;
    childSessionId?: string;
    observedAt: string;
  }) {
    return this.compareAndSet(
      input.delegationId,
      input.ownerInstanceId,
      input.version,
      {
        childSessionId: input.childSessionId,
        lastNativeObservationAt: input.observedAt,
      },
    );
  }

  async recordHeartbeat(input: {
    delegationId: string;
    ownerInstanceId: string;
    version: number;
    renewedAt: string;
  }) {
    return this.compareAndSet(
      input.delegationId,
      input.ownerInstanceId,
      input.version,
      { lastHeartbeatAt: input.renewedAt },
    );
  }

  async captureReceipt(input: {
    delegationId: string;
    ownerInstanceId: string;
    version: number;
    resultHash: string;
    receiptHash: string;
    receiptJson: string;
  }) {
    return this.transaction(() => {
      const current = this.require(input.delegationId);
      if (
        current.receiptHash &&
        (current.receiptHash !== input.receiptHash ||
          current.resultHash !== input.resultHash)
      )
        throw new Error("RESULT_REPLAY_CONFLICT");
      if (current.receiptHash === input.receiptHash) return current;
      return this.compareAndSetInTransaction(
        current,
        input.ownerInstanceId,
        input.version,
        {
          resultHash: input.resultHash,
          receiptHash: input.receiptHash,
          receiptJson: input.receiptJson,
          receiptPhase: "captured",
        },
      );
    });
  }

  async finishReceipt(input: {
    delegationId: string;
    ownerInstanceId: string;
    version: number;
    phase: Extract<ReceiptPhase, "applied" | "rejected">;
    receiptJson?: string;
    errorJson?: string;
  }) {
    return this.compareAndSet(
      input.delegationId,
      input.ownerInstanceId,
      input.version,
      {
        transportPhase: "closed",
        receiptPhase: input.phase,
        receiptJson: input.receiptJson,
        errorJson: input.errorJson,
        sideEffectsMayContinue: false,
      },
    );
  }

  /** Captures a rejection before its authoritative binding transition. */
  async captureRejection(input: {
    delegationId: string;
    ownerInstanceId: string;
    version: number;
    stage: string;
    code: string;
    rawResultHash: string;
    diagnosticHash?: string;
    paths?: string[];
    ids: {
      delegationId: string;
      specialist: string;
      workId: string;
      workItemId: string;
    };
  }) {
    const receiptHash = rejectedNativeReceiptHash({
      delegationId: input.delegationId,
      stage: input.stage,
      code: input.code,
      rawResultHash: input.rawResultHash,
    });
    const receipt = JSON.stringify({
      delegationId: input.delegationId,
      stage: input.stage,
      code: input.code,
      rawResultHash: input.rawResultHash,
      receiptHash,
      ...(input.diagnosticHash ? { diagnosticHash: input.diagnosticHash } : {}),
      paths: input.paths ?? [],
      ids: input.ids,
    });
    return this.transaction(() => {
      const current = this.require(input.delegationId);
      if (current.receiptHash && current.receiptHash !== receiptHash)
        throw new Error("RESULT_REPLAY_CONFLICT");
      if (current.receiptHash === receiptHash) return current;
      return this.compareAndSetInTransaction(
        current,
        input.ownerInstanceId,
        input.version,
        {
          receiptHash,
          receiptJson: receipt,
          receiptPhase: "captured",
          errorJson: receipt,
        },
      );
    });
  }

  async reject(input: {
    delegationId: string;
    ownerInstanceId: string;
    stage: string;
    code: string;
    rawResultHash?: string;
    paths?: string[];
    retainClaim?: boolean;
    sideEffectsMayContinue?: boolean;
  }) {
    return this.transaction(() => {
      const current = this.require(input.delegationId);
      const rawResultHash = input.rawResultHash ?? nativeReceiptHash(null);
      const receiptHash = rejectedNativeReceiptHash({
        delegationId: input.delegationId,
        stage: input.stage,
        code: input.code,
        rawResultHash,
      });
      const receipt = JSON.stringify({
        delegationId: input.delegationId,
        stage: input.stage,
        code: input.code,
        rawResultHash,
        receiptHash,
        paths: input.paths ?? [],
        ids: {
          delegationId: current.delegationId,
          specialist: current.specialist,
          workId: current.workId,
          workItemId: current.workItemId,
        },
      });
      if (current.receiptHash) {
        if (
          current.receiptPhase === "rejected" &&
          current.receiptHash !== receiptHash
        )
          throw new Error("RESULT_REPLAY_CONFLICT");
        if (!input.retainClaim && current.transportPhase === "claimed")
          return this.compareAndSetInTransaction(
            current,
            input.ownerInstanceId,
            current.version,
            {
              transportPhase: "closed",
              sideEffectsMayContinue: false,
            },
          );
        if (input.sideEffectsMayContinue && !current.sideEffectsMayContinue)
          return this.compareAndSetInTransaction(
            current,
            input.ownerInstanceId,
            current.version,
            {
              sideEffectsMayContinue: true,
              errorJson: receipt,
            },
          );
        return current;
      }
      const captured = this.compareAndSetInTransaction(
        current,
        input.ownerInstanceId,
        current.version,
        {
          receiptHash,
          receiptJson: receipt,
          receiptPhase: "rejected",
          ...(input.retainClaim ? {} : { transportPhase: "closed" }),
          errorJson: receipt,
          sideEffectsMayContinue: input.sideEffectsMayContinue ?? false,
        },
      );
      return captured;
    });
  }

  async closeDispatchFailure(
    delegationId: string,
    ownerInstanceId: string,
    code: string,
  ) {
    return this.transaction(() => {
      const current = this.require(delegationId);
      if (current.transportPhase === "closed") return current;
      if (current.sideEffectsMayContinue) return current;
      return this.compareAndSetInTransaction(
        current,
        ownerInstanceId,
        current.version,
        {
          transportPhase: "closed",
          errorJson: JSON.stringify({ stage: "native_dispatch", code }),
        },
      );
    });
  }

  async diagnose(input: {
    delegationId: string;
    ownerInstanceId: string;
    version: number;
    errorJson: string;
    sideEffectsMayContinue?: boolean;
  }) {
    return this.compareAndSet(
      input.delegationId,
      input.ownerInstanceId,
      input.version,
      {
        errorJson: input.errorJson,
        sideEffectsMayContinue: input.sideEffectsMayContinue,
      },
    );
  }

  async get(delegationId: string) {
    const row = this.db
      .query("SELECT * FROM native_delegations WHERE delegation_id=?")
      .get(delegationId) as Row | null;
    return row ? this.row(row) : undefined;
  }

  async getByCall(
    workspaceId: string,
    parentSessionId: string,
    parentCallId: string,
  ) {
    const row = this.db
      .query(
        `SELECT * FROM native_delegations WHERE workspace_id=? AND parent_session_id=? AND parent_call_id=?`,
      )
      .get(workspaceId, parentSessionId, parentCallId) as Row | null;
    return row ? this.row(row) : undefined;
  }

  /** Returns a child-session match only when it is unique within the workspace. */
  async getByChildSession(workspaceId: string, childSessionId: string) {
    const rows = this.db
      .query(
        `SELECT * FROM native_delegations
         WHERE workspace_id=? AND child_session_id=? LIMIT 2`,
      )
      .all(workspaceId, childSessionId) as Row[];
    return rows.length === 1 ? this.row(rows[0]) : undefined;
  }

  async getByTaskWire(
    workspaceId: string,
    parentSessionId: string,
    taskWire: string,
  ) {
    const rows = this.db
      .query(
        `SELECT * FROM native_delegations
         WHERE workspace_id=? AND parent_session_id=? AND task_wire=? LIMIT 2`,
      )
      .all(workspaceId, parentSessionId, taskWire) as Row[];
    // A corrupt or manually duplicated wire is not a durable authorization.
    return rows.length === 1 ? this.row(rows[0]) : undefined;
  }

  async list(workspaceId: string, parentSessionId: string) {
    return (
      this.db
        .query(
          `SELECT * FROM native_delegations WHERE workspace_id=? AND parent_session_id=? ORDER BY prepared_at DESC`,
        )
        .all(workspaceId, parentSessionId) as Row[]
    ).map((row) => this.row(row));
  }

  close() {
    this.db.close();
  }

  private compareAndSet(
    delegationId: string,
    ownerInstanceId: string,
    version: number,
    patch: Partial<NativeDelegation>,
  ) {
    return this.transaction(() =>
      this.compareAndSetInTransaction(
        this.require(delegationId),
        ownerInstanceId,
        version,
        patch,
      ),
    );
  }

  private compareAndSetInTransaction(
    current: NativeDelegation,
    ownerInstanceId: string,
    version: number,
    patch: Partial<NativeDelegation>,
  ) {
    if (current.ownerInstanceId !== ownerInstanceId)
      throw new Error("CLAIM_OWNERSHIP_LOST");
    const candidates: Array<[string, string | number | undefined]> = [
      ["transport_phase", patch.transportPhase],
      ["receipt_phase", patch.receiptPhase],
      ["child_session_id", patch.childSessionId],
      ["binding_id", patch.bindingId],
      ["last_native_observation_at", patch.lastNativeObservationAt],
      ["last_heartbeat_at", patch.lastHeartbeatAt],
      [
        "side_effects_may_continue",
        patch.sideEffectsMayContinue === undefined
          ? undefined
          : Number(patch.sideEffectsMayContinue),
      ],
      ["result_hash", patch.resultHash],
      ["receipt_hash", patch.receiptHash],
      ["receipt_json", patch.receiptJson],
      ["error_json", patch.errorJson],
    ];
    const columns = candidates.filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined,
    );
    if (!columns.length) return current;
    const values = columns.map(([, value]) => value);
    const result = this.db
      .query(
        `UPDATE native_delegations SET ${columns
          .map(([column]) => `${column}=?`)
          .join(",")},version=version+1
         WHERE delegation_id=? AND owner_instance_id=? AND version=?`,
      )
      .run(...values, current.delegationId, ownerInstanceId, version) as {
      changes: number;
    };
    if (result.changes !== 1) throw new Error("JOURNAL_CAS_CONFLICT");
    const updated = this.require(current.delegationId);
    if (updated.transportPhase === "closed" && !updated.sideEffectsMayContinue)
      this.db
        .query(
          "UPDATE native_resource_reservations SET state='released' WHERE delegation_id=? AND state='active'",
        )
        .run(current.delegationId);
    return updated;
  }

  private adoptClaimInTransaction(
    current: NativeDelegation,
    ownerInstanceId: string,
  ) {
    if (current.ownerInstanceId === ownerInstanceId) return current;
    const result = this.db
      .query(
        `UPDATE native_delegations SET owner_instance_id=?,version=version+1
         WHERE delegation_id=? AND transport_phase='claimed' AND version=?`,
      )
      .run(ownerInstanceId, current.delegationId, current.version) as {
      changes: number;
    };
    if (result.changes !== 1) throw new Error("JOURNAL_CAS_CONFLICT");
    return this.require(current.delegationId);
  }

  private require(delegationId: string) {
    const row = this.db
      .query("SELECT * FROM native_delegations WHERE delegation_id=?")
      .get(delegationId) as Row | null;
    if (!row) throw new Error("DELEGATION_NOT_FOUND");
    return this.row(row);
  }

  private row(row: Row): NativeDelegation {
    return {
      delegationId: String(row.delegation_id),
      workspaceId: String(row.workspace_id),
      parentSessionId: String(row.parent_session_id),
      requestMessageId: String(row.request_message_id),
      requestHash: String(row.request_hash),
      workId: String(row.work_id),
      workItemId: String(row.work_item_id),
      specialist: row.specialist as SpecialistId,
      taskWire: String(row.task_wire),
      taskHash: String(row.task_hash),
      preparedAt: String(row.prepared_at),
      preparationExpiresAt: String(row.preparation_expires_at),
      transportPhase: row.transport_phase as TransportPhase,
      ownerInstanceId: decode(row.owner_instance_id),
      parentCallId: decode(row.parent_call_id),
      childSessionId: decode(row.child_session_id),
      bindingId: decode(row.binding_id),
      dispatchedAt: decode(row.dispatched_at),
      deadlineAt: decode(row.deadline_at),
      lastNativeObservationAt: decode(row.last_native_observation_at),
      lastHeartbeatAt: decode(row.last_heartbeat_at),
      sideEffectsMayContinue: Number(row.side_effects_may_continue) === 1,
      resultHash: decode(row.result_hash),
      receiptHash: decode(row.receipt_hash),
      receiptJson: decode(row.receipt_json),
      receiptPhase: row.receipt_phase as ReceiptPhase,
      errorJson: decode(row.error_json),
      version: Number(row.version),
    };
  }

  private async transaction<T>(fn: () => T): Promise<T> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.transactionTail;
    this.transactionTail = previous.then(
      () => turn,
      () => turn,
    );
    await previous;
    try {
      for (const delay of [0, 20, 50, 100]) {
        if (delay) await pause(delay);
        try {
          this.db.exec("BEGIN IMMEDIATE");
          try {
            const value = fn();
            this.db.exec("COMMIT");
            return value;
          } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
          }
        } catch (error) {
          if (!String(error).includes("database is locked") || delay === 100)
            throw error;
        }
      }
      throw new Error("SQLITE_BUSY");
    } finally {
      release();
    }
  }
}
