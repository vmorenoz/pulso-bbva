# Pulso V4 · technical source guide

One canonical local semantic core, independently rendered native integrations, and a separate global installation selector. Runtime packages are self-contained and contain only their own integration and neutral resources. Historical V3 directories remain unchanged.

## 4.2.0 · durable continuity

The source declares **4.2.0**. Package contents must be built and verified against the intended source revision; a matching version alone does not establish freshness. See the [changelog from V1](../CHANGELOG.md) for historical installations and checks, and the [acceptance API](core/lib/ACCEPTANCE-API.md) for durable contracts.

- `contractVersion:2` prepares a durable snapshot and returns compact IDs plus the exact specialist prompt. Retrieve originals explicitly with `get_delegation`; do not retransmit canonical acceptance hashes.
- Literal returns survive invalid decisions or stale revisions. `accept_result` accepts a stored `returnId` or captures `reportedReturn` before semantic validation, in the same invocation. Operation IDs make committed retries idempotent.
- Continuity binds an objective, Work, repository scopes and a revisioned intention. Global workspace focus is navigation, not an implicit instruction to resume another objective.
- Per-ID snapshots/return blobs and a lightweight registry avoid reading unrelated historical bodies. Short owned mutexes protect cooperative metadata writers; they do not cover agent execution or replace native permissions.
- OpenCode correlates managed calls and captures supported native terminal wrappers/events. VS Code checks binding/generation on directed reads as well as mutations and retains explicitly reported returns without claiming native chat identity.
- Legacy Work/evidence schema version 1 remains readable; new sidecars are format 2. Older writers do not participate in these guarantees and must not write the same workspace concurrently during a runtime transition.

Native conversational acceptance remains **NOT_RUN** for OpenCode, VS Code Local and Copilot Agent Host. No exactly-once execution or interruption of an already running specialist is claimed. A lost event requires an available native replay or explicit, sourced reconciliation.

## Install a prepared package

For a fresh machine and a reproducible build from `main` or a specific commit, follow [Instalar Pulso en otro equipo](INSTALLATION.md).

From either the repository root or this `v4/` directory:

```sh
node install.mjs
```

This installs OpenCode from the self-contained archive in `v4/artifacts/`, verifies its SHA-256 and asks for confirmation. It requires Node.js 22 or newer and standard macOS/Linux `tar`, but no npm installation or build. Use `--dry-run` to preview, `--conflict backup-replace` to authorize replacement of recognized modified Pulso files, or `--help` for options. Restart OpenCode afterward. VS Code users can install the prepared VSIX through “Extensions: Install from VSIX…”.

## Documentation-first policy and skills

The distribution contains six skills, with a single BBVA entry: [`core/skills/bbva-engineering/SKILL.md`](core/skills/bbva-engineering/SKILL.md). It replaces `bbva-apx`, `bbva-apx-testing`, `bbva-cells` and `bbva-cells-testing`.

The `<technology_knowledge_policy>` blocks in [`core/agents/common.md`](core/agents/common.md) and [`core/agents/pulso.md`](core/agents/pulso.md), together with the consolidated skill, instruct relevant roles to study documentation before dependent CELLS/APX/ASO work: confirm stack and versions, consult the catalog, search in the original language, read original sources and verify applicability. Current accessible evidence can be reused; missing evidence blocks only the dependent decision or work. These are prompt instructions, not runtime-enforced MCP calls.

