import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type PreferenceScope = "project" | "global";
export type PreferenceSource = "user" | "project-file" | "inferred";
export type PreferenceStatus = "active" | "proposed" | "removed";
export type Preference = {
  scope: PreferenceScope;
  workspaceId: string;
  key: string;
  revision: number;
  value: unknown;
  source: PreferenceSource;
  status: PreferenceStatus;
  createdAt: string;
  sourceMessageId?: string;
  sourceArtifactHash?: string;
  justification?: string;
};
/** Supplied only by the host adapter after validating chat.message/chat.params. */
export type TrustedMessageProvenance = Readonly<{
  messageId: string;
  role: "user";
}>;
export class PreferenceConflictError extends Error {
  constructor() {
    super("PREFERENCE_CONFLICT");
    this.name = "PreferenceConflictError";
  }
}

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const decode = (row: Record<string, unknown>): Preference => ({
  scope: row.scope as PreferenceScope,
  workspaceId: String(row.workspace_id),
  key: String(row.key),
  revision: Number(row.revision),
  value: JSON.parse(String(row.value_json)),
  source: row.source as PreferenceSource,
  status: row.status as PreferenceStatus,
  createdAt: String(row.created_at),
  ...(row.source_message_id
    ? { sourceMessageId: String(row.source_message_id) }
    : {}),
  ...(row.source_artifact_hash
    ? { sourceArtifactHash: String(row.source_artifact_hash) }
    : {}),
  ...(row.justification ? { justification: String(row.justification) } : {}),
});

/** Project preference authority. It never owns capability permissions. */
export class PreferenceService {
  private readonly db: Database;
  constructor(
    readonly databasePath: string,
    private readonly now = () => new Date().toISOString(),
  ) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath, { create: true });
    chmodSync(databasePath, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=100;");
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS preferences(scope TEXT NOT NULL, workspace_id TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, value_json TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, source_message_id TEXT, source_artifact_hash TEXT, justification TEXT, PRIMARY KEY(scope,workspace_id,key,revision)); CREATE TABLE IF NOT EXISTS preference_events(id TEXT PRIMARY KEY, scope TEXT NOT NULL, workspace_id TEXT NOT NULL, key TEXT NOT NULL, revision INTEGER NOT NULL, event TEXT NOT NULL, created_at TEXT NOT NULL, source_message_id TEXT);`,
    );
  }
  close() {
    this.db.close();
  }
  list(workspaceId: string, scope: PreferenceScope = "project") {
    return (
      this.db
        .query(
          "SELECT p.* FROM preferences p JOIN (SELECT scope,workspace_id,key,MAX(revision) revision FROM preferences WHERE scope=? AND workspace_id=? GROUP BY scope,workspace_id,key) latest USING(scope,workspace_id,key,revision) WHERE p.status IN ('active','proposed') ORDER BY p.key",
        )
        .all(scope, workspaceId) as Record<string, unknown>[]
    ).map(decode);
  }
  get(workspaceId: string, key: string, scope: PreferenceScope = "project") {
    const row = this.db
      .query(
        "SELECT * FROM preferences WHERE scope=? AND workspace_id=? AND key=? ORDER BY revision DESC LIMIT 1",
      )
      .get(scope, workspaceId, key) as Record<string, unknown> | null;
    return row && row.status !== "removed" ? decode(row) : undefined;
  }
  set(input: {
    workspaceId: string;
    key: string;
    value: unknown;
    expectedRevision: number;
    scope?: PreferenceScope;
    source?: "user";
    provenance: TrustedMessageProvenance;
  }) {
    if (input.provenance?.role !== "user" || !input.provenance.messageId)
      throw new Error("TRUSTED_USER_MESSAGE_REQUIRED");
    return this.write({
      ...input,
      scope: input.scope ?? "project",
      source: "user",
      status: "active",
      messageId: input.provenance.messageId,
    });
  }
  propose(input: {
    workspaceId: string;
    key: string;
    value: unknown;
    reason: string;
    expectedRevision: number;
  }) {
    if (!input.reason.trim()) throw new Error("PROPOSAL_REASON_REQUIRED");
    return this.write({
      ...input,
      scope: "project",
      source: "inferred",
      status: "proposed",
      justification: input.reason,
    });
  }
  remove(input: {
    workspaceId: string;
    key: string;
    expectedRevision: number;
    scope?: PreferenceScope;
    provenance: TrustedMessageProvenance;
  }) {
    if (input.provenance?.role !== "user" || !input.provenance.messageId)
      throw new Error("TRUSTED_USER_MESSAGE_REQUIRED");
    return this.write({
      ...input,
      scope: input.scope ?? "project",
      source: "user",
      status: "removed",
      value: null,
      messageId: input.provenance.messageId,
    });
  }
  private write(input: {
    workspaceId: string;
    key: string;
    value: unknown;
    expectedRevision: number;
    scope: PreferenceScope;
    source: PreferenceSource;
    status: PreferenceStatus;
    messageId?: string;
    justification?: string;
  }) {
    if (!input.workspaceId || !input.key.trim())
      throw new Error("PREFERENCE_ID_REQUIRED");
    this.db.exec("BEGIN IMMEDIATE");
    let next = 0,
      valueJson = "",
      createdAt = "";
    try {
      const current = this.db
        .query(
          "SELECT MAX(revision) revision FROM preferences WHERE scope=? AND workspace_id=? AND key=?",
        )
        .get(input.scope, input.workspaceId, input.key) as {
        revision: number | null;
      };
      const revision = current.revision ?? 0;
      if (revision !== input.expectedRevision)
        throw new PreferenceConflictError();
      next = revision + 1;
      createdAt = this.now();
      valueJson = JSON.stringify(input.value);
      this.db
        .query("INSERT INTO preferences VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          input.scope,
          input.workspaceId,
          input.key,
          next,
          valueJson,
          input.source,
          input.status,
          createdAt,
          input.messageId ?? null,
          hash(valueJson),
          input.justification ?? null,
        );
      this.db
        .query("INSERT INTO preference_events VALUES(?,?,?,?,?,?,?,?)")
        .run(
          randomUUID(),
          input.scope,
          input.workspaceId,
          input.key,
          next,
          input.status,
          createdAt,
          input.messageId ?? null,
        );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return (
      this.get(input.workspaceId, input.key, input.scope) ??
      decode({
        scope: input.scope,
        workspace_id: input.workspaceId,
        key: input.key,
        revision: next,
        value_json: valueJson,
        source: input.source,
        status: input.status,
        created_at: createdAt,
        source_message_id: input.messageId,
        justification: input.justification,
      })
    );
  }
}
