# BBVA skill content provenance

The four APX/CELLS skills in `core/skills` were deliberately enriched on
2026-10-05. They are no longer byte-for-byte copies of the earlier compact
corpus. `bbva-engineering` remains unchanged.

## Sources and scope

- Starting V4 source: commit `507ee6888ce06bb4251fd41e9e91a0c77379e464`.
- Recipe reference: the same commit's `v1/skills/bbva-apx`,
  `bbva-apx-testing`, `bbva-cells`, and `bbva-cells-testing` `SKILL.md` files.
- The starting V4 BBVA files were byte-identical to `v3-opencode-v1/skills`.
  That historical corpus and the original `v1` files are not modified.

Recovered guidance includes APX transaction lifecycle and test contexts,
job/step setup, conditional helper names, CELLS runner examples, per-test
state isolation, and the headless-browser diagnostic checklist. The base
skills also make discovery, affected contracts, and validation explicit.

Patterns apply only when confirmed in the target repository. No fixed CLI
versions, universal coverage thresholds, obsolete orchestration contracts,
or extra permissions are restored. Native tool/evidence contracts are
unchanged.

## Integrity contract

[bbva-integrity.json](bbva-integrity.json) pins the reviewed current bytes of all five BBVA
skills. Its four APX/CELLS SHA-256 values were intentionally updated for this
revision; the `bbva-engineering` digest is unchanged. The build still rejects
unexpected inventory or byte changes. Both native outputs must contain the
exact current canonical bytes, without adapter prose injected into BBVA
skills. Distribution tests check preservation, recipe anchors, and rejection
of tampered or incomplete inputs.

This is source-maintenance provenance, not a runtime prerequisite. Builds consume
the canonical V4 skills and their pinned hashes, not the historical directories
listed above. Run `npm run check` from `v4/` after building to check the current
outputs; a historical successful check is not evidence for a later artifact.
