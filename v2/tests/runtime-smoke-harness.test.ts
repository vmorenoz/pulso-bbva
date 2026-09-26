import { describe, expect, test } from "bun:test";
import {
  assertIndependentMultiTurnSession,
  commandTimeoutForCategory,
  multiTurnMessages,
} from "./runtime-smoke-harness";

describe("runtime smoke multiturn runner", () => {
  test("defines eight independent user messages", () => {
    expect(multiTurnMessages).toHaveLength(8);
    expect(new Set(multiTurnMessages).size).toBe(8);
  });

  test("uses the run timeout for every multiturn run", () => {
    expect(commandTimeoutForCategory("run")).toBe(90_000);
    for (let turn = 1; turn <= 8; turn += 1) {
      expect(commandTimeoutForCategory(`turn-${turn}`)).toBe(90_000);
    }
    expect(commandTimeoutForCategory("version")).toBe(30_000);
    expect(commandTimeoutForCategory("turn-9")).toBe(30_000);
  });

  test("requires one persistent session while retaining turn boundaries", () => {
    const turns = multiTurnMessages.map((message, index) => ({
      turn: index + 1,
      message,
      sessionId: "session-1",
      processExitCode: 0,
      eventCount: 2,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolCount: 0,
      directPulsoToolCount: 0,
      taskCount: 0,
      mcpErrors: [],
    }));

    expect(() => assertIndependentMultiTurnSession(turns)).not.toThrow();
    expect(() =>
      assertIndependentMultiTurnSession(
        turns.map((turn, index) =>
          index === 7 ? { ...turn, sessionId: "session-2" } : turn,
        ),
      ),
    ).toThrow("MULTITURN_CREATED_MORE_THAN_ONE_SESSION");
  });
});
