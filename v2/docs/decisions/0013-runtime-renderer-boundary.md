# Runtime renderer boundary

Orchestration exposes a small RuntimeDefinition with rendering and config-artifact functions only. It does not access filesystems, detect installed hosts, or run a wizard. Installer owns all host discovery and mutation. Runtime branching is registered centrally.
