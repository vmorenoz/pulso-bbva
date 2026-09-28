import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  validateExecutablePlan,
  validateGraph,
} from "../../../orchestration/src/adaptive/decision-kernel";
import type {
  Evidence,
  ExecutablePlan,
} from "../../../orchestration/src/adaptive/types";
import type { CapabilitiesRuntime } from "../bootstrap";
import type { RuntimeExecutionBinding } from "../runtime";
import { type NativeDelegation, NativeJournal } from "./native-journal";

export type InventoryArtifact = {
  protocol: "pulso-inventory/1";
  complete: boolean;
  universe: string[];
  exclusions: { path: string; reason: string }[];
  entries: {
    target: string;
    specs: string[];
    evidenceLevel: "located" | "reviewed" | "executed" | "coverage-measured";
    behaviors: string[];
    evidence: Evidence[];
  }[];
  limitations: string[];
};
export type ReviewArtifact = {
  protocol: "pulso-review/1";
  artifactRef: string;
  verdict: "pass" | "fail" | "partial";
  checks: {
    criterion: string;
    result: "pass" | "fail" | "unknown";
    evidence: Evidence[];
  }[];
  limitations: string[];
};
export type ArtifactDocument =
  | InventoryArtifact
  | ExecutablePlan
  | ReviewArtifact;
export type ArtifactKind = "inventory" | "plan" | "review";
export type PublishedArtifact = {
  reference: string;
  kind: ArtifactKind;
  state: "staged" | "accepted" | "rejected";
  revision: number;
  hash: string;
  jsonPath: string;
  markdownPath: string;
  workId: string;
  workItemId: string;
  delegationId: string;
  artifactId?: string;
};
type ArtifactMetadata = {
  protocol: "pulso-artifact-state/1";
  reference: string;
  kind: ArtifactKind;
  state: "staged" | "accepted" | "rejected";
  revision: number;
  hash: string;
  workId: string;
  workItemId: string;
  delegationId: string;
  parentSessionId: string;
  workspaceId: string;
  receiptHash?: string;
  artifactId?: string;
};
type ArtifactJournal = Pick<NativeJournal, "get" | "ownsWork">;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const canonical = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
};
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const nonempty = (s: unknown): s is string =>
  typeof s === "string" && !!s.trim();
const kindOf = (doc: ArtifactDocument): ArtifactKind =>
  doc.protocol === "pulso-plan/1"
    ? "plan"
    : doc.protocol === "pulso-inventory/1"
      ? "inventory"
      : "review";
function fail(code: string, message: string): never {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
}

function validateInventory(doc: InventoryArtifact) {
  if (
    doc.protocol !== "pulso-inventory/1" ||
    !Array.isArray(doc.universe) ||
    !Array.isArray(doc.entries) ||
    !Array.isArray(doc.exclusions) ||
    !Array.isArray(doc.limitations)
  )
    fail("ARTIFACT_SCHEMA_INVALID", "Inventory shape is invalid");
  if (new Set(doc.universe).size !== doc.universe.length)
    fail(
      "INVENTORY_UNIVERSE_INVALID",
      "Inventory universe contains duplicates",
    );
  const covered = [
    ...doc.entries.map((x) => x.target),
    ...doc.exclusions.map((x) => x.path),
  ];
  if (
    covered.some((x) => !nonempty(x)) ||
    new Set(covered).size !== covered.length ||
    covered.length !== doc.universe.length ||
    doc.universe.some((x) => !covered.includes(x))
  )
    fail(
      "INVENTORY_UNIVERSE_INCOMPLETE",
      "Every universe item must have exactly one entry or justified exclusion",
    );
  for (const e of doc.entries)
    if (
      !Array.isArray(e.specs) ||
      !Array.isArray(e.behaviors) ||
      !Array.isArray(e.evidence) ||
      !["located", "reviewed", "executed", "coverage-measured"].includes(
        e.evidenceLevel,
      )
    )
      fail("ARTIFACT_SCHEMA_INVALID", "Inventory entry is invalid");
  for (const e of doc.exclusions)
    if (!nonempty(e.reason)) fail("INVENTORY_EXCLUSION_UNJUSTIFIED", e.path);
  if (doc.complete && doc.limitations.length)
    fail(
      "INVENTORY_NOT_COMPLETE",
      "A complete inventory cannot retain material limitations",
    );
}

