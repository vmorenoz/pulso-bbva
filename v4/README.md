# Pulso V4 · technical source guide

One canonical local semantic core, independently rendered native integrations, and a separate global installation selector. Runtime packages are self-contained and contain only their own integration and neutral resources. Historical V3 directories remain unchanged.

## 4.2.0 · durable continuity

The current source and local packages are **4.2.0**. See [delivery and observed checks](ENTREGA-4.2.0.md), [the cross-adapter plan](PLAN-CONTINUIDAD-MULTISESION-OPENCODE-VSCODE.md) and the [changelog from V1](../CHANGELOG.md). OpenCode was subsequently installed on explicit user request; restart existing instances to load it. VS Code installation and native conversational acceptance remain separate pending activities.

- `contractVersion:2` prepares a durable snapshot and returns compact IDs plus the exact specialist prompt. Retrieve originals explicitly with `get_delegation`; do not retransmit canonical acceptance hashes.
- Literal returns survive invalid decisions or stale revisions. `accept_result` accepts a stored `returnId` or captures `reportedReturn` before semantic validation, in the same invocation. Operation IDs make committed retries idempotent.
- Continuity binds an objective, Work, repository scopes and a revisioned intention. Global workspace focus is navigation, not an implicit instruction to resume another objective.
- Per-ID snapshots/return blobs and a lightweight registry avoid reading unrelated historical bodies. Short owned mutexes protect cooperative metadata writers; they do not cover agent execution or replace native permissions.
- OpenCode correlates managed calls and captures supported native terminal wrappers/events. VS Code checks binding/generation on directed reads as well as mutations and retains explicitly reported returns without claiming native chat identity.
- Legacy Work/evidence schema version 1 remains readable; new sidecars are format 2. Older writers do not participate in these guarantees and must not write the same workspace concurrently during a runtime transition.

Native conversational acceptance remains **NOT_RUN** for OpenCode, VS Code Local and Copilot Agent Host. No exactly-once execution or interruption of an already running specialist is claimed. A lost event requires an available native replay or explicit, sourced reconciliation.

## Use and build

Node.js 22 or newer is required. From this directory:

```sh
npm ci
npm run verify
npm run package:opencode
npm run package:vscode
node installer/cli.mjs --help
```

- `core/lib`: persistence, identity, memory, recovery, evidence and semantic tool contracts.
- `core/agents`, `core/skills`, `core/templates`, `core/schemas`: canonical authored content. The five BBVA skills are byte-identical to the reviewed baseline; `scripts/bbva-integrity.json` locks their hashes.
- `adapters/opencode`: native tool registration, strict descriptor-to-Zod conversion, native permissions and passive observation.
- `adapters/vscode`: public extension tool registration, native agent/skill contributions, workspace trust and window-scoped project binding.
- `scripts`: rendering, positive package inventory, complete-payload checks, archives and an isolated real-core happy path.
- `installer`: separate global selector, ownership planning, verified backups and native extension CLI integration.

Build one adapter with `npm run build:opencode` or `npm run build:vscode`. Its sibling source directory is not needed and its sibling output is not touched. Generated stages live in `dist/`; archives and SHA-256 files live in `artifacts/`. None is canonical source.

## Semantic API

Exactly four operations are published: `pulso_workspace`, `pulso_work`, `pulso_history`, `pulso_context`. `tool-contracts.mjs` owns flat action-specific descriptors, validation and mutation classification; adapters generate their native advertised schemas from it. `executeTool(name, input, context)` receives the trusted absolute `projectRoot`, `homeDir`, `resourceRoot`, and `assertContext` callback separately. Model arguments never choose filesystem roots or authenticated identities.

V4 public reads use `limit` and snapshot/filter-bound `cursor`, not the earlier public `offset` input. Follow `hasMore` and `nextCursor`; work sections expose actionable read hints. The low-level history offset helper remains for compatibility inside the core. Memory writes require explicit scope, source where appropriate, and revision. Success returns structured data and receipts; partial persistence failures retain confirmed work IDs/revisions and failure facts so clients do not blindly retry committed mutations.

