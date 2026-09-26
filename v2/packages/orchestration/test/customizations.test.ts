import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { agentDefinitions, agentIds } from "../src/agents/definitions";
import { openCodeRuntime } from "../src/runtimes/opencode";
import { vscodeCopilotRuntime } from "../src/runtimes/vscode-copilot";

const source = join(import.meta.dir, "..");
const frontmatter = (source: string) =>
  source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";

test("agent definitions enforce the Pulso-only topology without fixed routes", async () => {
  const pulso = frontmatter(
    vscodeCopilotRuntime.renderAgent(agentDefinitions.pulso).content,
  );
  expect(pulso).toContain("user-invocable: true");
  expect(pulso).toContain("'agent'");
  expect(pulso).toContain(
    "['Planner', 'Explorer', 'Executor', 'Verifier', 'Security Auditor']",
  );
  expect(pulso).toContain("tools: ['agent', 'pulso/*']");
  expect(pulso).not.toMatch(
    /['"](?:read|grep|glob|list|edit|write|apply_patch|bash|todowrite|todoread|terminal|search)['"]/i,
  );
  for (const name of [
    "planner",
    "explorer",
    "executor",
    "verifier",
    "security-auditor",
  ]) {
    const content = frontmatter(
      vscodeCopilotRuntime.renderAgent(
        agentDefinitions[name as keyof typeof agentDefinitions],
      ).content,
    );
    expect(content).toContain("agents: []");
    expect(content).toContain("user-invocable: false");
    expect(content).not.toContain("'agent'");
    expect(content).not.toContain("pulso/");
  }
  const all = agentIds.map(
    (id) => vscodeCopilotRuntime.renderAgent(agentDefinitions[id]).content,
  );
  expect(all.join("\n")).not.toMatch(
    /quickRoute|plannedRoute|defaultPipeline|alwaysPlanner|alwaysVerifier/,
  );
});

test("both runtimes render the same canonical semantic prompt and skill roster", () => {
  for (const id of agentIds) {
    const vscode = vscodeCopilotRuntime.renderAgent(
      agentDefinitions[id],
    ).content;
    const opencode = openCodeRuntime.renderAgent(agentDefinitions[id]).content;
    const body = (value: string) =>
      value
        .slice(value.indexOf("\n---\n") + 5)
        .replace(
          /<communication_protocol>[\s\S]*?<\/communication_protocol>\n?/,
          "<communication_protocol>shared</communication_protocol>\n",
        )
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replace(/<runtime_contract>[\s\S]*?<\/runtime_contract>\n?/, "");
    expect(body(vscode)).toBe(body(opencode));
    if (id !== "pulso")
      expect(
        vscode.match(
          /<communication_protocol>([\s\S]*?)<\/communication_protocol>/,
        )?.[1],
      ).toBe(
        opencode.match(
          /<communication_protocol>([\s\S]*?)<\/communication_protocol>/,
        )?.[1],
      );
    else {
      expect(vscode).toContain("pulso-result/2");
      expect(opencode).toContain("installed OpenCode Protocol Guard validates");
    }
  }
  expect(vscodeCopilotRuntime.capabilities).toBeDefined();
  expect(agentDefinitions.pulso.skills).toEqual(agentDefinitions.pulso.skills);
});

test("Pulso policy anchors continuity and explicit-only commits", () => {
  const rendered = openCodeRuntime.renderAgent(agentDefinitions.pulso).content;
  expect(rendered).toContain("Work continuity defaults to reuse");
  expect(rendered).toContain(
    "Request a new Work only when the user's objective actually changes",
  );
  expect(rendered).toContain("only when the user explicitly requests a commit");
  expect(rendered).toContain("Git identity is unavailable");
  expect(rendered).toContain("There are no predefined routes");
});

test("checked-in VS Code agents are generated from the canonical runtime renderer", async () => {
  const installedRoot = join(source, "../../.github/agents");
  for (const id of agentIds) {
    const rendered = vscodeCopilotRuntime.renderAgent(agentDefinitions[id]);
    const installed = await readFile(
      join(installedRoot, rendered.path),
      "utf8",
    );
    if (id === "pulso") {
      expect(installed).toContain("pulso-task/2");
      expect(installed).toContain("pulso-result/2");
      expect(installed).toContain(
        "Validate the result before recording artifacts or lifecycle",
      );
      expect(installed).toContain("pulso_runtime_fail");
    } else {
      const normalized = installed
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">");
      expect(normalized).toBe(rendered.content);
    }
  }
});

test("all six skills retain valid metadata and avoid legacy control-plane dependencies", async () => {
  const expected = [
    "bbva-engineering",
    "bbva-apx",
    "bbva-apx-testing",
    "bbva-cells",
    "bbva-cells-testing",
    "integration-verification",
  ];
  for (const name of expected) {
    const content = await readFile(
      join(source, "skills", name, "SKILL.md"),
      "utf8",
    );
    expect(frontmatter(content)).toContain(`name: ${name}`);
    expect(frontmatter(content)).toContain("description:");
    expect(frontmatter(content)).toContain("user-invocable: false");
    expect(content).not.toMatch(
      /pulso-protocol|pulso_route|pulso_lease|\.pulso|OpenCode|CodeGraph|dashboard|experience engine|contacts/i,
    );
    if (name === "bbva-apx") expect(content).toContain("Batch Jobs");
    if (name === "bbva-apx-testing") expect(content).toContain("JaCoCo");
    if (name === "bbva-cells") expect(content).toContain("Lit/LitElement");
    if (name === "bbva-cells-testing")
      expect(content).toContain("Open Web Components");
    if (name === "bbva-engineering")
      expect(content).toContain("synthetic data");
  }
});
