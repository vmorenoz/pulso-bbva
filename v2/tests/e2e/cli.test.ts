import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

test("CLI doctor boots runtime", () => {
  const result = spawnSync(
    process.execPath,
    ["run", "apps/cli/src/index.ts", "doctor"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('"ok": true');
});