Canonical `.pulso/work/ID/work.json` owns task/acceptance decisions; state and history are projections. Work/evidence schemaVersion remains 1. Continuity owns the current intention; the durable registry owns snapshots, returns and protocol reservations. Short metadata mutexes protect cooperative multiprocess writes on the same canonical root. They are never held across delegation. Native product writes still require compatible declared scopes, and Git integration on a shared checkout must be serialized. Old runtimes ignoring the mutex and different metadata roots pointing at the same checkout remain outside this exclusion domain.

### 4.1.0 acceptance contracts

- Criteria use `acceptanceMode`: `evidence` (default, including legacy criteria), `user` (explicit current user acceptance), or `both`. `create` still creates AC-1 in evidence mode. Set a different agreed mode through `criterion.update` with a reason before observation; changing it invalidates the affected acceptance bases and tasks.
- `accept_delivery` adds `origin:"user_acceptance"` without replacing existing evidence links. It satisfies only the user part, never missing/failed ordinary evidence or task execution. An ordinary manual observation is not explicit user acceptance. Inspect `closed` and all readiness issues after incorporation.
- `prepare_delegation` supports `output:"conversation"` for inline results: `hostContext.paths.output` is null and `writeScope:[]` is allowed. `readBase` and `cwd` are the trusted project root. File artifacts still require authorized existing paths.
- `completedTaskIds` retains completion within the current cycle even after a task returns to pending or evidence is invalidated. Such tasks cannot be cancelled or deleted to bypass closure. Reopen starts a new cycle and preserves historical results.

### 4.1.1 specialist Markdown contract

In the historical **4.1.1** baseline, the prompt contract and runtime release used that version while persisted `schemaVersion:1` stayed unchanged. The following describes the legacy Markdown contract, still supported alongside durable v2. Older runtimes are not guaranteed to understand newer optional fields.

`prepare_delegation` returns a ready-to-send `specialistPrompt` with four headings: `## Objetivo`, `## Alcance`, `## Condiciones`, `## Entrega`. Only specialist communication uses Markdown. The coordinator retains the original `delegation`, `acceptanceBasis` and trusted `hostContext`; tools and persistence continue using validated JSON, revisions, scopes and integrity hashes. The prompt includes the workspace and authorized relative paths, without internal bases, hashes or JSON schema paths. Inputs must exist; descriptive task resource labels grant no read access and are excluded from the prompt and `readScope`.

Short input/output example from the real smoke: the input is the existing authorized `request.md` asking for a private ESM fixture at version 1.0.0 with `sum(2,3)=5`; output is `conversation`, with writes scoped to `fixture`. The script produces a report in this shape, populated from its actual child process:

```markdown
## Resultado
Completado: fixture generado y comprobado con Node.
## Cambios o hallazgos
- fixture/package.json, fixture/index.mjs, fixture/check.mjs
- fixture/observation.json
## Comprobación y pendientes
Node check.mjs: exit 0; Verified private ESM package 1.0.0 and sum(2,3)=5.
Native agent/conversation NOT_RUN.
```

The parent extracts technical `status` and `summary`, attaches the literal report as `result.markdown`, and may include observed artifacts/checks. `accept_result` requires explicit `acceptedTaskIds` for `status:"completed"` (including `[]` when accepting no tasks). Core does not parse prose to infer completion, checks or accepted tasks. It normalizes compact results using identity from the **original delegation**, preserves Markdown literally in its JSON report and validates the original acceptance basis. Accepting a task still does not satisfy criterion evidence or user acceptance.

## Native integration and compatibility evidence

These are technical implementation facts, not claims of live-host acceptance. They are intentionally excluded from runtime packages.

| Surface | Source/API baseline | Live acceptance |
| --- | --- | --- |
| OpenCode V1 | 1.18.34 official source; user version 1.18.32 remains a separate target | NOT_RUN |
| OpenCode plugin SDK | npm 1.18.2, Zod 4.1.8 in offline adapter tests | SDK tests only |
| VS Code public extension APIs | 1.139.1 minimum, current stable 1.140.0 | Both NOT_RUN |
| VS Code Local agent loop | Public native contributions and LM tools | NOT_RUN |
| Copilot Agent Host | Client-supplied extension tools and provider-owned delegation | NOT_RUN |

OpenCode envelopes wrap the three action tools in `request`; history filters remain flat. Native permission requests cover reads and writes. Passive observer files exist only in that adapter: foreground tool return is not semantic acceptance; experimental background launch is not child completion. No experimental feature is enabled by installation.

