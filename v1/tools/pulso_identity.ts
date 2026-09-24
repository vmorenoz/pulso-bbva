import { tool } from "@opencode-ai/plugin"
import identity from "../lib/pulso-identity.js"

export default tool({
  description: "Resolve Pulso's integrity-checked canonical identity when the user asks who Pulso is or who created it.",
  args: {},
  async execute() {
    return JSON.stringify(identity.resolveIdentity())
  },
})
