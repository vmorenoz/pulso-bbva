# Installer Wizard

Install selects one or both supported runtimes, asks for one shared local/global scope, configures selected runtimes, previews managed file/config mutations, asks for confirmation, then applies and validates. OpenCode is probed before its model selector. Missing OpenCode offers continue with other selected runtimes or cancel; Pulso does not install OpenCode.

OpenCode discovery and planning are read-only. Apply preflights OpenCode files/config and revalidates selected model IDs immediately before mutation. Managed files are updated only when their current hash matches the previous Pulso manifest; user-edited managed content and foreign `mcp.pulso` configuration conflict. The manifest is written last. A late I/O failure is reported as partial installation.

The OpenCode manifest includes runtime, scope, runtime version, managed file/config hashes, selected profile, and exact model assignments (`null` means inherited). It contains no provider credentials or tokens. Uninstall removes only hash-matching Pulso assets and the managed `mcp.pulso` key; foreign MCP configuration remains.
