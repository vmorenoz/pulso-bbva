# Fuentes oficiales consultadas

Fecha de consulta: 2026-09-29. Se revisaron las superficies relevantes para agentes, delegación, permisos, skills, comandos, configuración y diferencias de harness. No se afirma haber ejecutado esos hosts ni leído cada página de su documentación completa.

- [OpenCode releases](https://github.com/anomalyco/opencode/releases/tag/v1.18.33): Versión estable consultada.
- [VS Code updates](https://code.visualstudio.com/updates/v1_139): Serie estable consultada; comprobar patch local.
- [OpenCode agents](https://opencode.ai/docs/agents/): mode primary/subagent, markdown, herencia modelo, permission frente a tools.
- [OpenCode permissions](https://opencode.ai/docs/permissions/): Precedencia y restricciones; evitar allow que amplíe configuración.
- [OpenCode skills](https://opencode.ai/docs/skills/): Descubrimiento .agents/skills y frontmatter.
- [OpenCode commands](https://opencode.ai/docs/commands/): Comandos nativos, agent, subtask, argumentos.
- [OpenCode tools](https://opencode.ai/docs/tools/): Herramientas nativas según disponibilidad.
- [OpenCode config](https://opencode.ai/docs/config/): Configuración existente que instalador preserva.
- [OpenCode config schema](https://opencode.ai/config.json): Campos de configuración; no se incorpora un schema parcial como si fuese oficial completo.
- [OpenCode plugins](https://opencode.ai/docs/plugins/): Evaluado; no se añade plugin innecesario.
- [VS Code custom agents](https://code.visualstudio.com/docs/agent-customization/custom-agents): Formato .agent.md, visibilidad y configuración.
- [VS Code harnesses](https://code.visualstudio.com/docs/agents/run/agent-harnesses): Distinción Local/Copilot Agent Host; herramientas y aislamiento/approvals.
- [VS Code subagents](https://code.visualstudio.com/docs/agents/run/subagents): Subagentes Local, roster y contextos separados.
- [VS Code skills](https://code.visualstudio.com/docs/agent-customization/agent-skills): Skills comunes e invocables.
- [VS Code prompt files](https://code.visualstudio.com/docs/agent-customization/prompt-files): Deprecación y no carga por Agent Host; no se usan .prompt.md.
- [VS Code tools](https://code.visualstudio.com/docs/agents/reference/tools-reference): Herramientas dependientes del motor/instalación.
- [GitHub Copilot custom agents](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-custom-agents): Custom agents nativos y omisión de tools para capacidades heredadas.

Las referencias documentan capacidades, no su habilitación concreta en el equipo. Las pruebas locales se reproducen con `npm run verify`; sus logs no se versionan.

## Correctivo 3.0.1 — consulta 2026-09-29

- Node.js `fs.realpathSync` y `fs.lstatSync`: https://nodejs.org/api/fs.html#fsrealpathsyncpath-options
  Resolución canónica frente a inspección del enlace mismo. Se usan APIs existentes en Node 22.
- OpenCode comandos: https://opencode.ai/docs/commands/
  Se conserva el envoltorio nativo; el cuerpo pasa a leerse de la skill fuente.
- VS Code skills: https://code.visualstudio.com/docs/agent-customization/agent-skills
  Se preserva la skill como superficie invocable, sin nuevo mecanismo de carga.
- VS Code motores: https://code.visualstudio.com/docs/agents/run/agent-harnesses
  Selección y capacidades nativas por motor; sin detector propio.

Las referencias de versiones de la entrega inicial no son versiones observadas de una
sesión. Esta revisión documental no constituye una aceptación live. No se añaden APIs
ni campos nuevos de runtimes como parte del correctivo.

## Instalador 3.0.3 — consulta 2026-09-29

- OpenCode agentes: https://opencode.ai/docs/agents/ — ubicación global y por proyecto.
- OpenCode comandos: https://opencode.ai/docs/commands/ — ubicación global y por proyecto.
- OpenCode configuración: https://opencode.ai/docs/config/ — OPENCODE_CONFIG_DIR.
- OpenCode skills: https://opencode.ai/docs/skills/ — ~/.agents/skills.
- VS Code agentes: https://code.visualstudio.com/docs/agent-customization/custom-agents —
  ~/.copilot/agents para Copilot Agent Host, .github/agents para workspace.
- Skills Copilot: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills —
  .agents/skills de proyecto y ~/.agents/skills personales.
- Fuente oficial VS Code skills:
  https://github.com/microsoft/vscode-docs/blob/main/docs/agent-customization/agent-skills.md
  — rutas de skills personales y de proyecto.

Se verificaron estas rutas en documentación. No equivale a descubrimiento live de
las nuevas instalaciones globales en OpenCode o Copilot.