VS Code arguments are flat with adapter-owned `expectedBindingId` for mutations and directed reads. Only initial unanchored status discovery permits an absent binding. The extension binds one canonical local open folder per window; multiple roots require explicit selection. It checks trust, cancellation, binding and generation across asynchronous boundaries. The public invocation API does not authenticate the calling agent or reveal a session cwd; opaque invocation tokens are never decoded or treated as role authorization. Continuity handles are references, not credentials. Native agent tool selection, prompts and host approvals remain effective. Unsupported root mappings fail closed instead of following the active editor.

Native skills and agents are contributed directly; no ChatParticipant-owned model loop, private server, generic agent runtime, synthetic session or cross-harness lifecycle abstraction exists. Delegation prompts are self-contained: trusted absolute `hostContext.projectRoot/readBase` stays outside canonical JSON, while persisted paths stay relative. Pure external reviews stay conversation-only, without initializing either project.

Authored neutral instructions use a finite explicit token renderer. There is no source-to-sibling prose translation. BBVA bytes are copied untouched. Runtime package READMEs contain only installation/use information; source provenance and this comparison stay here.

## Global installation safety

The selector can choose either or both native integrations, previews exact locations and requires confirmation unless explicitly invoked with `--yes`. `--yes` does not override foreign ownership. Use `--dry-run` first. Native runtime resources are distinct from user data; all workspace metadata, preferences, identities, registry and unknown files are preserved.

OpenCode uses the official V1 XDG global directory plus optional additive `OPENCODE_CONFIG_DIR`. `OPENCODE_CONFIG` is a file override, not an asset destination. External/custom directories outside the bounded supported roots are rejected. JSONC edits preserve foreign properties, comments, tuples and user overrides. Recognized modified owned files require explicit backup-and-replace; ambiguous legacy shared files are retained.

VS Code installation targets the exact executable/product, local user-data scope and profile selected. It does not install to every profile or a remote extension host. A clean reinstall cannot uninstall the existing version without a verified exact previous VSIX available for rollback. Missing CLI means manual installation pending, never successful installation. A named profile may be created by the native CLI; review the preview carefully.

All selected plans preflight before any writes. A failing target rolls itself back when recovery is available; an earlier successful target remains installed and the result reports the partial outcome. Verified backup archives are retained if restoration fails. These are bounded synchronous transactions, not a claim of crash-proof or concurrent-installer atomicity. No real user installation is run by the test suite: it uses temporary homes and CLI doubles.

## Verification gates

`npm run verify` runs builds, static package checks and both real-core smokes (legacy and durable). It does not invoke `npm test`, installer doubles or global mock suites. `npm run test:continuity` selects the bounded core/process and adapter-contract regressions for 4.2.0; adapter doubles do not establish real-host behavior. Historical suite results below do not apply automatically to current changes.

```sh
npm run build:opencode
npm run build:vscode
npm run check
npm run smoke:happy             # source core
npm run smoke:happy -- vscode   # generated core/resources, no VS Code host
npm run smoke:durable           # real durable flow, one fixture execution through retries
npm run smoke:durable -- vscode # same checks against generated resources
npm run test:continuity         # bounded core and adapter-contract regressions
node scripts/continuity-benchmark.mjs # historical 4.1.1 vs current metadata, temporary extraction
npm run package:opencode
npm run package:vscode
npm run verify:packages         # existing archives; never installs or downloads
# A single archive can be selected: npm run verify:packages -- opencode
```

The happy path calls the real `prepareWorkspace` and `executeTool` APIs with a disposable workspace and an explicit temporary home. It creates a Work/task in default evidence mode, obtains `prepare_delegation` with `output:"conversation"` and a criterion `acceptanceBasis` before observation, generates a private ESM fixture package and runs a real Node process checking its manifest and exported function. Its JSON output includes the actual executable/argv/cwd, stdout/stderr, exit code, observation timestamp, SHA-256 values, specialist prompt and literal Markdown report. It checks the four prompt headings, authorized input/write/read scopes and exclusion of descriptive resource labels and internal metadata. It incorporates the compact Markdown result through `accept_result` with explicit `acceptedTaskIds`, reads the persisted report to verify literal Markdown, normalized original identity (after an overview revision change), original basis and report hash, confirms the task is done and retained in `completedTaskIds` but the criterion is still pending, adds executed criterion evidence through `evidence.add`, checks readiness, closes and reads history. Final workspace validation checks evidence freshness. Temporary workspace and home are removed in `finally`; only the JSON output remains. Set `PULSO_SMOKE_TMP` to an existing temporary parent to choose its location.

