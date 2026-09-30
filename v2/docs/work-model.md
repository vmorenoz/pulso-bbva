# Work Model

Work is the objective lifecycle. WorkItem is a DAG node with a lifecycle separate from its kind. Assignment stores an opaque assignee identity, Execution is one concrete attempt identified by an opaque executor identity, Lease is temporary exclusive authority, Recovery reconciles lost attempts, Artifact is an external reference, and WorkEvent is append-only audit history.

Dependencies must be same-work, existing and acyclic. Pending items become ready deterministically only when every dependency is completed. Version fields support optimistic writes on descriptive updates.
