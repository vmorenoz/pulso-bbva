import { randomUUID } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

export type CapabilitySource = "native" | "mcp" | "plugin" | "skill" | "cli";
export type CapabilityPermission = "allow" | "ask" | "deny" | "unknown";
export type CapabilityHealth = "unprobed" | "ok" | "error" | "stale";
export type CapabilityObservation = Readonly<{
  id: string;
  source: CapabilitySource;
  configured: boolean;
  discovered: boolean;
  permitted: CapabilityPermission;
  health: CapabilityHealth;
  used: boolean;
  observedAt: string;
  evidence?: string;
}>;
export type CapabilityDescriptor = Readonly<{
  id: string;
  effects: readonly string[];
  agents: readonly string[];
  approvalSource: string;
  approved: true;
}>;
export type CapabilityHostMapping = Readonly<Record<string, string>>;
const maxAgeMs = 60_000;
const maxManifestBytes = 256 * 1024;
const validAtom = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDescriptor = (value: unknown): CapabilityDescriptor | undefined => {
  if (!isRecord(value)) return undefined;
  const keys = Object.keys(value).sort().join(",");
  if (
    keys !== "agents,approvalSource,approved,effects,id" ||
    value.approved !== true ||
    typeof value.id !== "string" ||
    !validAtom.test(value.id) ||
    typeof value.approvalSource !== "string" ||
    !value.approvalSource.trim() ||
    value.approvalSource.length > 200 ||
    !Array.isArray(value.effects) ||
    !value.effects.length ||
    !value.effects.every(
      (item) => typeof item === "string" && validAtom.test(item),
    ) ||
    !Array.isArray(value.agents) ||
    !value.agents.length ||
    !value.agents.every(
      (item) => typeof item === "string" && validAtom.test(item),
    )
  )
    return undefined;
  return Object.freeze({
    id: value.id,
    effects: [...new Set(value.effects as string[])],
    agents: [...new Set(value.agents as string[])],
    approvalSource: value.approvalSource,
    approved: true,
  });
};

/** Reads only the exact managed manifest path; no markdown/skill discovery. */
export const loadCapabilityDescriptors = (
  filePath: string,
): CapabilityDescriptor[] => {
  try {
    const stat = lstatSync(filePath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      (stat.mode & 0o077) !== 0 ||
      stat.size > maxManifestBytes
    )
      return [];
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (
      !isRecord(parsed) ||
      Object.keys(parsed).sort().join(",") !== "descriptors,version" ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.descriptors)
    )
      return [];
    const result: CapabilityDescriptor[] = [];
    const ids = new Set<string>();
    for (const candidate of parsed.descriptors) {
      const descriptor = parseDescriptor(candidate);
      if (descriptor && !ids.has(descriptor.id)) {
        ids.add(descriptor.id);
        result.push(descriptor);
      }
    }
    return result;
  } catch {
    return [];
  }
};

/** Atomic, owner-only write of explicitly approved descriptors. */
export const writeCapabilityDescriptors = (
  filePath: string,
  descriptors: readonly CapabilityDescriptor[],
) => {
  const normalized = descriptors.map(parseDescriptor);
  if (normalized.some((item) => !item))
    throw new Error("CAPABILITY_DESCRIPTOR_INVALID_OR_UNAPPROVED");
  const valid = normalized.filter(
    (item): item is CapabilityDescriptor => item !== undefined,
  );
  const ids = valid.map((item) => item.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("CAPABILITY_DESCRIPTOR_DUPLICATE");
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(
      temporary,
      `${JSON.stringify({ version: 1, descriptors: valid }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    chmodSync(temporary, 0o600);
    renameSync(temporary, filePath);
    chmodSync(filePath, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Leave no authority in a failed temporary write; cleanup is best effort.
    }
    throw error;
  }
};

/** Observations only: discovery, preference, and skills never grant permissions. */
export class CapabilityCatalog {
  private readonly observations = new Map<string, CapabilityObservation>();
  private readonly approved = new Map<string, CapabilityDescriptor>();
  constructor(private readonly clock: () => number = Date.now) {}
  observe(observation: CapabilityObservation) {
    if (!observation.id.trim()) throw new Error("CAPABILITY_ID_REQUIRED");
    const safe = {
      ...observation,
      evidence: observation.evidence?.slice(0, 500),
    };
    this.observations.set(observation.id, Object.freeze(safe));
    return safe;
  }
  recordCall(
    id: string,
    observedAt = new Date(this.clock()).toISOString(),
    evidence?: string,
  ) {
    const prior = this.observations.get(id);
    this.observe({
      id,
      source: prior?.source ?? "native",
      configured: prior?.configured ?? false,
      discovered: prior?.discovered ?? true,
      permitted: prior?.permitted ?? "unknown",
      health: prior?.health ?? "unprobed",
      used: true,
      observedAt,
      ...(evidence ? { evidence: evidence.slice(0, 500) } : {}),
    });
  }
  addApprovedDescriptor(descriptor: CapabilityDescriptor) {
    const approved = parseDescriptor(descriptor);
    if (!approved)
      throw new Error("CAPABILITY_DESCRIPTOR_INVALID_OR_UNAPPROVED");
    this.approved.set(approved.id, approved);
  }
  loadApprovedDescriptors(filePath: string) {
    this.approved.clear();
    for (const descriptor of loadCapabilityDescriptors(filePath))
      this.approved.set(descriptor.id, descriptor);
    return [...this.approved.values()];
  }
  persistApprovedDescriptors(filePath: string) {
    writeCapabilityDescriptors(filePath, [...this.approved.values()]);
  }
  descriptor(id: string) {
    return this.approved.get(id);
  }
  isAuthorized(id: string, agent?: string) {
    const descriptor = this.approved.get(id);
    const observed = this.observations.get(id);
    return Boolean(
      descriptor &&
        observed?.permitted === "allow" &&
        (!agent || descriptor.agents.includes(agent)),
    );
  }
  list(options: { forceRefresh?: boolean } = {}) {
    const cutoff = this.clock() - maxAgeMs;
    return [...this.observations.values()]
      .filter(
        (item) => options.forceRefresh || Date.parse(item.observedAt) >= cutoff,
      )
      .map((item) => ({ ...item }));
  }
  mapHostIds(mapping: CapabilityHostMapping) {
    return Object.fromEntries(
      Object.entries(mapping).map(([semanticId, hostId]) => [
        semanticId,
        hostId,
      ]),
    );
  }
  permissionsForAgent(agent: string) {
    return permissionsForAgent([...this.approved.values()], agent, [
      ...this.observations.values(),
    ]);
  }
}

/** Host adapter can add permissions only for explicitly approved descriptors. */
export const permissionsForAgent = (
  descriptors: readonly CapabilityDescriptor[],
  agent: string,
  observations: readonly CapabilityObservation[] = [],
) =>
  Object.fromEntries(
    descriptors
      .filter(
        (item) =>
          item.agents.includes(agent) &&
          observations.some(
            (observation) =>
              observation.id === item.id && observation.permitted === "allow",
          ),
      )
      .map((item) => [item.id, "allow" as const]),
  );
