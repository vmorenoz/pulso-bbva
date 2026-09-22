import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import jsonc from "../lib/pulso-jsonc.js"
import stateFiles from "../lib/pulso-file-state.js"

const { applyEdits, modify, parse } = jsonc

const AGENT_ROLES = {
  pulso: "reasoning",
  "pulso-planner": "reasoning",
  "pulso-challenger": "reasoning",
  "pulso-verifier": "reasoning",
  "pulso-integration-auditor": "reasoning",
  "pulso-security-auditor": "reasoning",
  "pulso-ui-auditor": "reasoning",
  "pulso-executor": "execution",
  "pulso-contact-manager": "execution",
  "pulso-config-manager": "execution",
  "pulso-explorer": "static",
  "pulso-experience-curator": "static",
  "pulso-delivery-reporter": "static",
}

const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" }

function availableModels() {
  const binary = process.env.PULSO_OPENCODE_BIN || "opencode"
  const output = execFileSync(binary, ["models"], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 })
  return [...new Set(output.split(/\r?\n/).map((line) => line.trim()).filter((line) => /^[^/\s]+\/[^\s]+$/.test(line)))].sort()
}

function recognized(models, pattern) {
  return models.find((model) => pattern.test(model.split("/").slice(1).join("/"))) || null
}

function catalog() {
  const models = availableModels()
  const grouped = models.reduce((providers, model) => {
    const provider = model.split("/", 1)[0]
    ;(providers[provider] ||= []).push(model)
    return providers
  }, {})
  const recommendations = Object.fromEntries(Object.entries(grouped).map(([provider, entries]) => [provider, {
    recommended: {
      reasoning: recognized(entries, /(?:^|[-_.])terra(?:$|[-_.])/i),
      static: recognized(entries, /(?:^|[-_.])luna(?:$|[-_.])/i),
    },
    performance: {
      reasoning: recognized(entries, /(?:^|[-_.])sol(?:$|[-_.])/i),
      execution: recognized(entries, /(?:^|[-_.])terra(?:$|[-_.])/i),
      static: recognized(entries, /(?:^|[-_.])luna(?:$|[-_.])/i),
    },
  }]))
  return {
    providers: grouped,
    recommended_provider: grouped["github-copilot"] ? "github-copilot" : Object.keys(grouped)[0] || null,
    recommendations,
    agents: AGENT_ROLES,
  }
}

function configFile(scope, directory) {
  if (scope === "global") {
    const root = path.resolve(process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"))
    return fs.existsSync(path.join(root, "opencode.jsonc"))
      ? path.join(root, "opencode.jsonc")
      : fs.existsSync(path.join(root, "opencode.json")) ? path.join(root, "opencode.json") : path.join(root, "opencode.jsonc")
  }
  for (const candidate of ["opencode.jsonc", "opencode.json", path.join(".opencode", "opencode.json")]) {
    const file = path.join(directory, candidate)
    if (fs.existsSync(file)) return file
  }
  return path.join(directory, "opencode.jsonc")
}

function parsedConfig(file) {
  if (!fs.existsSync(file)) return { text: '{\n  "$schema": "https://opencode.ai/config.json"\n}\n', value: {} }
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Refusing a symbolic OpenCode config path: ${file}`)
  const text = fs.readFileSync(file, "utf8")
  const errors = []
  const value = parse(text, errors, { allowTrailingComma: true })
  if (errors.length) throw new Error(`Cannot safely update invalid JSONC: ${file}`)
  return { text, value }
}

function mappingsFor(preset, provider, reasoningModel, executionModel, staticModel, assignments) {
  if (preset === "inherited") return {}
  if (preset === "custom") {
    const missing = Object.keys(AGENT_ROLES).filter((agent) => !assignments?.[agent])
    if (missing.length) throw new Error(`Custom configuration is missing agents: ${missing.join(", ")}`)
    return Object.fromEntries(Object.keys(AGENT_ROLES).map((agent) => [agent, assignments[agent]]))
  }
  if (!reasoningModel || !staticModel || (preset === "performance" && !executionModel)) {
    throw new Error(`${preset} configuration requires models for each requested capability.`)
  }
  const byRole = {
    reasoning: reasoningModel,
    execution: preset === "performance" ? executionModel : staticModel,
    static: staticModel,
  }
  return Object.fromEntries(Object.entries(AGENT_ROLES).map(([agent, role]) => [agent, byRole[role]]))
}

function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" })
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

export default tool({
  description: "Discover available OpenCode models and configure Pulso agent models globally or for the current project.",
  args: {
    action: tool.schema.enum(["catalog", "apply"]),
    scope: tool.schema.enum(["global", "project"]).optional(),
    preset: tool.schema.enum(["recommended", "performance", "inherited", "custom"]).optional(),
    provider: tool.schema.string().optional(),
    reasoning_model: tool.schema.string().optional(),
    execution_model: tool.schema.string().optional(),
    static_model: tool.schema.string().optional(),
    assignments: tool.schema.record(tool.schema.string(), tool.schema.string()).optional(),
  },
  async execute({ action, scope, preset, provider, reasoning_model, execution_model, static_model, assignments }, context) {
    if (context.agent !== "pulso-config-manager") throw new Error("Only pulso-config-manager can configure agent models.")
    const currentCatalog = catalog()
    if (action === "catalog") return JSON.stringify(currentCatalog)
    if (!scope || !preset) throw new Error("Model configuration requires scope and preset.")
    const target = configFile(scope, context.directory)
    const mappings = mappingsFor(preset, provider, reasoning_model, execution_model, static_model, assignments)
    const selected = Object.values(mappings)
    const available = new Set(Object.values(currentCatalog.providers).flat())
    const invalid = selected.filter((model) => !available.has(model))
    if (invalid.length) throw new Error(`Models are not available in this OpenCode installation: ${[...new Set(invalid)].join(", ")}`)
    if (provider && selected.some((model) => !model.startsWith(`${provider}/`))) throw new Error(`All selected models must belong to provider ${provider}.`)

    if (preset === "inherited" && scope === "project") {
      const global = parsedConfig(configFile("global", context.directory)).value
      const pinned = Object.keys(AGENT_ROLES).filter((agent) => typeof global.agent?.[agent]?.model === "string")
      if (pinned.length) throw new Error("Project inheritance is blocked by global Pulso model assignments; choose global scope to remove them.")
    }

    stateFiles.withFileLock(target, () => {
      const { text: previous } = parsedConfig(target)
      let next = previous
      for (const agent of Object.keys(AGENT_ROLES)) {
        next = applyEdits(next, modify(next, ["agent", agent, "model"], preset === "inherited" ? undefined : mappings[agent], { formattingOptions }))
      }
      writeAtomic(target, next)
    })
    return JSON.stringify({
      status: "configured",
      scope,
      preset,
      provider: provider || null,
      config_file: target,
      models: mappings,
      restart_required: true,
    })
  },
})
