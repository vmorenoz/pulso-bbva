# Métricas y ejecuciones

## Conteos comprobados

| Comando | Resultado |
|---|---|
| `npx --yes bun@1.4.2 test packages/*/test` | 285 passed, 0 failed, 1288 assertions, 44 archivos |
| `npx --yes bun@1.4.2 run test:evolution:unit` | exit 0; 285 passed, 0 failed, 1288 assertions |
| `npx --yes bun@1.4.2 run test:integration` | 3 passed, 0 failed, 31 assertions |
| `npx --yes bun@1.4.2 run test:e2e` | 4 passed, 0 failed, 36 assertions |
| `npx --yes bun@1.4.2 run test:opencode-bridge` | 66 passed, 0 failed, 184 assertions |
| `npx --yes bun@1.4.2 test packages/installer/test` | 45 passed, 0 failed, 186 assertions |
| `npx --yes bun@1.4.2 test tests/evolution-v21` | 111 passed, 0 failed, 354 assertions |
| `npx --yes bun@1.4.2 run typecheck` | exit 0 |
| `npx --yes bun@1.4.2 run build` | exit 0; orchestration 98 módulos, CLI/bridge 272 módulos |
| `npx --yes bun@1.4.2 run test:evolution:live` | exit 2; `NOT_RUN`, guard `PULSO_RUNTIME_SMOKE_LIVE_AUTH=1` requerido |
| `python3 scripts/verify_package.py` (kit) | exit 0; integridad PASS |

## No aprobado / NOT_RUN

- `npx --yes bun@1.4.2 run test:runtime-smoke:offline`: FAIL en `valid` (`SCRIPTED_NATIVE_TASK_ARGS_NOT_OBSERVED`), y la tanda de cuatro modos fue terminada por timeout (360 s). El run directo `valid` dejó evidencia en `v2/.pulso-evidence/2026-09-28T05-52-18-903Z-78216fb1-6d53-4cfd-ab9d-2fe9fea5218a/{turn-1/run.json,turn-1/barrier.json,parent-export.json}`; el journal no observó Work ni intentos. No se convierte en PASS por tener unitarias verdes.
- `npx --yes bun@1.4.2 run lint`: exit 0; 26 warnings y 1 info de Biome, principalmente assertions no nulas e import/optional-chain/style findings.
- `test:evolution:integration`/`test:evolution:all`: NOT_RUN como scripts compuestos; se ejecutaron sus unit/integration/E2E/bridge/offline subcomandos por separado; el smoke offline falla y el live se reportó NOT_RUN.
- `opencode run` conversacional con provider real/credenciales, solapamiento real de hijos, dos writers reales, preferencias en sesiones/hijos reales, plan-only/adopción real, AC25/AC26 en sesiones reales: NOT_RUN.
- Latencias, solapamiento temporal de hijos, tokens/provider y comparación A/B v2/v2.1: NOT_RUN; no se infieren desde tests simulados.

## Smoke aislado de instalación

- OpenCode `1.18.32`, `opencode agent list`: exit 0; roles Pulso (primary), Planner, Explorer, Executor, Verifier, Security Auditor y ocho skills instaladas.
- Manifest de build: `bc418e10916fa80aa165f234300de72ac72385f74c055818d8be58c7b70ec64f`; assets instalados: 6 agentes + 8 skills + plugin bridge (15 SHA-256 bajo `manifest.json`).
- No se usó configuración/home global ni se importaron credenciales.
