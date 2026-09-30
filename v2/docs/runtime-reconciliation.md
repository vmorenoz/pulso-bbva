# Runtime Reconciliation

Startup and explicit reconciliation first invoke the existing Work Recovery,
then inspect each active binding through the Work gateway. The reconciler only
updates adapter state:

| Work observation | Binding result |
| --- | --- |
| running execution and live lease | active |
| completed execution | completed |
| failed execution | failed |
| cancelled execution | cancelled |
| abandoned execution or expired/non-active lease | lost |

It never performs reassignment, retry preparation or a second recovery flow.
After runtime disappearance, heartbeats stop; Work lease expiry and Work
Recovery set the WorkItem to `recovery_required`. Reconciliation then marks the
binding `lost`. Late lifecycle events cannot regain authority because Work
fencing and the adapter active-state check reject them.
