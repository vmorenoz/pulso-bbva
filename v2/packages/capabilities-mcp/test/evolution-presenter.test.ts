import { expect, test } from "bun:test";
import type { NativeDelegation } from "../src/opencode/native-journal";
import {
  presentPrepared,
  presentReceipt,
} from "../src/opencode/receipt-presenter";

test("prepare presenter exposes exact short task handoffs without durable authority JSON", () => {
  const output = presentPrepared([
    {
      delegationId: "internal-id",
      workId: "work-id",
      workItemId: "item-id",
      nativeTaskArgs: {
        description: "Pulso explorer task",
        subagent_type: "explorer",
        prompt: "pulso-dispatch/1:8e7be836-7a16-4e28-8f62-f718be1ae4de",
      },
    },
  ]);
  expect(output).toContain("Preparadas 1 tarea");
  expect(output).toContain("subagent_type: explorer");
  expect(output).toContain(
    "prompt: pulso-dispatch/1:8e7be836-7a16-4e28-8f62-f718be1ae4de",
  );
  expect(output).not.toContain("pulso-task/2");
  expect(output).not.toContain("work-id");
});

test("receipt presenter communicates accepted content without replacing durable JSON", () => {
  const delegation = {
    delegationId: "diagnostic-id",
    receiptJson: JSON.stringify({
      protocol: "pulso-receipt/1",
      accepted: true,
      result: { summary: "Se inspeccionó el contrato.", outcome: "completed" },
    }),
  } as NativeDelegation;
  const output = presentReceipt(delegation);
  expect(output).toContain("Se inspeccionó el contrato.");
  expect(output).toContain("Estado: completed.");
  expect(output).not.toContain('"protocol":"pulso-receipt/1"');
  expect(output).toContain("Diagnóstico: diagnostic-id.");
});
