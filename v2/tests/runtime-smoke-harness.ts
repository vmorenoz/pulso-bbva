import { Database } from "bun:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { bootstrapCapabilities } from "../packages/capabilities-mcp/src/bootstrap";
import {
  applyOpenCodeInstall,
  planOpenCodeInstall,
} from "../packages/installer/src/runtimes/opencode-installer";
import { agentIds } from "../packages/orchestration/src/agents/definitions";
import {
  parseAgentResult,
  parseTaskEnvelope,
} from "../packages/orchestration/src/protocol/parse";
import type {
  AgentResult,
  TaskEnvelope,
} from "../packages/orchestration/src/protocol/schemas";
import type { CanonicalSkill } from "../packages/orchestration/src/runtimes/types";
import {
  dataDirectory,
  workspaceId,
} from "../packages/working-system/src/bootstrap";

const runtimeVersion = "1.18.32";
const model = "openai/gpt-5.6-luna";
const opencodeExecutable = "opencode";
const root = resolve(import.meta.dir, "..");
const stdioEntry = join(root, "packages/capabilities-mcp/src/mcp/stdio.ts");
const bunExecutable = process.execPath;
const modes = [
  "preflight",
  "invalid-result",
  "invalid-result-diagnostic",
  "valid-control",
  "executor",
  "verifier",
  "chain",
  "parallel",
] as const;
type SmokeMode = (typeof modes)[number];

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(`SMOKE_ASSERTION_FAILED:${message}`);
};

const redactString = (source: string) =>
  source
    .replace(/(Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(
      /\b(?:sk|sbp|sb_secret|plane_api)_[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    )
    .replace(/\b[A-Fa-f0-9]{8}-[A-Fa-f0-9-]{27,}\b/g, "[ID]")
    .replace(
      /((?:access|refresh|api)[_-]?(?:key|token)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );

const isSensitiveProperty = (key: string) => {
  const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  return /^(?:api_key|access_token|refresh_token|token|secret|password|authorization|credential|cookie|key)$/.test(
    normalized,
  );
};

export const sanitizeForTranscript = (value: unknown): unknown => {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(sanitizeForTranscript);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        isSensitiveProperty(key) ? "[REDACTED]" : sanitizeForTranscript(entry),
      ]),
    );
  }
  return value;
};

const sanitizerProbe = JSON.stringify(
  sanitizeForTranscript({
    apiKey: "dummy-api-secret",
    authorization: "Bearer dummy-oauth-token",
    note: "refresh_token=dummy-refresh-secret",
  }),
);
assert(
  !/(dummy-api-secret|dummy-oauth-token|dummy-refresh-secret)/.test(
    sanitizerProbe,
  ),
  "TRANSCRIPT_SANITIZER_SELF_TEST_FAILED",
);

const digestFile = async (path: string) => {
  try {
    const value = await readFile(path);
    return createHash("sha256").update(value).digest("hex");
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return "absent";
    throw error;
  }
};

const globalConfigFiles = () => [
  join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "opencode/opencode.json",
  ),
  join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "opencode/opencode.jsonc",
  ),
  join(homedir(), "Library/Application Support/Code/User/mcp.json"),
  join(homedir(), ".config/Code/User/mcp.json"),
];

const globalStateSnapshot = async () => {
  const workspaceRoot = join(dataDirectory(), "workspaces");
  const records: Record<string, unknown> = {};
  let entries: string[] = [];
  try {
    entries = await readdir(workspaceRoot);
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
  for (const id of entries.filter((name) => /^[a-f\d]{32}$/.test(name))) {
    const directory = join(workspaceRoot, id);
    const summary: Record<string, unknown> = {};
    for (const [file, table, column] of [
      ["work.db", "works", "id"],
      ["work.db", "work_items", "id"],
      ["work.db", "work_events", "id"],
      ["work.db", "work_executions", "id"],
      ["work.db", "work_leases", "id"],
      ["runtime-bindings.db", "runtime_bindings", "binding_id"],
    ] as const) {
      const path = join(directory, file);
      try {
        await stat(path);
        const db = new Database(path, { readonly: true });
        try {
          const exists = db
            .query("select name from sqlite_master where type = ? and name = ?")
            .get("table", table);
          if (exists) {
            summary[`${file}:${table}`] = (
              db
                .query(`select count(${column}) as count from ${table}`)
                .get() as { count: number }
            ).count;
            const groupColumn = table === "work_events" ? "type" : "status";
            summary[`${file}:${table}By${groupColumn}`] = db
              .query(
                `select ${groupColumn}, count(*) as count from ${table} group by ${groupColumn} order by ${groupColumn}`,
              )
              .all();
          }
        } finally {
          db.close();
        }
        summary[`${file}:metadata`] = await fileMetadata(path);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
    }
    records[id] = summary;
  }
  const config = await Promise.all(
    globalConfigFiles().map(
      async (path) => [path, await digestFile(path)] as const,
    ),
  );
  const globalDataRoot = dataDirectory();
  const authPath = join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
    "opencode/auth.json",
  );
  const authMetadata = await fileMetadata(authPath);
  const globalOpenCode = await Promise.all(
    [
      join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "opencode",
      ),
      join(
        process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
        "opencode",
      ),
      join(
        process.env.XDG_STATE_HOME ?? join(homedir(), ".local/state"),
        "opencode",
      ),
      join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "opencode"),
    ].map(async (path) => [path, await directoryMetadata(path)] as const),
  );
  return {
    workspaceCounts: records,
    configHashes: Object.fromEntries(config),
    globalPulsoRoot: await directoryMetadata(globalDataRoot),
    globalAuthMetadata: authMetadata,
    globalOpenCode: Object.fromEntries(globalOpenCode),
  };
};

const fileMetadata = async (path: string) => {
  try {
    const value = await stat(path);
    return { size: value.size, mtimeMs: value.mtimeMs, inode: value.ino };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
};

const globalOpenCodeDatabaseFiles = [
  join(homedir(), ".local/share/opencode/opencode.db"),
  join(homedir(), ".local/share/opencode/opencode.db-wal"),
];

const globalOpenCodeDatabaseMetadata = async () =>
  Object.fromEntries(
    await Promise.all(
      globalOpenCodeDatabaseFiles.map(
        async (path) => [path, await fileMetadata(path)] as const,
      ),
    ),
  );

const globalOpenCodeDatabaseOwners = () => {
  const result = spawnSync(
    "lsof",
    ["-nP", "-t", ...globalOpenCodeDatabaseFiles],
    { encoding: "utf8", timeout: 10_000 },
  );
  return [
    ...new Set((result.stdout ?? "").trim().split(/\s+/).filter(Boolean)),
  ].sort();
};

const runAuditedCommand = async (
  executable: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; timeout: number },
) => {
  const dbBefore = await globalOpenCodeDatabaseMetadata();
  const ownersBefore = globalOpenCodeDatabaseOwners();
  const ownersDuring = new Set<string>();
  const processResult = await new Promise<{
    status: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
    pid?: number;
  }>((resolveResult, rejectResult) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const poll = setInterval(() => {
      for (const pid of globalOpenCodeDatabaseOwners())
        if (!ownersBefore.includes(pid)) ownersDuring.add(pid);
    }, 40);
    const timeout = setTimeout(() => child.kill("SIGTERM"), options.timeout);
    child.on("error", (error) => {
      clearInterval(poll);
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.on("close", (status, signal) => {
      clearInterval(poll);
      clearTimeout(timeout);
      resolveResult({
        status,
        signal,
        stdout,
        stderr,
        pid: child.pid,
      });
    });
  });
  const dbAfter = await globalOpenCodeDatabaseMetadata();
  const ownersAfter = globalOpenCodeDatabaseOwners();
  const observedOwners = new Set([...ownersDuring, ...ownersAfter]);
  return {
    ...processResult,
    dbChanged: JSON.stringify(dbBefore) !== JSON.stringify(dbAfter),
    ownersBefore,
    ownersDuring: [...ownersDuring].sort(),
    ownersAfter,
    newGlobalDbOwners: [...observedOwners]
      .filter((pid) => !ownersBefore.includes(pid))
      .sort(),
    childOpenedGlobalDb: processResult.pid
      ? observedOwners.has(String(processResult.pid))
      : false,
  };
};

const directoryMetadata = async (path: string) => {
  try {
    const names = await readdir(path);
    const contents = await Promise.all(
      names.sort().map(async (name) => {
        const entry = await stat(join(path, name));
        return [
          name,
          {
            size: entry.size,
            mtimeMs: entry.mtimeMs,
            inode: entry.ino,
            directory: entry.isDirectory(),
          },
        ] as const;
      }),
    );
    return {
      count: names.length,
      contents: Object.fromEntries(contents),
    };
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return null;
    throw error;
  }
};

const isolatedEnvironment = (home: string, workspace: string) => {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    TMPDIR: home,
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"),
    XDG_CACHE_HOME: join(home, "cache"),
    OPENCODE_DB: join(home, "data/opencode/runtime-smoke.db"),
    PULSO_WORKSPACE: workspace,
    LANG: process.env.LANG ?? "en_US.UTF-8",
  };
  for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.npm_config_cache = join(home, "npm-cache");
  env.npm_config_userconfig = join(home, ".npmrc");
  return env;
};

