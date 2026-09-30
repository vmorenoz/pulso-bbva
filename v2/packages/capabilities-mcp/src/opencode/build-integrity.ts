import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ManagedAsset = {
  path: string;
  sha256: string;
};
type BuildManifest = {
  buildId: string;
  files: Record<string, string>;
  nativeBridge: ManagedAsset;
};
export type ActivePulsoBuild = {
  buildId: string;
  manifestPath: string;
};

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const buildId = () =>
  typeof __PULSO_BUILD_ID__ === "string" ? __PULSO_BUILD_ID__ : "development";
const canonicalPath = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};
const isManagedPath = (root: string, path: string) => {
  const pathFromRoot = relative(canonicalPath(root), canonicalPath(path));
  return (
    pathFromRoot.length > 0 &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith("../")
  );
};
const managedAsset = (value: unknown): ManagedAsset | undefined => {
  if (!isRecord(value)) return undefined;
  if (typeof value.path !== "string" || typeof value.sha256 !== "string")
    return undefined;
  return { path: value.path, sha256: value.sha256 };
};

/**
 * The manifest switch activates the complete managed OpenCode bridge build.
 */
export const assertActivePulsoBuild = (): ActivePulsoBuild | undefined => {
  const expectedBuildId = buildId();
  if (expectedBuildId === "development") return;
  const entrypointPath = fileURLToPath(import.meta.url);
  const root = dirname(dirname(canonicalPath(entrypointPath)));
  const manifestPath = join(root, ".pulso-manifest.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error("OPENCODE_BUILD_INCOHERENT:manifest_missing_or_invalid");
  }
  if (!isRecord(parsed))
    throw new Error("OPENCODE_BUILD_INCOHERENT:manifest_missing_or_invalid");
  const manifest = parsed as Partial<BuildManifest>;
  if (manifest.buildId !== expectedBuildId)
    throw new Error("OPENCODE_BUILD_INCOHERENT:build_id_mismatch");
  if (!isRecord(manifest.files))
    throw new Error("OPENCODE_BUILD_INCOHERENT:manifest_shape");
  const bridge = managedAsset(manifest.nativeBridge);
  if (!bridge) throw new Error("OPENCODE_BUILD_INCOHERENT:manifest_shape");
  if (
    canonicalPath(bridge.path) !==
      join(canonicalPath(root), "plugins", "pulso-protocol-guard.js") ||
    !isManagedPath(root, bridge.path)
  )
    throw new Error("OPENCODE_BUILD_INCOHERENT:bridge_identity");
  const assets = [bridge];
  for (const asset of assets) {
    if (manifest.files[asset.path] !== asset.sha256)
      throw new Error("OPENCODE_BUILD_INCOHERENT:manifest_asset_identity");
    try {
      if (digest(readFileSync(asset.path, "utf8")) !== asset.sha256)
        throw new Error("asset_hash");
    } catch {
      throw new Error("OPENCODE_BUILD_INCOHERENT:asset_hash");
    }
  }
  for (const [path, expectedHash] of Object.entries(manifest.files)) {
    if (typeof expectedHash !== "string" || !isManagedPath(root, path))
      throw new Error("OPENCODE_BUILD_INCOHERENT:asset_hash");
    try {
      if (digest(readFileSync(path, "utf8")) !== expectedHash)
        throw new Error("asset_hash");
    } catch {
      throw new Error("OPENCODE_BUILD_INCOHERENT:asset_hash");
    }
  }
  return { buildId: expectedBuildId, manifestPath };
};

declare const __PULSO_BUILD_ID__: string;
