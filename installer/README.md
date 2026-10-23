# Pulso native plugin installer · API 2.1.2

The installer configures **OpenCode 2.1.2 only**. It installs the Pulso plugin, not the OpenCode executable; it never starts a model, modifies project metadata, or downloads dependencies. Pulso releases remain **0.1.*** until further notice.

## Prepared package

From the repository root:

```sh
node install.mjs --dry-run
node install.mjs
```

The bootstrap requires Node.js 22+ and standard macOS/Linux `tar`. It reads `artifacts/pulso-opencode-installer-<version>.tar.gz` and its `.sha256`, matching root `package.json`. It verifies a private archive copy before extracting, rejects links and unsafe member paths, and removes its unique temporary directory after execution. Missing or corrupt artifacts fail without downloading or building anything. `--help` requires no archive.

The [standalone archive](STANDALONE.md) includes the runtime and pinned `jsonc-parser` dependency. The checkout's `dist` and `node_modules` are not needed when using this archive.

## Developer CLI

After `npm ci` and `npm run build:opencode` at the repository root:

```sh
node installer/cli.mjs --dry-run
node installer/cli.mjs --yes
```

`--opencode-package /absolute/package` selects a prepared native package; otherwise `dist/opencode` is used. `--yes` confirms the plan but never grants permission to overwrite foreign files. Modified owned resources require explicit `--conflict backup-replace`; original bytes are backed up. `--clean` applies the same bounded managed-resource replacement policy, never a broad directory deletion. `--host` and extension-installation flags are unsupported: this package targets OpenCode only.

## Native V2 registration and migration

The runtime is isolated at `~/.pulso/runtimes/opencode-v2`, with ownership recorded independently at `~/.pulso/installations/opencode-v2.json`; its package exports the native `id/setup` entrypoint and includes the required root `server.js` facade for the native local-package loader. `plugins` contains the **directory** file URL, not a V1 JavaScript-file registration. Native agents, skills and commands are copied into the selected global configuration directory; resource links are relocated narrowly. The installer validates Pulso 0.1.* and the declared OpenCode 2.1.2 contract before planning writes. Installation does not prove that a running host is compatible; runtime setup checks the actual host identity and API metadata.

OpenCode global locations:

| Target | Global root | Additive directory | Native config files | Preserved override |
| --- | --- | --- | --- | --- |
| `opencode` | `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode` | `OPENCODE_CONFIG_DIR` | `opencode.json(c)` | `OPENCODE_CONFIG` |

Custom asset directories must be absolute and inside the user's home. Override files are never asset destinations. A custom directory cannot contain the entire global configuration directory. Project and managed settings may override this configuration. Existing `config.json` is preserved with a warning.

Managed prior OpenCode registrations and files are migrated only using validated inventories or the explicit known legacy list. Unknown files, shared metadata, project registries and borrowed resources remain untouched. An incompatible borrowed V1 registration blocks migration until its owner resolves it; `--conflict backup-replace` does not acquire foreign ownership. The previous isolated manifest is removed only after owned migration, or reduced to retained borrowed entries. The installer does not select or discover other host installations.

`model`/`variant` presets are removed only for exact catalog and recognized legacy Pulso IDs in global `agent` and `agents` maps. Global models, other agents, permissions and JSONC comments are retained. Foreign plugin tuples/objects retain their options and comments. Equivalent native registrations across both JSON/JSONC files or additive global roots fail closed rather than load the runtime twice; borrowed registrations are never silently moved. Both legacy `plugin` and native `plugins` entries remain supported as **configuration input to cleanup**, not as an implementation of the V1 plugin API.

## Safety and verification

Dry-run writes nothing. Preflight and a final byte comparison reject concurrent changes; backups are verified before replacements. Failure attempts synchronous rollback and retains recovery backups when restoration fails. This is not a crash-proof or multi-process transaction.

Native configuration success is not a conversation test. Installer tests run only in temporary homes; staged tool checks use OpenCode native-domain doubles and report live conversation as `NOT_RUN`.
