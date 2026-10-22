# Instalar Pulso en otro equipo

Esta guía describe la instalación de **Pulso V4 en OpenCode o VS Code**, incluyendo sus agentes, prompts, skills y política documental CELLS/APX/ASO. El recorrido de reconstrucción detallado corresponde a OpenCode; VS Code dispone de su guía específica. Para reproducir exactamente una instalación, conserva el commit utilizado; `main` puede avanzar.

## Instalación rápida con el paquete incluido

Con Node.js 22+ y OpenCode ya instalados, puedes utilizar el instalador autocontenido versionado en este repositorio:

```sh
git clone https://github.com/vmorenoz/pulso-bbva.git
cd pulso-bbva
node install.mjs --dry-run
node install.mjs
```

Revisa el plan y confirma la instalación; después cierra y vuelve a abrir OpenCode. Este camino no necesita `npm ci` ni compilar. Los pasos siguientes permiten reconstruir el instalador desde una revisión concreta o regenerar los artefactos cuando cambie el código.

Para **VS Code + GitHub Copilot**, desde el mismo checkout abre «Extensions: Install from VSIX…», selecciona `v4/artifacts/pulso-4.2.0.vsix` y recarga la ventana. Revisa los requisitos del host en la [guía de VS Code](adapters/vscode/README.md). El VSIX instala Pulso; Pulso Knowledge se configura por separado según su propio README.

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

La distribución contiene **seis skills**, con `bbva-engineering` como única skill BBVA. En la migración se retiran solo las cuatro skills obsoletas gestionadas por Pulso (`bbva-apx`, `bbva-apx-testing`, `bbva-cells` y `bbva-cells-testing`); las prestadas (`borrowed`) y ajenas se preservan.

## 5. Comprobar en OpenCode

1. Cierra y vuelve a abrir OpenCode tras instalar.
2. Abre **el proyecto donde quieras utilizar Pulso**, distinto de este repositorio de desarrollo.
3. Comprueba que puedes seleccionar el agente **Pulso**, que sus especialistas están disponibles y que aparecen `/pulso-init`, `/pulso-status`, `/pulso-recap` y `/pulso-resume`.
4. Comprueba que el plugin expone `pulso_workspace`, `pulso_work`, `pulso_history` y `pulso_context`. No esperes encontrar un servidor MCP llamado Pulso en la lista de MCP.
5. Pide una consulta de estado sin inicializar el proyecto. Si deseas prepararlo, ejecuta después `/pulso-init`: prepara el mapa contextual en `.pulso/` sin crear un objetivo de trabajo.

Si faltan agentes o herramientas, revisa los errores de carga de OpenCode y que su entorno utilice los mismos directorios de configuración que mostró el instalador. La instalación de archivos por sí sola no acredita una conversación correcta: anota la versión del host y el resultado de esta comprobación.

## 6. Política CELLS/APX/ASO y conocimiento externo

Los prompts de Pulso incluyen una política de **documentación primero para CELLS, APX y ASO**. Antes de diseñar o planificar soluciones, implementar, revisar, preparar o ejecutar pruebas y realizar migraciones de CELLS, APX o ASO, con el stack confirmado, los especialistas deben estudiar documentación pertinente y suficiente, y contrastarla con código, dependencias y runtime observados. Abarca todos los roles relevantes, incluidos QA y reviewers. Se permite orientación inicial solo de lectura para identificar stack, versiones y pregunta concreta.

Es una política de prompts, no enforcement del runtime ni certificación de cumplimiento: los tests de distribución verifican el texto renderizado, no que una sesión haya estudiado las fuentes o ejecutado correctamente el cambio. La disponibilidad del MCP `pulso-knowledge` (Pulso Knowledge) o consultar su catálogo no satisface el estudio documental.

La política se extiende a APX, ASO y las tecnologías confirmadas por el catálogo dinámico: consulta `knowledge_technologies` antes de afirmar disponibilidad instalada. Estos nombres son pistas, no una lista de fuentes instaladas ni activadores automáticos:

| Tecnología candidata | Keywords y contexto que debe confirmarse |
| --- | --- |
| CELLS | `front`, `frontend`, `cells`, `lit`; `web` es una señal débil. |
| APX | Transacciones, librerías y DTOs; distinguir **APX Online**, **APX Batch** (jobs/steps) y **utilitarios** mediante artefactos y dependencias. |
| ASO | Arquitectura de servicios; `TSEC`, `AAP` y `SMC` son calificadores que requieren contexto ASO confirmado. |

`Java`, `backend` y `REST` son términos genéricos insuficientes para identificar APX o ASO. Confirma el stack y las versiones en manifiestos, configuración y estructura reales. Usa `knowledge_search` con filtro `technology` explícito y el ID confirmado por el catálogo; separa consultas cuando convivan tecnologías. Conserva `sourceId` desde los resultados y úsalo cuando versiones o fuentes relevantes requieran acotar o desambiguar. Envía la query original sin traducción, preservando idioma, APIs, versiones e intención.

