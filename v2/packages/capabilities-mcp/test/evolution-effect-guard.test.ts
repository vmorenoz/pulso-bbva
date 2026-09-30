import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractNativePaths,
  guardNativeEffect,
} from "../src/opencode/effect-guard";

const make = (
  workspace: string,
  mode: "read" | "files" | "exclusive" = "files",
  files = ["src/a.ts", "src/b.ts"],
) => ({
  workspace: realpathSync(workspace),
  mode,
  files,
  leaseValid: true,
  fenced: false,
  cancelled: false,
});

test("extracts all native paths, including every patch move/update/delete", () => {
  expect(
    extractNativePaths("apply_patch", {
      patch: [
        "*** Begin Patch",
        "*** Update File: src/old.ts",
        "*** Move to: src/new.ts",
        "*** Delete File: src/remove.ts",
        "*** Add File: src/add.ts",
        "*** End Patch",
      ].join("\n"),
    }),
  ).toEqual(["src/old.ts", "src/new.ts", "src/remove.ts", "src/add.ts"]);
  expect(extractNativePaths("edit", { filePath: "src/a.ts" })).toEqual([
    "src/a.ts",
  ]);
});

test("guards declared writes and rejects undeclared, traversal and unknown effects", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-effect-guard-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/a.ts"), "a");
    expect(
      await guardNativeEffect({
        tool: "write",
        args: { filePath: "src/a.ts" },
        policy: make(root),
      }),
    ).toEqual([join(realpathSync(root), "src/a.ts")]);
    await expect(
      guardNativeEffect({
        tool: "write",
        args: { filePath: "src/other.ts" },
        policy: make(root),
      }),
    ).rejects.toThrow("EFFECT_RESOURCE_NOT_DECLARED");
    await expect(
      guardNativeEffect({
        tool: "read",
        args: { filePath: "../outside" },
        policy: make(root, "read"),
      }),
    ).rejects.toThrow("EFFECT_PATH_INVALID");
    await expect(
      guardNativeEffect({
        tool: "opaque",
        args: {},
        policy: make(root, "read"),
      }),
    ).rejects.toThrow("EFFECT_NOT_AUTHORIZED");
    await expect(
      guardNativeEffect({
        tool: "opaque",
        args: {},
        policy: make(root, "exclusive"),
      }),
    ).rejects.toThrow("EFFECT_NOT_AUTHORIZED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("read mode blocks writes and authority uncertainty always fails closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-effect-authority-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/a.ts"), "a");
    await expect(
      guardNativeEffect({
        tool: "edit",
        args: { filePath: "src/a.ts" },
        policy: make(root, "read"),
      }),
    ).rejects.toThrow("EFFECT_NOT_AUTHORIZED");
    await expect(
      guardNativeEffect({
        tool: "read",
        args: { filePath: "src/a.ts" },
        policy: { ...make(root, "read"), sideEffectsMayContinue: true },
      }),
    ).rejects.toThrow("EFFECT_AUTHORITY_INVALID");
    await expect(
      guardNativeEffect({
        tool: "read",
        args: { filePath: "src/a.ts" },
        policy: { ...make(root, "read"), leaseValid: false },
      }),
    ).rejects.toThrow("EFFECT_AUTHORITY_INVALID");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("realpath rejects a symlink escape and destination new file uses real parent", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-effect-symlink-"));
  const outside = mkdtempSync(join(tmpdir(), "pulso-effect-outside-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(outside, "secret.ts"), "secret");
    symlinkSync(outside, join(root, "src/out"));
    await expect(
      guardNativeEffect({
        tool: "read",
        args: { filePath: "src/out/secret.ts" },
        policy: make(root, "read"),
      }),
    ).rejects.toThrow("EFFECT_PATH_SYMLINK_ESCAPE");
    expect(
      await guardNativeEffect({
        tool: "write",
        args: { filePath: "src/new.ts" },
        policy: make(root, "files", ["src/new.ts"]),
      }),
    ).toEqual([join(realpathSync(root), "src/new.ts")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("write tools deny protected control roots, including patch move sources and destinations", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-effect-protected-paths-"));
  try {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["edit", { filePath: ".git/config" }],
      ["write", { filePath: ".opencode/agent/pulso.md" }],
      [
        "apply_patch",
        {
          patch:
            "*** Begin Patch\n*** Delete File: .pulso/state.json\n*** End Patch",
        },
      ],
      [
        "apply_patch",
        {
          patch:
            "*** Begin Patch\n*** Update File: src/original.ts\n*** Move to: .pulso/artifacts/result.json\n*** End Patch",
        },
      ],
      [
        "apply_patch",
        {
          patch:
            "*** Begin Patch\n*** Update File: .git/config\n*** Move to: src/config-copy\n*** End Patch",
        },
      ],
    ];
    for (const [tool, args] of cases) {
      await expect(
        guardNativeEffect({ tool, args, policy: make(root, "files", []) }),
      ).rejects.toThrow("EFFECT_PROTECTED_PATH");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("read and search routes deny protected control roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-effect-protected-reads-"));
  try {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["read", { filePath: ".git/config" }],
      ["grep", { path: ".opencode/agents" }],
      ["glob", { pattern: ".pulso/**/*.json" }],
      ["glob", { pattern: "**/.pulso/**" }],
    ];
    for (const [tool, args] of cases) {
      await expect(
        guardNativeEffect({ tool, args, policy: make(root, "read") }),
      ).rejects.toThrow("EFFECT_PROTECTED_PATH");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell remains exclusive and rejects direct protected-root references", async () => {
  const root = mkdtempSync(join(tmpdir(), "pulso-effect-shell-"));
  const shellPolicy = {
    ...make(root, "exclusive"),
    allowedTools: ["bash"],
  };
  try {
    await expect(
      guardNativeEffect({
        tool: "bash",
        args: { command: "rm -rf .pulso" },
        policy: shellPolicy,
      }),
    ).rejects.toThrow("EFFECT_PROTECTED_PATH");
    await expect(
      guardNativeEffect({
        tool: "bash",
        args: { command: `git -C ${join(realpathSync(root), ".git")} status` },
        policy: shellPolicy,
      }),
    ).rejects.toThrow("EFFECT_PROTECTED_PATH");
    await expect(
      guardNativeEffect({
        tool: "bash",
        args: { command: "npm test" },
        policy: shellPolicy,
      }),
    ).resolves.toEqual([]);
    await expect(
      guardNativeEffect({
        tool: "bash",
        args: { command: "npm test" },
        policy: make(root, "files"),
      }),
    ).rejects.toThrow("EFFECT_NOT_AUTHORIZED");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
