# Pulso

**Pulso, Asistente IA para desarrollo** coordina especialistas de IA para entender, planificar, implementar y verificar cambios de software, manteniendo continuidad mediante artefactos locales por proyecto.

## Estado de la distribución

La base de la adaptación actual es [`v3-opencode-v1/`](v3-opencode-v1/), para **OpenCode v1**. Su distribución hermana [`v3-vscode/`](v3-vscode/) se empaqueta como extensión de **VS Code**, con nombre público **Pulso**, agentes, skills y cuatro tools nativas. Consulta allí instalación y estado de verificación para Copilot / Agent Host y Local.

`v3/` contiene la distribución anterior para **OpenCode v2**, cuya documentación se conserva a continuación. `v1/` y `v2/` son referencias históricas; ninguno de estos tres directorios es base de la adaptación VS Code.

Pulso no es un runtime propio de agentes, servicio MCP, daemon, scheduler ni base de datos. OpenCode mantiene la ejecución de agentes, delegación visible, herramientas y aprobaciones. Los artefactos de coordinación se guardan localmente dentro de `.pulso/` en cada workspace.

## Requisitos

- Node.js 22 o posterior.
- OpenCode major 2 instalado y disponible en `PATH`.
- Un workspace abierto en OpenCode para usar las tools de proyecto.

Comprueba la versión antes de instalar:

```sh
node --version
opencode --version
```

El instalador aborta antes de escribir si no detecta OpenCode v2. No instala OpenCode ni dependencias npm.

## Instalar globalmente

Desde la raíz de este repositorio:

```sh
npm run install:pulso --prefix v3
```

O entrando a `v3/`:

```sh
cd v3
npm run install:pulso
```

Para previsualizar qué archivos gestionados se crearían o actualizarían:

```sh
node v3/install.mjs --dry-run
```

Después de instalar, reinicia OpenCode y selecciona `pulso` como agente principal. La instalación es global para el usuario y no requiere `sudo` ni `npm install`.

### Recursos instalados

| Recurso | Ubicación predeterminada |
|---|---|
| Agentes | `~/.config/opencode/agents/` |
| Comandos | `~/.config/opencode/commands/` |
| Skills | `~/.config/opencode/skills/` |
| Plugin Pulso | `~/.config/opencode/plugins/pulso/` |
| Core, schemas, plantillas y documentación | `~/.pulso/` |

Se respetan `OPENCODE_CONFIG_DIR` y `XDG_CONFIG_HOME` cuando apuntan dentro del directorio del usuario. El instalador mantiene un manifest con hashes para conocer la propiedad de sus archivos. No modifica `opencode.json(c)`, modelos, credenciales, MCP, permisos del host ni agentes ajenos. Si encuentra recursos modificados o propiedad ambigua, detiene la operación en lugar de sobrescribirlos.

## Uso básico

Una vez seleccionado el agente `pulso`:

- `/pulso-status` consulta el snapshot de trabajos del workspace.
- `/pulso-recap` resume cierres y trabajos abiertos.
- `/pulso-resume` retoma un trabajo existente.
- `/pulso-init` solicita el mapeo inicial cuando falta contexto.

El saludo y las consultas de solo lectura no preparan el workspace. Ante el primer encargo concreto, Pulso puede inicializar el esqueleto local `.pulso/` y delegar el mapeo al especialista Explorer.

### Tools principales

- `pulso_status`, `pulso_history`, `pulso_work_get`: lectura de estado, cierres y detalle de un trabajo.
- `pulso_workspace_prepare`: prepara únicamente el workspace activo y conserva cualquier contenido preexistente.
- `pulso_work_create`: crea un objetivo con criterio verificable.
- `pulso_work_apply`: aplica un lote de cambios semánticos con `expectedRevision` vigente.
- `pulso_work_close` y `pulso_work_reopen`: cierre validado y reapertura con motivo.
- `pulso_work_validate`: valida coherencia; opcionalmente comprueba vigencia de evidencia.
- `pulso_project_complete_map`: completa el Work reservado al mapeo inicial.

Las mutaciones reciben campos semánticos, no un JSON completo de Work ni una ruta raíz elegida por el modelo. El core valida y persiste los cambios; las tools devuelven recibos breves. Las delegaciones de especialistas siguen siendo llamadas nativas visibles de OpenCode.

### Datos por workspace

```text
<workspace>/.pulso/
  state.json
  history.jsonl
  project.md
  decisions.md
  work/<ID>/
    work.json
    evidence/
    ...
```

El instalador global no recorre los proyectos. Desinstalar Pulso no borra sus datos. Workspaces legacy, incompletos o incompatibles se preservan y pueden bloquear operaciones; no se migran ni reparan automáticamente.

## Desinstalar

Desde la raíz del repositorio:

```sh
npm run uninstall:pulso --prefix v3
```

O desde `v3/`:

```sh
npm run uninstall:pulso
```

La desinstalación retira únicamente archivos globales registrados e intactos en el manifest. No recorre workspaces ni borra sus `.pulso/`. Los archivos administrados que hayan sido modificados detienen la operación para proteger cambios locales.

## Desarrollo y verificación

```sh
cd v3
npm run build
npm test
npm run check
npm run verify
```

- `build` valida la composición OpenCode v2 en memoria; no genera archivos en el repositorio.
- `test` ejecuta las pruebas Node.js del core, operaciones semánticas e instalador.
- `check` valida schemas, skills, agentes, plugin y composición.
- `verify` ejecuta `check` y todas las pruebas.

Las pruebas offline no certifican carga real del plugin, permisos efectivos, TUI ni respuestas del modelo. La aceptación live de OpenCode está documentada en [`v3/docs/REAL-SCENARIOS.md`](v3/docs/REAL-SCENARIOS.md) y debe marcarse como no ejecutada hasta observarla.

## Documentación

- [Inicio de Pulso v3](v3/README.md)
- [Arquitectura](v3/docs/ARCHITECTURE.md)
- [Runtime OpenCode v2](v3/docs/RUNTIMES.md)
- [Instalador y migración](v3/docs/INSTALLER.md)
- [Operaciones y tools](v3/docs/OPERATIONS.md)
- [Seguridad y límites](v3/docs/SECURITY.md)
- [Desarrollo y composición](v3/docs/BUILD.md)
- [Migración desde instalaciones anteriores](v3/docs/MIGRATION.md)
- [Validación live](v3/docs/REAL-SCENARIOS.md)
