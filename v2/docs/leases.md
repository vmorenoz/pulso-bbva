# Leases

Lease TTL is runtime configuration (`leaseTtlMs`, default 300000 ms), not a domain magic constant. Heartbeat renews `heartbeatAt` and `expiresAt`. Only one active lease is allowed by both service logic and a SQLite partial unique index. Released, expired and revoked leases cannot authorize writes. Every started execution returns a per-item monotonic fencing token; heartbeat and terminal execution writes require that token, so a caller cannot authorize a write with an outdated lease capability.

Revocation is authoritative: it marks the lease `revoked`, abandons the running execution, moves the item to `recovery_required`, and records `lease.revoked`. Blocking or waiting uses the same authority boundary, releasing the lease and abandoning the execution before changing the item state.
