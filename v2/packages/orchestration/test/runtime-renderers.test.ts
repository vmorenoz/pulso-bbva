import { expect, test } from "bun:test";
import { agentDefinitions, agentIds } from "../src/agents/definitions";
import { openCodeV21PromptTexts } from "../src/agents/opencode-v21-prompts";
import { openCodeRuntime } from "../src/runtimes/opencode";
import { vscodeCopilotRuntime } from "../src/runtimes/vscode-copilot";

test("OpenCode managed assets expose only the native bridge and bounded task selectors", () => {
  const pulso = openCodeRuntime.renderAgent(agentDefinitions.pulso).content;
  expect(pulso).toContain("mode: primary");
  expect(pulso).not.toContain("hidden: true");
  expect(pulso).toContain('"*": deny');
  expect(pulso).not.toMatch(/^\s+\*: deny$/m);
  expect(pulso).toContain("task:");
  expect(pulso).toContain('"planner": allow');
  expect(pulso).toContain('"*": deny');
  expect(pulso).toContain('"pulso_native_work": deny');
  expect(pulso).toContain('"pulso_native_prepare": deny');
  expect(pulso).toContain('"pulso_native_status": deny');
  expect(pulso).toContain("pulso_prepare resuelve el Work");
  expect(pulso).toContain("Usa pulso_prepare");
  expect(pulso).not.toContain("pulso_*: allow");
  expect(pulso).not.toContain(
    "Capabilities MCP is the sole operational boundary",
  );
  expect(pulso).not.toMatch(
    /\b(read|grep|glob|list|edit|write|apply_patch|bash|todowrite|todoread): allow/,
  );
  expect(pulso).not.toContain("skill: allow");
  expect(pulso).not.toMatch(/\bmcp\b/i);
  for (const id of agentIds.filter((agent) => agent !== "pulso")) {
    const rendered = openCodeRuntime.renderAgent(agentDefinitions[id]).content;
    expect(rendered).toContain("mode: subagent");
    expect(rendered).toContain("hidden: true");
    expect(rendered).toContain('"*": deny');
    expect(rendered).toContain('"task": deny');
    expect(rendered).toContain('"pulso_native_work": deny');
    expect(rendered).toContain('"pulso_native_prepare": deny');
    expect(rendered).toContain('"pulso_native_status": deny');
  }
});

test("OpenCode managed and VS Code legacy runtime contracts remain isolated", () => {
  const forbidden =
    /['"](?:read|grep|glob|list|edit|write|apply_patch|bash|todowrite|todoread|terminal|search)['"]/i;
  const vscode = vscodeCopilotRuntime.renderAgent(
    agentDefinitions.pulso,
  ).content;
  const opencode = openCodeRuntime.renderAgent(agentDefinitions.pulso).content;
  expect(vscode).toContain("tools: ['agent', 'pulso/*']");
  expect(vscode).not.toMatch(forbidden);
  expect(opencode).toContain("task:");
  expect(opencode).toContain('"pulso_native_prepare": deny');
  expect(opencode).toContain('"read": allow');
  expect(opencode).toContain('"glob": allow');
  expect(opencode).toContain('"grep": allow');
  expect(opencode).not.toMatch(/['"](?:edit|bash)['"]:\s*allow/i);
  expect(opencode).toContain('"planner": allow');
  expect(opencode).toContain('"security-auditor": allow');
  expect(opencode).not.toContain("pulso_*: allow");
  expect(vscode).not.toContain("pulso_native_");
  expect(vscode).toContain("Capabilities MCP is the sole operational boundary");
  expect(vscode).not.toContain("Utiliza la fachada operativa");
});

test("OpenCode omits inherited model overrides and preserves exact selected IDs", () => {
  const inherited = openCodeRuntime.renderAgent(agentDefinitions.pulso, {
    model: null,
  }).content;
  expect(inherited).not.toContain("\nmodel:");
  const selected = openCodeRuntime.renderAgent(agentDefinitions.pulso, {
    model: "openai/example-exact",
  }).content;
  expect(selected).toContain("model: openai/example-exact");
});

test("VS Code keeps legacy prompts while OpenCode uses the supplied v2.1 prompts", () => {
  const semanticBody = (text: string) =>
    text
      .slice(text.indexOf("\n---\n") + 5)
      .replace(
        /<communication_protocol>[\s\S]*?<\/communication_protocol>\n?/,
        "<communication_protocol>shared</communication_protocol>\n",
      )
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replace(/<runtime_contract>[\s\S]*?<\/runtime_contract>\n?/, "");
  for (const id of agentIds.filter((agent) => agent !== "pulso")) {
    const vscodeBody = semanticBody(
      vscodeCopilotRuntime.renderAgent(agentDefinitions[id]).content,
    );
    const openCodeBody = semanticBody(
      openCodeRuntime.renderAgent(agentDefinitions[id]).content,
    );
    expect(vscodeBody).toContain(agentDefinitions[id].prompt.mission ?? "");
    expect(openCodeBody).toContain(openCodeV21PromptTexts[id].mission ?? "");
  }
  const vscode = vscodeCopilotRuntime.renderAgent(
    agentDefinitions.pulso,
  ).content;
  const opencode = openCodeRuntime.renderAgent(agentDefinitions.pulso).content;
  expect(vscode).toContain("Capabilities MCP is the sole operational boundary");
  expect(opencode).toContain("Working System es la única autoridad");
  expect(opencode).toContain("pulso_prepare");
});

test("runtime skill renderers use the same canonical skill artifact", () => {
  const skill = {
    id: "bbva-engineering" as const,
    content: "---\nname: bbva-engineering\n---\nCanonical skill\n",
  };
  expect(openCodeRuntime.renderSkill(skill)).toEqual(
    vscodeCopilotRuntime.renderSkill(skill),
  );
});

test("OpenCode registers the native bridge while VS Code retains Pulso MCP", () => {
  const vscode = vscodeCopilotRuntime.buildRuntimeConfig({
    scope: "local",
    mcpCommand: ["node", "pulso-mcp.js"],
  })[0];
  const opencode = openCodeRuntime.buildRuntimeConfig({
    scope: "local",
    mcpCommand: ["node", "pulso-mcp.js"],
  })[0];
  if (!vscode || !opencode) throw new Error("RUNTIME_CONFIG_ARTIFACT_MISSING");
  expect(JSON.parse(vscode.content).servers).toHaveProperty("pulso");
  expect(JSON.parse(opencode.content).plugin).toEqual([
    "./plugins/pulso-protocol-guard.js",
  ]);
  expect(JSON.parse(opencode.content)).not.toHaveProperty("mcp");
  expect(openCodeRuntime.capabilities.mcp).toBe(false);
});

test("Pulso renderer keeps the exact VS Code allowlist and specialist roster", () => {
  const rendered = vscodeCopilotRuntime.renderAgent(
    agentDefinitions.pulso,
  ).content;
  expect(rendered).toContain("tools: ['agent', 'pulso/*']");
  expect(rendered).toContain(
    "agents: ['Planner', 'Explorer', 'Executor', 'Verifier', 'Security Auditor']",
  );
  expect(rendered).not.toMatch(/agents:.*(?:Git|Commit|Review)/);
});
