import { expect, test } from "bun:test";
import {
  type CommandRunner,
  OpenCodeDiscovery,
  parseModelCatalog,
} from "../src/discovery/opencode";

test("model parser ignores blanks, validates IDs, deduplicates, and preserves unknown providers", () => {
  expect(
    parseModelCatalog(
      "\nopenai/gpt-6-luna\nopenai/gpt-6-luna\nodd-provider/model-x  Display X\nbad-id\n ",
    ),
  ).toEqual([
    {
      id: "odd-provider/model-x",
      provider: "odd-provider",
      modelId: "model-x",
      displayName: "Display X",
    },
    { id: "openai/gpt-6-luna", provider: "openai", modelId: "gpt-6-luna" },
  ]);
});

test("probe detects compatible future versions by capabilities, not version equality", async () => {
  const runner: CommandRunner = async (_executable, args) => {
    const output: Record<string, string> = {
      "--version": "3.4.5",
      "agent,--help": "manage agents",
      "agent,create,--help": "--model provider/model",
      "models,--help": "list all available models",
      "mcp,--help": "manage MCP",
      "debug,skill,--help": "list skills",
    };
    return { stdout: output[args.join(",")] ?? "", stderr: "", code: 0 };
  };
  const discovery = new OpenCodeDiscovery(runner, "/mock");
  const probe = await discovery.probe();
  expect(probe.version).toBe("3.4.5");
  expect(probe.supported).toBe(true);
  expect(probe.capabilities.agentModelOverride).toBe(true);
});

test("absent executable is an unsupported probe, not an exception", async () => {
  const probe = await new OpenCodeDiscovery(async () => {
    throw new Error("missing");
  }, "").probe();
  expect(probe.executable).toBeNull();
  expect(probe.supported).toBe(false);
});
