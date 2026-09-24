# Multi-runtime installer

The installer selects runtime(s), then one scope shared by all selections, creates a read-only plan, previews it, confirms, preflights and applies mutations, validates, and records runtime-specific manifests. Uninstall uses those manifests to preserve unmanaged and user-modified assets.
