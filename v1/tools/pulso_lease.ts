import { tool } from "@opencode-ai/plugin"
import leases from "../lib/pulso-lease-core.js"
import contacts from "../lib/pulso-agent-contacts.js"

export default tool({
  description: "Acquire, heartbeat, release, or inspect a recoverable Pulso task lease.",
  args: {
    action: tool.schema.enum(["acquire", "heartbeat", "release", "status", "recover"]),
    task_id: tool.schema.string().regex(/^PULSO-\d+$/),
    ttl_minutes: tool.schema.number().int().min(5).max(240).default(30),
    force: tool.schema.boolean().optional(),
    reason: tool.schema.string().optional(),
  },
  async execute({ action, task_id, ttl_minutes, force, reason }, context) {
    const canOwnLease = context.agent === "pulso-executor"
      || contacts.registeredContact(context.directory, context.agent)?.mutation === "scoped"
    const canRecoverLease = context.agent === "pulso" && (action === "recover" || (action === "release" && force))
    if (action !== "status" && !canOwnLease && !canRecoverLease) {
      throw new Error(`Agent ${context.agent} cannot ${action} a task lease.`)
    }
    const ttlMinutes = ttl_minutes ?? 30
    if (action === "status") return JSON.stringify(leases.read(context.directory, task_id) || { task_id, status: "none" })
    if (action === "acquire") return JSON.stringify(leases.acquire(context.directory, task_id, context.sessionID, ttlMinutes))
    if (action === "recover") return JSON.stringify(leases.acquire(context.directory, task_id, context.sessionID, ttlMinutes, { recover: true, reason: reason || "manual recovery" }))
    if (action === "heartbeat") return JSON.stringify(leases.heartbeat(context.directory, task_id, context.sessionID, ttlMinutes))
    return JSON.stringify(leases.release(context.directory, task_id, {
      ownerSession: context.sessionID,
      force: Boolean(force),
      releasedBy: context.sessionID,
      reason,
    }) || { task_id, status: "none" })
  },
})