const parseDebugPaths = (source: string) =>
  Object.fromEntries(
    source
      .split("\n")
      .map((line) => /^\s*([a-z]+)\s+(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => [match[1], match[2].trim()]),
  );

const copyModelCredential = async (xdgDataHome: string) => {
  const source = join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
    "opencode/auth.json",
  );
  const auth = JSON.parse(await readFile(source, "utf8")) as Record<
    string,
    Record<string, unknown>
  >;
  assert(auth.openai?.type === "oauth", "OPENAI_OAUTH_CREDENTIAL_UNAVAILABLE");
  const target = join(xdgDataHome, "opencode/auth.json");
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, JSON.stringify({ openai: auth.openai }), {
    mode: 0o600,
    flag: "wx",
  });
  return target;
};

const canonicalSkills = async () => {
  const directory = join(root, "packages/orchestration/skills");
  return Promise.all(
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => ({
        id: entry.name as CanonicalSkill["id"],
        content: await readFile(
          join(directory, entry.name, "SKILL.md"),
          "utf8",
        ),
      })),
  );
};

const parseTaskOutput = (output: string) => {
  const match =
    /^\s*<task\b[^>]*state="completed"[^>]*>[\s\S]*?<task_result>([\s\S]*?)<\/task_result>\s*<\/task>\s*$/.exec(
      output,
    );
  return match?.[1]?.trim();
};

const diagnosticEventPlugin = `
import { appendFile } from "node:fs/promises";

export const PulsoRuntimeDiagnostic = async () => {
  const tracePath = process.env.PULSO_SMOKE_TRACE;
  const sessions = new Map();
  const messages = new Map();
  let childNumber = 0;
  let messageNumber = 0;
  let callNumber = 0;
  let eventCount = 0;
  const sessionAlias = (id) => {
    if (!id) return "unknown";
    if (!sessions.has(id)) sessions.set(id, "S" + (sessions.size + 1));
    return sessions.get(id);
  };
  const codeOnly = (value) => {
    const match = String(value ?? "").match(/PULSO_PROTOCOL_INVALID_(?:TASK|RESULT)|AGENT_RESULT_INVALID|TASK_RESULT_NOT_COMPLETED_OR_TEXT_MISSING/);
    return match?.[0];
  };
  return {
    event: async ({ event }) => {
      if (eventCount >= 500 || !tracePath) return;
      const type = event?.type;
      const p = event?.properties ?? {};
      const relevant = new Set(["session.created", "session.status", "session.error", "message.updated", "message.part.updated"]);
      if (!relevant.has(type)) return;
      let sid = p.sessionID;
      if (type === "session.created") {
        const info = p.info ?? {};
        sid = info.id;
        if (sid && !sessions.has(sid)) {
          const alias = info.parentID ? "C" + (++childNumber) : "P" + (sessions.size + 1);
          sessions.set(sid, alias);
        }
      }
      const record = { at: Date.now(), type, session: sessionAlias(sid) };
      if (type === "session.created") {
        record.parent = p.info?.parentID ? sessionAlias(p.info.parentID) : undefined;
        record.agent = p.info?.agent;
      }
      if (type === "session.status") record.status = p.status?.type;
      if (type === "session.error") record.errorName = p.error?.name;
      if (type === "message.updated") {
        const info = p.info ?? {};
        if (info.id && !messages.has(info.id)) messages.set(info.id, "M" + (++messageNumber));
        record.message = info.id ? messages.get(info.id) : undefined;
        record.role = info.role;
        record.finish = info.finish;
        record.messageCompleted = Boolean(info.time?.completed);
        record.errorPresent = Boolean(info.error);
        record.errorName = info.error?.name;
      }
      if (type === "message.part.updated") {
        const part = p.part ?? {};
        if (part.messageID && !messages.has(part.messageID)) messages.set(part.messageID, "M" + (++messageNumber));
        record.message = part.messageID ? messages.get(part.messageID) : undefined;
        record.partType = part.type;
        if (part.type === "tool") {
          record.tool = part.tool;
          record.toolStatus = part.state?.status;
          record.toolCall = part.callID ? "TC" + (++callNumber) : undefined;
          record.toolStart = part.state?.time?.start;
          record.toolEnd = part.state?.time?.end;
          record.errorCode = codeOnly(part.state?.error);
        }
        if (part.type === "step-finish") record.finish = part.reason;
        if (part.type === "text") record.nonEmptyText = Boolean(part.text?.trim());
      }
      eventCount++;
      await appendFile(tracePath, JSON.stringify(record) + "\\n", { mode: 0o600 });
    },
  };
};
`;

type RuntimeEvent = {
  type?: string;
  timestamp?: number;
  sessionID?: string;
  part?: {
    type?: string;
    tool?: string;
    callID?: string;
    messageID?: string;
    metadata?: Record<string, unknown>;
    reason?: string;
    time?: { start?: number; end?: number };
    text?: string;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
      output?: string;
      error?: string;
      time?: { start?: number; end?: number };
      metadata?: Record<string, unknown>;
    };
  };
};

type CapturedTask = {
  callId: string;
  messageId?: string;
  taskStatus?: string;
  envelope: TaskEnvelope;
  bytes: number;
  evidenceCount: number;
  result?: AgentResult;
  firstAttemptValid: boolean;
  errorCode?: string;
};

