import { tool } from "@opencode-ai/plugin"
import core from "../lib/pulso-control-core.js"

export default tool({
  description: "Select the smallest Pulso delivery route using deterministic risk signals.",
  args: {
    objective: tool.schema.string().min(3),
    paths: tool.schema.array(tool.schema.string()).optional(),
    changed_files: tool.schema.number().int().min(0).optional(),
    signals: tool.schema.array(tool.schema.enum([
      "ambiguous", "dependencies", "cross_layer", "new_dependency", "authentication", "persistence",
      "public_contract", "sensitive_data", "remote_operation", "destructive",
      "validation_gap", "contradictory_evidence",
    ])).optional(),
  },
  async execute(args) {
    return JSON.stringify(core.classifyRoute(args))
  },
})
