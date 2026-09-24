import { expect, test } from "bun:test";
import type { AvailableModel } from "../src/discovery/opencode";
import {
  modelProfileDescriptions,
  OpenCodeModelResolver,
} from "../src/wizard/model-profiles";

const catalog: AvailableModel[] = [
  { id: "openai/gpt-6-luna", provider: "openai", modelId: "gpt-6-luna" },
  { id: "openai/gpt-6-terra", provider: "openai", modelId: "gpt-6-terra" },
  { id: "openai/gpt-6-sol", provider: "openai", modelId: "gpt-6-sol" },
  {
    id: "github-copilot/gpt-6-sol",
    provider: "github-copilot",
    modelId: "gpt-6-sol",
  },
  { id: "other/claude", provider: "other", modelId: "claude" },
];

test("inherited is universal; profile availability requires the specified model families", () => {
  const lunaTerra = new OpenCodeModelResolver(catalog.slice(0, 2));
  expect(lunaTerra.presetAvailable("inherited")).toBe(true);
  expect(lunaTerra.presetAvailable("economic", "openai")).toBe(true);
  expect(lunaTerra.presetAvailable("balanced", "openai")).toBe(true);
  expect(lunaTerra.presetAvailable("maximum", "openai")).toBe(false);
  const unsupportedProvider = new OpenCodeModelResolver([
    { id: "other/gpt-luna", provider: "other", modelId: "gpt-luna" },
  ]);
  expect(unsupportedProvider.presetAvailable("inherited")).toBe(true);
  expect(unsupportedProvider.presetAvailable("economic")).toBe(false);
});

test("OpenAI/Copilot provider ambiguity is surfaced and custom supports exact arbitrary IDs", () => {
  const resolver = new OpenCodeModelResolver(catalog);
  expect(resolver.providersFor("sol")).toEqual(["github-copilot", "openai"]);
  expect(resolver.resolve("sol")).toBeNull();
  expect(resolver.resolve("sol", "openai")).toBe("openai/gpt-6-sol");
  const custom = resolver.custom({
    pulso: "other/claude",
    planner: null,
    explorer: null,
    executor: null,
    verifier: null,
    "security-auditor": null,
  });
  expect(custom.agents.pulso).toBe("other/claude");
  expect(custom.agents.planner).toBeNull();
});

test("every model profile has a distinct explanatory description", () => {
  expect(modelProfileDescriptions.inherited).toContain("sesión");
  expect(modelProfileDescriptions.economic).toContain("Luna");
  expect(modelProfileDescriptions.balanced).toContain("Terra");
  expect(modelProfileDescriptions.balanced).toContain("Luna");
  expect(modelProfileDescriptions.maximum).toContain("Sol");
  expect(modelProfileDescriptions.custom).toContain("catálogo");
  expect(new Set(Object.values(modelProfileDescriptions)).size).toBe(5);
});