const readOpenCodeDiagnosticSnapshot = (path: string) => {
  const db = new Database(path, { readonly: true });
  try {
    const names = new Set(
      (
        db
          .query("select name from sqlite_master where type = ?")
          .all("table") as {
          name: string;
        }[]
      ).map((row) => row.name),
    );
    const sessionRows = names.has("session")
      ? (db
          .query(
            "select id, parent_id, agent from session order by time_created, id",
          )
          .all() as {
          id: string;
          parent_id: string | null;
          agent: string | null;
        }[])
      : [];
    const aliases = new Map<string, string>();
    let parentNumber = 0;
    let childNumber = 0;
    let unknownNumber = 0;
    for (const session of sessionRows) {
      if (!session.parent_id) aliases.set(session.id, `P${++parentNumber}`);
      else if (aliases.has(session.parent_id))
        aliases.set(session.id, `C${++childNumber}`);
      else aliases.set(session.id, `S${++unknownNumber}`);
    }
    const decode = (source: unknown): Record<string, unknown> => {
      if (typeof source === "string") {
        try {
          return JSON.parse(source) as Record<string, unknown>;
        } catch {
          return {};
        }
      }
      return source && typeof source === "object"
        ? (source as Record<string, unknown>)
        : {};
    };
    const messageRows = names.has("message")
      ? (db
          .query(
            "select session_id, data from message order by time_created, id",
          )
          .all() as {
          session_id: string;
          data: unknown;
        }[])
      : [];
    const messages = messageRows.map((row) => {
      const data = decode(row.data);
      const time = decode(data.time);
      const error = decode(data.error);
      return {
        session: aliases.get(row.session_id) ?? "unknown",
        role: data.role,
        finish: data.finish ?? null,
        created: time.created ?? null,
        completed: time.completed ?? null,
        errorName: error.name ?? null,
      };
    });
    const partRows = names.has("part")
      ? (db
          .query(
            "select session_id, message_id, data from part order by time_created, id",
          )
          .all() as {
          session_id: string;
          message_id: string;
          data: unknown;
        }[])
      : [];
    const toolParts = partRows.flatMap((row) => {
      const data = decode(row.data);
      if (data.type !== "tool") return [];
      const tool = String(data.tool ?? "");
      if (
        tool !== "task" &&
        !tool.includes("runtime_fail") &&
        !tool.includes("runtime_complete")
      )
        return [];
      const state = data.state ?? {};
      const stateRecord = decode(state);
      const time = decode(stateRecord.time);
      const metadata = decode(stateRecord.metadata);
      const eventMetadata = decode(data.metadata);
      const error = String(stateRecord.error ?? "");
      const sessionId = metadata.sessionId ?? eventMetadata.sessionId;
      return [
        {
          session: aliases.get(row.session_id) ?? "unknown",
          tool,
          status: stateRecord.status,
          errorCode: error.match(
            /PULSO_PROTOCOL_INVALID_RESULT|PULSO_PROTOCOL_INVALID_TASK|AGENT_RESULT_INVALID/,
          )?.[0],
          start: time.start ?? null,
          end: time.end ?? null,
          childSession:
            typeof sessionId === "string" ? aliases.get(sessionId) : undefined,
        },
      ];
    });
    const eventRows = names.has("event")
      ? (db
          .query("select aggregate_id, type from event order by seq")
          .all() as {
          aggregate_id: string;
          type: string;
        }[])
      : [];
    const relevantSessionIds = new Set(
      sessionRows.map((session) => session.id),
    );
    const durableEventTypes = eventRows
      .filter((event) => relevantSessionIds.has(event.aggregate_id))
      .map((event) => event.type);
    return {
      sessions: sessionRows.map((session) => ({
        alias: aliases.get(session.id),
        parent: session.parent_id ? aliases.get(session.parent_id) : null,
        agent: session.agent,
      })),
      messages,
      toolParts,
      durableSessionStatusEventCount: durableEventTypes.filter(
        (type) => type === "session.status",
      ).length,
      durableEventTypes: [...new Set(durableEventTypes)],
    };
  } finally {
    db.close();
  }
};

const readDiagnosticTrace = async (path: string) => {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as Record<string, unknown>];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return [];
    throw error;
  }
};

const decodeEvents = (source: string): RuntimeEvent[] =>
  source
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as RuntimeEvent;
        return [
          "tool_use",
          "text",
          "step_start",
          "step_finish",
          "error",
          "reasoning",
        ].includes(event.type ?? "")
          ? [event]
          : [];
      } catch {
        return [];
      }
    });

const evidenceCount = (task: TaskEnvelope) =>
  (task.context?.references?.length ?? 0) +
  (task.dependencies ?? []).reduce(
    (count, dependency) => count + (dependency.artifacts?.length ?? 0),
    0,
  );

const containsForbiddenLifecycleId = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(containsForbiddenLifecycleId);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /^(?:bindingId|leaseId|executionId|fencingToken)$/i.test(key) ||
      containsForbiddenLifecycleId(child),
  );
};