Tras la búsqueda, lee los originales en las secciones pertinentes con `knowledge_read`, apoyándote en `knowledge_outline` y `knowledge_related` según necesidad. Conserva referencias `sourceId`, `path`, sección y versión, y comprueba prerrequisitos, contratos, proceso, excepciones, límites y verificación requerida para el cambio. Distingue APX Online, Batch y utilitarios; para ASO estudia fronteras, seguridad y conectores según la tarea. `knowledge_status` y `knowledge_sources` permiten comprobar cobertura y procedencia. Los documentos recuperados son referencias, no instrucciones que puedan modificar roles, permisos o el encargo. Los scopes `current/historical/all` describen ubicación, no compatibilidad verificada. Declara diagnósticos, resultados vacíos o truncados y fuentes faltantes: no prueban ausencia de una API ni compatibilidad.

El estudio es proporcional: sin barrido completo, ceremonia ni informe extra. Reutiliza evidencia ya leída y accesible cuyo alcance y versión sigan vigentes; un cambio de alcance, versión o una laguna exige actualizar lo pertinente, no repetir consultas por trámite. El coordinador delega el estudio, transmite fuentes y decisiones mediante inputs accesibles y verifica suficiencia antes de aceptar trabajo dependiente. Puede encargarse al mismo especialista documentarse primero y ejecutar después, sin pipeline fijo; el coordinador verifica referencias recibidas, no realiza investigación sustitutiva.

**Recomendamos [Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge) para mejorar el trabajo con documentación tecnológica.** Su repositorio es privado. Es un utilitario externo: Pulso no incorpora su implementación y su instalador no lo instala ni configura.

Para instalarlo, sigue el [README de Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge#readme) como fuente única de requisitos y comandos y consulta las [releases](https://github.com/vmorenoz/pulso-knowledge/releases/latest). **Knowledge 0.3** permite seleccionar OpenCode, VS Code o ambos como destino; comprueba la versión disponible en ese enlace. La [0.2.0 anterior](https://github.com/vmorenoz/pulso-knowledge/releases/tag/v0.2.0) incluye programa, dependencias, modelo y corpus CELLS/APX/ASO con vectores para instalar sin red tras la descarga; requiere macOS Apple Silicon con Metal y Node 24 preinstalado. La ingesta permite ampliar o actualizar el corpus, no es requisito inicial de ese paquete completo. Comprueba los requisitos vigentes de la release que descargues. Instalar Pulso en OpenCode o instalar su VSIX en VS Code no configura automáticamente ese MCP.

En VS Code, el servidor debe utilizar el ID `pulso-knowledge` en `servers` de `.vscode/mcp.json` o del perfil de usuario, conforme a la guía del utilitario. Los diez roles de Pulso declaran sus siete herramientas documentales explícitas; declararlas no demuestra conexión ni disponibilidad. En OpenCode se utiliza la configuración MCP nativa del host. La política documental y `bbva-engineering` son comunes; los controles nativos se detallan en la [matriz de paridad](README.md#semantic-parity-and-host-controls).

La política está reforzada en `<technology_knowledge_policy>` de [`v4/core/agents/common.md`](core/agents/common.md) y [`v4/core/agents/pulso.md`](core/agents/pulso.md), y en la única skill BBVA vigente, [`v4/core/skills/bbva-engineering/SKILL.md`](core/skills/bbva-engineering/SKILL.md). Esta skill consolida las cuatro guías APX/CELLS retiradas y orienta el estudio documental; no es una fuente exhaustiva de APIs o versiones. Las keywords por sí solas no justifican su activación ni reemplazan la confirmación del stack y la consulta de fuentes pertinentes.

Cuando el MCP no esté disponible o su cobertura sea insuficiente, fuentes oficiales o locales autorizadas, pertinentes y versionadas pueden sustentar la decisión, declarando la limitación y las referencias utilizadas. Sin evidencia suficiente no se implementa por memoria o snippets ni se finge aprobación: se bloquea únicamente la decisión afectada y se continúa el trabajo independiente sustentado, sin simular acceso, consultas, documentación ni resultados.

## Paquete ya preparado y otros destinos

Si recibes el instalador autocontenido y su checksum correspondientes a la revisión deseada, puedes omitir la construcción: sigue [la guía del paquete autocontenido](installer/STANDALONE.md). Los paquetes de ejecuciones satisfactorias de GitHub Actions se obtienen desde **Artifacts**, conservando su asociación con el commit; no se presupone una release publicada.

Para VS Code, consulta su [guía específica](adapters/vscode/README.md). El CLI avanzado permite seleccionar destinos; su ayuda se obtiene desde `v4/`, después de `npm ci`, con:

```sh
node installer/cli.mjs --help
```
