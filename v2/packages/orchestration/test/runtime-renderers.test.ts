import { expect, test } from "bun:test";
import { agentDefinitions, agentIds } from "../src/agents/definitions";
import { openCodeRuntime } from "../src/runtimes/opencode";
import { vscodeCopilotRuntime } from "../src/runtimes/vscode-copilot";

test("OpenCode agents use native primary/subagent modes and canonical permissions", () => {
  const pulso = openCodeRuntime.renderAgent(agentDefinitions.pulso).content;
  expect(pulso).toContain("mode: primary");
  expect(pulso).toContain("task:");
  expect(pulso).toContain('"planner": allow');
  expect(pulso).toContain('"*": deny');
  expect(pulso).toContain("pulso_*: allow");
  for (const id of agentIds.filter((agent) => agent !== "pulso")) {
    const rendered = openCodeRuntime.renderAgent(agentDefinitions[id]).content;
    expect(rendered).toContain("mode: subagent");
    expect(rendered).toContain("task: deny");
  }
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

test("runtime renderer parity retains one canonical semantic prompt", () => {
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
  for (const id of agentIds) {
    expect(
      semanticBody(
        vscodeCopilotRuntime.renderAgent(agentDefinitions[id]).content,
      ),
    ).toBe(
      semanticBody(openCodeRuntime.renderAgent(agentDefinitions[id]).content),
    );
  }
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

test("both runtime configs expose only the Pulso Capabilities MCP identity", () => {
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
  expect(JSON.parse(opencode.content).mcp).toHaveProperty("pulso");
  expect(JSON.parse(opencode.content).mcp).not.toHaveProperty("work");
});
