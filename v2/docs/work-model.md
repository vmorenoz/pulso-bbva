# Work Model

Work is the objective lifecycle. WorkItem is a DAG node with a lifecycle separate from its kind. Assignment stores an opaque assignee identity, Execution is one concrete attempt identified by an opaque executor identity, Lease is temporary exclusive authority, Recovery reconciles lost attempts, Artifact is an external reference, and WorkEvent is append-only audit history.

Dependencies must be same-work, existing and acyclic. Pending items become ready deterministically only when every dependency is completed. Version fields support optimistic writes on descriptive updates.

## Execution model

Starting an execution atomically validates readiness and assignment, creates an execution for an opaque executor identity, acquires the only active lease, changes the item to `in_progress`, and appends events. Completion/failure validates `(item, execution, lease)` authority. Lease IDs plus per-item monotonic fencing tokens prevent a late attempt from overwriting a newer attempt.

## Leases

Lease TTL is runtime configuration (`leaseTtlMs`, default 300000 ms), not a domain magic constant. Heartbeat renews `heartbeatAt` and `expiresAt`. Only one active lease is allowed by both service logic and a SQLite partial unique index. Released, expired and revoked leases cannot authorize writes. Every started execution returns a per-item monotonic fencing token; heartbeat and terminal execution writes require that token, so a caller cannot authorize a write with an outdated lease capability.

Revocation is authoritative: it marks the lease `revoked`, abandons the running execution, moves the item to `recovery_required`, and records `lease.revoked`. Blocking or waiting uses the same authority boundary, releasing the lease and abandoning the execution before changing the item state.

## Recovery

Recovery is lazy at the application boundary: authoritative `snapshot` and `list` queries, reads exposed by MCP, CLI commands, execution starts and sensitive execution writes invoke reconciliation. An expired active lease becomes `expired`; its running execution becomes `abandoned`; its in-progress item becomes `recovery_required`. Since only active leases are processed, reruns are idempotent. Recovery never chooses a replacement executor or assignee.
