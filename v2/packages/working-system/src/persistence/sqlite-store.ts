import { Database, type SQLQueryBindings } from "bun:sqlite";
import type {
  Artifact,
  Assignment,
  Execution,
  State,
  Store,
  Work,
  WorkEvent,
  WorkItem,
  WorkLease,
} from "../domain";
import { error, validateAppendOnlyEvents, validateState } from "../domain";

const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: string | null): T | undefined =>
  value === null ? undefined : JSON.parse(value);

/** Relational SQLite adapter. State is a unit-of-work DTO, never a persisted snapshot. */
export class SqliteStore implements Store {
  private db: Database;
  private transactionTail = Promise.resolve();

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 100;",
    );
    this.migrate();
  }

  private migrate() {
    const columns = (table: string) =>
      new Set(
        (
          this.db.query(`PRAGMA table_info(${table})`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      );
    // Upgrade the prototype schema in place; new installations use the full DDL below.
    if (
      columns("schema_migrations").size &&
      !columns("schema_migrations").has("applied_at")
    )
      this.db.exec("ALTER TABLE schema_migrations ADD COLUMN applied_at TEXT");
    const add = (table: string, definition: string) => {
      const name = definition.split(" ")[0];
      if (columns(table).size && !columns(table).has(name))
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    };
    const rename = (table: string, from: string, to: string) => {
      if (columns(table).has(from) && !columns(table).has(to))
        this.db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
    };
    add("works", "title TEXT");
    add("works", "objective TEXT");
    add("works", "created_at TEXT");
    add("works", "started_at TEXT");
    add("works", "completed_at TEXT");
    add("works", "version INTEGER");
    add("work_items", "title TEXT");
    add("work_items", "description TEXT");
    add("work_items", "kind TEXT");
    add("work_items", "created_at TEXT");
    add("work_items", "started_at TEXT");
    add("work_items", "completed_at TEXT");
    add("work_items", "result TEXT");
    add("work_items", "version INTEGER");
    add("work_assignments", "assigned_at TEXT");
    add("work_assignments", "unassigned_at TEXT");
    add("work_assignments", "version INTEGER");
    add("work_executions", "assignment_id TEXT");
    add("work_executions", "external_execution_ref TEXT");
    add("work_executions", "created_at TEXT");
    add("work_executions", "started_at TEXT");
    add("work_executions", "completed_at TEXT");
    add("work_executions", "failure_reason TEXT");
    add("work_executions", "version INTEGER");
    add("work_leases", "acquired_at TEXT");
    add("work_leases", "heartbeat_at TEXT");
    add("work_leases", "fencing_token INTEGER");
    add("work_leases", "version INTEGER");
    add("work_events", "item_id TEXT");
    add("work_events", "execution_id TEXT");
    add("work_events", "type TEXT");
    add("work_events", "actor TEXT");
    add("work_events", "timestamp TEXT");
    add("work_events", "payload TEXT");
    add("work_artifacts", "item_id TEXT");
    add("work_artifacts", "type TEXT");
    add("work_artifacts", "uri TEXT");
    add("work_artifacts", "description TEXT");
    add("work_artifacts", "created_at TEXT");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS works (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, objective TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS work_items (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), title TEXT NOT NULL, description TEXT, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, result TEXT, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS work_item_dependencies (work_item_id TEXT NOT NULL REFERENCES work_items(id), dependency_id TEXT NOT NULL REFERENCES work_items(id), PRIMARY KEY(work_item_id, dependency_id), CHECK(work_item_id <> dependency_id));
      CREATE TABLE IF NOT EXISTS work_assignments (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id), assignee_id TEXT NOT NULL, assignee_type TEXT, assigned_at TEXT NOT NULL, unassigned_at TEXT, status TEXT NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS work_executions (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id), assignment_id TEXT NOT NULL REFERENCES work_assignments(id), executor_id TEXT NOT NULL, executor_type TEXT, external_execution_ref TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, failure_reason TEXT, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS work_leases (id TEXT PRIMARY KEY, work_item_id TEXT NOT NULL REFERENCES work_items(id), execution_id TEXT NOT NULL REFERENCES work_executions(id), holder_id TEXT NOT NULL, status TEXT NOT NULL, acquired_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL, expires_at TEXT NOT NULL, fencing_token INTEGER NOT NULL, version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS work_events (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), sequence INTEGER NOT NULL, item_id TEXT REFERENCES work_items(id), execution_id TEXT REFERENCES work_executions(id), type TEXT NOT NULL, actor TEXT, timestamp TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE(work_id, sequence));
      CREATE TABLE IF NOT EXISTS work_artifacts (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), item_id TEXT REFERENCES work_items(id), type TEXT NOT NULL, uri TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL);
       INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, datetime('now'));
    `);
    const applyMigration = (
      version: number,
      migration: string | (() => void),
    ) => {
      const applied = this.db
        .query("SELECT 1 FROM schema_migrations WHERE version = ?")
        .get(version);
      if (applied) return;
      this.db.exec("BEGIN");
      try {
        if (typeof migration === "string") {
          if (migration.trim()) this.db.exec(migration);
        } else migration();
        this.db
          .query(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, datetime('now'))",
          )
          .run(version);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    };
    applyMigration(
      2,
      `
        CREATE UNIQUE INDEX IF NOT EXISTS unique_active_assignment ON work_assignments(work_item_id) WHERE status = 'active';
        CREATE UNIQUE INDEX IF NOT EXISTS unique_active_lease ON work_leases(work_item_id) WHERE status = 'active';
        CREATE INDEX IF NOT EXISTS idx_items_work_status ON work_items(work_id, status);
        CREATE INDEX IF NOT EXISTS idx_dependencies_dependency ON work_item_dependencies(dependency_id);
        CREATE INDEX IF NOT EXISTS idx_leases_expiry ON work_leases(status, expires_at);
        CREATE INDEX IF NOT EXISTS idx_events_work_sequence ON work_events(work_id, sequence);
      `,
    );
    applyMigration(
      3,
      `
        CREATE TRIGGER IF NOT EXISTS work_events_append_only_update
        BEFORE UPDATE ON work_events BEGIN
          SELECT RAISE(ABORT, 'EVENT_LOG_APPEND_ONLY');
        END;
        CREATE TRIGGER IF NOT EXISTS work_events_append_only_delete
        BEFORE DELETE ON work_events BEGIN
          SELECT RAISE(ABORT, 'EVENT_LOG_APPEND_ONLY');
        END;
      `,
    );
    applyMigration(4, () => {
      const renameOrAdd = (
        table: string,
        oldName: string,
        newName: string,
        definition: string,
      ) => {
        if (columns(table).has(oldName) && !columns(table).has(newName))
          rename(table, oldName, newName);
        if (!columns(table).has(newName))
          this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
      };
      renameOrAdd(
        "work_assignments",
        "owner_agent",
        "assignee_id",
        "assignee_id TEXT",
      );
      renameOrAdd(
        "work_assignments",
        "",
        "assignee_type",
        "assignee_type TEXT",
      );
      renameOrAdd(
        "work_executions",
        "agent_name",
        "executor_id",
        "executor_id TEXT",
      );
      renameOrAdd("work_executions", "", "executor_type", "executor_type TEXT");
      renameOrAdd("work_leases", "owner_agent", "holder_id", "holder_id TEXT");
    });
  }

  private load(): State {
    const dependencies = new Map<string, string[]>();
    for (const row of this.db
      .query("SELECT work_item_id, dependency_id FROM work_item_dependencies")
      .all() as Array<{ work_item_id: string; dependency_id: string }>)
      dependencies.set(row.work_item_id, [
        ...(dependencies.get(row.work_item_id) ?? []),
        row.dependency_id,
      ]);
    const works = (
      this.db.query("SELECT * FROM works").all() as Array<
        Record<string, unknown>
      >
    ).map(
      (r): Work => ({
        id: r.id as string,
        workspaceId: r.workspace_id as string,
        title: r.title as string,
        objective: r.objective as string,
        status: r.status as Work["status"],
        createdAt: r.created_at as string,
        startedAt: r.started_at as string | undefined,
        completedAt: r.completed_at as string | undefined,
        version: r.version as number,
      }),
    );
    const items = (
      this.db.query("SELECT * FROM work_items").all() as Array<
        Record<string, unknown>
      >
    ).map(
      (r): WorkItem => ({
        id: r.id as string,
        workId: r.work_id as string,
        title: r.title as string,
        description: r.description as string | undefined,
        kind: r.kind as WorkItem["kind"],
        status: r.status as WorkItem["status"],
        dependencies: dependencies.get(r.id as string) ?? [],
        createdAt: r.created_at as string,
        startedAt: r.started_at as string | undefined,
        completedAt: r.completed_at as string | undefined,
        result: r.result as string | undefined,
        version: r.version as number,
      }),
    );
    const assignments = (
      this.db.query("SELECT * FROM work_assignments").all() as Array<
        Record<string, unknown>
      >
    ).map(
      (r): Assignment => ({
        id: r.id as string,
        workItemId: r.work_item_id as string,
        assigneeId: r.assignee_id as string,
        assigneeType: r.assignee_type as string | undefined,
        assignedAt: r.assigned_at as string,
        unassignedAt: r.unassigned_at as string | undefined,
        status: r.status as Assignment["status"],
        version: r.version as number,
      }),
    );
    const executions = (
      this.db.query("SELECT * FROM work_executions").all() as Array<
        Record<string, unknown>
      >
    ).map(
      (r): Execution => ({
        id: r.id as string,
        workItemId: r.work_item_id as string,
        assignmentId: r.assignment_id as string,
        executorId: r.executor_id as string,
        executorType: r.executor_type as string | undefined,
        externalExecutionRef: parse<Execution["externalExecutionRef"]>(
          r.external_execution_ref as string | null,
        ),
        status: r.status as Execution["status"],
        createdAt: r.created_at as string,
        startedAt: r.started_at as string | undefined,
        completedAt: r.completed_at as string | undefined,
        failureReason: r.failure_reason as string | undefined,
        version: r.version as number,
      }),
    );
    const leases = (
      this.db.query("SELECT * FROM work_leases").all() as Array<
        Record<string, unknown>
      >
    ).map(
      (r): WorkLease => ({
        id: r.id as string,
        workItemId: r.work_item_id as string,
        executionId: r.execution_id as string,
        holderId: r.holder_id as string,
        status: r.status as WorkLease["status"],
        acquiredAt: r.acquired_at as string,
        heartbeatAt: r.heartbeat_at as string,
        expiresAt: r.expires_at as string,
        fencingToken: r.fencing_token as number,
        version: r.version as number,
      }),
    );
    const artifacts = (
      this.db.query("SELECT * FROM work_artifacts").all() as Array<
        Record<string, unknown>
      >
    ).map(
      (r): Artifact => ({
        id: r.id as string,
        workId: r.work_id as string,
        itemId: r.item_id as string | undefined,
        type: r.type as string,
        uri: r.uri as string,
        description: r.description as string | undefined,
        createdAt: r.created_at as string,
      }),
    );
    const events = (
      this.db
        .query("SELECT * FROM work_events ORDER BY work_id, sequence")
        .all() as Array<Record<string, unknown>>
    ).map(
      (r): WorkEvent => ({
        id: r.id as string,
        workId: r.work_id as string,
        sequence: r.sequence as number,
        itemId: r.item_id as string | undefined,
        executionId: r.execution_id as string | undefined,
        type: r.type as string,
        actor: parse<WorkEvent["actor"]>(r.actor as string | null),
        timestamp: r.timestamp as string,
        payload: JSON.parse(r.payload as string),
      }),
    );
    return { works, items, assignments, executions, leases, artifacts, events };
  }

  async read() {
    return structuredClone(this.load());
  }
  async transaction<T>(fn: (state: State) => T | Promise<T>) {
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
      this.db.exec("BEGIN IMMEDIATE");
    } catch (e) {
      if (String(e).includes("database is locked")) {
        error(
          "CONCURRENT_TRANSACTION",
          "Another writer currently owns the SQLite transaction",
        );
      }
      throw e;
    }
    try {
      const before = this.load();
      const state = structuredClone(before);
      const out = await fn(state);
      validateAppendOnlyEvents(before, state);
      validateState(state);
      this.persist(before, state);
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      release();
    }
  }

  private persist(before: State, state: State) {
    const run = (sql: string, values: SQLQueryBindings[]) =>
      this.db.query(sql).run(...values);
    const sync = <T extends { id: string }>(
      oldRows: T[],
      rows: T[],
      table: string,
      write: (row: T) => void,
    ) => {
      const ids = new Set(rows.map((row) => row.id));
      for (const row of oldRows)
        if (!ids.has(row.id)) run(`DELETE FROM ${table} WHERE id=?`, [row.id]);
      for (const row of rows) write(row);
    };
    sync(before.works, state.works, "works", (w) =>
      run(
        "INSERT INTO works VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id,title=excluded.title,objective=excluded.objective,status=excluded.status,started_at=excluded.started_at,completed_at=excluded.completed_at,version=excluded.version",
        [
          w.id,
          w.workspaceId,
          w.title,
          w.objective,
          w.status,
          w.createdAt,
          w.startedAt ?? null,
          w.completedAt ?? null,
          w.version,
        ],
      ),
    );
    sync(before.items, state.items, "work_items", (i) =>
      run(
        "INSERT INTO work_items VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,kind=excluded.kind,status=excluded.status,started_at=excluded.started_at,completed_at=excluded.completed_at,result=excluded.result,version=excluded.version",
        [
          i.id,
          i.workId,
          i.title,
          i.description ?? null,
          i.kind,
          i.status,
          i.createdAt,
          i.startedAt ?? null,
          i.completedAt ?? null,
          i.result ?? null,
          i.version,
        ],
      ),
    );
    this.db.exec("DELETE FROM work_item_dependencies");
    for (const i of state.items)
      for (const d of i.dependencies)
        run("INSERT INTO work_item_dependencies VALUES(?,?)", [i.id, d]);
    sync(before.assignments, state.assignments, "work_assignments", (a) =>
      run(
        "INSERT INTO work_assignments(id,work_item_id,assignee_id,assignee_type,assigned_at,unassigned_at,status,version) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET assignee_id=excluded.assignee_id,assignee_type=excluded.assignee_type,unassigned_at=excluded.unassigned_at,status=excluded.status,version=excluded.version",
        [
          a.id,
          a.workItemId,
          a.assigneeId,
          a.assigneeType ?? null,
          a.assignedAt,
          a.unassignedAt ?? null,
          a.status,
          a.version,
        ],
      ),
    );
    sync(before.executions, state.executions, "work_executions", (e) =>
      run(
        "INSERT INTO work_executions(id,work_item_id,assignment_id,executor_id,executor_type,external_execution_ref,status,created_at,started_at,completed_at,failure_reason,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET executor_id=excluded.executor_id,executor_type=excluded.executor_type,status=excluded.status,started_at=excluded.started_at,completed_at=excluded.completed_at,failure_reason=excluded.failure_reason,version=excluded.version",
        [
          e.id,
          e.workItemId,
          e.assignmentId,
          e.executorId,
          e.executorType ?? null,
          e.externalExecutionRef ? json(e.externalExecutionRef) : null,
          e.status,
          e.createdAt,
          e.startedAt ?? null,
          e.completedAt ?? null,
          e.failureReason ?? null,
          e.version,
        ],
      ),
    );
    sync(before.leases, state.leases, "work_leases", (l) =>
      run(
        "INSERT INTO work_leases VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,heartbeat_at=excluded.heartbeat_at,expires_at=excluded.expires_at,fencing_token=excluded.fencing_token,version=excluded.version",
        [
          l.id,
          l.workItemId,
          l.executionId,
          l.holderId,
          l.status,
          l.acquiredAt,
          l.heartbeatAt,
          l.expiresAt,
          l.fencingToken,
          l.version,
        ],
      ),
    );
    sync(before.artifacts, state.artifacts, "work_artifacts", (a) =>
      run(
        "INSERT INTO work_artifacts VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,uri=excluded.uri,description=excluded.description",
        [
          a.id,
          a.workId,
          a.itemId ?? null,
          a.type,
          a.uri,
          a.description ?? null,
          a.createdAt,
        ],
      ),
    );
    const oldEvents = new Set(before.events.map((e) => e.id));
    for (const e of state.events)
      if (!oldEvents.has(e.id))
        run("INSERT INTO work_events VALUES(?,?,?,?,?,?,?,?,?)", [
          e.id,
          e.workId,
          e.sequence,
          e.itemId ?? null,
          e.executionId ?? null,
          e.type,
          e.actor ? json(e.actor) : null,
          e.timestamp,
          json(e.payload),
        ]);
  }
  close() {
    this.db.close();
  }
  diagnostics() {
    const foreignKeys = Number(
      (this.db.query("PRAGMA foreign_keys").get() as { foreign_keys: number })
        .foreign_keys,
    );
    const schemaVersion = Number(
      (
        this.db
          .query("SELECT MAX(version) AS version FROM schema_migrations")
          .get() as {
          version: number | null;
        }
      ).version ?? 0,
    );
    const indexes = new Set(
      (
        this.db
          .query("SELECT name FROM sqlite_master WHERE type='index'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    const triggers = new Set(
      (
        this.db
          .query("SELECT name FROM sqlite_master WHERE type='trigger'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    return {
      database: true,
      schema: schemaVersion >= 4,
      schemaVersion,
      migrations: schemaVersion >= 4,
      foreignKeys: foreignKeys === 1,
      leaseUniqueness: indexes.has("unique_active_lease"),
      eventLog:
        triggers.has("work_events_append_only_update") &&
        triggers.has("work_events_append_only_delete"),
    };
  }
}
