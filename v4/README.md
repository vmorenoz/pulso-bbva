# Pulso V4 · technical source guide

One canonical local semantic core, independently rendered native integrations, and a separate global installation selector. Runtime packages are self-contained and contain only their own integration and neutral resources. Historical V3 directories remain unchanged.

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
- `scripts`: build-only rendering, positive package inventory, complete-payload checks and archives.
- `installer`: separate global selector, ownership planning, verified backups and native extension CLI integration.

Build one adapter with `npm run build:opencode` or `npm run build:vscode`. Its sibling source directory is not needed and its sibling output is not touched. Generated stages live in `dist/`; archives and SHA-256 files live in `artifacts/`. None is canonical source.

## Semantic API

Exactly four operations are published: `pulso_workspace`, `pulso_work`, `pulso_history`, `pulso_context`. `tool-contracts.mjs` owns flat action-specific descriptors, validation and mutation classification; adapters generate their native advertised schemas from it. `executeTool(name, input, context)` receives the trusted absolute `projectRoot`, `homeDir`, `resourceRoot`, and `assertContext` callback separately. Model arguments never choose filesystem roots or authenticated identities.

V4 public reads use `limit` and snapshot/filter-bound `cursor`, not the earlier public `offset` input. Follow `hasMore` and `nextCursor`; work sections expose actionable read hints. The low-level history offset helper remains for compatibility inside the core. Memory writes require explicit scope, source where appropriate, and revision. Success returns structured data and receipts; partial persistence failures retain confirmed work IDs/revisions and failure facts so clients do not blindly retry committed mutations.

Canonical `.pulso/work/ID/work.json` is authoritative; state and history are projections. Persisted schemaVersion remains 1. The core retains optimistic revision checks, owned bootstrap recovery, project/work UUIDs, user-memory locking, immutable observed evidence, acceptance-change audits, historical evidence tolerance and idempotent projection repair. There is no synthetic complete-map action. Optimistic revisions do not provide a multiprocess lock: only one coordinator writes a checkout at a time.

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

VS Code arguments are flat with adapter-owned `expectedBindingId` for mutations. The extension binds one canonical local open folder per window; multiple roots require explicit selection. It checks trust, cancellation and binding before writes and after asynchronous boundaries. The public invocation API does not authenticate the calling agent or reveal a session cwd; opaque invocation tokens are never decoded or treated as role authorization. Native agent tool selection, prompts and host approvals govern coordinator ownership. Unsupported root mappings fail closed instead of following the active editor.

Native skills and agents are contributed directly; no ChatParticipant-owned model loop, private server, generic agent runtime, synthetic session or cross-harness lifecycle abstraction exists. Delegation prompts are self-contained: trusted absolute `hostContext.projectRoot/readBase` stays outside canonical JSON, while persisted paths stay relative. Pure external reviews stay conversation-only, without initializing either project.

Authored neutral instructions use a finite explicit token renderer. There is no source-to-sibling prose translation. BBVA bytes are copied untouched. Runtime package READMEs contain only installation/use information; source provenance and this comparison stay here.

## Global installation safety

The selector can choose either or both native integrations, previews exact locations and requires confirmation unless explicitly invoked with `--yes`. `--yes` does not override foreign ownership. Use `--dry-run` first. Native runtime resources are distinct from user data; all workspace metadata, preferences, identities, registry and unknown files are preserved.

OpenCode uses the official V1 XDG global directory plus optional additive `OPENCODE_CONFIG_DIR`. `OPENCODE_CONFIG` is a file override, not an asset destination. External/custom directories outside the bounded supported roots are rejected. JSONC edits preserve foreign properties, comments, tuples and user overrides. Recognized modified owned files require explicit backup-and-replace; ambiguous legacy shared files are retained.

VS Code installation targets the exact executable/product, local user-data scope and profile selected. It does not install to every profile or a remote extension host. A clean reinstall cannot uninstall the existing version without a verified exact previous VSIX available for rollback. Missing CLI means manual installation pending, never successful installation. A named profile may be created by the native CLI; review the preview carefully.

All selected plans preflight before any writes. A failing target rolls itself back when recovery is available; an earlier successful target remains installed and the result reports the partial outcome. Verified backup archives are retained if restoration fails. These are bounded synchronous transactions, not a claim of crash-proof or concurrent-installer atomicity. No real user installation is run by the test suite: it uses temporary homes and CLI doubles.

## Verification gates

`npm run verify` combines core regression, action-contract and cursor adversarial tests, native boundary/root tests, fake-home installer tests and independent build/package checks. Archive checks cover full inventories, hashes, BBVA bytes, references, relative imports, forbidden sibling APIs/dependencies/paths and package-only execution. Isolated builds remove the sibling entirely and compare repeated output hashes.

Required manual host acceptance still includes agent/skill visibility, four callable tools, native approval denial/cancellation, intended-project delegation, observed evidence close/reopen and installation recovery. Record host version and harness separately; mock tests and package extraction cannot establish real conversation behavior or universal compatibility. Prompt restrictions are not a filesystem sandbox, and successful plugin configuration alone does not prove a native conversation was tested.

## Reviewed baseline

Source migration began at immutable main `16cc3aa86fc47de02afeac6336bc5545012a3945`, after the two preceding integration PRs were merged. Canonical artifacts and work mutations adopt the latest persistence/history corrections while retaining the complete hardened core. Five BBVA source and output hashes are asserted independently. Historical directories are preserved for reference and are not read by V4 builds.

### Executed verification · 2026-10-05

- Aggregate source verification: 297 tests passed, 0 failed, 0 skipped.
- Independent builds without the sibling adapter: PASS; repeated staged outputs match byte-for-byte.
- Actual archive extraction, complete inventories and resource/import checks: PASS.
- OpenCode extracted plugin activation with bundled dependencies and no injected SDK: PASS; status does not initialize a project.
- Five BBVA source/output files match the baseline SHA-256 values exactly.
- Historical tracked runtime files: 146 unchanged; historical directories were not edited.
- All real-host/native-conversation acceptance entries above remain NOT_RUN.

Frozen reviewed artifacts (generated locally, not committed to source):

```
f032f85e648a9b1bc494d10bad1f0d4b5d545d20d2fd7e0f47487071ff50da61  pulso-opencode-4.0.0.tar.gz
a9af4f5073f5cd339afcab73948d37cf39c3b78169b6267c82e547cc09410aa4  pulso-4.0.0.vsix
```

The OpenCode payload includes the pinned SDK runtime tool helper and its Zod ESM dependency closure with licenses and a strict hash inventory. Installation performs no npm download or package script. The SDK helper's bare dependency import is the only relocated vendor statement; Zod runtime bytes are unchanged. Source licensing: [OpenCode MIT license](https://github.com/anomalyco/opencode/blob/v1.18.34/LICENSE); Zod's packaged MIT license is preserved alongside its runtime.
