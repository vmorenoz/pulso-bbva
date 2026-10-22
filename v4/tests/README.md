# Focused V4 tests

Run from `v4/` with Node >=22. Tests use disposable workspaces/homes; never install
into a real user profile to verify a change.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify                         # build, package checks, real-core smokes
npm test                               # includes isolated archives/native adapters
npm run test:continuity                 # persistence, continuity and adapter slice
npm run verify:installer-staged         # actual staged installer, temporary home
```

The bootstrap integration case requires an actual installer bundle. To include it
without replacing release artifacts:

```sh
export PULSO_TEST_ARTIFACTS="$(mktemp -d)"
export PULSO_INSTALLER_ARCHIVE="$(node --input-type=module -e \
  "import {packageInstaller} from './scripts/package-installer.mjs'; \
   console.log(packageInstaller({artifacts:process.env.PULSO_TEST_ARTIFACTS}).file)")"
npm test
rm -rf -- "$PULSO_TEST_ARTIFACTS"          # only this disposable directory
unset PULSO_INSTALLER_ARCHIVE PULSO_TEST_ARTIFACTS
```

## Coverage ownership

- **`core/work-mutations`** owns acceptance-change matrices: criterion
  description/verification and task scope/acceptance/title changes, audit snapshots,
  reasons, invalidation, old-evidence rejection, and renewed acceptance. Summary-only
  edits remain metadata. The overlapping cases were removed from `core-integrity`,
  which retains immutable historical observations, cross-document integrity,
  partial persistence/recovery, and cancellation with missing/stale reports.
- **`core/schema` + `contract-fixtures`** exercise the same explicit mutation inputs
  through persisted and advertised contracts. Missing fields/discriminators,
  unknown fields and types still fail. `assertions` checks structured code + entity
  rather than a localized summary. `tool-contracts` retains native-only constraints,
  evidence execution rules and union diagnostics; its duplicate executed/PASS loop
  is folded into the main evidence matrix.
- **Legacy results are not compact returns.** `legacyResult` supplies the supported
  persisted v1 envelope for schema, artifact and semantic-tool tests. The authored
  compact result template is checked against `accept_result`; `validate_result`
  still requires the legacy envelope. Historical evidence and legacy migration
  cases remain supported and tested.
- **Identity/migration fault injection** targets registry publication, not every
  HOME rename (which now includes lock-owner writes). Migration tests preserve
  source/backup/staging bytes and verify idempotent retry/roll-forward; they no
  longer demand automatic staging deletion or obsolete rollback behavior.
- **Distribution:** `role-contract` centralizes the current native permission
  matrix and applies it to both direct rendering and isolated built packages.
  `prompts` owns Knowledge guidance; `native-parity` owns role/skill composition;
  `isolation` retains reproducibility, archive/import activation, package inventory
  and shipped guidance. Steering checks inspect instructions/schema shape, not
  model behavior. Existing integration, security, scope, cancellation, user
  acceptance, concurrency and persistence tests remain in place.

## Recovery regression and limits

`opencode/durable-hooks` includes a failed native task followed by explicit binding
of **the same continuity** from a new session, using already-confirmed IDs and
intent. It verifies an error is not terminal evidence, retirement alone does not
clear an unresolved attempt, explicit administrative reconciliation is recorded,
replacement preparation is idempotent, and same-task redispatch is blocked. Work
results/evidence and the old native provenance are not fabricated.

`core/session-recovery` covers the lost-capsule path: selected-Work inspection,
complete paginated candidates, explicit CAS adoption, current intention preserved,
root/cycle/owner races, absent native identity, lost-response replay and unresolved
versus awaiting-incorporation diagnostics. `opencode/plugin` verifies current native
permission, denial, cancellation and root revocation for this new flow.

These are adapter contract fixtures using real disk/core, **not** a live network
failure or conversational acceptance test. Administrative reconciliation does not
prove the old process stopped. Specialist-tool permissions and autonomous adoption
policy are separate work; this stage only adds explicit selected-Work recovery.

## Cleanup baseline (2026-10-22)

Linux, Node 24.19.0, starting at `a32bf696`:

| Suite | Before | After |
| --- | --- | --- |
| Core | 301: 252 pass / 49 fail | 301 pass |
| OpenCode | 47 pass | 48 pass (new recovery regression) |
| Full suite | 472: 422 pass / 49 fail / 1 bundle-dependent skip | 473 pass / 0 fail / 0 skip with temporary bundle |

Build/check, happy and durable core smokes, extracted package tests and staged
installer verification pass locally. No live OpenCode/VS Code conversation or
macOS/Node 22 CI run is claimed by these local results. Test count reduction is not
a goal: duplicated assertions were consolidated while useful coverage increased.
