# Compatibilidad de Pulso

Nombre público: **Pulso**. Directorio interno: `v3-vscode`. Base exclusiva de recursos y core: `v3-opencode-v1`.

## Entorno y destinos

| Elemento | Referencia / estado |
| --- | --- |
| VS Code instalado | 1.139.1, macOS arm64 |
| GitHub Copilot instalado | builtin 0.67.0 |
| Requisito del manifiesto | VS Code `^1.139.1`; Node.js `>=22` |
| Copilot / Agent Host | Destino principal; **LIVE NOT_RUN** |
| Local | Intención de soporte; **LIVE NOT_RUN** |
| Workspace | Confiable, carpetas locales `file:` abiertas |
| Workspace virtual o no confiable | No soportado por el manifiesto |

El smoke real inicial `npm run test:host` confirmó activación y registro de las cuatro tools en `vscode.lm.tools`, un comando (`pulso.openChat`) y la presencia de los recursos empaquetados en VS Code 1.139.1. El contrato actual añade `pulso.selectProject`: requiere una nueva ejecución que compruebe ambos comandos. El smoke no ejecuta conversaciones ni delegaciones. Las pruebas con un host simulado comprueban ejecución de tools y aislamiento, pero no el descubrimiento efectivo de agentes/skills ni el flujo del modelo. La exposición de capacidades debe verificarse por separado en Copilot / Agent Host y Local.

## Contrato de integración

- **Tools nativas:** `src/extension.cjs` registra `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context` mediante `vscode.lm.registerTool`, devolviendo `LanguageModelToolResult` y `LanguageModelTextPart`. `src/tools.mjs` define y valida los inputs.
- **Agentes y skills:** el build contribuye `chatAgents` y `chatSkills`: 10 agentes y 10 skills. El agente público invocable es **Pulso**; los nueve especialistas son destinos de delegación. Las cuatro skills operativas exigen selección manual de Pulso.
- **Selección de proyecto:** una resolver por ventana usa `workspace.workspaceFolders`: carpeta local única automáticamente, sin picker; multi-root selecciona una vez con `window.showQuickPick` y conserva el binding en memoria. Invocaciones concurrentes comparten el picker pendiente. `pulso.selectProject` fuerza una nueva selección; cancelar conserva el binding anterior si sigue vigente. Snapshots invalidan la selección ante cualquier cambio del listado o las raíces, sin listener; recargar pierde el binding y multi-root elige de nuevo. Solo admite directorios locales canónicos abiertos y revalida confianza, cancelación y vigencia; el checker detiene una mutación si cambia el binding o el workspace.
- **Sesiones y aprobaciones:** el proyecto activo se comparte entre todas las sesiones de la ventana; no existe API pública de raíz por sesión. Para operar en otro proyecto usa **Pulso: Seleccionar proyecto** o una ventana separada. No inspecciona el token opaco de invocación para obtener raíz de sesión ni usa `cwd`, `activeTextEditor` o un campo root del modelo. Las aprobaciones normales de VS Code son independientes de esta selección y mantienen su comportamiento.
- **Worktrees:** se seleccionan como carpetas abiertas. No existe descubrimiento automático de la raíz de un worktree de Agent Host. Si el proyecto de la sesión no está entre las carpetas ofrecidas, debe abrirse y seleccionarse explícitamente antes de operar.
- **Delegación:** usa capacidades nativas disponibles, sin sesiones sintéticas ni scheduler. El prompt incluye un envelope contextual con `hostContext.projectRoot/readBase` absolutos procedentes del recibo del host, separado del JSON canónico de delegación y resultado. Los campos canónicos mantienen rutas relativas; el especialista resuelve rutas absolutas solo para llamar a herramientas nativas. El envelope es contexto del prompt, no una nueva API de agentes. La delegación Local es stateless; Copilot sigue las capacidades de su harness. El flujo completo debe pasar aceptación real en cada destino.
- **Prompt files:** no se contribuyen ni generan prompt files para Agent Host. Las operaciones se exponen mediante agentes, skills y tools.
- **Hooks:** no se registra un hook observador en esta extensión. Incluir `delegation-observer.mjs` del core no equivale a conectarlo a eventos del host. `attempts` y `reconcile_attempts` solo leen telemetría preexistente, sin modificar Work ni afirmar observación live o vida de agentes.
- **Memoria:** `.pulso/memory.json` pertenece al proyecto; las preferencias de usuario están en `~/.pulso/preferences.json`. El core recibe `homeDir` inyectable, permitiendo un HOME aislado en tests. Compartir preferencias no transfiere identidad, raíz ni estado de un proyecto a otro.

El comando `pulso.openChat` abre Chat y muestra una indicación. No cambia el agente o el destino de sesión, instala dependencias ni modifica settings.

El comando `pulso.selectProject`, público como **Pulso: Seleccionar proyecto**, cambia el proyecto activo de la ventana. Se registran cuatro tools y dos comandos (seis subscriptions). `receipt.workspace` conserva la raíz activa entre llamadas; tras un cambio explícito o invalidación, cualquier deriva respecto a la raíz conservada del objetivo detiene nuevas delegaciones y consolidaciones para no mezclar proyectos.

## Composición y empaquetado

`scripts/build.mjs` consume `src/tools.mjs` y `src/composition.mjs`, reemplaza los recursos generados y actualiza las contribuciones del manifiesto. Empaqueta módulos del core, agentes, skills, catálogo, templates y schemas de la base exclusiva. Los enlaces se adaptan a recursos relativos del paquete.

`resources/provenance.json` registra fuentes `v3-opencode-v1`, hashes SHA-256 y modificaciones de las copias. Core, schemas y plantillas se copian intactos. Las nuevas operaciones ofrecen `low`, `normal`, `high`, `urgent`; los schemas de la base también conservan `critical` para trabajos anteriores. Las pruebas de continuidad verifican lectura, actualización, cierre y reapertura sucesivos entre ambos cores sin cambiar la prioridad persistida. La severidad de resultados permanece intacta.

`verify` encadena build, check y tests. `package` ejecuta verify y crea `dist/pulso-3.1.1.vsix` mediante VSCE. El publisher `pulso-local` es una identidad para distribución local, no evidencia de registro en Marketplace. Consulta los resultados pendientes y el protocolo real en [ACCEPTANCE.md](ACCEPTANCE.md).

## Referencias oficiales

Las referencias describen capacidades del host; no sustituyen evidencias de ejecución de Pulso:

- [Release VS Code 1.139 y actualización 1.139.1](https://code.visualstudio.com/updates/v1_139)
- [API de tools para modelos de lenguaje](https://code.visualstudio.com/api/extension-guides/ai/tools)
- [API estable de VS Code: `lm`, workspace y window](https://code.visualstudio.com/api/references/vscode-api)
- [Agentes personalizados](https://code.visualstudio.com/docs/agent-customization/custom-agents)
- [Agent skills](https://code.visualstudio.com/docs/agent-customization/agent-skills)
- [Hooks del host](https://code.visualstudio.com/docs/agent-customization/hooks)
- [Agent Host y harnesses](https://code.visualstudio.com/docs/agents/concepts/agent-host)
- [Arquitectura de Agent Host](https://code.visualstudio.com/blogs/2026/08/26/agent-host-architecture)
- [Instalación desde VSIX](https://code.visualstudio.com/docs/configure/extensions/extension-marketplace#_install-from-a-vsix)