export function validatePlanReadiness(doc: ExecutablePlan) {
  validateExecutablePlan(doc);
  validateGraph(doc.graph);
  if (doc.status === "ready") {
    if (!doc.inventoryComplete || doc.unresolved.length || !doc.targets.length)
      fail(
        "PLAN_NOT_READY",
        "Ready plan needs a complete inventory and no unresolved questions",
      );
    for (const target of doc.targets) {
      const safe =
        target.path &&
        !target.path.startsWith("/") &&
        !target.path.split("/").some((p) => !p || p === "." || p === "..");
      if (!safe) fail("PLAN_TARGET_PATH_INVALID", target.path);
      if (
        target.existence === "existing" &&
        !target.evidence.some((e) => e.kind === "file" && e.ref === target.path)
      )
        fail("PLAN_TARGET_EVIDENCE_REQUIRED", target.path);
      if (
        target.existence === "new" &&
        !target.evidence.some(
          (e) =>
            e.kind === "file" &&
            /new|create|does not exist/i.test(`${e.note ?? ""} ${e.ref}`),
        )
      )
        fail("PLAN_NEW_TARGET_UNVERIFIED", target.path);
      if (!target.behaviors.length)
        fail("PLAN_TARGET_UNSUPPORTED", target.path);
    }
  }
}

function validateReview(doc: ReviewArtifact, target: ArtifactDocument) {
  if (doc.protocol !== "pulso-review/1" || !doc.checks.length)
    fail("ARTIFACT_SCHEMA_INVALID", "Review must have checks");
  if (kindOf(target) !== "plan")
    fail("REVIEW_TARGET_INVALID", "Review must reference a plan");
  const plan = target as ExecutablePlan;
  const expected = [
    ...plan.graph.branches.flatMap((b) => b.criteria.map((c) => c.key)),
    ...plan.targets.map((t) => `target:${t.path}`),
  ];
  const checked = doc.checks.map((c) => c.criterion);
  if (
    new Set(checked).size !== checked.length ||
    expected.some((c) => !checked.includes(c))
  )
    fail(
      "REVIEW_CRITERIA_INCOMPLETE",
      "Review must assess every branch criterion and target",
    );
  if (doc.checks.some((c) => c.result === "pass" && !c.evidence.length))
    fail("REVIEW_EVIDENCE_REQUIRED", "Passing checks require evidence");
  if (doc.verdict === "pass" && doc.checks.some((c) => c.result !== "pass"))
    fail("REVIEW_VERDICT_UNSUPPORTED", "Pass requires every check to pass");
  if (doc.verdict === "pass" && plan.status !== "ready")
    fail("REVIEW_PLAN_NOT_READY", "Draft plans cannot be approved");
}

function markdown(doc: ArtifactDocument, hash: string, revision: number) {
  const lines = [
    `# ${kindOf(doc)} · revisión ${revision}`,
    "",
    `Hash: ${hash}`,
    "",
    `\`\`\`json`,
    canonical(doc),
    "```",
  ];
  if (doc.protocol === "pulso-plan/1")
    lines.push(
      "",
      "## Objetivos",
      ...doc.targets.map(
        (t) => `- ${t.path} (${t.existence}): ${t.behaviors.join("; ")}`,
      ),
      "",
      `Estado: **${doc.status}**`,
    );
  if (doc.protocol === "pulso-inventory/1")
    lines.push(
      "",
      "## Cobertura",
      ...doc.universe.map(
        (x) =>
          `- ${x}: ${doc.entries.some((e) => e.target === x) ? "inventariado" : "excluido"}`,
      ),
    );
  if (doc.protocol === "pulso-review/1")
    lines.push(
      "",
      `Veredicto: **${doc.verdict}**`,
      ...doc.checks.map((c) => `- ${c.criterion}: ${c.result}`),
    );
  return `${lines.join("\n")}\n`;
}

