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

`distribution/prompts` checks scoped obligations on both adapters' fully rendered
agents, including dynamic Knowledge study, generic source/semantic tracing,
inherited evidence definitions, publication authority, specialist receipts and
reported verification. Negative mutations verify that removing discovery/study
gates or reversing provenance safeguards fails those checks. These are structural
prompt contracts, not proof of LLM compliance or a live CI execution. API/permission
oracles and behavioral core tests remain independent; wording-only deduplication
does not justify dropping concurrency, denial, recovery or acceptance scenarios.

Role-loading checks distinguish instructions that are merely tagged as
coordinator-only from instructions physically omitted from specialist prompts.
They preserve native specialist authority, scoped operations and receipt recovery,
the VS Code fallback, and the full coordinator boundary of operational skills.
Prompt-size comparisons exclude frontmatter and are character measurements, not
provider token counts or the total session context (tools, history and retrieved
content are additional).

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

`opencode/automatic-recovery` checks bounded read-only discovery from an ordinary
primary message hook, authentic current/historical native context, legacy without
source references, a single active candidate, real empty-idle status-map semantics,
terminal parent/child errors, and busy/retry/unknown/abort vetoes. It also covers
missing APIs, changed messages/history/root/owner, private proof, permissioned CAS
and terminal-return replay without accepting tasks or releasing unresolved work.
`distribution/prompts` checks the coordinator's semantic compatibility obligation,
the narrow greeting/detection exception and explicit fallback in rendered prompts.

These are adapter contract fixtures using real disk/core, **not** a live network
failure, conversational acceptance test or proof of an LLM's semantic decision.
Administrative reconciliation does not prove the old process stopped. Automatic
recovery is conditional on the pinned host capability and approved existing goal;
without it, explicit selected-Work recovery remains supported. Neither path implies
a daemon, background agent service or activity while the host is closed.

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


## Scoped specialist tools

`opencode/scoped-tools` uses public SDK-shaped session/message responses plus the
real plugin, hooks and core on temporary disk. It reproduces the pinned order:
before restores canonical args, task publishes parent/child metadata and current
input, then the child invokes a tool. It covers fail-closed ancestry, role/call/
prompt mismatch and ambiguous proof, four-tool scope denial, current native
permission, owner-transfer revocation with later return capture, restricted Work
projection, concurrent sibling CAS, atomic receipts, lost-response replay,
changed-key conflict, output/symlink limits and partial projection repair.
Existing plugin/package fixtures now supply realistic mandatory ToolContext
identity and public SDK reads; they no longer omit session/agent metadata.
These fixtures do not claim live host conversation, remote execution or macOS.

## Integrated verification snapshot (2026-10-22)

Linux x64, Node 24.19.0: **583/583 tests pass**, with no failures or skips,
using the freshly regenerated tracked standalone installer archive through
`PULSO_INSTALLER_ARCHIVE`. Build/check, happy/durable smokes, verification of both
runtime archives and checksums, and the staged installer also pass. OpenCode,
VSIX and standalone installer artifacts were rebuilt from the integrated source;
the package version remains 4.2.0, so verify content/checksums rather than infer
freshness from the version label alone.

The existing GitHub Actions job now runs the full suite and core/staged smokes.
This local snapshot does not claim a GitHub Actions run, Node 22/macOS execution,
installation in a real user profile, or a live host/LLM conversation.

After role-specific prompt composition, OpenCode's rendered coordinator prompt
decreased from 58,640 to 53,502 Unicode characters (8.8%); specialist prompts each
lost 5,699 characters (17.8–19.5%), ending at 23,452–26,332. Baseline is `eca5161`,
not `main`: the coordinator still includes additional continuity features absent
from the earlier main version. Counts exclude frontmatter, tools and dynamic
context. Operational skills retain their complete coordinator boundary; runtime
schemas and permission enforcement are unchanged. These measurements are not
token counts or evidence of live-model behavioral equivalence.
