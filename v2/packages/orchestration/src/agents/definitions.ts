import { renderAgentProtocolInstructions } from "../protocol/instructions";
import { specialistTaskContracts } from "../protocol/specialist-contracts";
import type {
  AgentDefinition,
  AgentId,
  CapabilityProfile,
  StructuredPromptDefinition,
} from "../runtimes/types";
import {
  canonicalPromptTexts,
  commonSpecialistInstructions,
} from "./prompt-texts";

const pulsoCapabilities: CapabilityProfile = {
  // Pulso is an orchestrator: host-native Task and Pulso MCP are its only
  // operational surfaces. Specialists retain their existing capability
  // profiles below.
  allow: ["delegate", "mcp"],
  deny: ["read", "search", "edit", "shell", "skill"],
};
const readonlyCapabilities: CapabilityProfile = {
  allow: ["read", "search", "skill"],
  deny: ["edit", "shell", "delegate"],
};
const verifierCapabilities: CapabilityProfile = {
  allow: ["read", "search", "shell", "skill"],
  deny: ["edit", "delegate"],
};

// CP1 keeps hosts on this baseline primary prompt until their native facade exists.
export const legacyPrimaryPrompt: StructuredPromptDefinition = {
  identity: "You are Pulso, the only human-facing orchestrator.",
  mission:
    "Understand the objective and authoritative Work state, choose the next best action, then re-evaluate after every meaningful result.",
  authority:
    "Working System is authoritative for Work state. Capabilities MCP is the sole operational boundary.",
  operating_model:
    "There are no predefined routes. Delegate only when isolated context, specialization, independent verification, or prolonged execution materially helps. Do not do substantial specialist work yourself; direct edit or terminal use is only for unequivocally tiny, low-risk work.",
  delegation_policy:
    "Invoke only the specialist needed for the next step. Specialists never orchestrate.",
  context_policy:
    "Minimize context and provide only the objective, relevant evidence, constraints, and acceptance criteria.",
  work_tracking:
    "Before every material delegation create or resolve an exact WorkItem, bind it through the active runtime's native subagent provider, then invoke one stateless specialist. Validate the result before recording artifacts or lifecycle; suggested next steps are evidence, not instructions.",
  continuity_policy:
    "Work continuity defaults to reuse. For an actionable follow-up, keep using the current Work and add WorkItems as needed. Request a new Work only when the user's objective actually changes.",
  commit_policy:
    "Delegate commit work only when the user explicitly requests a commit. Never infer commit intent. If an explicit commit is requested but Git identity is unavailable, the Executor must report a blocker instead of changing Git configuration.",
  constraints:
    "Specialists cannot own Work state. Technical work is delegated to the appropriate specialist and specialists never use repo tools through Pulso. Do not narrate bookkeeping, repeat MCP calls/payloads, dump protocol or Zod diagnostics, or expose internal IDs unless necessary. Keep the user-facing response concise; preserve detailed diagnostics for the runtime only. Ask the human only when required.",
};

// Semantic prompt content lives here once. Runtime renderers add only host contracts/frontmatter.
export const agentDefinitions: Record<AgentId, AgentDefinition> = {
  pulso: {
    id: "pulso",
    displayName: "Pulso",
    description:
      "Coordinate human objectives through tracked, demand-driven specialist work.",
    role: "primary",
    capabilities: pulsoCapabilities,
    delegation: {
      allowedSpecialists: [
        "planner",
        "explorer",
        "executor",
        "verifier",
        "security-auditor",
      ],
    },
    skills: [
      "bbva-engineering",
      "bbva-apx",
      "bbva-apx-testing",
      "bbva-cells",
      "bbva-cells-testing",
      "integration-verification",
    ],
    prompt: canonicalPromptTexts.pulso,
  },
  planner: {
    id: "planner",
    displayName: "Planner",
    description:
      "Produce a minimal executable proposal without modifying code or Work.",
    role: "specialist",
    capabilities: readonlyCapabilities,
    skills: ["bbva-engineering"],
    prompt: canonicalPromptTexts.planner,
    taskContract: specialistTaskContracts.planner,
  },
  explorer: {
    id: "explorer",
    displayName: "Explorer",
    description:
      "Gather focused read-only technical evidence for a delegated question.",
    role: "specialist",
    capabilities: readonlyCapabilities,
    skills: ["bbva-engineering"],
    prompt: canonicalPromptTexts.explorer,
    taskContract: specialistTaskContracts.explorer,
  },
  executor: {
    id: "executor",
    displayName: "Executor",
    description:
      "Implement and validate exactly one bounded delegated objective.",
    role: "specialist",
    capabilities: {
      allow: ["read", "search", "edit", "shell", "skill"],
      deny: ["delegate"],
    },
    skills: ["bbva-engineering"],
    prompt: canonicalPromptTexts.executor,
    taskContract: specialistTaskContracts.executor,
  },
  verifier: {
    id: "verifier",
    displayName: "Verifier",
    description:
      "Independently verify a delivery against criteria and evidence.",
    role: "specialist",
    capabilities: verifierCapabilities,
    skills: ["bbva-engineering", "integration-verification"],
    prompt: canonicalPromptTexts.verifier,
    taskContract: specialistTaskContracts.verifier,
  },
  "security-auditor": {
    id: "security-auditor",
    displayName: "Security Auditor",
    description: "Review a bounded change for concrete security regressions.",
    role: "specialist",
    capabilities: readonlyCapabilities,
    skills: ["bbva-engineering"],
    prompt: canonicalPromptTexts["security-auditor"],
    taskContract: specialistTaskContracts["security-auditor"],
  },
};

export const agentIds = Object.keys(agentDefinitions) as AgentId[];

export const semanticPrompt = (
  agent: AgentDefinition,
  options: {
    guarded?: boolean;
    runtimeMode?: "managed-opencode" | "legacy-mcp";
    primaryPrompt?: StructuredPromptDefinition;
  } = {},
) => {
  const prompt =
    agent.role === "primary" && options.primaryPrompt
      ? options.primaryPrompt
      : agent.prompt;
  const sections = Object.entries(prompt).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const identity = sections.find(([section]) => section === "identity");
  const remainder = sections.filter(([section]) => section !== "identity");
  return [
    ...(identity ? [`<identity>${identity[1]}</identity>`] : []),
    `<communication_protocol>${renderAgentProtocolInstructions(agent.id, agent.taskContract, options)}</communication_protocol>`,
    ...remainder.map(([section, text]) => `<${section}>${text}</${section}>`),
    ...(agent.role === "specialist" ? [commonSpecialistInstructions] : []),
  ].join("\n");
};
