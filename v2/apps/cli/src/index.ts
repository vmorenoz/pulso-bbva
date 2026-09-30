#!/usr/bin/env bun
import { bootstrapCapabilities } from "../../../packages/capabilities-mcp/src";

const [scope, command, id] = process.argv.slice(2);
const workspace = process.env.PULSO_WORKSPACE ?? process.cwd();
const runtime = bootstrapCapabilities(workspace);
try {
  if (scope === "doctor") {
    const checks = runtime.doctor();
    const ok = Object.entries(checks)
      .filter(([name]) => name !== "schemaVersion" && name !== "buildId")
      .every(([, value]) => value === true);
    console.log(
      JSON.stringify({ ok, workspaceId: runtime.workspaceId, checks }, null, 2),
    );
    if (!ok) process.exitCode = 1;
  } else if (scope === "work") {
    await runtime.recovery.recover();
    if (command === "list")
      console.log(
        JSON.stringify(await runtime.work.list(runtime.workspaceId), null, 2),
      );
    else if (command === "status")
      console.log(
        JSON.stringify(
          (await runtime.work.list(runtime.workspaceId)).filter(
            (w) => w.status === "active",
          ),
          null,
          2,
        ),
      );
    else if (id) {
      const snapshot = await runtime.work.snapshot(id);
      const value =
        command === "show"
          ? snapshot
          : command === "items"
            ? snapshot.items
            : command === "executions"
              ? snapshot.executions
              : command === "leases"
                ? snapshot.leases
                : command === "events"
                  ? snapshot.events
                  : command === "recover"
                    ? await runtime.recovery.recover()
                    : null;
      if (value === null) throw new Error("Unknown work command");
      console.log(JSON.stringify(value, null, 2));
    } else throw new Error("Missing work ID");
  } else if (scope === "runtime") {
    if (command === "bindings")
      console.log(
        JSON.stringify(await runtime.runtimeBindings.list(), null, 2),
      );
    else if (command === "status")
      console.log(
        JSON.stringify(await runtime.runtimeAdapter.reconcile(), null, 2),
      );
    else throw new Error("Unknown runtime command");
  } else
    throw new Error(
      "Usage: pulso work <list|status|show|items|executions|leases|events|recover> [id] | runtime <bindings|status>",
    );
} finally {
  runtime.close();
}