The result's role is the contract's assigned role; the work is performed by the local script, **not a native agent invocation**. No host, conversation, user acceptance or command is mocked. `accept_delivery` and manual/conversational acceptance are **NOT_RUN**. The smoke does not establish continuity, reassignment, native parallelism or natural-language acceptance in either host.

The durable smoke additionally verifies snapshot preservation, capture before semantic rejection, ID recovery, stale/future revision idempotency, independent continuities, competing real writer processes and readiness/history. It runs a real Node fixture exactly once across incorporation retries. The benchmark extracts commit `daa72fc` locally and compares metadata protocol costs; it does not measure a language model or native conversation. See the 4.2.0 delivery for the observed latency tradeoff and the unmet provisional relative budget.

`verify:packages` checks archive SHA-256 sidecars, extracts into a disposable directory, checks inventories/hashes/resources/imports/BBVA bytes against the current build, loads the extracted contracts and runs both smokes against each extracted core. OpenCode also loads the real bundled SDK and constructs native schemas without activating a host. VS Code checks native binding descriptors and extension syntax; activation requires a real VS Code host. Missing/stale/invalid archives fail explicitly. Packaging uses the locally installed VSCE (or `PULSO_VSCE_PATH`), never an automatic download. macOS uses BSD tar without GNU-specific metadata flags; archive byte reproducibility across platforms is not promised.

### 4.1.1 patch verification · 2026-10-09

Executed on macOS with Node v24.18.0. Source, installer and both runtime manifests are **4.1.1**; persisted schemaVersion remains **1**. Package manifest and npm lock release fields were updated without changing dependencies; adapter builders also implement the Markdown communication changes. The pnpm files were not edited.

| Command | Exit | Observed result |
| --- | --- | --- |
| `npm run build:opencode` | 0 | 155 generated files |
| `npm run build:vscode` | 0 | 80 generated files |
| `npm run check` | 0 | Both inventories/hashes and five BBVA resources per adapter pass |
| `npm run smoke:happy` | 0 | Real Node fixture exits 0; compact Markdown, original identity/basis, scope, done, readiness and history assertions pass |
| `npm run package:opencode` | 0 | 4.1.1 tar archive and SHA-256 sidecar generated |
| `npm run package:vscode` | 0 | 4.1.1 VSIX and SHA-256 sidecar generated with local VSCE |
| `npm run verify:packages` | 0 | Both archive hashes/inventories and extracted-core happy paths pass; both runtimes report 4.1.1 |

Package SHA-256 values:

```text
cd7b17c1582b734304f33a9a8004867759c28012402ba4a7c9a0427663731669  artifacts/pulso-opencode-4.1.1.tar.gz
b679fbb5f2cae3de44971c1b6e53369749231ce861967859d09469dd5a9cb6e0  artifacts/pulso-4.1.1.vsix
```

