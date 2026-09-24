import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const source = join(import.meta.dir, "..");
const frontmatter = (source: string) =>
  source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";

test("agent definitions enforce the Pulso-only topology without fixed routes", async () => {
  const agents = join(source, "agents");
  const pulso = frontmatter(
    await readFile(join(agents, "pulso.agent.md"), "utf8"),
  );
  expect(pulso).toContain("user-invocable: true");
  expect(pulso).toContain("'agent'");
  expect(pulso).toContain(
    "['Planner', 'Explorer', 'Executor', 'Verifier', 'Security Auditor']",
  );
  for (const name of [
    "planner",
    "explorer",
    "executor",
    "verifier",
    "security-auditor",
  ]) {
    const content = frontmatter(
      await readFile(join(agents, `${name}.agent.md`), "utf8"),
    );
    expect(content).toContain("agents: []");
    expect(content).toContain("user-invocable: false");
    expect(content).not.toContain("'agent'");
    expect(content).not.toContain("pulso/");
  }
  const all = await Promise.all(
    (await readdir(agents)).map((name) => readFile(join(agents, name), "utf8")),
  );
  expect(all.join("\n")).not.toMatch(
    /quickRoute|plannedRoute|defaultPipeline|alwaysPlanner|alwaysVerifier/,
  );
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
