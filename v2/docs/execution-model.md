# Execution Model

Starting an execution atomically validates readiness and assignment, creates an execution for an opaque executor identity, acquires the only active lease, changes the item to `in_progress`, and appends events. Completion/failure validates `(item, execution, lease)` authority. Lease IDs plus per-item monotonic fencing tokens prevent a late attempt from overwriting a newer attempt.
