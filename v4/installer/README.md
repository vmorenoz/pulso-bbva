# Pulso global installer

OpenCode installation removes per-agent `model` and `variant` presets for exact current and recognized legacy Pulso agent IDs from both `opencode.json` and `opencode.jsonc` in inventoried global roots. The dry-run reports `agent-presets` actions; original configuration bytes are backed up and rollback covers the edits. Global models, other agent settings and JSONC comments are retained. Project configuration and explicit `OPENCODE_CONFIG` file overrides are preserved and may still provide presets.

## Install the prepared OpenCode package

From either the repository root or `v4`, run the same command:

```sh
node install.mjs
```

This bootstrap requires Node.js 22+ and standard macOS/Linux `tar`, with no `npm install`, `npm ci` or build step. Developers must first supply `v4/artifacts/pulso-opencode-installer-<version>.tar.gz` and its `.sha256`, matching `v4/package.json`. The bootstrap resolves these paths relative to its own module (also when invoked from another directory), verifies SHA-256 before extraction, rejects unsafe member paths and links, and runs the bundled installer in a unique temporary directory that is removed afterwards. Missing or corrupt artifacts stop installation with an error; nothing is downloaded or built.

OpenCode is the default target; interactive confirmation and the installer's conflict protections remain in force. `node install.mjs --help` works even without the archive. Use `--dry-run` to preview, `--yes` to confirm, or explicitly `--conflict backup-replace` when appropriate. Arguments and the installer's exit status are forwarded. No replacement policy is selected automatically. The bundle carries its own runtime and dependency; checkout `dist` and `node_modules` are not used.

## Developer CLI

The BBVA distribution now supplies only `bbva-engineering`, complementary to
documentation-first CELLS/APX/ASO work. Updating OpenCode removes obsolete skills
recorded as managed, including their isolated runtime copies. Borrowed and
unowned/shared skills remain user-owned. Modified managed files abort by default;
`--conflict backup-replace` explicitly permits removal with their original bytes
backed up. Review `node install.mjs --dry-run` before confirming the update and
restart OpenCode afterwards. VS Code receives the consolidated skills through
replacement of the extension package; it does not clean unrelated user skills.

This is a separate orchestration package, never part of either runtime payload. It configures one or both selected integrations globally. For ready-to-install OpenCode packages, use the [self-contained installer archive](STANDALONE.md): it includes the runtime and pinned dependency and needs no npm installation or compilation. When developing from the checkout, run `npm ci` from `v4/` with its matching committed lock, then `node installer/cli.mjs --help`. This uses the dependency pinned by the V4 source package.

From this installer directory, run interactively with `node cli.mjs`, or select explicitly with `--targets opencode,vscode`. Existing repository-local `../dist/opencode` and `../artifacts/pulso-<version>.vsix` matching the installer version are used by default. Explicit `--opencode-package /absolute/dist/opencode` and `--vsix /absolute/pulso.vsix` take priority; missing packages show the required build command. Use `--dry-run` to inspect the complete plan. `--yes` confirms that plan; it does not permit foreign collisions. Modified owned or exact known legacy resources need `--conflict backup-replace`; default is abort. Unknown files are never replaced. All selected targets are preflighted before mutation.

OpenCode uses the XDG global directory plus the additive `OPENCODE_CONFIG_DIR` layer when set; native resources go to that explicit layer. Custom directories must be absolute and within the home directory. `OPENCODE_CONFIG` is an override file, never a resource directory. Loaded legacy `config.json` is preserved and warned about. Runtime data is isolated under `~/.pulso/runtimes/opencode-v1`, ownership under `~/.pulso/installations`. Shared preferences, identity, registry, projects and historical shared distribution resources are retained. Native prompts receive narrowly relocated resource links. No project state is initialized.

VS Code uses the exact chosen `--code` executable and local `--profile`/`--user-data-dir` scope. A named profile that does not exist may be created by the native CLI. Other profiles, remote extension hosts, Insiders and containers are not implicitly targeted. A missing CLI reports manual installation pending and supplies the VSIX path/hash. Clean reinstall requires a cached verified previous VSIX or `--previous-vsix` plus `--previous-sha256`; without that it stops before uninstall and recommends an in-place update. An installed extension directory is never treated as a recovery VSIX.

Execution is sequential in selection order. A failure stops later targets; the failing target attempts rollback and earlier completed targets remain installed. Backups and recovery VSIXs are retained when needed. Files are checked again before execution. This is synchronous rollback, not a crash-safe multi-process transaction. Native installation/configuration success is separate from an actual native conversation test, reported as `NOT_RUN`.
