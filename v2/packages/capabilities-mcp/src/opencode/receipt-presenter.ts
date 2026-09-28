import type { NativeDelegation } from "./native-journal";

type Prepared = {
  delegationId: string;
  workId: string;
  workItemId: string;
  nativeTaskArgs: {
    description: string;
    subagent_type: string;
    prompt: string;
  };
};

/** Human-facing projection. Durable receipt bytes remain in the journal. */
export const presentPrepared = (items: Prepared[]) => {
  const lines = [
    `Preparadas ${items.length} ${items.length === 1 ? "tarea" : "tareas"}.`,
  ];
  for (const item of items) {
    lines.push(
      `\n${item.nativeTaskArgs.description} · ${item.nativeTaskArgs.subagent_type}`,
    );
    lines.push(`- subagent_type: ${item.nativeTaskArgs.subagent_type}`);
    lines.push(`- prompt: ${item.nativeTaskArgs.prompt}`);
  }
  return lines.join("\n");
};

export const presentReceipt = (delegation: NativeDelegation) => {
  if (!delegation.receiptJson) return "No hay un recibo disponible todavía.";
  let receipt: Record<string, unknown>;
  try {
    receipt = JSON.parse(delegation.receiptJson) as Record<string, unknown>;
  } catch {
    return `Resultado registrado; diagnóstico ${delegation.delegationId}.`;
  }
  const result =
    receipt.result && typeof receipt.result === "object"
      ? (receipt.result as Record<string, unknown>)
      : receipt;
  const outcome =
    typeof result.outcome === "string" ? result.outcome : "registrado";
  const summary =
    typeof result.summary === "string"
      ? result.summary
      : "El especialista terminó su tarea.";
  const files = Array.isArray(result.filesChanged)
    ? result.filesChanged.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  return [
    summary,
    `Estado: ${outcome}.`,
    ...(files.length ? [`Archivos: ${files.join(", ")}.`] : []),
    `Diagnóstico: ${delegation.delegationId}.`,
  ].join("\n");
};
