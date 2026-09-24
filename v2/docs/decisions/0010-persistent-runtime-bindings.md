# 0010 Persistent runtime bindings

Bindings use a separate SQLite store so host-specific correlation data does
not contaminate Work domain entities. Work remains the state authority;
cross-store bind uses compensation and reconciliation rather than a fictitious
distributed transaction.
