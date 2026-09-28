# Línea base E00

## Checkout y evidencia

- Checkout: `v2/`, HEAD inicial `085af69 feat(v2): add native OpenCode runtime`.
- Estado inicial versionado limpio. Se preservaron los tres elementos locales sin seguimiento: `.cgcignore`, `pulso-bbva-v1-review.zip` y `pulso-bbva-v2-review.zip`.
- `pulso-bbva-v2-review.zip`: SHA-256 `9a312007875510b069495b12a992b04d6aca796266ba836e7c3bccbbe39d4de4`, igual al hash de la evidencia suministrada.
- `evidence/baseline-v2.json`: 207/207 fuentes presentes; 189 mantienen el hash base; 18 difieren en rutas modificadas durante este evolutivo (incluye scripts añadidos a `package.json`); 0 ausentes.
- El kit de referencia se extrajo fuera del checkout a `/var/folders/w0/bxwjhlfn5254znsw3cdxf52h0000gn/T/opencode/pulso-evolutivo-opencode-v2.1-r1`.

## Entorno comprobado

| Componente | Versión/resultado |
|---|---|
| Node | `v24.18.0` |
| Bun | `1.4.2`, invocado con `npx --yes bun@1.4.2`; Bun global no está instalado |
| OpenCode | `1.18.32` en el smoke local aislado |
| Credenciales/provider | No se copiaron ni se registraron credenciales en el sandbox |
| Pulso global | Sin modificación ni uso para construcción/delegación |

## Línea base del kit

- `python3 scripts/verify_package.py`: PASS; 95 archivos de kit comprobados, 207 fuentes v2 verificadas.
- `node --experimental-strip-types --test tests/decision-kernel.test.ts`: prueba de referencia del kit ejecutada por separado; no sustituye integración del producto.
- Suites iniciales del producto: Bun global no disponible; el resto se repitió con Bun 1.4.2 por `npx` durante la implementación.

## Aislamiento E10

Workspace/home/config/data/state/cache aislados bajo `/var/folders/w0/bxwjhlfn5254znsw3cdxf52h0000gn/T/opencode/evolution-v21-smoke.RJN3CI`. OpenCode 1.18.32 cargó seis roles gestionados y ocho skills; AGENTS.md, CLAUDE.md y PULSO.md estuvieron ausentes y no se generaron. Es evidencia de carga de configuración/assets, no de conversación real con modelo.