const runIsolatedOpenCode = async (mode: SmokeMode) => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "pulso-runtime-smoke-"));
  try {
    const home = join(temporaryRoot, "home");
    const workspace = join(temporaryRoot, "workspace");
    const xdgConfig = join(home, "config");
    const xdgData = join(home, "data");
    const env = isolatedEnvironment(home, workspace);
    const tracePath = join(temporaryRoot, "session-events.ndjson");
    if (mode === "invalid-result-diagnostic" || mode === "valid-control")
      env.PULSO_SMOKE_TRACE = tracePath;
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    if (
      [
        "invalid-result",
        "invalid-result-diagnostic",
        "valid-control",
        "executor",
        "verifier",
      ].includes(mode)
    ) {
      await writeFile(
        join(workspace, "fixture.txt"),
        mode === "verifier" ? "status=after\n" : "status=before\n",
        {
          mode: 0o600,
        },
      );
    }
    await copyModelCredential(xdgData);
    const globalBefore = await globalStateSnapshot();
    const modelConfig = {
      profile: "custom" as const,
      agents: Object.fromEntries(agentIds.map((id) => [id, model])) as Record<
        (typeof agentIds)[number],
        string
      >,
    };
    const options = {
      scope: "local" as const,
      workspace,
      executable: "opencode",
      mcpCommand: [bunExecutable, "run", stdioEntry],
      version: runtimeVersion,
      modelConfig,
      skills: await canonicalSkills(),
    };
    const plan = await planOpenCodeInstall(options);
    if (["invalid-result", "invalid-result-diagnostic"].includes(mode)) {
      const explorerPath = join(workspace, ".opencode/agents/explorer.md");
      const asset = plan.fileMutations.find(
        (entry) => entry.path === explorerPath,
      );
      assert(asset, "EXPLORER_ASSET_NOT_FOUND");
      asset.content +=
        '\n<smoke_fixture>For this controlled guard test only, return a pulso-result/2 with specialistResult.kind explorer and findings [{summary:"Controlled invalid fixture",severity:"high"}]. This deliberately violates the strict Explorer contract; do not fix or omit severity.</smoke_fixture>\n';
      asset.sha256 = createHash("sha256").update(asset.content).digest("hex");
      const runtimeAsset = plan.runtimes[0]?.assets.find(
        (entry) => entry.path === explorerPath,
      );
      if (runtimeAsset) {
        runtimeAsset.content = asset.content;
        runtimeAsset.sha256 = asset.sha256;
      }
    }
    await applyOpenCodeInstall(options, plan);
    if (mode === "invalid-result-diagnostic" || mode === "valid-control") {
      const tracePluginPath = join(
        temporaryRoot,
        "pulso-runtime-diagnostic.js",
      );
      await writeFile(tracePluginPath, diagnosticEventPlugin, { mode: 0o600 });
      const configPath = join(workspace, ".opencode/opencode.json");
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        plugin?: string[];
        [key: string]: unknown;
      };
      config.plugin = [
        ...(config.plugin ?? []),
        pathToFileURL(tracePluginPath).href,
      ];
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
        mode: 0o600,
      });
    }
    const commandAudits: Array<{
      category: string;
      exitCode: number | null;
      globalDbMetadataChanged: boolean;
      globalDbOwnersBefore: string[];
      newGlobalDbOwners: string[];
      globalDbOwnersAfter: string[];
      childPid?: number;
      childOpenedGlobalDb: boolean;
    }> = [];
    const audited = async (category: string, args: string[]) => {
      const result = await runAuditedCommand(opencodeExecutable, args, {
        cwd: workspace,
        env,
        timeout:
          category === "mcp-list" || category === "run" ? 90_000 : 30_000,
      });
      commandAudits.push({
        category,
        exitCode: result.status,
        globalDbMetadataChanged: result.dbChanged,
        globalDbOwnersBefore: result.ownersBefore,
        newGlobalDbOwners: result.newGlobalDbOwners,
        globalDbOwnersAfter: result.ownersAfter,
        ...(result.pid ? { childPid: result.pid } : {}),
        childOpenedGlobalDb: result.childOpenedGlobalDb,
      });
      return result;
    };

    const versionResult = await audited("version", ["--version"]);
    assert(
      versionResult.status === 0 &&
        versionResult.stdout?.trim() === runtimeVersion,
      "OPENCODE_VERSION_MISMATCH",
    );

    const dbPathResult = await audited("db-path", ["db", "path"]);
    assert(
      dbPathResult.status === 0 &&
        dbPathResult.stdout?.trim() === env.OPENCODE_DB,
      "OPENCODE_DATABASE_PATH_NOT_TEMPORARY",
    );

    const pathResult = await audited("debug-paths", ["debug", "paths"]);
    assert(pathResult.status === 0, "OPENCODE_DEBUG_PATHS_FAILED");
    const paths = parseDebugPaths(pathResult.stdout ?? "");
    const isolatedPaths = [
      "home",
      "data",
      "cache",
      "config",
      "state",
      "tmp",
    ].every(
      (key) => typeof paths[key] === "string" && paths[key].startsWith(home),
    );
    assert(isolatedPaths, "OPENCODE_PATH_ESCAPED_TEMP_HOME");

    const mcpList = await audited("mcp-list", ["mcp", "list"]);
    assert(mcpList.status === 0, "ISOLATED_MCP_LIST_FAILED");
    const serverNames = [
      ...(mcpList.stdout ?? "").matchAll(/[●•]\s+[✓✗]\s+([a-z0-9_-]+)/gi),
    ].map((match) => match[1]);
    assert(
      serverNames.length === 1 && serverNames[0] === "pulso",
      "NON_ISOLATED_MCP_REGISTRY",
    );
    assert(
      commandAudits.every((command) => !command.childOpenedGlobalDb),
      "ISOLATED_PREFLIGHT_PROCESS_OPENED_GLOBAL_OPENCODE_DB",
    );
    const globalAfterPreflight = await globalStateSnapshot();
    const globalPulsoAndMcpUnchanged =
      JSON.stringify(globalBefore.workspaceCounts) ===
        JSON.stringify(globalAfterPreflight.workspaceCounts) &&
      JSON.stringify(globalBefore.globalPulsoRoot) ===
        JSON.stringify(globalAfterPreflight.globalPulsoRoot) &&
      JSON.stringify(globalBefore.configHashes) ===
        JSON.stringify(globalAfterPreflight.configHashes) &&
      JSON.stringify(globalBefore.globalAuthMetadata) ===
        JSON.stringify(globalAfterPreflight.globalAuthMetadata);
    assert(
      globalPulsoAndMcpUnchanged,
      "DEVELOPER_GLOBAL_PULSO_OR_MCP_CONFIG_CHANGED;MODEL_NOT_RUN",
    );

    const prompts: Record<SmokeMode, string> = {
      preflight: "",
      "invalid-result":
        "Use only Pulso Capabilities MCP. Create one tracked Work and one Explorer WorkItem, bind, then invoke Explorer on the fixture. The installed Explorer is a controlled invalid-result fixture. Do not repair or retry its result. The guard rejection must be terminalized with runtime_fail exactly once; never runtime_complete. Tell the user briefly that verification failed without internal IDs or diagnostics.",
      "invalid-result-diagnostic":
        "Use only Pulso Capabilities MCP. Create one tracked Work and one Explorer WorkItem, bind, then invoke Explorer on the fixture. The installed Explorer is a controlled invalid-result fixture. Do not retry. After the guard rejects the result, call runtime_fail exactly once, then give one brief useful user-facing failure response without internal IDs or diagnostics and stop.",
      "valid-control":
        "Use only Pulso Capabilities MCP. Create one tracked Work and one Explorer WorkItem, bind, then ask Explorer to inspect fixture.txt and return a normal valid pulso-result/2 with a concise finding and Evidence. Validate it, call runtime_complete exactly once, then give one brief user-facing success response and stop.",
      executor:
        "Use only Pulso Capabilities MCP. This is a safe, tracked implementation task in a temporary text fixture. Delegate exactly one Executor Task to modify only fixture.txt, changing status=before to status=after. Ask Executor to validate the exact new content with a read-only command and return the canonical ExecutorResult with changes and validations. Validate its first result, terminalize with runtime_complete, and summarize the change without internal IDs.",
      verifier:
        "Use only Pulso Capabilities MCP. Verify this pre-seeded temporary fixture representing a small Executor change: fixture.txt should contain status=after. Delegate one read-only Verifier Task, request criterion checks and Evidence, and keep AgentResult.status distinct from VerifierResult.verdict. Validate the first result, terminalize with runtime_complete, and report pass/fail usefully without internal IDs.",
      chain:
        "Use only Pulso Capabilities MCP. In this temporary text fixture, perform the bounded test flow Explorer → Executor → Verifier, in that order. Explorer reports evidence on fixture/message.txt. Executor changes exactly status=before to status=after and records a validation. Verifier independently checks the change and returns criterion checks/Evidence. Track/bind each real delegation, pass only minimum relevant summaries, dependencies, Evidence, constraints, and acceptance criteria in each pulso-task/2 (never copy complete AgentResult, conversation, MCP history or lifecycle IDs), validate every result, and terminalize every binding. This is only a test fixture, not a routing policy; do no unrelated work.",
      parallel:
        "Use only Pulso Capabilities MCP. Independently inspect fixture/alpha.txt and fixture/beta.txt with two concurrent native Explorer Tasks if supported. Create distinct tracked WorkItems and bindings, then invoke both tasks in parallel with exact canonical envelopes. Complete each only after its matching result validates. Do not combine results or expose internal IDs.",
    };
    if (mode === "chain") {
      await mkdir(join(workspace, "fixture"), { recursive: true });
      await writeFile(
        join(workspace, "fixture/message.txt"),
        "status=before\n",
        { mode: 0o600 },
      );
    }
    if (mode === "parallel") {
      await mkdir(join(workspace, "fixture"), { recursive: true });
      await writeFile(join(workspace, "fixture/alpha.txt"), "alpha marker\n", {
        mode: 0o600,
      });
      await writeFile(join(workspace, "fixture/beta.txt"), "beta marker\n", {
        mode: 0o600,
      });
    }
    /* v1.18.32 has no --standalone option. RunCommand's non-attach path
       serves its local API in-process, so this does not discover a shared server. */
    const run =
      mode === "preflight"
        ? { status: 0, signal: null, stdout: "" }
        : await audited("run", [
            "run",
            "--auto",
            "--agent",
            "pulso",
            "--format",
            "json",
            "--dir",
            workspace,
            prompts[mode],
          ]);
    const runHasNoGlobalDbOwner =
      mode === "preflight" ||
      commandAudits.at(-1)?.childOpenedGlobalDb === false;
    const events = decodeEvents(run.stdout ?? "");
    const toolEvents = events.filter((event) => event.type === "tool_use");
    const textEvents = events.filter((event) => event.type === "text");
    const diagnosticMode = mode === "invalid-result-diagnostic";
    const diagnosticTraceRecords = diagnosticMode
      ? await readDiagnosticTrace(tracePath)
      : [];
    const diagnosticTrace = [
      ...new Map(
        diagnosticTraceRecords.map((event) => [JSON.stringify(event), event]),
      ).values(),
    ];
    const openCodeState = diagnosticMode
      ? readOpenCodeDiagnosticSnapshot(env.OPENCODE_DB)
      : undefined;
    const rejectEvent = toolEvents.find(
      (event) =>
        event.part?.tool === "task" &&
        /PULSO_PROTOCOL_INVALID_RESULT/.test(event.part.state?.error ?? ""),
    );
    const t0 = rejectEvent?.timestamp;
    const failToolEvent = toolEvents.find(
      (event) => event.part?.tool === "pulso_runtime_fail",
    );
    const failTraceStart = diagnosticTrace.find(
      (event) =>
        event.type === "message.part.updated" &&
        event.tool === "pulso_runtime_fail" &&
        event.toolStatus === "running",
    );
    const failTraceComplete = [...diagnosticTrace]
      .reverse()
      .find(
        (event) =>
          event.type === "message.part.updated" &&
          event.tool === "pulso_runtime_fail" &&
          event.toolStatus === "completed",
      );
    const t1 =
      typeof failTraceStart?.toolStart === "number"
        ? failTraceStart.toolStart
        : typeof failToolEvent?.part?.state?.time?.start === "number"
          ? failToolEvent.part.state.time.start
          : failToolEvent?.timestamp;
    const t2 =
      typeof failTraceComplete?.toolEnd === "number"
        ? failTraceComplete.toolEnd
        : typeof failToolEvent?.part?.state?.time?.end === "number"
          ? failToolEvent.part.state.time.end
          : failToolEvent?.timestamp;
    const afterT2Trace =
      typeof t2 === "number"
        ? diagnosticTrace.filter(
            (event) =>
              typeof event.at === "number" && (event.at as number) > t2,
          )
        : [];
    const afterT2RunEvents =
      typeof t2 === "number"
        ? events.filter(
            (event) =>
              typeof event.timestamp === "number" && event.timestamp > t2,
          )
        : [];
    const parentSession = openCodeState?.sessions.find(
      (session) => session.parent === null,
    );
    const parentMessagesAfterT2 =
      typeof t2 === "number"
        ? (openCodeState?.messages ?? []).filter(
            (message) =>
              message.session === parentSession?.alias &&
              message.role === "assistant" &&
              typeof message.created === "number" &&
              (message.created as number) > t2,
          )
        : [];
    const statusBySession = new Map<string, string>();
    for (const event of diagnosticTrace)
      if (
        event.type === "session.status" &&
        typeof event.session === "string" &&
        typeof event.status === "string"
      )
        statusBySession.set(event.session, event.status);
    const diagnosticTimeline = diagnosticTrace
      .filter(
        (event) =>
          typeof t0 === "number" &&
          typeof event.at === "number" &&
          (event.at as number) >= t0,
      )
      .map((event) => ({
        offsetMs: (event.at as number) - (t0 as number),
        type: event.type,
        session: event.session,
        message: event.message,
        role: event.role,
        tool: event.tool,
        toolStatus: event.toolStatus,
        errorCode: event.errorCode,
        status: event.status,
        finish: event.finish,
        messageCompleted: event.messageCompleted,
        nonEmptyText: event.nonEmptyText,
      }));
    const tasks: CapturedTask[] = [];
    const terminalCalls: string[] = [];
    const createdWorkIds: string[] = [];
    const knownIds = new Set<string>();
    const bindingIds: string[] = [];
    const toolUx: Array<{
      name: string;
      inputKeys: string[];
      outputKeys: string[];
      outputBytes: number;
    }> = [];
    for (const event of toolEvents) {
      const tool = event.part?.tool ?? "";
      const callId = event.part?.callID ?? "";
      if (callId) knownIds.add(callId);
      if (tool.startsWith("pulso_")) {
        const output = event.part?.state?.output ?? "";
        let outputKeys: string[] = [];
        try {
          const parsed = JSON.parse(output) as {
            ok?: boolean;
            value?: Record<string, unknown>;
          };
          outputKeys = Object.keys(parsed.value ?? parsed).sort();
        } catch {
          outputKeys = event.part?.state?.error ? ["error"] : [];
        }
        toolUx.push({
          name: tool,
          inputKeys: Object.keys(event.part?.state?.input ?? {}).sort(),
          outputKeys,
          outputBytes: Buffer.byteLength(output, "utf8"),
        });
      }
      const input = event.part?.state?.input;
      for (const idKey of [
        "workId",
        "workItemId",
        "bindingId",
        "delegationId",
      ]) {
        const value = input?.[idKey];
        if (typeof value === "string") knownIds.add(value);
      }
      if (tool === "task") {
        const prompt = event.part?.state?.input?.prompt;
        if (typeof prompt === "string") {
          try {
            const task = parseTaskEnvelope(prompt);
            const bytes = Buffer.byteLength(prompt, "utf8");
            let result: AgentResult | undefined;
            let errorCode: string | undefined;
            const wrapped = parseTaskOutput(event.part?.state?.output ?? "");
            if (wrapped) {
              try {
                result = parseAgentResult(wrapped, {
                  delegationId: task.delegationId,
                  specialist: task.specialist,
                  workId: task.work.workId,
                  workItemId: task.work.workItemId,
                });
              } catch {
                errorCode = "AGENT_RESULT_INVALID";
              }
            }
            const stateError = event.part?.state?.error ?? "";
            errorCode ??= /PULSO_PROTOCOL_INVALID_RESULT/.test(stateError)
              ? "PULSO_PROTOCOL_INVALID_RESULT"
              : /PULSO_PROTOCOL_INVALID_TASK/.test(stateError)
                ? "PULSO_PROTOCOL_INVALID_TASK"
                : undefined;
            tasks.push({
              callId,
              ...(event.part?.messageID
                ? { messageId: event.part.messageID }
                : {}),
              ...(event.part?.state?.status
                ? { taskStatus: event.part.state.status }
                : {}),
              envelope: task,
              bytes,
              evidenceCount: evidenceCount(task),
              result,
              firstAttemptValid: Boolean(result),
              ...(errorCode ? { errorCode } : {}),
            });
          } catch {
            // Invalid Task prompts are represented only by a compact error code below.
          }
        }
      }
      if (["pulso_runtime_complete", "pulso_runtime_fail"].includes(tool))
        terminalCalls.push(tool);
      if (tool === "pulso_work_create") {
        try {
          const result = JSON.parse(event.part?.state?.output ?? "") as {
            value?: { workId?: string };
          };
          if (result.value?.workId) {
            createdWorkIds.push(result.value.workId);
            knownIds.add(result.value.workId);
          }
        } catch {
          // The report intentionally contains no raw MCP response.
        }
      }
      if (tool === "pulso_runtime_bind") {
        try {
          const result = JSON.parse(event.part?.state?.output ?? "") as {
            value?: { bindingId?: string };
          };
          if (result.value?.bindingId) {
            knownIds.add(result.value.bindingId);
            bindingIds.push(result.value.bindingId);
          }
        } catch {
          // Binding IDs are used only in memory for UX leak checks.
        }
      }
    }
    const finalResponse = textEvents
      .map((event) => event.part?.text ?? "")
      .join("\n");
    const leaksIdentifier = [...knownIds].some(
      (id) => id && finalResponse.includes(id),
    );
    let userResponseSource = finalResponse;
    for (const id of [...knownIds].sort(
      (left, right) => right.length - left.length,
    )) {
      if (id) userResponseSource = userResponseSource.replaceAll(id, "[ID]");
    }
    const userResponse = redactString(userResponseSource)
      .replace(
        /(workItemId|workId|bindingId|delegationId)\s*[:=]?\s*[A-Za-z0-9_-]+/gi,
        "$1=[REDACTED]",
      )
      .slice(0, 2_000);
    const userResponseHasBookkeeping =
      /\b(?:bindingId|workItemId|delegationId|pulso_runtime_(?:bind|complete|fail)|raw MCP|Zod issues)\b/i.test(
        finalResponse,
      );
    const userResponseIncludesProtocolDiagnostics =
      /PULSO_PROTOCOL_INVALID|AGENT_RESULT_INVALID|specialistResult\.|findings\[\d+\]|severity:/i.test(
        finalResponse,
      );
    const sessionStatusAfterFail = {
      parent: parentSession?.alias
        ? (statusBySession.get(parentSession.alias) ?? "not-observed")
        : "not-observed",
      children: (openCodeState?.sessions ?? [])
        .filter((session) => session.parent === parentSession?.alias)
        .map((session) => ({
          session: session.alias,
          agent: session.agent,
          status: session.alias
            ? (statusBySession.get(session.alias) ?? "not-observed")
            : "not-observed",
        })),
    };
    const runtimeDiagnostic = diagnosticMode
      ? {
          diagnosticAttempt: 2,
          t0AfterRejectMs: 0,
          t1RuntimeFailStartMs:
            typeof t1 === "number" && typeof t0 === "number" ? t1 - t0 : null,
          t2RuntimeFailCompleteMs:
            typeof t2 === "number" && typeof t0 === "number" ? t2 - t0 : null,
          protocolRejectObserved: Boolean(rejectEvent),
          runtimeFailToolStatus:
            failToolEvent?.part?.state?.status ?? "not-observed",
          taskErrors: (openCodeState?.toolParts ?? []).filter(
            (part) => part.tool === "task",
          ),
          runtimeFailParts: (openCodeState?.toolParts ?? []).filter((part) =>
            part.tool.includes("runtime_fail"),
          ),
          sessions: openCodeState?.sessions ?? [],
          assistantMessagesAfterRuntimeFail: parentMessagesAfterT2,
          modelStepStartsAfterRuntimeFail: afterT2RunEvents.filter(
            (event) => event.type === "step_start",
          ).length,
          modelStepFinishesAfterRuntimeFail: afterT2RunEvents
            .filter((event) => event.type === "step_finish")
            .map((event) => event.part?.reason ?? "unknown"),
          toolCallsAfterRuntimeFail: afterT2RunEvents.filter(
            (event) =>
              event.type === "tool_use" &&
              event.part?.tool !== "pulso_runtime_fail",
          ).length,
          finalTextsAfterRuntimeFail: afterT2RunEvents.filter(
            (event) =>
              event.type === "text" && Boolean(event.part?.text?.trim()),
          ).length,
          sessionStatusesAfterRuntimeFail: sessionStatusAfterFail,
          idleObserved: diagnosticTrace.some(
            (event) =>
              event.type === "session.status" &&
              event.status === "idle" &&
              typeof t2 === "number" &&
              typeof event.at === "number" &&
              (event.at as number) >= t2,
          ),
          durableSessionStatusEventCount:
            openCodeState?.durableSessionStatusEventCount ?? 0,
          afterRuntimeFailTraceEventCount: afterT2Trace.length,
          timeline: diagnosticTimeline.slice(0, 250),
          responseAfterFailure: finalResponse.trim()
            ? userResponseHasBookkeeping ||
              userResponseIncludesProtocolDiagnostics
              ? "[response omitted: it contained internal identifiers or protocol diagnostics]"
              : userResponse.slice(0, 1_000)
            : null,
          process: { exitCode: run.status, signal: run.signal },
        }
      : undefined;

    const tempDataRoot =
      process.platform === "darwin"
        ? join(home, "Library/Application Support/Pulso")
        : process.platform === "win32"
          ? join(home, "Pulso")
          : join(home, "data/pulso");
    const runtime = bootstrapCapabilities(workspace, { dataDir: tempDataRoot });
    const bindings = await runtime.runtimeBindings.list();
    const workSnapshots = await Promise.all(
      [
        ...new Set([
          ...createdWorkIds,
          ...tasks.map((task) => task.envelope.work.workId),
        ]),
      ].map(async (id) => {
        try {
          return await runtime.work.snapshot(id);
        } catch {
          return undefined;
        }
      }),
    );
    const snapshots = workSnapshots.filter((value) => value !== undefined);
    const state = {
      bindings: bindings.map((binding) => binding.status),
      workItems: snapshots.flatMap((snapshot) =>
        snapshot.items.map((item) => item.status),
      ),
      executions: snapshots.flatMap((snapshot) =>
        snapshot.executions.map((execution) => execution.status),
      ),
      leases: snapshots.flatMap((snapshot) =>
        snapshot.leases.map((lease) => lease.status),
      ),
      events: snapshots.flatMap((snapshot) =>
        snapshot.events.map((entry) => entry.type),
      ),
    };
    runtime.close();
    const globalAfter = await globalStateSnapshot();
    const globalPulsoAndMcpUnchangedFinal =
      JSON.stringify(globalBefore.workspaceCounts) ===
        JSON.stringify(globalAfter.workspaceCounts) &&
      JSON.stringify(globalBefore.globalPulsoRoot) ===
        JSON.stringify(globalAfter.globalPulsoRoot) &&
      JSON.stringify(globalBefore.configHashes) ===
        JSON.stringify(globalAfter.configHashes) &&
      JSON.stringify(globalBefore.globalAuthMetadata) ===
        JSON.stringify(globalAfter.globalAuthMetadata);
    const globalChanges = {
      pulsoWorkHistory:
        JSON.stringify(globalBefore.workspaceCounts) !==
        JSON.stringify(globalAfter.workspaceCounts),
      pulsoRootMetadata:
        JSON.stringify(globalBefore.globalPulsoRoot) !==
        JSON.stringify(globalAfter.globalPulsoRoot),
      mcpConfigHashes:
        JSON.stringify(globalBefore.configHashes) !==
        JSON.stringify(globalAfter.configHashes),
      openCodeStateMetadata:
        JSON.stringify(globalBefore.globalOpenCode) !==
        JSON.stringify(globalAfter.globalOpenCode),
      authFileMetadata:
        JSON.stringify(globalBefore.globalAuthMetadata) !==
        JSON.stringify(globalAfter.globalAuthMetadata),
    };
    const globalOpenCodeChanges = Object.entries(
      globalBefore.globalOpenCode as Record<
        string,
        { contents?: Record<string, unknown> } | null
      >,
    ).flatMap(([path, before]) => {
      const after = (
        globalAfter.globalOpenCode as Record<
          string,
          { contents?: Record<string, unknown> } | null
        >
      )[path];
      const beforeContents = before?.contents ?? {};
      const afterContents = after?.contents ?? {};
      const fileNames = [
        ...new Set([
          ...Object.keys(beforeContents),
          ...Object.keys(afterContents),
        ]),
      ].filter(
        (name) =>
          JSON.stringify(beforeContents[name]) !==
          JSON.stringify(afterContents[name]),
      );
      const category = path.includes("/.config/")
        ? "config"
        : path.includes("/.local/share/")
          ? "data"
          : path.includes("/.local/state/")
            ? "state"
            : path.includes("/.cache/")
              ? "cache"
              : "other";
      return fileNames.map((file) => ({ category, file }));
    });
    const isolation = {
      homeDiffersFromDeveloper: home !== homedir(),
      workspaceInsideTempHome: workspace.startsWith(temporaryRoot),
      pulsoDataInsideTempHome: tempDataRoot.startsWith(home),
      workingSystemDbInsideTempHome: join(
        tempDataRoot,
        "workspaces",
        workspaceId(workspace),
        "work.db",
      ).startsWith(home),
      runtimeBindingsDbInsideTempHome: join(
        tempDataRoot,
        "workspaces",
        workspaceId(workspace),
        "runtime-bindings.db",
      ).startsWith(home),
      openCodeConfigInsideTempHome:
        xdgConfig.startsWith(home) && (paths.config ?? "").startsWith(home),
      openCodeDatabaseInsideTempHome:
        Boolean(env.OPENCODE_DB) && env.OPENCODE_DB.startsWith(home),
      onlyPulsoMcpRegistered:
        serverNames.length === 1 && serverNames[0] === "pulso",
      developerGlobalStateUnchanged: globalPulsoAndMcpUnchangedFinal,
      globalMcpConfigUnchanged:
        JSON.stringify(globalBefore.configHashes) ===
        JSON.stringify(globalAfter.configHashes),
      globalWorkAndHistoryCountsUnchanged:
        JSON.stringify(globalBefore.workspaceCounts) ===
        JSON.stringify(globalAfter.workspaceCounts),
      globalChanges,
      globalOpenCodeChanges,
      globalOpenCodeStateUnchanged:
        JSON.stringify(globalBefore.globalOpenCode) ===
        JSON.stringify(globalAfter.globalOpenCode),
      isolatedCommandsDidNotOpenGlobalDb: commandAudits.every(
        (command) => !command.childOpenedGlobalDb,
      ),
      globalOpenCodeOwners: commandAudits[0]?.globalDbOwnersBefore ?? [],
      commandAudits,
      temporaryOpenCodeDatabaseExists:
        (await fileMetadata(env.OPENCODE_DB)) !== null,
    };
    const lifecycle = {
      runtimeCompleteCalls: terminalCalls.filter(
        (name) => name === "pulso_runtime_complete",
      ).length,
      runtimeFailCalls: terminalCalls.filter(
        (name) => name === "pulso_runtime_fail",
      ).length,
    };
    const taskSummaries = tasks.map((task) => {
      const payload = task.result?.specialistResult;
      const specialistOutput =
        payload?.kind === "explorer"
          ? {
              findings: payload.findings.length,
              evidence: payload.findings.reduce(
                (count, finding) => count + (finding.evidence?.length ?? 0),
                0,
              ),
              references: payload.references?.length ?? 0,
            }
          : payload?.kind === "executor"
            ? {
                changes: payload.changes.length,
                validations: payload.validations?.length ?? 0,
                artifacts: payload.artifacts?.length ?? 0,
                unresolved: payload.unresolved?.length ?? 0,
              }
            : payload?.kind === "verifier"
              ? {
                  verdict: payload.verdict,
                  checks: payload.checks.length,
                  failures: payload.failures?.length ?? 0,
                  risks: payload.risks?.length ?? 0,
                }
              : undefined;
      return {
        specialist: task.envelope.specialist,
        protocol: task.envelope.protocol,
        resultContract: task.envelope.output.contract,
        bytes: task.bytes,
        dependencies: task.envelope.dependencies?.length ?? 0,
        evidenceRefs: task.evidenceCount,
        facts: task.envelope.context?.facts?.length ?? 0,
        constraints: task.envelope.constraints?.length ?? 0,
        acceptanceCriteria: task.envelope.acceptanceCriteria?.length ?? 0,
        requestedEvidence: task.envelope.requestedEvidence?.length ?? 0,
        contextTransfer: [
          "objective",
          ...(task.envelope.context?.facts?.length ? ["facts"] : []),
          ...(task.envelope.context?.references?.length ? ["Evidence"] : []),
          ...(task.envelope.dependencies?.length
            ? ["dependency summary/references"]
            : []),
          ...(task.envelope.constraints?.length ? ["constraints"] : []),
          ...(task.envelope.acceptanceCriteria?.length
            ? ["acceptance criteria"]
            : []),
        ],
        contextFields: Object.keys(task.envelope.context ?? {}),
        dependencyFields: [
          ...new Set(
            (task.envelope.dependencies ?? []).flatMap((dependency) =>
              Object.keys(dependency),
            ),
          ),
        ],
        dependencySummaryBytes: (task.envelope.dependencies ?? []).map(
          (dependency) => Buffer.byteLength(dependency.summary, "utf8"),
        ),
        taskCallIdDistinct: Boolean(task.callId),
        taskStatus: task.taskStatus ?? "not-reported",
        firstAttemptValid: task.firstAttemptValid,
        resultStatus: task.result?.status,
        ...(specialistOutput ? { specialistOutput } : {}),
        ...(task.errorCode ? { errorCode: task.errorCode } : {}),
        hasPriorResults: JSON.stringify(task.envelope).includes("priorResults"),
        hasForbiddenLifecycleIds: containsForbiddenLifecycleId(task.envelope),
        dependencyIsCompact: (task.envelope.dependencies ?? []).every(
          (dependency) =>
            Object.keys(dependency).every((key) =>
              ["workItemId", "summary", "artifacts"].includes(key),
            ),
        ),
      };
    });
    const taskFor = (specialist: TaskEnvelope["specialist"]) =>
      tasks.find((task) => task.envelope.specialist === specialist);
    const explorerTask = taskFor("explorer");
    const executorTask = taskFor("executor");
    const verifierTask = taskFor("verifier");
    const executorDependency = executorTask?.envelope.dependencies?.[0];
    const verifierDependency = verifierTask?.envelope.dependencies?.[0];
    const fixtureText =
      mode === "chain" || mode === "executor"
        ? await readFile(
            join(
              workspace,
              mode === "chain" ? "fixture/message.txt" : "fixture.txt",
            ),
            "utf8",
          ).catch(() => "")
        : undefined;
    const executorStandalone = tasks.find(
      (task) => task.envelope.specialist === "executor",
    );
    const verifierStandalone = tasks.find(
      (task) => task.envelope.specialist === "verifier",
    );
    const invalidTask = tasks.find(
      (task) => task.errorCode === "PULSO_PROTOCOL_INVALID_RESULT",
    );
    const invalidResultLifecycle = {
      afterRejected: Boolean(invalidTask),
      runtimeCompleteCalls: lifecycle.runtimeCompleteCalls,
      runtimeFailCalls: lifecycle.runtimeFailCalls,
      bindingFailed:
        state.bindings.length === 1 && state.bindings[0] === "failed",
      executionFailed:
        state.executions.length === 1 && state.executions[0] === "failed",
      leaseReleased:
        state.leases.length === 1 && state.leases[0] === "released",
      workItemFailed:
        state.workItems.length === 1 && state.workItems[0] === "failed",
      requiredEventsPresent: [
        "execution.failed",
        "lease.released",
        "item.failed",
      ].every((event) => state.events.includes(event)),
    };
    const chainChecks = {
      specialistsOnceInOrder:
        tasks.filter((task) => task.envelope.specialist === "explorer")
          .length === 1 &&
        tasks.filter((task) => task.envelope.specialist === "executor")
          .length === 1 &&
        tasks.filter((task) => task.envelope.specialist === "verifier")
          .length === 1 &&
        tasks.findIndex((task) => task.envelope.specialist === "explorer") <
          tasks.findIndex((task) => task.envelope.specialist === "executor") &&
        tasks.findIndex((task) => task.envelope.specialist === "executor") <
          tasks.findIndex((task) => task.envelope.specialist === "verifier"),
      allFirstAttemptValid:
        tasks.length === 3 && tasks.every((task) => task.firstAttemptValid),
      executorHasChangeAndValidation:
        executorTask?.result?.specialistResult.kind === "executor" &&
        executorTask.result.specialistResult.changes.length > 0 &&
        (executorTask.result.specialistResult.validations?.length ?? 0) > 0,
      verifierSeparatesTaskStatusAndVerdict:
        verifierTask?.result?.status === "completed" &&
        verifierTask.result.specialistResult.kind === "verifier" &&
        ["pass", "fail", "partial"].includes(
          verifierTask.result.specialistResult.verdict,
        ),
      explorerToExecutorDependency:
        Boolean(explorerTask && executorDependency) &&
        executorDependency?.workItemId ===
          explorerTask?.envelope.work.workItemId,
      executorToVerifierDependency:
        Boolean(executorTask && verifierDependency) &&
        verifierDependency?.workItemId ===
          executorTask?.envelope.work.workItemId,
      evidenceTransferredToExecutor: (executorTask?.evidenceCount ?? 0) > 0,
      evidenceTransferredToVerifier: (verifierTask?.evidenceCount ?? 0) > 0,
      acceptanceCriteriaPassedToExecutor:
        (executorTask?.envelope.acceptanceCriteria?.length ?? 0) > 0,
      acceptanceCriteriaPassedToVerifier:
        (verifierTask?.envelope.acceptanceCriteria?.length ?? 0) > 0,
      uniqueTaskIdentities:
        new Set(tasks.map((task) => task.envelope.delegationId)).size ===
        tasks.length,
      uniqueBindings: new Set(bindingIds).size === tasks.length,
      dependenciesCompact: tasks
        .slice(1)
        .every(
          (task) =>
            (task.envelope.dependencies?.length ?? 0) > 0 &&
            task.envelope.dependencies?.every((dependency) =>
              Object.keys(dependency).every((key) =>
                ["workItemId", "summary", "artifacts"].includes(key),
              ),
            ),
        ),
      fixtureUpdatedExactly: fixtureText === "status=after\n",
    };
    const modePassed =
      mode === "preflight"
        ? isolation.homeDiffersFromDeveloper &&
          isolation.workspaceInsideTempHome &&
          isolation.pulsoDataInsideTempHome &&
          isolation.workingSystemDbInsideTempHome &&
          isolation.runtimeBindingsDbInsideTempHome &&
          isolation.openCodeConfigInsideTempHome &&
          isolation.openCodeDatabaseInsideTempHome &&
          isolation.onlyPulsoMcpRegistered &&
          isolation.developerGlobalStateUnchanged &&
          isolation.isolatedCommandsDidNotOpenGlobalDb &&
          isolation.temporaryOpenCodeDatabaseExists &&
          state.bindings.length === 0 &&
          state.workItems.length === 0 &&
          state.executions.length === 0 &&
          state.leases.length === 0
        : ["invalid-result", "invalid-result-diagnostic"].includes(mode)
          ? tasks.length === 1 &&
            invalidResultLifecycle.afterRejected &&
            invalidResultLifecycle.runtimeCompleteCalls === 0 &&
            invalidResultLifecycle.runtimeFailCalls === 1 &&
            invalidResultLifecycle.bindingFailed &&
            invalidResultLifecycle.executionFailed &&
            invalidResultLifecycle.leaseReleased &&
            invalidResultLifecycle.workItemFailed &&
            invalidResultLifecycle.requiredEventsPresent &&
            runHasNoGlobalDbOwner &&
            isolation.developerGlobalStateUnchanged &&
            !leaksIdentifier &&
            !userResponseHasBookkeeping &&
            !userResponseIncludesProtocolDiagnostics &&
            finalResponse.trim().length > 0
          : mode === "valid-control"
            ? tasks.length === 1 &&
              tasks[0]?.envelope.specialist === "explorer" &&
              tasks[0]?.firstAttemptValid === true &&
              lifecycle.runtimeCompleteCalls === 1 &&
              lifecycle.runtimeFailCalls === 0 &&
              state.bindings.every((status) => status === "completed") &&
              state.executions.every((status) => status === "completed") &&
              state.leases.every((status) => status === "released") &&
              runHasNoGlobalDbOwner &&
              isolation.developerGlobalStateUnchanged &&
              finalResponse.trim().length > 0
            : mode === "executor"
              ? tasks.length === 1 &&
                executorStandalone?.firstAttemptValid === true &&
                executorStandalone.result?.status === "completed" &&
                executorStandalone.result?.specialistResult.kind ===
                  "executor" &&
                executorStandalone.result.specialistResult.changes.length > 0 &&
                (executorStandalone.result.specialistResult.validations
                  ?.length ?? 0) > 0 &&
                lifecycle.runtimeCompleteCalls === 1 &&
                lifecycle.runtimeFailCalls === 0 &&
                state.bindings.length === 1 &&
                state.bindings[0] === "completed" &&
                state.executions[0] === "completed" &&
                state.leases[0] === "released" &&
                fixtureText === "status=after\n" &&
                runHasNoGlobalDbOwner &&
                isolation.developerGlobalStateUnchanged
              : mode === "verifier"
                ? tasks.length === 1 &&
                  verifierStandalone?.firstAttemptValid === true &&
                  verifierStandalone.result?.status === "completed" &&
                  verifierStandalone.result?.specialistResult.kind ===
                    "verifier" &&
                  verifierStandalone.result.specialistResult.checks.length >
                    0 &&
                  lifecycle.runtimeCompleteCalls === 1 &&
                  lifecycle.runtimeFailCalls === 0 &&
                  state.bindings[0] === "completed" &&
                  state.executions[0] === "completed" &&
                  state.leases[0] === "released" &&
                  runHasNoGlobalDbOwner &&
                  isolation.developerGlobalStateUnchanged
                : mode === "chain"
                  ? Object.values(chainChecks).every(Boolean) &&
                    state.bindings.every((status) => status === "completed") &&
                    state.executions.every(
                      (status) => status === "completed",
                    ) &&
                    state.leases.every((status) => status === "released") &&
                    runHasNoGlobalDbOwner &&
                    isolation.developerGlobalStateUnchanged
                  : tasks.length === 2 &&
                    tasks.every((task) => task.firstAttemptValid) &&
                    new Set(tasks.map((task) => task.callId)).size === 2 &&
                    new Set(bindingIds).size === 2 &&
                    state.bindings.length === 2 &&
                    state.bindings.every((status) => status === "completed") &&
                    runHasNoGlobalDbOwner &&
                    isolation.developerGlobalStateUnchanged;
    const report = {
      mode,
      runtimeVersion,
      model,
      openCodeVersion: versionResult.stdout?.trim(),
      exitCode: run.status,
      signal: run.signal,
      isolation,
      taskMetrics: taskSummaries,
      invalidResultLifecycle,
      chainChecks: mode === "chain" ? chainChecks : undefined,
      parallel:
        mode === "parallel"
          ? {
              taskCount: tasks.length,
              distinctTaskCallIds:
                new Set(tasks.map((task) => task.callId)).size === tasks.length,
              distinctBindingIds:
                new Set(bindingIds).size === bindingIds.length,
              sameAssistantMessage:
                new Set(tasks.map((task) => task.messageId)).size === 1,
              resultIdentitiesValidated: tasks.every(
                (task) => task.firstAttemptValid,
              ),
            }
          : undefined,
      runtimeDiagnostic,
      taskCallIdsDistinct:
        new Set(tasks.map((task) => task.callId)).size === tasks.length,
      lifecycle,
      mcpUx: toolUx,
      finalState: {
        bindingStatuses: state.bindings,
        itemStatuses: state.workItems,
        executionStatuses: state.executions,
        leaseStatuses: state.leases,
        eventTypes: [...new Set(state.events)],
        activeBindings: state.bindings.filter((status) => status === "active")
          .length,
        runningExecutions: state.executions.filter(
          (status) => status === "running",
        ).length,
        activeLeases: state.leases.filter((status) => status === "active")
          .length,
      },
      userResponse,
      userResponseLeakedKnownId: leaksIdentifier,
      userResponseHasBookkeeping,
      userResponseIncludesProtocolDiagnostics,
      sanitization:
        "only the selected OpenAI credential was staged in temp HOME; raw tool/config/auth/environment output is never persisted or printed; secret-like keys/values and IDs are redacted before transcript output",
      pass: modePassed,
    };
    await rm(temporaryRoot, { recursive: true, force: true });
    let temporaryRootRemoved = false;
    try {
      await stat(temporaryRoot);
    } catch (error) {
      temporaryRootRemoved = (error as { code?: string }).code === "ENOENT";
    }
    assert(temporaryRootRemoved, "TEMPORARY_ROOT_NOT_REMOVED");
    Object.assign(report, { temporaryRootRemoved });
    const scrubbed = sanitizeForTranscript(report);
    console.log(JSON.stringify(scrubbed, null, 2));
    assert(
      isolation.developerGlobalStateUnchanged,
      "DEVELOPER_GLOBAL_PULSO_OR_MCP_CONFIG_CHANGED",
    );
    assert(modePassed, `SMOKE_FAILED:${mode}`);
    return report;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

const mode = process.argv[2] as SmokeMode | undefined;
assert(mode && modes.includes(mode), `USAGE: ${modes.join("|")}`);
try {
  await runIsolatedOpenCode(mode);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify(sanitizeForTranscript({ error: message })));
  process.exitCode = 1;
}
