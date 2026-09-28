import { Database } from "bun:sqlite";
import type {
  BindingRepository,
  RuntimeExecutionBinding,
  RuntimeExecutionReference,
} from "../index";
import { runtimeReferenceKey } from "../index";

const encode = (value: unknown) => JSON.stringify(value);
const decode = <T>(value: string | null): T | undefined =>
  value === null ? undefined : (JSON.parse(value) as T);
const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type ReservationInput = {
  bindingId: string;
  runtime: RuntimeExecutionReference;
  workId: string;
  workItemId: string;
  executorId: string;
  assigneeId: string;
  requestHash: string;
  managedBy: "mcp" | "opencode-native";
  creationToken: string;
  createdAt: string;
  creationExpiresAt: string;
};

/** SQLite persistence for short-lived reservations and durable runtime bindings. */
export class SqliteBindingStore implements BindingRepository {
  private readonly db: Database;
  private transactionTail = Promise.resolve();

  constructor(readonly databasePath: string) {
    this.db = new Database(databasePath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 100;");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_bindings (
        binding_id TEXT PRIMARY KEY,
        runtime_provider TEXT NOT NULL,
        runtime_execution_id TEXT NOT NULL,
        runtime_session_id TEXT,
        runtime_metadata TEXT,
        runtime_key TEXT NOT NULL UNIQUE,
        work_id TEXT,
        work_item_id TEXT NOT NULL,
        assignment_id TEXT,
        execution_id TEXT,
        lease_id TEXT,
        fencing_token INTEGER,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('creating','active','completed','failed','cancelled','blocked','waiting','lost'))
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_bindings_status ON runtime_bindings(status);
      CREATE TABLE IF NOT EXISTS runtime_binding_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const columns = () =>
      new Set(
        (
          this.db.query("PRAGMA table_info(runtime_bindings)").all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      );
    const apply = (version: number, migrate: () => void) => {
      if (
        this.db
          .query("SELECT 1 FROM runtime_binding_migrations WHERE version = ?")
          .get(version)
      )
        return;
      this.db.exec("BEGIN");
      try {
        migrate();
        this.db
          .query(
            "INSERT INTO runtime_binding_migrations(version, applied_at) VALUES (?, datetime('now'))",
          )
          .run(version);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    };
    apply(1, () => {
      const add = (definition: string) => {
        const name = definition.split(" ")[0];
        if (!columns().has(name))
          this.db.exec(`ALTER TABLE runtime_bindings ADD COLUMN ${definition}`);
      };
      add("executor_id TEXT");
      add("assignee_id TEXT");
      add("request_hash TEXT");
      add("managed_by TEXT");
      add("creation_token TEXT");
      add("creation_expires_at TEXT");
      add("terminal_result TEXT");
      add("version INTEGER NOT NULL DEFAULT 1");
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_runtime_bindings_creating ON runtime_bindings(status, creation_expires_at)",
      );
    });
  }

  async reserve(input: ReservationInput): Promise<RuntimeExecutionBinding> {
    return this.transaction(() => {
      const existing = this.db
        .query("SELECT * FROM runtime_bindings WHERE runtime_key = ?")
        .get(runtimeReferenceKey(input.runtime)) as Record<
        string,
        unknown
      > | null;
      if (existing) return this.row(existing);
      this.db
        .query(`INSERT INTO runtime_bindings
          (binding_id,runtime_provider,runtime_execution_id,runtime_session_id,runtime_metadata,runtime_key,work_id,work_item_id,executor_id,assignee_id,request_hash,managed_by,creation_token,creation_expires_at,created_at,status,version)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`)
        .run(
          input.bindingId,
          input.runtime.provider,
          input.runtime.executionId,
          input.runtime.sessionId ?? null,
          input.runtime.metadata ? encode(input.runtime.metadata) : null,
          runtimeReferenceKey(input.runtime),
          input.workId,
          input.workItemId,
          input.executorId,
          input.assigneeId,
          input.requestHash,
          input.managedBy,
          input.creationToken,
          input.creationExpiresAt,
          input.createdAt,
          "creating",
        );
      return this.require(input.bindingId);
    });
  }

  async finalize(
    binding: RuntimeExecutionBinding,
    creationToken: string,
  ): Promise<RuntimeExecutionBinding> {
    return this.transaction(() => {
      const result = this.db
        .query(
          `UPDATE runtime_bindings
           SET work_id=?, work_item_id=?, executor_id=?, assignee_id=?, request_hash=?, managed_by=?, assignment_id=?, execution_id=?, lease_id=?, fencing_token=?, expires_at=?, status='active', creation_token=NULL, creation_expires_at=NULL, version=version+1
           WHERE binding_id=? AND status='creating' AND creation_token=?`,
        )
        .run(
          binding.workId,
          binding.workItemId,
          binding.executorId ?? null,
          binding.assigneeId ?? null,
          binding.requestHash ?? null,
          binding.managedBy ?? null,
          binding.assignmentId ?? null,
          binding.executionId,
          binding.leaseId,
          binding.fencingToken,
          binding.expiresAt,
          binding.bindingId,
          creationToken,
        ) as { changes: number };
      if (result.changes !== 1) throw new Error("BINDING_RESERVATION_LOST");
      return this.require(binding.bindingId);
    });
  }

  async updateHeartbeat(
    bindingId: string,
    expiresAt: string,
    version: number,
  ): Promise<RuntimeExecutionBinding> {
    return this.transaction(() => {
      const result = this.db
        .query(
          "UPDATE runtime_bindings SET expires_at=?, version=version+1 WHERE binding_id=? AND status='active' AND version=?",
        )
        .run(expiresAt, bindingId, version) as { changes: number };
      if (result.changes !== 1) throw new Error("BINDING_CAS_CONFLICT");
      return this.require(bindingId);
    });
  }

  async updateStatus(
    bindingId: string,
    status: RuntimeExecutionBinding["status"],
    version: number,
    terminalResult?: string,
  ): Promise<RuntimeExecutionBinding> {
    return this.transaction(() => {
      const result = this.db
        .query(
          "UPDATE runtime_bindings SET status=?, terminal_result=?, version=version+1 WHERE binding_id=? AND status='active' AND version=?",
        )
        .run(status, terminalResult ?? null, bindingId, version) as {
        changes: number;
      };
      if (result.changes !== 1) throw new Error("BINDING_CAS_CONFLICT");
      return this.require(bindingId);
    });
  }

  async markPendingLost(
    bindingId: string,
    creationToken: string,
    version: number,
    diagnostic: string,
  ): Promise<RuntimeExecutionBinding> {
    return this.transaction(() => {
      const result = this.db
        .query(
          "UPDATE runtime_bindings SET status='lost', terminal_result=?, creation_token=NULL, creation_expires_at=NULL, version=version+1 WHERE binding_id=? AND status='creating' AND creation_token=? AND version=?",
        )
        .run(diagnostic, bindingId, creationToken, version) as {
        changes: number;
      };
      if (result.changes !== 1) throw new Error("BINDING_RESERVATION_LOST");
      return this.require(bindingId);
    });
  }

  async recordPendingDiagnostic(
    bindingId: string,
    creationToken: string,
    diagnostic: string,
  ): Promise<boolean> {
    return this.transaction(() => {
      const result = this.db
        .query(
          "UPDATE runtime_bindings SET terminal_result=?, version=version+1 WHERE binding_id=? AND status='creating' AND creation_token=?",
        )
        .run(diagnostic, bindingId, creationToken) as { changes: number };
      return result.changes === 1;
    });
  }

  async removePending(
    bindingId: string,
    creationToken: string,
  ): Promise<boolean> {
    return this.transaction(() => {
      const result = this.db
        .query(
          "DELETE FROM runtime_bindings WHERE binding_id = ? AND status = 'creating' AND creation_token = ?",
        )
        .run(bindingId, creationToken) as { changes: number };
      return result.changes === 1;
    });
  }

  async get(bindingId: string) {
    return this.one(
      "SELECT * FROM runtime_bindings WHERE binding_id = ?",
      bindingId,
    );
  }

  async getByRuntime(runtime: RuntimeExecutionReference) {
    return this.one(
      "SELECT * FROM runtime_bindings WHERE runtime_key = ?",
      runtimeReferenceKey(runtime),
    );
  }

  async list() {
    return (
      this.db
        .query("SELECT * FROM runtime_bindings ORDER BY created_at, binding_id")
        .all() as Array<Record<string, unknown>>
    ).map((row) => this.row(row));
  }

  diagnostics() {
    const table = this.db
      .query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_bindings'",
      )
      .get();
    const unique = this.db
      .query(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'sqlite_autoindex_runtime_bindings%'",
      )
      .get();
    return {
      database: true,
      schema: Boolean(table),
      runtimeReferenceUniqueness: Boolean(unique),
    };
  }

