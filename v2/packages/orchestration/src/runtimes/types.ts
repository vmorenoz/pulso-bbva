export type AgentId =
  | "pulso"
  | "planner"
  | "explorer"
  | "executor"
  | "verifier"
  | "security-auditor";

export type SkillId =
  | "bbva-engineering"
  | "bbva-apx"
  | "bbva-apx-testing"
  | "bbva-cells"
  | "bbva-cells-testing"
  | "integration-verification";

export type RuntimeId = "vscode-copilot" | "opencode";
export type Capability =
  | "read"
  | "search"
  | "edit"
  | "shell"
  | "skill"
  | "delegate"
  | "mcp";

export interface StructuredPromptDefinition {
  identity?: string;
  mission?: string;
  authority?: string;
  operating_model?: string;
  delegation_policy?: string;
  context_policy?: string;
  work_tracking?: string;
  constraints?: string;
}

export interface CapabilityProfile {
  allow: Capability[];
  deny: Capability[];
}

export interface AgentDefinition {
  id: AgentId;
  displayName: string;
  description: string;
  role: "primary" | "specialist";
  prompt: StructuredPromptDefinition;
  capabilities: CapabilityProfile;
  delegation?: { allowedSpecialists: AgentId[] };
  skills: SkillId[];
}

export interface CanonicalSkill {
  id: SkillId;
  content: string;
}

export interface RenderedAsset {
  path: string;
  content: string;
}

export interface RuntimeCapabilities {
  customAgents: boolean;
  subagents: boolean;
  agentSkills: boolean;
  mcp: boolean;
  perAgentModel: boolean;
  inheritedAgentModel: boolean;
}

export interface RuntimeRenderOptions {
  runtimeContract?: string;
  model?: string | null;
}

export interface RuntimeConfigOptions {
  scope: "local" | "global";
  mcpCommand: string[];
  mcpCwd?: string;
}

export interface RuntimeConfigArtifact {
  path: string;
  content: string;
  format: "jsonc" | "json";
}

export interface RuntimeDefinition {
  id: RuntimeId;
  displayName: string;
  capabilities: RuntimeCapabilities;
  renderAgent(
    agent: AgentDefinition,
    options?: RuntimeRenderOptions,
  ): RenderedAsset;
  renderSkill(skill: CanonicalSkill): RenderedAsset;
  buildRuntimeConfig(options: RuntimeConfigOptions): RuntimeConfigArtifact[];
}
