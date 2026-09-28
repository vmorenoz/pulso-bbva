import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { sanitizeEvidence } from "./native-evidence";

export type SmokeArtifact = { path: string; bytes: number; sha256: string };

export class SmokeArtifactArchive {
  readonly runId: string;
  readonly directory: string;
  private artifacts: SmokeArtifact[] = [];
  private archiveComplete = true;
  private readonly root: string;

  private constructor(root: string, runId: string) {
    this.root = resolve(root);
    this.runId = runId;
    this.directory = join(this.root, runId);
  }

  static async create(
    v2Root: string,
    runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
  ) {
    const override = process.env.PULSO_SMOKE_EVIDENCE_DIR;
    if (override && !isAbsolute(override))
      throw new Error("PULSO_SMOKE_EVIDENCE_DIR_MUST_BE_ABSOLUTE");
    const root = override
      ? resolve(override)
      : join(resolve(v2Root), ".pulso-evidence");
    if (!isAbsolute(root)) throw new Error("EVIDENCE_ROOT_NOT_ABSOLUTE");
    const archive = new SmokeArtifactArchive(root, runId);
    await mkdir(archive.directory, { recursive: true, mode: 0o700 });
    await chmod(root, 0o700);
    await chmod(archive.directory, 0o700);
    return archive;
  }

  async write(path: string, value: unknown) {
    const destination = resolve(this.directory, path);
    const rel = relative(this.directory, destination);
    if (!rel || rel.startsWith("..") || isAbsolute(rel))
      throw new Error("EVIDENCE_PATH_ESCAPES_ARCHIVE");
    const bytes = Buffer.from(
      typeof value === "string"
        ? String(sanitizeEvidence(value))
        : JSON.stringify(sanitizeEvidence(value), null, 2),
      "utf8",
    );
    await mkdir(join(destination, ".."), { recursive: true, mode: 0o700 });
    await chmod(join(destination, ".."), 0o700);
    await writeFile(destination, bytes, { mode: 0o600, flag: "wx" });
    this.artifacts.push({
      path: rel,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return destination;
  }

  markIncomplete() {
    this.archiveComplete = false;
  }

  async finalize(metadata: Record<string, unknown> = {}) {
    const manifest = {
      runId: this.runId,
      archiveComplete: this.archiveComplete,
      artifacts: this.artifacts,
      ...(sanitizeEvidence(metadata) as Record<string, unknown>),
    };
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(join(this.directory, "manifest.json"), bytes, {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(join(this.directory, "manifest.json"), 0o600);
    return {
      directory: this.directory,
      archiveComplete: this.archiveComplete,
      manifest,
    };
  }
}
