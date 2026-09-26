import { expect, test } from "bun:test";
import { resolveWorkContinuity } from "../src/policy/work-continuity";

const sameObjective = (candidate: { objective: string }, objective: string) =>
  candidate.objective === objective;

test("related turns reuse one current Work without prescribing WorkItem count", () => {
  expect(
    resolveWorkContinuity({
      current: { workId: "work-1", objective: "Improve installer permissions" },
      objective: "Improve installer permissions",
      continuesObjective: sameObjective,
    }),
  ).toEqual({ action: "reuse", workId: "work-1" });
});

test("a distinct objective creates a new Work", () => {
  expect(
    resolveWorkContinuity({
      current: { workId: "work-1", objective: "Improve installer permissions" },
      recent: [{ workId: "work-0", objective: "Document runtime behavior" }],
      objective: "Add billing export",
      continuesObjective: sameObjective,
    }),
  ).toEqual({ action: "create" });
});
