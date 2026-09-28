# Bundles para revisión

Esta carpeta se distribuye en dos ZIP separados:

- `pulso-bbva-v2.1-evolution-r1.zip`: checkout de `v2/` con fuentes, tests, fixtures, documentación y reportes; excluye dependencias instaladas, compilados, caches, `.pulso-evidence`, `.DS_Store` y archivos temporales.
- `pulso-bbva-v2.1-evidence-r1.zip`: reports/evolution-v21, el índice de esta entrega y el archivo de evidencia del smoke scripted fallido `v2/.pulso-evidence/2026-09-28T05-52-18-903Z-78216fb1-6d53-4cfd-ab9d-2fe9fea5218a/`.

Ambos ZIP contienen un `MANIFEST.sha256.json` calculado al empaquetar. El segundo conserva evidencia de un bloqueo real de integración y no constituye certificación. Estado funcional y criterios están en `final.md`, `limitations.md` y `acceptance.json`.
