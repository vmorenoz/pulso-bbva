import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import core from "../lib/pulso-control-core.js"

const requiredAgents = [
  "pulso", "pulso-planner", "pulso-challenger", "pulso-executor", "pulso-explorer", "pulso-verifier",
  "pulso-code-auditor", "pulso-integration-auditor", "pulso-security-auditor", "pulso-ui-auditor", "pulso-experience-curator",
]

export default tool({
  description: "Run a read-only Pulso health check for configuration, plugins, state, leases, breakers, and experience storage.",
  args: {},
  async execute(_, context) {
    const findings = []
    const configRoot = path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"))
    for (const agent of requiredAgents) {
      if (!fs.existsSync(path.join(configRoot, "agents", `${agent}.md`))) findings.push({ severity: "error", code: "missing_agent", detail: agent })
    }
    for (const plugin of ["pulso-circuit-breaker", "pulso-experience-engine"]) {
      if (!fs.existsSync(path.join(configRoot, "plugins", `${plugin}.mjs`))) findings.push({ severity: "error", code: "missing_plugin", detail: plugin })
    }
    const configFiles = ["opencode.jsonc", "opencode.json"].map((name) => path.join(configRoot, name))
    const configFile = configFiles.find((file) => fs.existsSync(file))
    if (!configFile) findings.push({ severity: "error", code: "missing_config", detail: configRoot })
    else {
      const configText = fs.readFileSync(configFile, "utf8")
      for (const plugin of ["./plugins/pulso-circuit-breaker.mjs", "./plugins/pulso-experience-engine.mjs"]) {
        if (!configText.includes(plugin)) findings.push({ severity: "error", code: "unregistered_plugin", detail: plugin })
      }
    }
    for (const customTool of ["pulso_lease", "pulso_route", "pulso_skill_digest", "pulso_doctor", "pulso_dashboard"]) {
      if (!fs.existsSync(path.join(configRoot, "tools", `${customTool}.ts`))) findings.push({ severity: "error", code: "missing_tool", detail: customTool })
    }
    const taskDir = path.join(context.directory, ".pulso", "tasks")
    if (fs.existsSync(taskDir)) {
      for (const name of fs.readdirSync(taskDir).filter((entry) => entry.endsWith(".json"))) {
        try { JSON.parse(fs.readFileSync(path.join(taskDir, name), "utf8")) } catch { findings.push({ severity: "error", code: "invalid_task_json", detail: name }) }
      }
    }
    const leaseDir = path.join(context.directory, ".pulso", "leases")
    if (fs.existsSync(leaseDir)) {
      for (const name of fs.readdirSync(leaseDir).filter((entry) => entry.endsWith(".json"))) {
        try {
          const lease = JSON.parse(fs.readFileSync(path.join(leaseDir, name), "utf8"))
          if (core.isExpired(lease)) findings.push({ severity: "warning", code: "expired_lease", detail: lease.task_id })
        } catch { findings.push({ severity: "error", code: "invalid_lease_json", detail: name }) }
      }
    }
    const breakerDir = path.join(context.directory, ".pulso", "circuit-breakers")
    if (fs.existsSync(breakerDir)) {
      for (const name of fs.readdirSync(breakerDir).filter((entry) => entry.endsWith(".json"))) {
        try {
          const breaker = JSON.parse(fs.readFileSync(path.join(breakerDir, name), "utf8"))
          if (breaker?.state === "open") findings.push({ severity: "warning", code: "open_circuit", detail: breaker.task_id })
        } catch { findings.push({ severity: "error", code: "invalid_breaker_json", detail: name }) }
      }
    }
    const experience = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "opencode", "pulso", "experience.sqlite")
    if (fs.existsSync(experience)) {
      try {
        fs.accessSync(experience, fs.constants.R_OK)
      } catch {
        findings.push({ severity: "error", code: "experience_store_unreadable", detail: "Experience store is not readable" })
      }
    } else findings.push({ severity: "warning", code: "experience_store_missing", detail: "No Pulso experience has been recorded yet" })
    return JSON.stringify({ status: findings.some((item) => item.severity === "error") ? "unhealthy" : findings.length ? "warning" : "healthy", findings })
  },
})
