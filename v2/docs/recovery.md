# Recovery

Recovery is lazy at the application boundary: authoritative `snapshot` and `list` queries, reads exposed by MCP, CLI commands, execution starts and sensitive execution writes invoke reconciliation. An expired active lease becomes `expired`; its running execution becomes `abandoned`; its in-progress item becomes `recovery_required`. Since only active leases are processed, reruns are idempotent. Recovery never chooses a replacement executor or assignee.
