import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync, realpathSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import {
  type Clock,
  ExecutionService,
  RecoveryService,
  systemClock,
  WorkService,
} from "./domain";
import { SqliteStore } from "./persistence/sqlite-store";
export const workspaceId = (path: string) =>
  createHash("sha256")
    .update(realpathSync(resolve(path)))
    .digest("hex")
    .slice(0, 32);
export const dataDirectory = () =>
  platform() === "darwin"
    ? join(homedir(), "Library", "Application Support", "Pulso")
    : platform() === "win32"
      ? join(process.env.LOCALAPPDATA ?? homedir(), "Pulso")
      : join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
          "pulso",
        );
export interface WorkingSystem {
  workspaceId: string;
  dataDir: string;
  store: SqliteStore;
  work: WorkService;
  execution: ExecutionService;
  recovery: RecoveryService;
  doctor(): Record<string, boolean | number>;
  close(): void;
}
export const bootstrapWorkingSystem = (
  workspace: string,
  options: {
    dataDir?: string;
    clock?: Clock;
    leaseTtlMs?: number;
  } = {},
): WorkingSystem => {
  const ws = workspaceId(workspace);
  const dir = join(options.dataDir ?? dataDirectory(), "workspaces", ws);
  mkdirSync(dir, { recursive: true });
  const store = new SqliteStore(join(dir, "work.db"));
  const clock = options.clock ?? systemClock;
  const work = new WorkService(store, clock);
  const execution = new ExecutionService(
    store,
    work,
    clock,
    options.leaseTtlMs,
  );
  const recovery = new RecoveryService(store, clock);
  return {
    workspaceId: ws,
    dataDir: dir,
    store,
    work,
    execution,
    recovery,
    doctor: () => {
      accessSync(dir, constants.R_OK | constants.W_OK);
      const diagnostics = store.diagnostics();
      return {
        dataDirectory: true,
        workspaceIdentity: ws.length > 0,
        database: diagnostics.database,
        schema: diagnostics.schema,
        schemaVersion: diagnostics.schemaVersion,
        migrations: diagnostics.migrations,
        foreignKeys: diagnostics.foreignKeys,
        leaseUniqueness: diagnostics.leaseUniqueness,
        eventLog: diagnostics.eventLog,
        workingSystem: true,
      };
    },
    close: () => {
      store.close();
    },
  };
};
