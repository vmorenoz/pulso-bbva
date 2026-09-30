import { tool } from "@opencode-ai/plugin"
import contacts from "../lib/pulso-agent-contacts.js"

export default tool({
  description: "Scan, manage, and match the global address book of user-approved external agents for native task delegation.",
  args: {
    action: tool.schema.enum(["scan", "list", "register", "remove", "match"]),
    agent: tool.schema.string().regex(/^[A-Za-z0-9._-]+$/).optional(),
    digest: tool.schema.string().regex(/^[a-f0-9]{64}$/).optional(),
    description: tool.schema.string().max(500).optional(),
    use_when: tool.schema.array(tool.schema.string().max(120)).max(12).optional(),
    avoid_when: tool.schema.array(tool.schema.string().max(120)).max(12).optional(),
    capabilities: tool.schema.array(tool.schema.string().max(120)).max(12).optional(),
    mutation: tool.schema.enum(["read_only", "scoped"]).optional(),
    objective: tool.schema.string().max(2000).optional(),
    paths: tool.schema.array(tool.schema.string().max(500)).max(50).optional(),
  },
  async execute(args, context) {
    if (args.action === "scan") return JSON.stringify({ candidates: contacts.scan(context.directory) })
    if (args.action === "list") return JSON.stringify({ contacts: Object.values(contacts.readCatalog().contacts) })
    if (args.action === "remove") {
      if (!args.agent) throw new Error("agent is required for remove.")
      return JSON.stringify({ agent: args.agent, removed: contacts.remove(args.agent) })
    }
    if (args.action === "match") {
      if (!args.objective) throw new Error("objective is required for match.")
      return JSON.stringify({
        contacts: contacts.match(context.directory, args.objective, args.paths || []),
        delegation: {
          required_markers: ["PULSO_TASK_ID=PULSO-xxx", "PULSO_CONTACT_ID=<agent>"],
          rules: ["Supply the authoritative task scope and acceptance criteria.", "Scoped contacts must acquire and release the task lease before mutation.", "Contacts cannot use shell, delegate other agents, operate Pulso control tools, or modify .pulso state."],
        },
      })
    }
    if (!args.agent || !args.digest || !args.description || !args.use_when?.length || !args.capabilities?.length || !args.mutation) {
      throw new Error("register requires agent, digest, description, use_when, capabilities, and mutation.")
    }
    const contact = contacts.register(context.directory, {
      agent: args.agent,
      digest: args.digest,
      description: args.description,
      use_when: args.use_when,
      avoid_when: args.avoid_when || [],
      capabilities: args.capabilities,
      mutation: args.mutation,
    })
    return JSON.stringify({ status: "registered", contact })
  },
})
