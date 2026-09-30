# 0008 Explicit runtime identity

Use `(provider, executionId)` as the external idempotency key. Host-specific
identity is explicit and opaque; no universal session or executor identity is
assumed.
