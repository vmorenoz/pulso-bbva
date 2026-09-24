# Runtime Bindings

A persisted binding correlates, without copying state:

```text
RuntimeExecutionReference <-> RuntimeExecutionBinding
                           <-> Work Execution <-> Lease
```

The durable key is `(provider, executionId)`. A repeated start for the same
reference and WorkItem returns the existing binding. The same reference for a
different WorkItem is rejected with `RUNTIME_EXECUTION_CONFLICT`.

The separate `runtime-bindings.db` stores provider, opaque external IDs,
optional session ID, safe string metadata, Work and authority IDs, fencing
token, timestamps and adapter status. It never stores tokens, prompts,
credentials, source code or payloads.

The temporary `creating` row serializes bind retries. It is not exposed as a
normal lifecycle state and is removed when bind compensation completes.
