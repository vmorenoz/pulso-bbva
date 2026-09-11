import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { tool } from "@opencode-ai/plugin"

const dashboardScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "pulso-dashboard.js")

export default tool({
  description: "Start a temporary local read-only Pulso dashboard for the current project's metrics, memories, and preferences.",
  args: {
    open: tool.schema.boolean().default(true),
    timeout_minutes: tool.schema.number().int().min(5).max(240).default(30),
  },
  async execute({ open, timeout_minutes }, context) {
    const args = [dashboardScript, "--project", context.directory, "--port", "0", "--timeout", String(timeout_minutes ?? 30)]
    if (open ?? true) args.push("--open")
    const child = spawn(process.env.PULSO_NODE_BINARY || "node", args, { detached: true, stdio: ["ignore", "pipe", "pipe"] })
    const url = await new Promise<string>((resolve, reject) => {
      let settled = false
      let stdout = ""
      let stderr = ""
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        reject(error)
      }
      const timer = setTimeout(() => {
        child.kill("SIGTERM")
        fail(new Error("Pulso dashboard did not start within 5 seconds."))
      }, 5000)
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk)
        const match = stdout.match(/PULSO_DASHBOARD_URL=(\S+)/)
        if (!match) return
        settled = true
        clearTimeout(timer)
        resolve(match[1])
      })
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-2000) })
      child.once("error", (error) => fail(new Error(`Unable to launch Node for the Pulso dashboard: ${error.message}`)))
      child.once("exit", (code) => {
        if (!settled) fail(new Error(`Pulso dashboard exited with status ${code}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`))
      })
    })
    child.stdout.destroy()
    child.stderr.destroy()
    child.unref()
    return JSON.stringify({ status: "started", url, expires_after_minutes: timeout_minutes ?? 30, stop: "Use the dashboard Stop server button." })
  },
})
