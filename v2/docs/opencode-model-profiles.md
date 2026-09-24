# OpenCode Model Profiles

The model catalog is the parsed, de-duplicated output of `opencode models`. Presets use `luna`, `terra`, and `sol` requirements, resolved to exact `provider/model` IDs from the catalog. Only OpenAI and GitHub Copilot catalog entries participate in presets; Custom offers every discovered model, including other providers. If both supported providers satisfy a family, the wizard requires a provider selection. No family/model is synthesized.

| Profile | Pulso | Planner | Explorer | Executor | Verifier | Security | Availability |
|---|---|---|---|---|---|---|---|
| Inherited | inherit | inherit | inherit | inherit | inherit | inherit | Always |
| Economic | Luna | Luna | Luna | Luna | Luna | Luna | Luna resolves |
| Balanced | Terra | Terra | Luna | Luna | Terra | Terra | Luna + Terra resolve |
| Maximum performance | Sol | Sol | Luna | Terra | Sol | Sol | Luna + Terra + Sol resolve |
| Custom | chosen | chosen | chosen | chosen | chosen | chosen | Valid catalog available |

For presets the resolver chooses exact discovered IDs from the explicitly selected provider. Custom offers `Inherited` independently for each agent and stores exact selected IDs. Before apply, selected IDs are rediscovered; a missing ID aborts rather than downgrading. If catalog discovery fails, inherited remains available and setup can continue.

The local smoke environment had OpenCode 1.18.32 and reported OpenAI `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol` IDs, so all three presets resolved for OpenAI. GitHub Copilot was listed by `auth list` but its family availability is not inferred from credentials; it was not present as a provider in the model catalog. `auth list` is not used as the availability source.
