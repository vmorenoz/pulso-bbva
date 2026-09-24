# Agent Protocol

`TaskEnvelope` is `pulso-task/1`, carrying immutable delegation, specialist, Work, and WorkItem identity plus compact context. Specialists return `pulso-result/1` with the same identity and a discriminated specialist payload. The XML-like envelope contains escaped JSON so every Zod-supported field round-trips without lossy field mapping; unknown fields are rejected by strict schemas.

`parseAgentResult(result, expectedIdentity)` rejects a different protocol, delegation, specialist, Work, or WorkItem. One outer fence-removal repair is permitted; malformed results are not consumed. `DelegationCoordinator` is a pure correlation helper: it creates envelopes, validates results, and maps statuses to binding lifecycle actions. Pulso executes those actions through the native VS Code agent tool and capabilities MCP; this package never invokes a subagent or Working System directly.

For a completed result, Pulso registers each returned artifact with `pulso_work_artifact` before `pulso_runtime_complete(bindingId)`. If artifact registration fails, Pulso maps the delegation to `pulso_runtime_fail(bindingId)` instead of leaving an active binding. Failed, cancelled, and blocked results map respectively to `pulso_runtime_fail`, `pulso_runtime_cancel`, and `pulso_runtime_block`; no result mapping selects a retry or another specialist.
