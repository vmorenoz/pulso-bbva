import { tool } from "@opencode-ai/plugin"
import core from "../lib/pulso-control-core.js"

export default tool({
  description: "Resolve compact Pulso skill constraints once per objective.",
  args: { skills: tool.schema.array(tool.schema.string()).max(10) },
  async execute({ skills }) {
    return JSON.stringify(core.skillDigest([...new Set(skills)]))
  },
})
