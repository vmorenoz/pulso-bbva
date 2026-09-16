import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { tool } from "@opencode-ai/plugin"
import core from "../lib/pulso-control-core.js"

const requiredAgents = [
  "pulso", "pulso-planner", "pulso-challenger", "pulso-contact-manager", "pulso-executor", "pulso-explorer", "pulso-verifier",
  "pulso-integration-auditor", "pulso-security-auditor", "pulso-ui-auditor", "pulso-experience-curator", "pulso-delivery-reporter",
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
    for (const customTool of ["pulso_lease", "pulso_artifacts", "pulso_route", "pulso_skill_digest", "pulso_doctor", "pulso_dashboard", "pulso_agent_contacts", "pulso_identity"]) {
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
    const reconciliationLog = path.join(path.dirname(experience), "reconciliation.jsonl")
    if (fs.existsSync(reconciliationLog)) {
      const projectKey = crypto.createHash("sha256").update(String(context.directory)).digest("hex").slice(0, 24)
      try {
        const recent = fs.readFileSync(reconciliationLog, "utf8").trim().split("\n").slice(-200)
          .map((line) => JSON.parse(line))
          .filter((item) => item.project_key === projectKey)
        const latestCompleted = [...recent].reverse().find((item) => item.code === "reconciliation_completed")
        const latestIssue = [...recent].reverse().find((item) => ["lookup_timeout", "lookup_failed", "cycle_detected", "self_parent", "foreign_project_session", "depth_limit", "budget_exhausted", "row_skipped", "reconciliation_failed"].includes(item.code))
        if (latestCompleted && Number(latestCompleted.skipped) > 0) {
          findings.push({ severity: "warning", code: "experience_reconciliation_issue", detail: `${latestCompleted.skipped} historical row(s) skipped; run pulso_experience_repair after OpenCode is responsive` })
        } else if (latestIssue && (!latestCompleted || latestIssue.timestamp > latestCompleted.timestamp)) {
          findings.push({ severity: "warning", code: "experience_reconciliation_issue", detail: `${latestIssue.code}; run pulso_experience_repair after OpenCode is responsive` })
        }
      } catch {
        findings.push({ severity: "warning", code: "experience_diagnostics_unreadable", detail: "Pulso reconciliation diagnostics could not be parsed" })
      }
    }
    return JSON.stringify({ status: findings.some((item) => item.severity === "error") ? "unhealthy" : findings.length ? "warning" : "healthy", findings })
  },
})
