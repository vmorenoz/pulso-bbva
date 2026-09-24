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

export class SqliteBindingStore implements BindingRepository {
  private readonly db: Database;
  private transactionTail = Promise.resolve();

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 100;");
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
    `);
  }

  async reserve(input: {
    bindingId: string;
    runtime: RuntimeExecutionReference;
    workItemId: string;
    createdAt: string;
  }): Promise<RuntimeExecutionBinding | undefined> {
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
        (binding_id,runtime_provider,runtime_execution_id,runtime_session_id,runtime_metadata,runtime_key,work_item_id,created_at,status)
        VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(
          input.bindingId,
          input.runtime.provider,
          input.runtime.executionId,
          input.runtime.sessionId ?? null,
          input.runtime.metadata ? encode(input.runtime.metadata) : null,
          runtimeReferenceKey(input.runtime),
          input.workItemId,
          input.createdAt,
          "creating",
        );
      return undefined;
    });
  }

  async finalize(binding: RuntimeExecutionBinding): Promise<void> {
    await this.transaction(() => {
      this.db
        .query(
          `UPDATE runtime_bindings SET work_id=?, work_item_id=?, assignment_id=?, execution_id=?, lease_id=?, fencing_token=?, expires_at=?, status=? WHERE binding_id=?`,
        )
        .run(
          binding.workId,
          binding.workItemId,
          binding.assignmentId ?? null,
          binding.executionId,
          binding.leaseId,
          binding.fencingToken,
          binding.expiresAt,
          binding.status,
          binding.bindingId,
        );
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

  async updateStatus(
    bindingId: string,
    status: RuntimeExecutionBinding["status"],
  ) {
    await this.transaction(() => {
      this.db
        .query("UPDATE runtime_bindings SET status = ? WHERE binding_id = ?")
        .run(status, bindingId);
    });
    const binding = await this.get(bindingId);
    if (!binding) throw new Error(`Binding not found: ${bindingId}`);
    return binding;
  }

  async removePending(bindingId: string) {
    await this.transaction(() => {
      this.db
        .query(
          "DELETE FROM runtime_bindings WHERE binding_id = ? AND status = 'creating'",
        )
        .run(bindingId);
    });
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
      workId: row.work_id as string,
      workItemId: row.work_item_id as string,
      assignmentId: (row.assignment_id as string | null) ?? undefined,
      executionId: (row.execution_id as string | null) ?? "",
      leaseId: (row.lease_id as string | null) ?? "",
      fencingToken: row.fencing_token as number,
      createdAt: row.created_at as string,
      expiresAt: row.expires_at as string,
      status: row.status as RuntimeExecutionBinding["status"],
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
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      release();
    }
  }
}