  close() {
    this.db.close();
  }

  private require(bindingId: string) {
    const binding = this.one(
      "SELECT * FROM runtime_bindings WHERE binding_id = ?",
      bindingId,
    );
    if (!binding) throw new Error("BINDING_RESERVATION_LOST");
    return binding;
  }

  private one(sql: string, ...values: string[]) {
    const row = this.db.query(sql).get(...values) as Record<
      string,
      unknown
    > | null;
    return row ? this.row(row) : undefined;
  }

  private row(row: Record<string, unknown>): RuntimeExecutionBinding {
    return {
      bindingId: row.binding_id as string,
      runtime: {
        provider: row.runtime_provider as string,
        executionId: row.runtime_execution_id as string,
        sessionId: (row.runtime_session_id as string | null) ?? undefined,
        metadata: decode<Record<string, string>>(
          row.runtime_metadata as string | null,
        ),
      },
      workId: (row.work_id as string | null) ?? "",
      workItemId: row.work_item_id as string,
      executorId: (row.executor_id as string | null) ?? undefined,
      assigneeId: (row.assignee_id as string | null) ?? undefined,
      requestHash: (row.request_hash as string | null) ?? undefined,
      managedBy:
        (row.managed_by as RuntimeExecutionBinding["managedBy"]) ?? undefined,
      assignmentId: (row.assignment_id as string | null) ?? undefined,
      executionId: (row.execution_id as string | null) ?? "",
      leaseId: (row.lease_id as string | null) ?? "",
      fencingToken: (row.fencing_token as number | null) ?? 0,
      createdAt: row.created_at as string,
      creationToken: (row.creation_token as string | null) ?? undefined,
      creationExpiresAt:
        (row.creation_expires_at as string | null) ?? undefined,
      expiresAt: (row.expires_at as string | null) ?? "",
      status: row.status as RuntimeExecutionBinding["status"],
      terminalResult: (row.terminal_result as string | null) ?? undefined,
      version: (row.version as number | null) ?? 1,
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
        if (delay) await wait(delay);
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
