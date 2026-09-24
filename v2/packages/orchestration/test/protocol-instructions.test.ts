import { expect, test } from "bun:test";
import {
  agentResultStatuses,
  protocolContractMetadata,
  renderAgentProtocolInstructions,
  specialistIds,
} from "../src";
import { agentDefinitions, agentIds } from "../src/agents/definitions";
import { openCodeRuntime } from "../src/runtimes/opencode";
import { vscodeCopilotRuntime } from "../src/runtimes/vscode-copilot";

const protocolSection = (content: string) =>
  content.match(
    /<communication_protocol>([\s\S]*?)<\/communication_protocol>/,
  )?.[1] ?? "";

test("runtime prompts render protocol instructions from canonical schema metadata", () => {
  for (const id of agentIds) {
    const generated = renderAgentProtocolInstructions(id);
    const openCode = openCodeRuntime.renderAgent(agentDefinitions[id]).content;
    const vscode = vscodeCopilotRuntime.renderAgent(
      agentDefinitions[id],
    ).content;
    expect(protocolSection(openCode)).toBe(generated);
    expect(protocolSection(vscode)).toBe(generated);
    expect(openCode.indexOf("<communication_protocol>")).toBeLessThan(
      openCode.indexOf("<mission>"),
    );
  }

  expect(protocolContractMetadata.task.fields.required).toEqual([
    "protocol",
    "delegationId",
    "specialist",
    "work",
    "objective",
    "output",
  ]);
  expect(protocolContractMetadata.task.workFields.required).toEqual([
    "workId",
    "workItemId",
  ]);
  expect(protocolContractMetadata.result.identityFields).toEqual([
    "delegationId",
    "specialist",
    "workId",
    "workItemId",
  ]);
});

test("OpenCode prompts expose only canonical versions, statuses and specialist payload fields", () => {
  const rendered = agentIds
    .map((id) => openCodeRuntime.renderAgent(agentDefinitions[id]).content)
    .join("\n");
  const pulsoInstructions = renderAgentProtocolInstructions("pulso");

  expect(pulsoInstructions).toContain(protocolContractMetadata.task.protocol);
  expect(pulsoInstructions).toContain(protocolContractMetadata.result.protocol);
  for (const status of agentResultStatuses)
    expect(pulsoInstructions).toContain(status);
  for (const specialist of specialistIds) {
    const instructions = renderAgentProtocolInstructions(specialist);
    expect(instructions).toContain(specialist);
    for (const field of protocolContractMetadata.result.payloads[specialist]
      .required)
      expect(instructions).toContain(field);
  }

  expect(rendered).not.toMatch(
    /\bresponseFormat\b|\bsucceeded\b|\bsuccess\b|\bdone\b|\bok\b/,
  );
  expect(rendered).not.toContain("pulso-result/1 JSON:");
  expect(rendered).toContain('provider "opencode"');
  expect(rendered).toContain(
    "externalExecutionId to the same fresh delegationId",
  );
  expect(pulsoInstructions).toContain("not plain JSON");
  expect(pulsoInstructions).toContain("Task selector never replaces it");
  expect(pulsoInstructions).toContain(
    "Task state=completed only means the child call ended",
  );
  expect(pulsoInstructions).toContain(
    '"work":{"workId":"<actual Work ID>","workItemId":"<actual WorkItem ID>"}',
  );
  const explorerInstructions = renderAgentProtocolInstructions("explorer");
  expect(explorerInstructions).toContain("never a top-level explorer key");
  expect(explorerInstructions).toContain(
    '"specialistResult":{"kind":"explorer","findings":[],"references":[]}',
  );
  const descriptions = agentIds.map((id) => agentDefinitions[id].description);
  expect(descriptions.every((description) => description.length > 0)).toBe(
    true,
  );
  expect(new Set(descriptions).size).toBe(descriptions.length);
  expect(descriptions.every((description) => description.length <= 100)).toBe(
    true,
  );
});