For better documentation support, use the separate private [Pulso Knowledge utility](https://github.com/vmorenoz/pulso-knowledge). Its [README](https://github.com/vmorenoz/pulso-knowledge#readme) is the installation source of truth for authorized corpus preparation, embedding model/index and host MCP configuration. Pulso neither bundles nor installs it; installing the VSIX does not configure this MCP in VS Code.

Knowledge **0.3** supports OpenCode, VS Code or both as installation targets; check [releases](https://github.com/vmorenoz/pulso-knowledge/releases/latest) for the available version. [0.2.0](https://github.com/vmorenoz/pulso-knowledge/releases/tag/v0.2.0) remains the previous distribution. Its bundled corpus/model permits offline installation after download on macOS Apple Silicon with Metal and preinstalled Node 24; consult the utility's own README for current requirements.

## Semantic parity and host controls

Both adapters render canonical roles, documentation policy and six skills. Semantic parity does not imply identical host controls or observed UI behavior.

| Concern | Shared semantics | OpenCode | VS Code |
| --- | --- | --- | --- |
| Roles and management | Coordinator and nine specialists; four management tools reserved for coordination | Native role permissions and `request` envelopes | Role tool lists, flat arguments and window binding |
| Knowledge | Documentation-first policy; external optional MCP | Native MCP tools subject to host configuration and permissions | Seven explicit `pulso-knowledge/knowledge_*` names in all ten roles; availability requires configured MCP |
| Skills | `bbva-engineering` common to all roles; integration verification for Executor, QA and Code Reviewer | Native skill permissions per role | Role-specific links and instructions, not a native skill ACL |
| Operational guides | Only init, status, recap and resume receive coordinator-only adapter instructions | Native commands/skills | Contributed skills; no `.prompt.md` tool-list override |
| Delegation | Send exact `specialistPrompt` to the canonical specialist; incorporate reviewed results separately | `task` with durable hooks for supported native events | `agent` (`agent/runSubagent` in Local); literal return reported by coordinator |
| Steering | Explicit confirmed `compatibleDelegationIds`; omission equals `[]` and invalidates previous-intent delegations | Native steering/cancellation only when available | Native steering/cancellation only when available |
| Execution and scope | Executor/QA execution capability; authorized output/write scope | Native permissions remain authoritative | Tool lists, Workspace Trust and approvals remain authoritative; scope instructions are not a filesystem sandbox |

Auxiliary skills do not receive the operational coordinator guard. The common BBVA skill is copied unchanged. Keeping a delegation compatible does not establish activity or physical termination. VS Code has no automatic capture of `agent` returns; its binding is not a chat identity. Native conversational/UI acceptance remains **NOT_RUN** in both hosts, including VS Code Local and Copilot Agent Host.

## Developer build

Node.js 22 or newer is required. From this directory:

```sh
npm ci
npm run verify
npm run package:opencode
npm run package:vscode
node scripts/package-installer.mjs
node installer/cli.mjs --help
```

- `core/lib`: persistence, identity, memory, recovery, evidence and semantic tool contracts.
- `core/agents`, `core/skills`, `core/templates`, `core/schemas`: canonical authored content. The consolidated BBVA skill is copied unchanged into each distribution; `scripts/bbva-integrity.json` pins its reviewed hash.
- `adapters/opencode`: native tool registration, strict descriptor-to-Zod conversion, native permissions and passive observation.
- `adapters/vscode`: public extension tool registration, native agent/skill contributions, workspace trust and window-scoped project binding.
- `scripts`: rendering, positive package inventory, complete-payload checks, archives and an isolated real-core happy path.
- `installer`: separate global selector, ownership planning, verified backups and native extension CLI integration.

`npm ci` is the developer dependency setup and requires the committed `package-lock.json` to match `package.json`; do not use an older checkout's lock or bypass a mismatch with an undocumented install. End-user installation above does not depend on npm.

Build one adapter with `npm run build:opencode` or `npm run build:vscode`. Its sibling source directory is not needed and its sibling output is not touched. Generated stages live in `dist/`; archives and SHA-256 files live in `artifacts/`. None is canonical source. The standalone installer packager consumes the existing OpenCode stage; see [installer packaging](installer/STANDALONE.md#generación-para-mantenedores).

GitHub Actions builds the OpenCode and VS Code packages and the standalone installer on pushes to `main`. Download the desired package from **Artifacts** on the successful workflow run and extract the download container before following its install instructions. These build artifacts are not GitHub Releases; retain the run/commit association when comparing checks or reporting a problem.

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
| VS Code public extension APIs | 1.139.1 minimum; 1.140.0 stable in the reviewed baseline | Both NOT_RUN |
| VS Code Local agent loop | Public native contributions and LM tools | NOT_RUN |
| Copilot Agent Host | Client-supplied extension tools and provider-owned delegation | NOT_RUN |

OpenCode envelopes wrap the three action tools in `request`; history filters remain flat. Native permission requests cover reads and writes. Passive observer files exist only in that adapter: foreground tool return is not semantic acceptance; experimental background launch is not child completion. No experimental feature is enabled by installation.

VS Code arguments are flat with adapter-owned `expectedBindingId` for mutations and directed reads. Only initial unanchored status discovery permits an absent binding. The extension binds one canonical local open folder per window; multiple roots require explicit selection. It checks trust, cancellation, binding and generation across asynchronous boundaries. The public invocation API does not authenticate the calling agent or reveal a session cwd; opaque invocation tokens are never decoded or treated as role authorization. Continuity handles are references, not credentials. Native agent tool selection, prompts and host approvals remain effective. Unsupported root mappings fail closed instead of following the active editor.

Native skills and agents are contributed directly; no ChatParticipant-owned model loop, private server, generic agent runtime, synthetic session or cross-harness lifecycle abstraction exists. Delegation prompts are self-contained: trusted absolute `hostContext.projectRoot/readBase` stays outside canonical JSON, while persisted paths stay relative. Pure external reviews stay conversation-only, without initializing either project.

Authored neutral instructions use a finite explicit token renderer. There is no source-to-sibling prose translation. BBVA bytes are copied untouched. Runtime package READMEs contain only installation/use information; source provenance and this comparison stay here.

## Global installation safety

The selector can choose either or both native integrations, previews exact locations and requires confirmation unless explicitly invoked with `--yes`. `--yes` does not override foreign ownership. Use `--dry-run` first. Native runtime resources are distinct from user data; all workspace metadata, preferences, identities, registry and unknown files are preserved.

OpenCode uses the official V1 XDG global directory plus optional additive `OPENCODE_CONFIG_DIR`. `OPENCODE_CONFIG` is a file override, not an asset destination, and is preserved. External/custom directories outside the bounded supported roots are rejected. JSONC edits preserve foreign properties, comments and tuples. The installer removes only `model` and `variant` presets for exact current and recognized legacy Pulso agent IDs in inventoried global `opencode.json` and `opencode.jsonc`, backing up original bytes; other agent settings and the global model remain. Project settings and the explicit override may still supply presets. Recognized modified owned files require explicit backup-and-replace; ambiguous legacy shared files are retained.

VS Code installation targets the exact executable/product, local user-data scope and profile selected. It does not install to every profile or a remote extension host. A clean reinstall cannot uninstall the existing version without a verified exact previous VSIX available for rollback. Missing CLI means manual installation pending, never successful installation. A named profile may be created by the native CLI; review the preview carefully.

The BBVA consolidation migration removes only managed obsolete resources for the four retired APX/CELLS skills. Borrowed and foreign resources are preserved.

All selected plans preflight before any writes. A failing target rolls itself back when recovery is available; an earlier successful target remains installed and the result reports the partial outcome. Verified backup archives are retained if restoration fails. These are bounded synchronous transactions, not a claim of crash-proof or concurrent-installer atomicity. No real user installation is run by the test suite: it uses temporary homes and CLI doubles.

## Verification gates

Local integration reported on 2026-10-22: Pulso OpenCode **4.2.0 installed, 175 hashes PASS**; VS Code upgraded **4.1.1 → 4.2.0** through the official CLI. Knowledge **0.3**, `target=both`: manifest v3 with two targets, 399-document corpus preserved, identical OpenCode configuration and unrelated VS Code entries preserved. Real SDK checks in both hosts: **seven tools and search PASS**; UI/conversation **NOT_RUN**. Subsequent documentation-only packaging does not reinstall globally: installed hashes describe that reported installation, not the regenerated packaged README bytes.

`npm run verify` runs builds, static package checks and both real-core smokes (legacy and durable). It does not invoke `npm test`, installer doubles or global mock suites. `npm run test:continuity` selects the bounded core/process and adapter-contract regressions for 4.2.0; adapter doubles do not establish real-host behavior. Historical suite results in the changelog do not apply automatically to current changes.

Current parity checks (2026-10-22, Node **24.18.0**): `tests/distribution/*.test.mjs`, `tests/vscode/*.test.mjs` and `tests/core/continuity.test.mjs`: **83 PASS, 0 FAIL, 0 skipped**. `npm run verify`, both package builds and `npm run verify:packages`: **PASS**, including happy-path and durable smokes against both extracted packages. Inventories: **155 OpenCode files**, **79 VS Code files**, one unchanged BBVA skill in each. The standalone installer was regenerated; its offline fixture passed once with a temporary package and once against the final archive using `PULSO_INSTALLER_ARCHIVE` (**1 test per run**). Three archives and their three SHA-256 sidecars remain at **4.2.0**, checked against current content. No global installation or live-host/UI conversation was performed.

Earlier consolidation checks (distribution/installer **64 PASS, 1 skip**, bootstrap **10 PASS**, staged verification PASS) remain historical. The global suite was not rerun for parity: its previous result was **455 tests, 408 PASS, 46 FAIL, 1 skip**. All 46 failures reproduced on baseline `a7351bf` (47 failures there, including one subsequently corrected fixture). The current bounded checks do not declare the global suite green.

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

The durable smoke additionally verifies snapshot preservation, capture before semantic rejection, ID recovery, stale/future revision idempotency, independent continuities, competing real writer processes and readiness/history. It runs a real Node fixture exactly once across incorporation retries. The benchmark extracts commit `daa72fc` locally and compares metadata protocol costs; it does not measure a language model or native conversation. See the [historical 4.2.0 measurements](../CHANGELOG.md#rendimiento-y-verificación-históricos) for the observed latency tradeoff and the unmet provisional relative budget.

`verify:packages` checks archive SHA-256 sidecars, extracts into a disposable directory, checks inventories/hashes/resources/imports/BBVA bytes against the current build, loads the extracted contracts and runs both smokes against each extracted core. OpenCode also loads the real bundled SDK and constructs native schemas without activating a host. VS Code checks native binding descriptors and extension syntax; activation requires a real VS Code host. Missing/stale/invalid archives fail explicitly. Packaging uses the locally installed VSCE (or `PULSO_VSCE_PATH`), never an automatic download. macOS uses BSD tar without GNU-specific metadata flags; archive byte reproducibility across platforms is not promised.

Required manual host acceptance still includes agent/skill visibility, four callable tools, native approval denial/cancellation, intended-project delegation, observed evidence close/reopen and installation recovery. Record host version and harness separately; mock tests and package extraction cannot establish real conversation behavior or universal compatibility. Prompt restrictions are not a filesystem sandbox, and successful plugin configuration alone does not prove a native conversation was tested.

## Reviewed baseline

Source migration began at immutable main `16cc3aa86fc47de02afeac6336bc5545012a3945`, after the two preceding integration PRs were merged. Canonical artifacts and work mutations adopt the latest persistence/history corrections while retaining the complete hardened core. The original migration asserted five BBVA source and output hashes; the current distribution pins the single consolidated skill. Historical directories are preserved for reference and are not read by V4 builds.

Historical build, smoke, installation and suite observations for 4.0.0–4.2.0 are consolidated in the [changelog](../CHANGELOG.md). They are not current verification results or package hashes to reuse. Verify the SHA-256 sidecar shipped with the exact archive being installed and run the appropriate gates for the current source revision.

The four APX/CELLS skills were enriched on 2026-10-05 and later retired in favor of `bbva-engineering`. Its reviewed current bytes, rather than an assertion of identity with every historical version, are pinned in `scripts/bbva-integrity.json`. See [BBVA provenance](scripts/bbva-provenance.md).

The OpenCode payload includes the pinned SDK runtime tool helper and its Zod ESM dependency closure with licenses and a strict hash inventory. Installation performs no npm download or package script. The SDK helper's bare dependency import is the only relocated vendor statement; Zod runtime bytes are unchanged. Source licensing: [OpenCode MIT license](https://github.com/anomalyco/opencode/blob/v1.18.34/LICENSE); Zod's packaged MIT license is preserved alongside its runtime.
