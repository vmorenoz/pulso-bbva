import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type EffectMode = "read" | "files" | "exclusive";
export type GuardPolicy = {
  workspace: string;
  mode: EffectMode;
  files?: string[];
  leaseValid: boolean;
  fenced: boolean;
  cancelled: boolean;
  sideEffectsMayContinue?: boolean;
  /** Exact host tool IDs are allowlisted; unknown tools are denied. */
  allowedTools?: string[];
};
export type GuardInput = {
  tool: string;
  args: Record<string, unknown>;
  policy: GuardPolicy;
};

const fail = (code: string): never => {
  throw new Error(code);
};
const values = (args: Record<string, unknown>, ...keys: string[]) =>
  keys.flatMap((key) =>
    typeof args[key] === "string" ? [args[key] as string] : [],
  );

/** Extract every source and destination mentioned by the supported native tools. */
export const extractNativePaths = (
  tool: string,
  args: Record<string, unknown>,
): string[] => {
  switch (tool) {
    case "read":
      return values(args, "filePath", "path");
    case "glob":
      return values(args, "pattern")
        .map((p) => {
          const slash = p.replaceAll("\\", "/");
          const firstGlob = slash.search(/[?*[{]/);
          return firstGlob < 0
            ? slash
            : slash.slice(0, slash.lastIndexOf("/", firstGlob));
        })
        .filter(Boolean);
    case "grep":
      return values(args, "path");
    case "edit":
      return values(args, "filePath", "path");
    case "write":
      return values(args, "filePath", "path");
    case "apply_patch": {
      const patch = values(args, "patch", "input").join("\n");
      const paths: string[] = [];
      let moveSource: string | undefined;
      for (const line of patch.split(/\r?\n/)) {
        const file = line.match(
          /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s*(.+?)\s*$/,
        );
        const from = line.match(/^\*\*\*\s+Move\s+from:\s*(.+?)\s*$/);
        const to = line.match(/^\*\*\*\s+Move\s+to:\s*(.+?)\s*$/);
        if (file) {
          paths.push(file[1]);
          if (/^\*\*\*\s+Update\s+File:/.test(line)) moveSource = file[1];
          else moveSource = undefined;
        }
        if (from) {
          moveSource = from[1];
          paths.push(from[1]);
        }
        if (to) {
          if (!moveSource) fail("EFFECT_PATCH_MOVE_SOURCE_MISSING");
          paths.push(to[1]);
          moveSource = undefined;
        }
      }
      return paths;
    }
    default:
      return [];
  }
};

const toolKind = (tool: string): "read" | "write" | "unknown" => {
  if (["read", "glob", "grep"].includes(tool)) return "read";
  if (["edit", "write", "apply_patch"].includes(tool)) return "write";
  return "unknown";
};
const isShellTool = (tool: string) => ["bash", "shell"].includes(tool);
const protectedPath = (root: string, candidate: string) => {
  const relativePath = relative(root, candidate).replaceAll("\\", "/");
  return relativePath
    .split("/")
    .some((segment) =>
      [".git", ".opencode", ".pulso"].includes(segment.toLowerCase()),
    );
};
const directlyReferencesProtectedRoot = (command: string) =>
  /(?:^|[\s"'=:/])(?:\.\.?\/)*\.(?:git|opencode|pulso)(?=$|[\s/\\"';&|])/i.test(
    command,
  );
const inside = (root: string, candidate: string) => {
  const rel = relative(root, candidate);
  return (
    rel === "" ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
  );
};

/** Validate once immediately before dispatch. Call again at the host before hook. */
export const guardNativeEffect = async ({ tool, args, policy }: GuardInput) => {
  if (
    !policy.leaseValid ||
    policy.fenced ||
    policy.cancelled ||
    policy.sideEffectsMayContinue
  )
    fail("EFFECT_AUTHORITY_INVALID");
  if (policy.allowedTools && !policy.allowedTools.includes(tool))
    fail("EFFECT_NOT_AUTHORIZED");
  if (isShellTool(tool)) {
    if (policy.mode !== "exclusive" || !policy.allowedTools?.includes(tool))
      fail("EFFECT_NOT_AUTHORIZED");
    const command = values(args, "command", "cmd", "script").join("\n");
    if (!command) fail("EFFECT_COMMAND_UNINTERPRETABLE");
    if (directlyReferencesProtectedRoot(command)) fail("EFFECT_PROTECTED_PATH");
    // Exclusive shell remains subject to OpenCode's permission boundary; this
    // check only blocks direct references to protected Pulso/control roots.
    return [];
  }
  const kind = toolKind(tool);
  if (kind === "unknown") {
    if (policy.mode !== "exclusive" || !policy.allowedTools?.includes(tool))
      fail("EFFECT_NOT_AUTHORIZED");
    return [];
  }
  if (policy.mode === "read" && kind !== "read") fail("EFFECT_NOT_AUTHORIZED");
  const paths = extractNativePaths(tool, args);
  if (!paths.length) fail("EFFECT_PATH_UNINTERPRETABLE");
  const root = await realpath(policy.workspace);
  const verified: string[] = [];
  for (const raw of paths) {
    if (!raw || raw.includes("\0") || raw.split(/[\\/]/).includes(".."))
      fail("EFFECT_PATH_INVALID");
    const normalized = raw.replaceAll("\\", "/");
    const absolute = resolve(root, normalized);
    if (!inside(root, absolute)) fail("EFFECT_PATH_OUTSIDE_WORKSPACE");
    if (protectedPath(root, absolute)) fail("EFFECT_PROTECTED_PATH");
    let cursor = absolute;
    let missing = false;
    while (true) {
      try {
        await lstat(cursor);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        missing = true;
        const parent = resolve(cursor, "..");
        if (parent === cursor) fail("EFFECT_PATH_INVALID");
        cursor = parent;
      }
    }
    const ancestor = await realpath(cursor);
    if (!inside(root, ancestor)) fail("EFFECT_PATH_SYMLINK_ESCAPE");
    if (!missing) {
      const actual = await realpath(absolute);
      if (!inside(root, actual)) fail("EFFECT_PATH_SYMLINK_ESCAPE");
      if (actual !== absolute && process.platform === "darwin")
        fail("EFFECT_PATH_CASE_MISMATCH");
      verified.push(actual);
    } else verified.push(absolute);
  }
  if (kind === "write") {
    if (policy.mode !== "files" && policy.mode !== "exclusive")
      fail("EFFECT_NOT_AUTHORIZED");
    if (policy.mode === "files") {
      const allowed = new Set(
        (policy.files ?? []).map((path) => resolve(root, path)),
      );
      if (verified.some((path) => !allowed.has(path)))
        fail("EFFECT_RESOURCE_NOT_DECLARED");
    }
  }
  return verified;
};
