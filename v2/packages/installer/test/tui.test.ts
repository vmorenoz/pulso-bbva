import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { TerminalWizard } from "../src/tui";

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  setRawMode(value: boolean) {
    this.isRaw = value;
  }
  resume() {}
}

class FakeOutput {
  isTTY = true;
  content = "";
  write(value: string) {
    this.content += value;
    return true;
  }
}

const makeWizard = () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const wizard = new TerminalWizard(
    input as unknown as NodeJS.ReadStream,
    output as unknown as NodeJS.WriteStream,
  );
  return { wizard, input, output };
};

test("single-choice menu navigates with arrows and confirms with Enter", async () => {
  const { wizard, input, output } = makeWizard();
  const choice = wizard.select("Alcance", "¿Dónde instalar?", [
    { value: "global", label: "Global" },
    { value: "local", label: "Local" },
  ]);
  input.emit("keypress", "", { name: "down" });
  input.emit("keypress", "\r", { name: "return" });
  await expect(choice).resolves.toBe("local");
  expect(input.isRaw).toBe(false);
  expect(output.content).toContain("PULSO");
});

test("multi-select toggles choices with Space", async () => {
  const { wizard, input } = makeWizard();
  const skills = wizard.multiSelect(
    "Skills",
    "Activa skills",
    [
      { value: "apx", label: "APX" },
      { value: "cells", label: "CELLS" },
    ],
    ["apx", "cells"],
  );
  input.emit("keypress", "\u0020", { name: "space" });
  input.emit("keypress", "", { name: "down" });
  input.emit("keypress", "\u0020", { name: "space" });
  input.emit("keypress", "\r", { name: "return" });
  await expect(skills).resolves.toEqual([]);
  expect(input.isRaw).toBe(false);
});

test("multi-select provides select-all and clear-all keyboard shortcuts", async () => {
  const { wizard, input } = makeWizard();
  const skills = wizard.multiSelect(
    "Skills",
    "Activa skills",
    [
      { value: "apx", label: "APX" },
      { value: "cells", label: "CELLS" },
    ],
    [],
  );
  input.emit("keypress", "a", { name: "a" });
  input.emit("keypress", "n", { name: "n" });
  input.emit("keypress", "", { name: "down" });
  input.emit("keypress", "\u0020", { name: "space" });
  input.emit("keypress", "\r", { name: "return" });
  await expect(skills).resolves.toEqual(["cells"]);
});

test("progress view reports successful operation completion", async () => {
  const { wizard, output } = makeWizard();
  await expect(
    wizard.withProgress(
      "Preparando bundle",
      async () => "ready",
      "Bundle listo",
    ),
  ).resolves.toBe("ready");
  expect(output.content).toContain("Preparando bundle");
  expect(output.content).toContain("Bundle listo");
});

test("progress view reports errors and rethrows them", async () => {
  const { wizard, output } = makeWizard();
  await expect(
    wizard.withProgress("Preparando bundle", async () => {
      throw new Error("bundle error");
    }),
  ).rejects.toThrow("bundle error");
  expect(output.content).toContain("Preparando bundle");
});
