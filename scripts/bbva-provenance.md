# BBVA skill content provenance

## Consolidation, 2026-10-20

The reviewed canonical corpus now contains only `bbva-engineering`. The former
`bbva-apx`, `bbva-apx-testing`, `bbva-cells` and `bbva-cells-testing` recipes
are retired from canonical sources, native permissions and generated packages.
Historical sources remain available through Git history, not runtime packages.

The previous enrichment (2026-10-05) used commit
`507ee6888ce06bb4251fd41e9e91a0c77379e464` and its V1 recipe references.
This revision replaces those version-sensitive recipes with durable guidance:
documentation-first CELLS/APX/ASO discovery, contracts and flow verification,
meaningful tests without weakened assertions, mock/integration/e2e distinctions,
CELLS event/UI cleanup, and change-dependent Batch restart/idempotency/files.
It retains the engineering scope, permissions and sensitive-data protections.
It does not claim new authoritative BBVA API documentation or version compatibility.

## Integrity contract

[bbva-integrity.json](bbva-integrity.json) intentionally pins the newly reviewed
`bbva-engineering/SKILL.md` bytes only.
The description is quoted as a YAML string because it contains a colon followed
by a space; the pinned digest includes this frontmatter correction.
Build validation still rejects modified, missing and unexpected BBVA files;
the native OpenCode build copies canonical bytes exactly.
Distribution tests assert the sole BBVA inventory and removal of legacy permissions.
Installer migration tests exercise ownership, conflicts, rollback and idempotency.
Builds consume root-level canonical sources, not historical directories.
