import fs from "node:fs"
import path from "node:path"
import { tool } from "@opencode-ai/plugin"
import core from "../lib/pulso-control-core.js"
import stateFiles from "../lib/pulso-file-state.js"

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
    const ttlMinutes = ttl_minutes ?? 30
    const file = path.join(stateFiles.safeDirectory(context.directory, [".pulso", "leases"]), `${task_id}.json`)
    return stateFiles.withFileLock(file, () => {
      const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null
      if (action === "status") return JSON.stringify(existing || { task_id, status: "none" })

      const now = new Date()
      if (action === "acquire") {
        if (existing?.status === "active" && !core.isExpired(existing) && existing.owner_session !== context.sessionID) {
          throw new Error(`${task_id} is leased by another active session until ${existing.expires_at}.`)
        }
        const lease = {
          schema_version: 1,
          task_id,
          status: "active",
          owner_session: context.sessionID,
          acquired_at: now.toISOString(),
          heartbeat_at: now.toISOString(),
          expires_at: new Date(now.getTime() + ttlMinutes * 60000).toISOString(),
          recovered_from: core.isExpired(existing) ? existing.owner_session : null,
        }
        stateFiles.writeAtomic(file, lease)
        return JSON.stringify(lease)
      }

      if (action === "recover") {
        const lease = {
          schema_version: 1,
          task_id,
          status: "active",
          owner_session: context.sessionID,
          acquired_at: now.toISOString(),
          heartbeat_at: now.toISOString(),
          expires_at: new Date(now.getTime() + ttlMinutes * 60000).toISOString(),
          recovered_from: existing?.status === "active" ? existing.owner_session : (core.isExpired(existing) ? existing.owner_session : null),
          recovery_reason: reason || "manual recovery",
        }
        stateFiles.writeAtomic(file, lease)
        return JSON.stringify(lease)
      }

      if (action === "release" && force) {
        if (!existing || existing.status !== "active") return JSON.stringify(existing || { task_id, status: "none" })
        existing.status = "released"
        existing.released_at = now.toISOString()
        existing.released_by = context.sessionID
        if (reason) existing.release_reason = reason
        stateFiles.writeAtomic(file, existing)
        return JSON.stringify(existing)
      }

      if (!existing || existing.owner_session !== context.sessionID || existing.status !== "active") {
        throw new Error(`${task_id} has no active lease owned by this session.`)
      }
      if (action === "heartbeat") {
        existing.heartbeat_at = now.toISOString()
        existing.expires_at = new Date(now.getTime() + ttlMinutes * 60000).toISOString()
      } else {
        existing.status = "released"
        existing.released_at = now.toISOString()
      }
      stateFiles.writeAtomic(file, existing)
      return JSON.stringify(existing)
    })
  },
})