/** Publishes typed artifacts inside the bound Work scope. Publication is staged until an accepted native receipt is supplied. */
export class ArtifactService {
  private readonly journal: ArtifactJournal;
  private readonly ownsJournal: boolean;
  constructor(
    private readonly runtime: CapabilitiesRuntime,
    private readonly workspaceRoot: string,
    journal?: ArtifactJournal,
  ) {
    this.journal =
      journal ?? new NativeJournal(runtime.runtimeBindings.databasePath);
    this.ownsJournal = !journal;
  }

  close() {
    if (this.ownsJournal && this.journal instanceof NativeJournal)
      this.journal.close();
  }

  /** Structural and live workspace checks for ready plans; call again immediately before adoption. */
  async validatePlanReadiness(plan: ExecutablePlan) {
    validatePlanReadiness(plan);
    if (plan.status === "ready") await this.verifyPlanTargets(plan);
    return plan;
  }

  private async verifyPlanTargets(plan: ExecutablePlan) {
    const workspace = await realpath(this.workspaceRoot);
    for (const target of plan.targets) {
      const segments = target.path.split("/");
      if (
        target.path.includes("\\") ||
        target.path.startsWith("/") ||
        /^[A-Za-z]:/.test(target.path) ||
        segments.some(
          (segment) => !segment || segment === "." || segment === "..",
        )
      )
        fail("PLAN_TARGET_PATH_INVALID", target.path);

      let current = workspace;
      for (let index = 0; index < segments.length; index++) {
        const segment = segments[index]!;
        const entries: string[] = await readdir(current, {
          encoding: "utf8",
        }).catch((error: NodeJS.ErrnoException): string[] => {
          if (error.code === "ENOENT" && target.existence === "new") return [];
          throw error;
        });
        const exact = entries.includes(segment);
        if (!exact) {
          if (
            entries.some(
              (entry) => entry.toLowerCase() === segment.toLowerCase(),
            )
          )
            fail("PLAN_TARGET_CASE_MISMATCH", target.path);
          if (target.existence === "existing")
            fail("PLAN_TARGET_NOT_FOUND", target.path);
          const missingPath = resolve(current, ...segments.slice(index));
          const relativePath = relative(workspace, missingPath);
          if (relativePath.startsWith("..") || relativePath.startsWith("/"))
            fail("PLAN_TARGET_PATH_INVALID", target.path);
          await this.assertRealPathInsideWorkspace(current, workspace);
          break;
        }
        current = join(current, segment);
        await this.assertRealPathInsideWorkspace(current, workspace);
        if (index < segments.length - 1) {
          const resolved = await realpath(current);
          const info = await lstat(resolved);
          if (!info.isDirectory())
            fail("PLAN_TARGET_ANCESTOR_INVALID", target.path);
        } else if (target.existence === "new") {
          fail("PLAN_NEW_TARGET_EXISTS", target.path);
        } else {
          const resolved = await realpath(current);
          const info = await lstat(resolved);
          if (!info.isFile()) fail("PLAN_TARGET_NOT_FILE", target.path);
        }
      }
    }
  }

  private async assertRealPathInsideWorkspace(path: string, workspace: string) {
    const resolved = await realpath(path);
    const fromWorkspace = relative(workspace, resolved);
    if (
      fromWorkspace === ".." ||
      fromWorkspace.startsWith(
        `..${process.platform === "win32" ? "\\" : "/"}`,
      ) ||
      fromWorkspace.startsWith("/")
    )
      fail("PLAN_TARGET_OUTSIDE_WORKSPACE", path);
  }

