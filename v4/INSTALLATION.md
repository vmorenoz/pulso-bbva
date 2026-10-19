# Instalar Pulso en otro equipo

Esta guía instala **Pulso V4 para OpenCode desde el código de este repositorio**, incluyendo sus agentes, prompts, skills y política CELLS. Para reproducir exactamente una instalación, conserva el commit utilizado; `main` puede avanzar.

## Instalación rápida con el paquete incluido

Con Node.js 22+ y OpenCode ya instalados, puedes utilizar el instalador autocontenido versionado en este repositorio:

```sh
git clone https://github.com/vmorenoz/pulso-bbva.git
cd pulso-bbva
node install.mjs --dry-run
node install.mjs
```

Revisa el plan y confirma la instalación; después cierra y vuelve a abrir OpenCode. Este camino no necesita `npm ci` ni compilar. Los pasos siguientes permiten reconstruir el instalador desde una revisión concreta o regenerar los artefactos cuando cambie el código.

## 1. Requisitos

- macOS o Linux con `git` y `tar` disponibles.
- Node.js **22 o posterior**, con npm para construir desde código.
- OpenCode instalado según su [documentación oficial](https://opencode.ai/docs/), con un proveedor y modelo configurados por el usuario.
- Acceso al repositorio y a las dependencias descargadas por `npm ci`.

Comprueba en la terminal donde vas a instalar:

```sh
git --version
tar --version
node --version
npm --version
opencode --version
command -v node
command -v opencode
```

Si gestionas Node con **nvm**, activa una versión compatible en esa terminal, por ejemplo `nvm use 22` si ya está instalada. `node -p 'process.execPath'` muestra la ruta absoluta del ejecutable activo. Cuando un lanzador externo no cargue nvm, usa esa ruta absoluta entre comillas en lugar de `node`, o configura su entorno para que encuentre la versión correcta. Las rutas deben obtenerse en el equipo destino; no copies las de otro equipo.

La referencia de integración OpenCode documentada es 1.18.34; consulta la [matriz técnica](README.md#native-integration-and-compatibility-evidence). La carga y conversación en tu versión concreta se comprueban después de instalar.

## 2. Clonar y fijar la revisión

Desde el directorio donde guardes tus proyectos:

```sh
git clone https://github.com/vmorenoz/pulso-bbva.git
cd pulso-bbva
git switch main
git pull --ff-only
git rev-parse HEAD
```

Para reproducir una revisión concreta, sustituye `COMMIT` por su SHA completo antes de construir:

```sh
git checkout --detach COMMIT
git rev-parse HEAD
```

Guarda ese SHA junto con las versiones de Node y OpenCode. Los siguientes pasos construyen el código de la revisión seleccionada, incluidos sus prompts; que un archivo preparado tenga la misma versión de paquete no demuestra que contenga los últimos cambios.

## 3. Construir el paquete OpenCode

Desde la raíz del checkout anterior:

```sh
cd v4
npm ci
npm run package:opencode
npm run verify:packages -- opencode
node scripts/package-installer.mjs
```

- `npm ci` utiliza `v4/package-lock.json`; si no coincide con `package.json`, detente y revisa la revisión descargada.
- `package:opencode` construye y verifica el runtime en `dist/opencode` y genera `artifacts/pulso-opencode-<versión>.tar.gz` con su `.sha256`.
- `verify:packages -- opencode` comprueba el archivo generado y ejecuta verificaciones aisladas del núcleo; no instala en tu usuario ni prueba una conversación real.
- `package-installer.mjs` consume ese runtime y produce `artifacts/pulso-opencode-installer-<versión>.tar.gz` y su `.sha256`. Este segundo archivo es el que utiliza el instalador raíz.

La versión procede de `v4/package.json`. No hace falta construir el adaptador VS Code para instalar OpenCode. Estos comandos utilizan el código y las dependencias del checkout; no dependen de un paquete global Pulso publicado en npm.

## 4. Revisar e instalar

Todavía desde `v4/`:

```sh
node install.mjs --help
node install.mjs --dry-run
node install.mjs
```

El mismo `node install.mjs` funciona desde la raíz del repositorio. Verifica el SHA-256 del instalador autocontenido, lo extrae temporalmente y pide confirmación. **No descarga ni construye paquetes**: si faltan el archivo o su checksum, completa el paso anterior.

Revisa los destinos mostrados. Se registra un **plugin nativo de OpenCode** y se instalan agentes, skills y comandos. Pulso no se instala como servidor MCP. El runtime queda en `~/.pulso/runtimes/opencode-v1`; la configuración utiliza el directorio global XDG de OpenCode y, si está definida, la capa adicional `OPENCODE_CONFIG_DIR`. Los directorios personalizados admitidos deben ser absolutos y estar dentro del home. `OPENCODE_CONFIG` es un override de archivo, no un destino de recursos.

Para actualizar archivos gestionados de Pulso que el instalador detecte modificados, revisa primero el plan con la política explícita de backup:

```sh
node install.mjs --conflict backup-replace --dry-run
node install.mjs --conflict backup-replace
```

Los archivos ajenos no se sobrescriben. `--yes` permite confirmar sin pregunta, pero no autoriza colisiones ajenas. Se respaldan las configuraciones modificadas y se eliminan los presets `model` y `variant` de los IDs Pulso reconocidos en las configuraciones globales inventariadas; se conserva el modelo global. Los overrides y la configuración del proyecto pueden seguir aportando presets. Consulta los detalles en la [guía del instalador](installer/README.md).

## 5. Comprobar en OpenCode

1. Cierra y vuelve a abrir OpenCode tras instalar.
2. Abre **el proyecto donde quieras utilizar Pulso**, distinto de este repositorio de desarrollo.
3. Comprueba que puedes seleccionar el agente **Pulso**, que sus especialistas están disponibles y que aparecen `/pulso-init`, `/pulso-status`, `/pulso-recap` y `/pulso-resume`.
4. Comprueba que el plugin expone `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`. No esperes encontrar un servidor MCP llamado Pulso en la lista de MCP.
5. Pide una consulta de estado sin inicializar el proyecto. Si deseas prepararlo, ejecuta después `/pulso-init`: prepara el mapa contextual en `.pulso/` sin crear un objetivo de trabajo.

Si faltan agentes o herramientas, revisa los errores de carga de OpenCode y que su entorno utilice los mismos directorios de configuración que mostró el instalador. La instalación de archivos por sí sola no acredita una conversación correcta: anota la versión del host y el resultado de esta comprobación.

## 6. Política CELLS y conocimiento externo

Los prompts de Pulso incluyen la política CELLS de la revisión construida. Cuando el stack CELLS está confirmado, esta exige consultar documentación mediante el MCP de conocimiento `cells-knowledge`, si está disponible, y contrastarla con código, dependencias y runtime observados.

**Ese MCP externo no está incluido ni publicado con Pulso.** Instalar Pulso no instala ni configura dicho servicio. Su entrega privada y configuración en otro equipo quedan pendientes de una entrega separada.

Cuando no esté disponible o su cobertura sea insuficiente, Pulso debe declarar la limitación y las decisiones que quedan sin sustento. Puede continuar el trabajo independiente respaldado por fuentes autorizadas, sin simular acceso, consultas, documentación ni resultados. La lectura inicial del proyecto para identificar tecnologías y versiones no requiere ese MCP.

## Paquete ya preparado y otros destinos

Si recibes el instalador autocontenido y su checksum correspondientes a la revisión deseada, puedes omitir la construcción: sigue [la guía del paquete autocontenido](installer/STANDALONE.md). Los paquetes de ejecuciones satisfactorias de GitHub Actions se obtienen desde **Artifacts**, conservando su asociación con el commit; no se presupone una release publicada.

Para VS Code, consulta su [guía específica](adapters/vscode/README.md). El CLI avanzado permite seleccionar destinos; su ayuda se obtiene desde `v4/`, después de `npm ci`, con:

```sh
node installer/cli.mjs --help
```