The fixture's actual stdout is `Verified private ESM package 1.0.0 and sum(2,3)=5`, with empty stderr. No native conversation/model simulation or legacy suite was run for this patch. After package verification, the user authorized real installation: OpenCode's global runtime and the default local VS Code profile were updated to 4.1.1, with installed versions and OpenCode source hashes checked. See the installation record in [the master plan](PLAN-ROBUSTECIMIENTO-OPENCODE-VSCODE.md#instalación-real-411). The user subsequently reported substantially better behavior in a real session; this is qualitative user feedback, not an automated conversational acceptance result.

### Historical 4.1.0 E6 integration observation · 2026-10-09

Runtime package version: **4.1.0** (both adapters read provenance from the loaded package manifest); persisted schemaVersion remains **1**. Executed here on macOS with **Node v24.18.0 / npm 11.16.0**; declared minimum remains Node >=22, not additionally exercised in this run. The npm lock changes only the root release version; dependencies and the user-owned pnpm lock remain unchanged.

| Command | Exit | Observed result |
| --- | --- | --- |
| `npm run build:opencode` | 0 | 154 generated files, including new `acceptance.mjs` |
| `npm run build:vscode` | 0 | 79 generated files |
| `npm run smoke:happy` | 0 | Real fixture check, accepted task, criterion evidence, readiness, close and history |
| `npm run check` | 0 | Both package inventories, hashes, resources and isolation guards pass |
| `npm run package:opencode` | 0 | Local BSD tar archive and SHA-256 sidecar generated |
| `npm run package:vscode` | 0 | VSIX and SHA-256 sidecar generated with local VSCE |
| `npm run verify:packages` | 0 | Both archives and extracted-core smokes pass; OpenCode SDK/schemas and VS Code native descriptors load |
| `node --check` (five integration scripts, two adapter builders and two generated VS Code entry/contract modules) | 0 | Syntax checks |
| `git diff --check` | 0 | No whitespace errors |

The E5 textual isolation defect is corrected in the VS Code README and generated boundary using neutral flat-input terminology; the guard is unchanged. Historical 4.1.0 artifacts:

```text
9d94c9eae24d449e8f5403915ba7cb521793cd84586a1705be91d575771ae45b  artifacts/pulso-opencode-4.1.0.tar.gz
96d9e8efac87877cb63fb4cad6a37a6568670a9e8df2e25b9031660d296d644f  artifacts/pulso-4.1.0.vsix
```

The installer for that delivery was version 4.1.0 and selected the matching VSIX by default. Following explicit user authorization, installation completed in the real global OpenCode environment and the default local VS Code profile; the installed package and VS Code CLI confirmed 4.1.0. See [delivery details](ENTREGA-4.1.0.md) for verification and backup references. This historical installation does not establish installation or host acceptance of 4.1.1. Real conversation acceptance and `accept_delivery` remain NOT_RUN; the positive smoke uses evidence mode without fabricating a user.

Required manual host acceptance still includes agent/skill visibility, four callable tools, native approval denial/cancellation, intended-project delegation, observed evidence close/reopen and installation recovery. Record host version and harness separately; mock tests and package extraction cannot establish real conversation behavior or universal compatibility. Prompt restrictions are not a filesystem sandbox, and successful plugin configuration alone does not prove a native conversation was tested.

## Reviewed baseline

Source migration began at immutable main `16cc3aa86fc47de02afeac6336bc5545012a3945`, after the two preceding integration PRs were merged. Canonical artifacts and work mutations adopt the latest persistence/history corrections while retaining the complete hardened core. Five BBVA source and output hashes are asserted independently. Historical directories are preserved for reference and are not read by V4 builds.

### Executed verification · 2026-10-05

- Aggregate source verification: 298 tests passed, 0 failed, 0 skipped.
- Independent builds without the sibling adapter: PASS; repeated staged outputs match byte-for-byte.
- Actual archive extraction, complete inventories and resource/import checks: PASS.
- OpenCode extracted plugin activation with bundled dependencies and no injected SDK: PASS; status does not initialize a project.
- Five BBVA source/output files match the baseline SHA-256 values exactly.
- Historical tracked runtime files: 146 unchanged; historical directories were not edited.
- Full staged package installed into a temporary home: all 151 runtime files, 31 relocated resource links, default SDK activation and all four tools verified; status is byte-for-byte read-only and explicit prepare succeeds.
- All real-host/native-conversation acceptance entries above remain NOT_RUN.

Frozen reviewed artifacts (generated locally, not committed to source):

```
f032f85e648a9b1bc494d10bad1f0d4b5d545d20d2fd7e0f47487071ff50da61  pulso-opencode-4.0.0.tar.gz
a9af4f5073f5cd339afcab73948d37cf39c3b78169b6267c82e547cc09410aa4  pulso-4.0.0.vsix
```

The OpenCode payload includes the pinned SDK runtime tool helper and its Zod ESM dependency closure with licenses and a strict hash inventory. Installation performs no npm download or package script. The SDK helper's bare dependency import is the only relocated vendor statement; Zod runtime bytes are unchanged. Source licensing: [OpenCode MIT license](https://github.com/anomalyco/opencode/blob/v1.18.34/LICENSE); Zod's packaged MIT license is preserved alongside its runtime.