  async publish(bindingId: string, document: ArtifactDocument) {
    const { binding, delegation } = await this.ownedBinding(bindingId);
    const specialist = binding.assigneeId ?? binding.executorId;
    const kind = kindOf(document);
    const allowed: Record<ArtifactKind, string[]> = {
      inventory: ["explorer", "planner"],
      plan: ["planner"],
      review: ["verifier"],
    };
    if (!specialist || !allowed[kind].includes(specialist))
      fail(
        "ARTIFACT_TYPE_NOT_AUTHORIZED",
        `${specialist ?? "unknown"} cannot publish ${kind}`,
      );
    if (document.protocol === "pulso-inventory/1") validateInventory(document);
    else if (document.protocol === "pulso-plan/1")
      await this.validatePlanReadiness(document);
    else {
      const targetRef = document.artifactRef;
      const targetArtifact = await this.loadReference(targetRef);
      const loadedTarget = targetArtifact
        ? await this.readDocument(targetArtifact)
        : undefined;
      const target = loadedTarget?.document;
      if (
        !targetArtifact ||
        targetArtifact.workId !== binding.workId ||
        targetArtifact.state !== "accepted" ||
        !target ||
        target.protocol !== "pulso-plan/1" ||
        target.status !== "ready"
      )
        fail(
          "REVIEW_TARGET_NOT_FOUND",
          "Review must reference an accepted ready plan in the same Work",
        );
      await this.assertReceiptState(targetArtifact);
      validateReview(document, target);
    }
    const state = await this.runtime.work.snapshot(binding.workId);
    const item = state.items.find((i) => i.id === binding.workItemId);
    if (!item)
      fail("ARTIFACT_OWNERSHIP_INVALID", "Binding WorkItem does not exist");
    const durableRevision = state.artifacts.filter(
      (a) => a.itemId === binding.workItemId && a.type === kind,
    ).length;
    const artifacts = await this.listArtifacts(binding.workId);
    const storedRevision = artifacts
      .filter((a) => a.workItemId === binding.workItemId && a.kind === kind)
      .reduce((max, a) => Math.max(max, a.revision), 0);
    const revision = Math.max(durableRevision, storedRevision) + 1;
    const json = `${canonical(document)}\n`,
      hash = digest(canonical(document));
    const alias = binding.workId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const name = `${kind}-r${revision}-${hash.slice(0, 12)}`;
    const base = resolve(
      this.workspaceRoot,
      ".pulso",
      "artifacts",
      alias,
      name,
    );
    const root = resolve(this.workspaceRoot, ".pulso", "artifacts", alias);
    if (!relative(root, base) || relative(root, base).startsWith(".."))
      fail(
        "ARTIFACT_PATH_INVALID",
        "Artifact path escaped its owner directory",
      );
    await mkdir(root, { recursive: true });
    await this.assertInsideWorkspace(root);
    const reference = `.pulso/artifacts/${alias}/${name}/${name}.json`;
    const published: PublishedArtifact = {
      reference,
      kind,
      state: "staged",
      revision,
      hash,
      jsonPath: join(base, `${name}.json`),
      markdownPath: join(base, `${name}.md`),
      workId: binding.workId,
      workItemId: binding.workItemId,
      delegationId: binding.runtime.executionId,
    };
    const metadata: ArtifactMetadata = {
      protocol: "pulso-artifact-state/1",
      reference,
      kind,
      state: "staged",
      revision,
      hash,
      workId: binding.workId,
      workItemId: binding.workItemId,
      delegationId: delegation.delegationId,
      parentSessionId: delegation.parentSessionId,
      workspaceId: delegation.workspaceId,
    };
    let ownsDirectory = false;
    try {
      // mkdir is exclusive: unlike rename(temp, destination), this cannot replace
      // an existing empty directory at the canonical artifact path.
      await mkdir(base, { recursive: false });
      ownsDirectory = true;
      const jsonTemp = join(base, `.json-${randomUUID()}.tmp`);
      const markdownTemp = join(base, `.markdown-${randomUUID()}.tmp`);
      const metadataTemp = join(base, `.metadata-${randomUUID()}.tmp`);
      await writeFile(jsonTemp, json, { flag: "wx" });
      await writeFile(markdownTemp, markdown(document, hash, revision), {
        flag: "wx",
      });
      await rename(jsonTemp, join(base, `${name}.json`));
      await rename(markdownTemp, join(base, `${name}.md`));
      await writeFile(metadataTemp, `${canonical(metadata)}\n`, { flag: "wx" });
      // The manifest is the commit marker; until its atomic rename the ref is invisible.
      await rename(metadataTemp, join(base, "metadata.json"));
    } catch (error) {
      if (ownsDirectory)
        await rm(base, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return structuredClone(published);
  }

  /** Reconcile from the durable native journal; no caller-supplied receipt flags are accepted. */
  async reconcileReceipt(delegationId: string) {
    const delegation = await this.journal.get(delegationId);
    if (!delegation)
      fail("ARTIFACT_RECEIPT_NOT_FOUND", "Native receipt is not durable");
    const trusted = this.validateDurableReceipt(delegation);
    const artifacts = await this.listArtifacts(delegation.workId);
    const results: PublishedArtifact[] = [];
    for (const artifact of artifacts) {
      if (artifact.delegationId !== delegationId) continue;
      if (
        artifact.workspaceId !== delegation.workspaceId ||
        artifact.workId !== delegation.workId ||
        artifact.workItemId !== delegation.workItemId ||
        artifact.parentSessionId !== delegation.parentSessionId
      )
        fail(
          "ARTIFACT_OWNERSHIP_INVALID",
          "Artifact metadata does not match the receipt owner",
        );
      if (artifact.state !== "staged") {
        if (
          artifact.state !== trusted.state ||
          artifact.receiptHash !== trusted.receiptHash
        )
          fail(
            "ARTIFACT_RECEIPT_CONFLICT",
            "Persisted artifact status differs from its native receipt",
          );
        if (artifact.state === "rejected") {
          results.push(this.publicArtifact(artifact));
          continue;
        }
      }
      if (trusted.state === "rejected") {
        artifact.state = "rejected";
        artifact.receiptHash = trusted.receiptHash;
        await this.writeMetadata(artifact);
        results.push(this.publicArtifact(artifact));
        continue;
      }
      if (
        artifact.workspaceId !== delegation.workspaceId ||
        artifact.workId !== delegation.workId ||
        artifact.workItemId !== delegation.workItemId ||
        artifact.parentSessionId !== delegation.parentSessionId
      )
        fail(
          "ARTIFACT_OWNERSHIP_INVALID",
          "Artifact metadata does not match the receipt owner",
        );
      const binding = await this.runtime.runtimeBindings.get(
        delegation.bindingId ?? "",
      );
      if (
        !binding ||
        binding.status !== "completed" ||
        binding.workId !== artifact.workId ||
        binding.workItemId !== artifact.workItemId ||
        binding.runtime.executionId !== delegationId
      )
        fail(
          "ARTIFACT_RECEIPT_NOT_ACCEPTED",
          "Completed native binding is required for accepted receipt",
        );
      const item = await this.runtime.work.snapshot(artifact.workId);
      if (!item.items.some((candidate) => candidate.id === artifact.workItemId))
        fail(
          "ARTIFACT_OWNERSHIP_INVALID",
          "Artifact WorkItem no longer belongs to its Work",
        );
      const artifactView = this.publicArtifact(artifact);
      const existing = item.artifacts.find(
        (candidate) =>
          candidate.itemId === artifact.workItemId &&
          candidate.type === artifact.kind &&
          candidate.uri === pathToFileURL(artifactView.jsonPath).href &&
          candidate.description?.includes(`hash=${artifact.hash}`),
      );
      if (existing) artifact.artifactId = existing.id;
      else {
        const saved = await this.runtime.work.artifact({
          workId: artifact.workId,
          itemId: artifact.workItemId,
          type: artifact.kind,
          uri: pathToFileURL(artifactView.jsonPath).href,
          description: `pulso-artifact/1 revision=${artifact.revision} hash=${artifact.hash} receipt=${trusted.receiptHash}`,
        });
        artifact.artifactId = saved.id;
      }
      artifact.state = "accepted";
      artifact.receiptHash = trusted.receiptHash;
      await this.writeMetadata(artifact);
      results.push(this.publicArtifact(artifact));
    }
    return results;
  }

  /** Receipt outcome/hash are intentionally ignored; authority is reloaded from NativeJournal. */
  async applyDelegationReceipt(input: {
    delegationId: string;
    accepted?: boolean;
    receiptHash?: string;
  }) {
    return this.reconcileReceipt(input.delegationId);
  }

  async read(reference: string, parentSessionId?: string) {
    const item = await this.loadReference(reference);
    if (!item || item.state === "rejected")
      fail("ARTIFACT_NOT_FOUND", "Artifact is not available");
    if (
      !parentSessionId ||
      item.workspaceId !== this.runtime.workspaceId ||
      item.parentSessionId !== parentSessionId ||
      !(await this.journal.ownsWork(
        item.workspaceId,
        parentSessionId,
        item.workId,
      ))
    )
      fail(
        "ARTIFACT_OWNERSHIP_INVALID",
        "Artifact is not owned by this workspace and parent session",
      );
    await this.assertReceiptState(item);
    const { document, markdown: markdownText } = await this.readDocument(item);
    return {
      artifact: this.publicArtifact(item),
      document,
      markdown: markdownText,
    };
  }

  private async ownedBinding(bindingId: string): Promise<{
    binding: RuntimeExecutionBinding;
    delegation: NativeDelegation;
  }> {
    const binding = await this.runtime.runtimeBindings.get(bindingId);
    if (
      binding?.managedBy !== "opencode-native" ||
      binding.runtime.provider !== "opencode" ||
      binding.status !== "active" ||
      !binding.workId
    )
      fail("ARTIFACT_BINDING_INVALID", "Active native binding required");
    const delegation = await this.journal.get(binding.runtime.executionId);
    if (
      !delegation ||
      delegation.bindingId !== binding.bindingId ||
      delegation.workspaceId !== this.runtime.workspaceId ||
      delegation.workId !== binding.workId ||
      delegation.workItemId !== binding.workItemId ||
      delegation.transportPhase !== "claimed" ||
      delegation.receiptPhase !== "none" ||
      !(await this.journal.ownsWork(
        delegation.workspaceId,
        delegation.parentSessionId,
        delegation.workId,
      ))
    )
      fail(
        "ARTIFACT_BINDING_INVALID",
        "Binding does not match an active owned native delegation",
      );
    return { binding, delegation };
  }

  private validateDurableReceipt(delegation: NativeDelegation) {
    if (
      delegation.workspaceId !== this.runtime.workspaceId ||
      delegation.transportPhase !== "closed" ||
      !delegation.receiptHash ||
      !delegation.receiptJson
    )
      fail(
        "ARTIFACT_RECEIPT_NOT_ACCEPTED",
        "Native delegation has no closed durable receipt",
      );
    let receipt: Record<string, unknown>;
    try {
      receipt = JSON.parse(delegation.receiptJson) as Record<string, unknown>;
    } catch {
      return fail(
        "ARTIFACT_RECEIPT_INVALID",
        "Durable native receipt JSON is invalid",
      );
    }
    if (
      receipt.delegationId !== delegation.delegationId ||
      receipt.receiptHash !== delegation.receiptHash
    )
      fail(
        "ARTIFACT_RECEIPT_INVALID",
        "Receipt identity or hash does not match the journal row",
      );
    if (
      delegation.receiptPhase === "applied" &&
      receipt.protocol === "pulso-receipt/1" &&
      receipt.accepted === true &&
      isRecord(receipt.result) &&
      receipt.resultHash === delegation.resultHash &&
      receipt.result.delegationId === delegation.delegationId &&
      receipt.result.specialist === delegation.specialist &&
      receipt.result.workId === delegation.workId &&
      receipt.result.workItemId === delegation.workItemId
    )
      return {
        state: "accepted" as const,
        receiptHash: delegation.receiptHash,
      };
    if (
      delegation.receiptPhase === "rejected" &&
      receipt.protocol !== "pulso-receipt/1" &&
      isRecord(receipt.ids) &&
      receipt.ids.delegationId === delegation.delegationId &&
      receipt.ids.workId === delegation.workId &&
      receipt.ids.workItemId === delegation.workItemId &&
      typeof receipt.code === "string" &&
      typeof receipt.stage === "string"
    )
      return {
        state: "rejected" as const,
        receiptHash: delegation.receiptHash,
      };
    return fail(
      "ARTIFACT_RECEIPT_NOT_ACCEPTED",
      "Receipt is captured, malformed, or not accepted",
    );
  }

  private async assertReceiptState(metadata: ArtifactMetadata) {
    if (metadata.state === "staged") return;
    const delegation = await this.journal.get(metadata.delegationId);
    if (!delegation)
      fail(
        "ARTIFACT_RECEIPT_NOT_FOUND",
        "Artifact has no durable native receipt",
      );
    const receipt = this.validateDurableReceipt(delegation);
    if (
      receipt.state !== metadata.state ||
      receipt.receiptHash !== metadata.receiptHash ||
      delegation.workId !== metadata.workId ||
      delegation.workItemId !== metadata.workItemId ||
      delegation.parentSessionId !== metadata.parentSessionId
    )
      fail(
        "ARTIFACT_RECEIPT_CONFLICT",
        "Artifact state is not supported by its durable native receipt",
      );
  }

  private async loadReference(
    reference: string,
  ): Promise<ArtifactMetadata | undefined> {
    const match =
      /^\.pulso\/artifacts\/([a-zA-Z0-9_-]+)\/([a-z]+-r[1-9][0-9]*-[a-f0-9]{12})\/\2\.json$/.exec(
        reference,
      );
    if (!match) return undefined;
    const directory = resolve(
      this.workspaceRoot,
      ".pulso",
      "artifacts",
      match[1]!,
      match[2]!,
    );
    const expectedRoot = resolve(this.workspaceRoot, ".pulso", "artifacts");
    const pathFromRoot = relative(expectedRoot, directory);
    if (
      !pathFromRoot ||
      pathFromRoot.startsWith("..") ||
      pathFromRoot.includes("/../")
    )
      fail("ARTIFACT_PATH_INVALID", "Artifact reference escapes its root");
    try {
      const [rootReal, dirStat] = await Promise.all([
        realpath(expectedRoot),
        lstat(directory),
      ]);
      if (dirStat.isSymbolicLink() || !dirStat.isDirectory())
        fail(
          "ARTIFACT_PATH_INVALID",
          "Artifact directory must be a real directory",
        );
      const dirReal = await realpath(directory);
      await this.assertInsideWorkspace(rootReal);
      if (!dirReal.startsWith(`${rootReal}/`))
        fail("ARTIFACT_PATH_INVALID", "Artifact directory escaped its root");
      const metadata = JSON.parse(
        await readFile(join(directory, "metadata.json"), "utf8"),
      ) as ArtifactMetadata;
      if (
        metadata.protocol !== "pulso-artifact-state/1" ||
        metadata.reference !== reference ||
        metadata.workId.replace(/[^a-zA-Z0-9_-]/g, "_") !== match[1] ||
        metadata.kind !== match[2]!.split("-r")[0]
      )
        fail(
          "ARTIFACT_METADATA_INVALID",
          "Artifact metadata does not match exact reference",
        );
      return metadata;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return undefined;
      throw error;
    }
  }

  private async readDocument(metadata: ArtifactMetadata) {
    const match =
      /^\.pulso\/artifacts\/([a-zA-Z0-9_-]+)\/([a-z]+-r[1-9][0-9]*-[a-f0-9]{12})\/\2\.json$/.exec(
        metadata.reference,
      );
    if (!match)
      fail("ARTIFACT_PATH_INVALID", "Stored artifact reference is malformed");
    const directory = resolve(
      this.workspaceRoot,
      ".pulso",
      "artifacts",
      match[1]!,
      match[2]!,
    );
    const name = match[2]!;
    const jsonPath = join(directory, `${name}.json`);
    const markdownPath = join(directory, `${name}.md`);
    const [jsonStat, markdownStat] = await Promise.all([
      lstat(jsonPath),
      lstat(markdownPath),
    ]);
    if (
      jsonStat.isSymbolicLink() ||
      markdownStat.isSymbolicLink() ||
      !jsonStat.isFile() ||
      !markdownStat.isFile()
    )
      fail(
        "ARTIFACT_PATH_INVALID",
        "Artifact projections must be regular files",
      );
    const json = await readFile(jsonPath, "utf8");
    const markdownText = await readFile(markdownPath, "utf8");
    const document = JSON.parse(json) as ArtifactDocument;
    if (
      digest(canonical(document)) !== metadata.hash ||
      !markdownText.includes(metadata.hash)
    )
      fail(
        "ARTIFACT_INTEGRITY",
        "JSON/Markdown does not match persisted artifact metadata",
      );
    return { document, markdown: markdownText };
  }

  private async listArtifacts(workId: string) {
    const alias = workId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const directory = resolve(this.workspaceRoot, ".pulso", "artifacts", alias);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      const artifacts: ArtifactMetadata[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) continue;
        const reference = `.pulso/artifacts/${alias}/${entry.name}/${entry.name}.json`;
        const metadata = await this.loadReference(reference);
        if (metadata?.workId === workId) artifacts.push(metadata);
      }
      return artifacts;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return [];
      throw error;
    }
  }

