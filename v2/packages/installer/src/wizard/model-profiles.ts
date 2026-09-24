import type { AgentId } from "../../../orchestration/src/runtimes/types";
import type { AvailableModel } from "../discovery/opencode";

export type PulsoModelFamily = "luna" | "terra" | "sol";
export type ModelProfile =
  | "inherited"
  | "economic"
  | "balanced"
  | "maximum"
  | "custom";

export const modelProfileDescriptions: Record<ModelProfile, string> = {
  inherited: "Los seis agentes usan el modelo configurado para la sesión.",
  economic: "Familia Luna para Pulso y los cinco especialistas.",
  balanced:
    "Terra para Pulso, Planner, Verifier y Security Auditor; Luna para Explorer y Executor.",
  maximum:
    "Sol para Pulso, Planner, Verifier y Security Auditor; Terra para Executor; Luna para Explorer.",
  custom:
    "Elige cualquier modelo del catálogo para cada agente o déjalo heredado.",
};

export interface ModelRequirement {
  family: PulsoModelFamily;
}
export interface ResolvedAgentModelConfig {
  profile: ModelProfile;
  agents: Record<AgentId, string | null>;
}
export const profileRequirements: Record<
  Exclude<ModelProfile, "custom">,
  Record<AgentId, ModelRequirement | null>
> = {
  inherited: {
    pulso: null,
    planner: null,
    explorer: null,
    executor: null,
    verifier: null,
    "security-auditor": null,
  },
  economic: {
    pulso: { family: "luna" },
    planner: { family: "luna" },
    explorer: { family: "luna" },
    executor: { family: "luna" },
    verifier: { family: "luna" },
    "security-auditor": { family: "luna" },
  },
  balanced: {
    pulso: { family: "terra" },
    planner: { family: "terra" },
    explorer: { family: "luna" },
    executor: { family: "luna" },
    verifier: { family: "terra" },
    "security-auditor": { family: "terra" },
  },
  maximum: {
    pulso: { family: "sol" },
    planner: { family: "sol" },
    explorer: { family: "luna" },
    executor: { family: "terra" },
    verifier: { family: "sol" },
    "security-auditor": { family: "sol" },
  },
};
const aliases: Record<PulsoModelFamily, string[]> = {
  luna: ["luna"],
  terra: ["terra"],
  sol: ["sol"],
};
const normalizedProvider = (provider: string) =>
  provider.toLowerCase().replace(/[-_]/g, " ");
export const compatibleProviders = ["openai", "github copilot"];
export class OpenCodeModelResolver {
  constructor(readonly catalog: AvailableModel[]) {}
  providersFor(family: PulsoModelFamily) {
    const candidates = this.catalog.filter(
      (model) =>
        compatibleProviders.includes(normalizedProvider(model.provider)) &&
        aliases[family].some((alias) =>
          model.modelId.toLowerCase().includes(alias),
        ),
    );
    return [...new Set(candidates.map((model) => model.provider))].sort();
  }
  resolve(family: PulsoModelFamily, provider?: string) {
    const candidates = this.catalog.filter(
      (model) =>
        compatibleProviders.includes(normalizedProvider(model.provider)) &&
        (!provider || model.provider === provider) &&
        aliases[family].some((alias) =>
          model.modelId.toLowerCase().includes(alias),
        ),
    );
    if (
      !provider &&
      new Set(candidates.map((model) => model.provider)).size > 1
    )
      return null;
    candidates.sort((a, b) => {
      const aExact = a.modelId.toLowerCase().endsWith(`-${family}`) ? 0 : 1;
      const bExact = b.modelId.toLowerCase().endsWith(`-${family}`) ? 0 : 1;
      return (
        aExact - bExact ||
        a.modelId.length - b.modelId.length ||
        a.id.localeCompare(b.id)
      );
    });
    return candidates[0]?.id ?? null;
  }
  presetAvailable(profile: Exclude<ModelProfile, "custom">, provider?: string) {
    if (profile === "inherited") return true;
    const families = new Set(
      Object.values(profileRequirements[profile])
        .filter((value): value is ModelRequirement => value !== null)
        .map((value) => value.family),
    );
    return [...families].every((family) =>
      Boolean(this.resolve(family, provider)),
    );
  }
  resolveProfile(
    profile: Exclude<ModelProfile, "custom">,
    provider?: string,
  ): ResolvedAgentModelConfig {
    if (!this.presetAvailable(profile, provider))
      throw new Error(`MODEL_PROFILE_UNAVAILABLE:${profile}`);
    const requirements = profileRequirements[profile];
    const agents = Object.fromEntries(
      Object.entries(requirements).map(([agent, requirement]) => [
        agent,
        requirement ? this.resolve(requirement.family, provider) : null,
      ]),
    ) as Record<AgentId, string | null>;
    return { profile, agents };
  }
  custom(agents: Record<AgentId, string | null>) {
    for (const model of Object.values(agents))
      if (model !== null && !this.catalog.some((entry) => entry.id === model))
        throw new Error(`MODEL_NOT_AVAILABLE:${model}`);
    return { profile: "custom" as const, agents };
  }
}
