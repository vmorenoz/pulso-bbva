# 0007 Runtime Work Adapter Boundary

Keep runtime lifecycle translation in `@pulso/capabilities-mcp`, consuming
`@pulso/working-system` application contracts through
`WorkingSystemGateway`. The Working System never imports or knows this boundary.
