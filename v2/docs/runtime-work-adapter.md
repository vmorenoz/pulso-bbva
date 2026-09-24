# Runtime Work Adapter

The adapter is an inbound lifecycle translation boundary:

```text
external runtime -> @pulso/capabilities-mcp -> @pulso/working-system application services
```

`@pulso/working-system` remains runtime-agnostic and authoritative for Work, WorkItem,
Execution, Lease, fencing and Recovery. The adapter does not create work,
select executors, plan, route, delegate, or decide retry policy.

`@pulso/capabilities-mcp` contains contracts, the lifecycle adapter, reconciliation,
ports and binding storage in a separate SQLite file. Provider values are opaque data;
there is no VS Code package or host-specific adapter.

The bind operation reserves a unique external reference, obtains existing Work
authority through the gateway, and finalizes the binding. If finalization
fails after Work authority was created, the adapter revokes that lease as a
compensation. This is not a distributed SQLite transaction; Work remains the
authority and reconciliation handles an interrupted compensation.

The explicit API is `bind`, `heartbeat`, `complete`, `fail`, `cancel`, `get`
and `reconcile`. A future caller supplies the already-decided WorkItem and
executor; no orchestration is present here.
