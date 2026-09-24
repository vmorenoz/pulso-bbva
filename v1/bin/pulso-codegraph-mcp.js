#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawn } = require("node:child_process");

const CODEGRAPH_MCP_TOOLS = "codegraph_explore,codegraph_search,codegraph_node,codegraph_callers,codegraph_callees,codegraph_impact,codegraph_files,codegraph_status";
const workspace = process.argv[2];
if (!workspace || !path.isAbsolute(workspace)) {
  process.stderr.write("Pulso CodeGraph MCP requires an absolute workspace root.\n");
  process.exit(2);
}

const child = spawn("codegraph", ["serve", "--mcp"], { cwd: workspace, env: { ...process.env, CODEGRAPH_MCP_TOOLS }, stdio: "inherit", windowsHide: true });
child.on("error", () => process.exit(1));
child.on("exit", (code, signal) => process.exitCode = signal ? 1 : (code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