  private async writeMetadata(metadata: ArtifactMetadata) {
    const match =
      /^\.pulso\/artifacts\/([a-zA-Z0-9_-]+)\/([a-z]+-r[1-9][0-9]*-[a-f0-9]{12})\/\2\.json$/.exec(
        metadata.reference,
      );
    if (!match)
      fail("ARTIFACT_PATH_INVALID", "Stored artifact reference is malformed");
    const directory = resolve(
      this.workspaceRoot,
      ".pulso",
      "artifacts",
      match[1]!,
      match[2]!,
    );
    const directoryStat = await lstat(directory);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())
      fail(
        "ARTIFACT_PATH_INVALID",
        "Artifact directory must be a real directory",
      );
    await this.assertInsideWorkspace(directory);
    const temp = join(directory, `.metadata-${randomUUID()}.tmp`);
    await writeFile(temp, `${canonical(metadata)}\n`, { flag: "wx" });
    await rename(temp, join(directory, "metadata.json"));
  }

  private publicArtifact(metadata: ArtifactMetadata): PublishedArtifact {
    const match =
      /^\.pulso\/artifacts\/([a-zA-Z0-9_-]+)\/([a-z]+-r[1-9][0-9]*-[a-f0-9]{12})\/\2\.json$/.exec(
        metadata.reference,
      );
    if (!match)
      fail("ARTIFACT_PATH_INVALID", "Stored artifact reference is malformed");
    const base = resolve(
      this.workspaceRoot,
      ".pulso",
      "artifacts",
      match[1]!,
      match[2]!,
    );
    return {
      ...metadata,
      jsonPath: join(base, `${match[2]}.json`),
      markdownPath: join(base, `${match[2]}.md`),
    };
  }

  private async assertInsideWorkspace(path: string) {
    const workspace = await realpath(this.workspaceRoot);
    const actual = await realpath(path);
    if (!actual.startsWith(`${workspace}/`))
      fail(
        "ARTIFACT_PATH_INVALID",
        "Artifact storage escaped the workspace root",
      );
  }
}
