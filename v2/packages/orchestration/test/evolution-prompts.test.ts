import { expect, test } from "bun:test";
import { agentDefinitions, agentIds } from "../src/agents/definitions";
import { openCodeV21PromptTexts } from "../src/agents/opencode-v21-prompts";
import { openCodeRuntime } from "../src/runtimes/opencode";

const skillIds = [
  "pulso-adaptive-orchestration",
  "pulso-evidence-inventory",
  "pulso-executable-plans",
  "pulso-human-delivery",
  "pulso-parallel-work",
  "pulso-preferences-capabilities",
  "pulso-quality-review",
  "pulso-safe-recovery",
] as const;

test("OpenCode renders all six complete v2.1 prompt definitions", () => {
  expect(Object.keys(openCodeV21PromptTexts).sort()).toEqual(
    [...agentIds].sort(),
  );
  for (const id of agentIds) {
    const rendered = openCodeRuntime.renderAgent(agentDefinitions[id]).content;
    for (const [section, content] of Object.entries(
      openCodeV21PromptTexts[id],
    )) {
      expect(rendered).toContain(`<${section}>${content}</${section}>`);
    }
    expect(rendered).not.toMatch(/(?:^|\s)[\p{Extended_Pictographic}]/u);
  }
});

test("v2.1 skills are checked in verbatim and render at the canonical path", async () => {
  for (const id of skillIds) {
    const source = await Bun.file(
      new URL(`../skills/${id}.md`, import.meta.url),
    ).text();
    expect(source).toContain(`name: ${id}`);
    expect(openCodeRuntime.renderSkill({ id, content: source })).toEqual({
      path: `${id}/SKILL.md`,
      content: source,
    });
  }
});

test("OpenCode permissions expose bounded v2.1 surfaces and preserve selected model", () => {
  const primary = openCodeRuntime.renderAgent(agentDefinitions.pulso, {
    model: "provider/exact-choice",
  }).content;
  expect(primary).toContain("model: provider/exact-choice");
  for (const tool of [
    "pulso_prepare",
    "pulso_inspect",
    "pulso_work",
    "pulso_preferences",
    "pulso_artifact",
    "read",
    "glob",
    "grep",
    "skill",
  ])
    expect(primary).toContain(`"${tool}": allow`);
  for (const tool of [
    "pulso_native_work",
    "pulso_native_prepare",
    "pulso_native_status",
    "edit",
    "bash",
  ])
    expect(primary).toContain(`"${tool}": deny`);
  for (const id of agentIds.filter((agent) => agent !== "pulso")) {
    const content = openCodeRuntime.renderAgent(agentDefinitions[id]).content;
    expect(content).toContain('"pulso_artifact": allow');
    expect(content).toContain('"pulso_work": deny');
    expect(content).toContain("no concede control de Work ni delegación");
  }
});
