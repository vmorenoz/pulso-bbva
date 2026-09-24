import path from "node:path";
import codegraph from "../lib/pulso-vscode-codegraph.js";

export async function PulsoCodeGraphPlugin(input) {
  const diagnostics = new Map();
  const activations = new Map();
  async function activate(message) {
    let root;
    try {
      root = codegraph.workspaceRoot(input.directory, process.env.HOME);
      const key = `${root}\0${message.sessionID}`;
      if (!activations.has(key)) {
        activations.set(key, (async () => {
          const result = await codegraph.lifecycle({
            runtime: "opencode",
            cwd: root,
            home: process.env.HOME,
            configFile: path.join(root, ".opencode", "opencode.jsonc")
          });
          if (result.status !== "ready" || !result.mcp?.registered) {
            diagnostics.set(key, { status: result.status || "unavailable" });
            return;
          }
          try {
            await input.client.mcp.add({
              query: { directory: root },
              body: { name: codegraph.SERVER, config: codegraph.openCodeServer(root) }
            });
            diagnostics.set(key, { status: "ready" });
          } catch {
            diagnostics.set(key, { status: "mcp_add_failed" });
          }
        })());
      }
      await activations.get(key);
    } catch {
      diagnostics.set(`${root || input.directory}\0${message.sessionID}`, { status: "unavailable" });
    }
  }
  const hooks = {
    async "chat.message"(message) {
      if (message.agent !== "pulso") return;
      await activate(message);
    },
    codegraphDiagnostic(sessionID) {
      return diagnostics.get(`${codegraph.workspaceRoot(input.directory, process.env.HOME)}\0${sessionID}`) || null;
    }
  };
  return hooks;
}

export default PulsoCodeGraphPlugin;
