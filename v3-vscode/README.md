# Pulso

**Pulso** es una extensión nativa de VS Code para organizar objetivos y delegar en especialistas mediante las capacidades del host GitHub Copilot. `v3-vscode` es el nombre interno de esta distribución, derivada exclusivamente de `v3-opencode-v1`.

Destino principal: **Copilot / Agent Host**. **Local** es también una intención de soporte. La aceptación en sesiones reales de ambos destinos sigue en **LIVE NOT_RUN**; disponer de las APIs y superar pruebas offline no acredita su funcionamiento en el harness real. Consulta [Compatibilidad](docs/COMPATIBILITY.md) y [Aceptación](docs/ACCEPTANCE.md).

## Requisitos e instalación local

- Entorno instalado de referencia: VS Code **1.139.1**, macOS **arm64**, GitHub Copilot integrado (**builtin 0.67.0**).
- El manifiesto requiere VS Code `^1.139.1` y Node.js `>=22`. Para construir el VSIX se necesitan npm y el directorio hermano `v3-opencode-v1`.
- Las tools requieren un workspace confiable con carpetas locales abiertas (`file:`).

Ejecuta desde `v3-vscode`, con el lockfile de dependencias disponible:

```sh
npm ci
npm run build
npm run verify
npm run package
```

`verify` ejecuta build, check y tests; `package` repite verify antes de empaquetar. El paquete local es **`dist/pulso-3.1.1.vsix`**, con SHA-256 adyacente. Las evidencias offline y del Extension Host real están en [Aceptación](docs/ACCEPTANCE.md). El smoke comprueba cuatro tools, dos comandos y tres consultas de solo lectura. No ejecuta conversaciones ni delegaciones con modelos.

Instala manualmente desde **Extensions: Install from VSIX…** y selecciona el archivo. Como alternativa, utiliza el CLI de tu instalación de VS Code; ejemplo general:

```sh
code --install-extension "/ruta/local/v3-vscode/dist/pulso-3.1.1.vsix"
```

Si el CLI no está en PATH, usa la ruta entre comillas al ejecutable instalado:

```sh
"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" --install-extension "/ruta/local/v3-vscode/dist/pulso-3.1.1.vsix"
```

`pulso-local` identifica el publisher del VSIX local; no acredita una cuenta registrada en Marketplace. La extensión no instala otras extensiones ni modifica settings automáticamente.

## Primer uso

1. Abre un proyecto o worktree local y confiable. Para aceptación, usa exclusivamente un proyecto aislado, no este repositorio.
2. Abre Chat, directamente o con **Pulso: Abrir chat**. Selecciona manualmente **Pulso** en el selector de agentes y el destino **Copilot** o **Local**. El comando abre el chat y muestra una indicación; no selecciona el agente por ti.
3. Usa `/skills` para consultar las skills disponibles. Las operativas son `/pulso-init`, `/pulso-status`, `/pulso-recap` y `/pulso-resume`.
4. Con **Pulso** seleccionado, invoca `/pulso-init` para preparar y mapear el proyecto cuando corresponda. Consulta `/pulso-status` para el estado, `/pulso-recap` para cierres y `/pulso-resume` para retomar un objetivo. Si está seleccionado otro agente, la skill operativa debe pedir seleccionar Pulso y detenerse.
5. Con una sola carpeta local, Pulso usa ese proyecto automáticamente, sin selector. En multi-root, la primera llamada pide elegir proyecto/worktree y conserva la selección en memoria para las llamadas siguientes. Usa **Pulso: Seleccionar proyecto** para cambiarla explícitamente; cancelar conserva la selección anterior mientras el workspace siga vigente.

Un saludo o consulta no inicializa el proyecto. Estado e historial leen lo existente. Las mutaciones de metadatos canónicos se realizan mediante las cuatro tools, no editando los JSON manualmente.

## Capacidades y límites

La extensión registra sus tools mediante `vscode.lm.registerTool`; el build genera las contribuciones `languageModelTools`, `chatAgents` y `chatSkills`.

| Tool | Función |
| --- | --- |
| `pulso_workspace` | Preparar, consultar y validar; sincronizar o recuperar explícitamente; consultar intentos heredados. |
| `pulso_work` | Crear, consultar, actualizar, bloquear, cerrar, reabrir objetivos y completar mapeos. |
| `pulso_history` | Consultar cierres por trabajo o período. |
| `pulso_context` | Contexto, preferencias y aprendizajes de proyecto o usuario. |

Se empaquetan **10 agentes** (Pulso y nueve especialistas) y **10 skills** (cuatro operativas, cinco BBVA y una de verificación de integración). Pulso usa la delegación nativa disponible en el host; no proporciona un scheduler ni un runtime paralelo. Las delegaciones requieren inputs y referencias suficientes, sin asumir memoria de sesiones anteriores.

La raíz procede exclusivamente de `workspaceFolders` y, cuando corresponde, `showQuickPick`, APIs estables del host. El binding es **por ventana y compartido entre sus sesiones**; no existe una API de raíz específica de sesión. Para trabajar en otro proyecto usa **Pulso: Seleccionar proyecto** (`pulso.selectProject`) o abre una ventana separada. No se deriva de `cwd`, el editor activo ni una ruta enviada por el modelo. Un worktree debe estar abierto como carpeta para poder seleccionarlo.

Recargar la ventana pierde la selección en memoria: multi-root vuelve a elegir. Cualquier cambio del listado o de las raíces del workspace invalida el binding mediante snapshots, sin requerir un listener. Cada llamada comprueba confianza, cancelación y vigencia; si el binding o el workspace cambia durante una mutación, la comprobación del adaptador la detiene. Los recibos reutilizan la raíz activa; un cambio de `receipt.workspace` obliga a detener la continuidad del objetivo antes de delegar o consolidar. Las aprobaciones normales de VS Code son independientes del selector y mantienen su comportamiento habitual.

No se generan prompt files para Agent Host. Tampoco hay un hook observador implementado: `attempts` y `reconcile_attempts` consultan únicamente telemetría preexistente del core heredado. No observan delegaciones en vivo, no reanudan sesiones y no certifican que un agente siga vivo.

Los metadatos del proyecto residen bajo su `.pulso/`. Las preferencias de usuario usan `~/.pulso/preferences.json`, compartidas entre proyectos y sesiones. `homeDir` es inyectable en el adaptador y el core para pruebas aisladas; el HOME no selecciona la raíz del proyecto.

## Recursos generados

`src/composition.mjs` compone exclusivamente recursos de `v3-opencode-v1`: módulos del core, catálogo, agentes, skills, templates y schemas. El build reemplaza `resources/`, adapta enlaces relativos y capacidades nativas, y genera `resources/provenance.json` con hashes SHA-256 de entradas y salidas y marcas de adaptación. También actualiza las contribuciones del manifiesto.

Las nuevas operaciones ofrecen las prioridades `low`, `normal`, `high`, `urgent`. Los schemas de la base admiten también `critical` para conservar trabajos anteriores. El VSIX copia esos schemas sin transformación: ambos runtimes conservan la prioridad persistida y pueden continuar sucesivamente el mismo trabajo. La severidad de resultados no cambia.

## Documentación y distribución

- [Compatibilidad y referencias oficiales](docs/COMPATIBILITY.md)
- [Procedimiento y evidencias de aceptación](docs/ACCEPTANCE.md)
- [Derechos y distribución privada](LICENSE.md): `UNLICENSED`, derechos reservados.
