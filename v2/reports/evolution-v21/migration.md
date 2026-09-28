# Pulso v2.1 — instalación local, manifest y rollback

The OpenCode installer now publishes the six canonical Pulso agent prompts and
all eight `pulso-*.md` skills from `packages/orchestration/skills`. Managed
asset hashes are recorded in `.opencode/.pulso-manifest.json` (local) or
`.config/opencode/.pulso-manifest.json` (global), alongside model profile and
per-agent model selections. Existing selected OpenCode model/configuration
values remain preserved during installation and model reconfiguration.

## Install or update

From `v2/`, install the locked dependencies and run the interactive installer:

```sh
npx --yes bun@1.4.2 install --frozen-lockfile
npx --yes bun@1.4.2 run install:v2
```

Choose **local/workspace scope** and OpenCode; review the selected model profile
and the paths in `.opencode/.pulso-manifest.json`. The generated manifest
contains the exact hashes for six agents, eight skills, and the plugin bridge.
This delivery did not install anything in the real user home/global config.
The installer does not use or modify `AGENTS.md`, `CLAUDE.md`, or `PULSO.md`; an
absent `PULSO.md` remains absent.

## Uninstall

Run `npx --yes bun@1.4.2 run uninstall:v2` and select the local OpenCode
installation. Uninstall removes only paths recorded in the Pulso manifest and
the managed OpenCode plugin registration. It does not purge Work, bindings,
preferences, capabilities, or artifacts. User-owned instruction files are not
managed uninstall targets.

## Database rollback

Before applying migrations to an existing installation, stop its test runtime
and create a consistent backup of `work.db` and `runtime-bindings.db` using the
SQLite backup API, or close/checkpoint the connection before copying. Include
`preferences.db` when present, the managed assets/config and their manifest in
the same backup set. A plain copy of a live WAL database is not a backup.

To roll back a test migration, stop the test runtime, preserve any post-migration
state needed for diagnosis, and restore the entire consistent backup set. Do
not run an older bridge against migrated databases without a compatibility
guarantee. The non-empty v2 historical-receipt migration test is still pending;
this instruction is not evidence that migration rollback was exercised.

## Verification

Run:

```sh
npx --yes bun@1.4.2 test packages/installer/test/evolution-opencode-install.test.ts packages/installer/test/opencode-installer.test.ts
```
