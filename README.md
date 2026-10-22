# Pulso

<p align="center"><img src="v4/adapters/vscode/assets/pulso.svg" alt="Pulso: robot con antena y ondas de sonar" width="192" height="192"></p>

**Pulso, Asistente IA para desarrollo** coordina especialistas para entender, planificar, implementar y verificar cambios de software, con artefactos locales por proyecto.

## Pulso V4

V4 mantiene un núcleo común y entrega instalaciones nativas independientes:

- [OpenCode V1: instalación y uso](v4/adapters/opencode/README.md)
- [VS Code + GitHub Copilot: instalación y uso](v4/adapters/vscode/README.md)
- [Código, construcción y verificación técnica](v4/README.md)
- [Instalador global con selección de harness](v4/installer/README.md)
- [Instalar en otro equipo desde main o un commit](v4/INSTALLATION.md)
- [Changelog desde V1](CHANGELOG.md)

Para instalar **Pulso en OpenCode**, con Node.js 22+, OpenCode y `git`/`tar` de macOS/Linux disponibles:

```sh
git clone https://github.com/vmorenoz/pulso-bbva.git
cd pulso-bbva
node install.mjs --dry-run
node install.mjs
```

Usa el paquete ya preparado en `v4/artifacts/`, verifica su SHA-256 y solicita confirmación. No requiere npm, instalar dependencias ni compilar; utiliza Node.js 22 o posterior y `tar` de macOS/Linux. Puedes previsualizar con `node install.mjs --dry-run` o actualizar archivos reconocidos de Pulso con `node install.mjs --conflict backup-replace`. Reinicia OpenCode tras instalar.

Para **VS Code + GitHub Copilot**, instala `v4/artifacts/pulso-4.2.0.vsix` mediante «Extensions: Install from VSIX…» y recarga la ventana. Consulta los requisitos en la [guía de VS Code](v4/adapters/vscode/README.md).

Los builds de GitHub Actions tras un push a `main` proporcionan los paquetes en **Artifacts** de la ejecución: descarga el correspondiente a tu host y extrae el contenedor de descarga. Para OpenCode sin checkout, sigue la [guía del instalador autocontenido](v4/installer/STANDALONE.md). Son artefactos de build, no una release publicada.

El empaquetado corresponde a los desarrolladores: consulta [construcción y verificación técnica](v4/README.md). El instalador global avanzado permite elegir uno o ambos destinos.

## Cambios actuales

Pulso aporta un coordinador, nueve especialistas, **seis skills** y cuatro herramientas semánticas. Los datos de cada proyecto permanecen en `.pulso/`; `/pulso-init` prepara el mapa contextual sin crear Work ni exigir QA o cierre.

- Una única skill BBVA, [`bbva-engineering`](v4/core/skills/bbva-engineering/SKILL.md), consolida las guías anteriores. La migración retira las cuatro skills APX/CELLS obsoletas solo cuando son gestionadas por Pulso; preserva las prestadas (`borrowed`) y ajenas.
- OpenCode y VS Code comparten roles, prompts, skills y contratos de continuidad. VS Code declara las siete herramientas documentales Knowledge en los diez roles y enlaza las skills pertinentes por rol. La [matriz de paridad semántica y controles del host](v4/README.md#semantic-parity-and-host-controls) distingue instrucciones compartidas de permisos, captura de retornos y capacidades nativas.
- Al cambiar la intención, el coordinador selecciona explícitamente `compatibleDelegationIds`; omitirlos equivale a `[]`. Las cuatro skills operativas llevan instrucciones de coordinación; las auxiliares conservan su alcance por rol.
- Política de documentación primero para CELLS/APX/ASO y las tecnologías confirmadas del catálogo en `<technology_knowledge_policy>` de [`common.md`](v4/core/agents/common.md) y [`pulso.md`](v4/core/agents/pulso.md): catálogo, búsqueda, lectura de originales y contraste de versiones. Permite reutilizar evidencia vigente y bloquea únicamente el trabajo dependiente de información insuficiente. Son instrucciones para los agentes, no consultas forzadas por el runtime.
- Recuperación explícita de continuidad desde otra sesión mediante inspección y CAS, sin reconstruir el encargo original. En OpenCode, la detección automática de fallos verificables de padre o hijo se limita al primario y proyecto actuales: una selección ambigua, pausa, cancelación o actividad nativa impide la adopción automática. No roba locks ni certifica cese físico; conserva las reservas y recupera retornos antes de repetir trabajo.
- Los especialistas de OpenCode pueden consultar su asignación, registrar progreso no terminal y el output autorizado. La identidad nativa y el alcance se comprueban en runtime; recibos durables evitan repetir acciones. Aceptación y cierre global siguen en el coordinador. VS Code no recibe estas capacidades sin una prueba nativa equivalente.
- Un reporte del usuario sobre CI, workflow o ambientes previos puede incorporarse como evidencia ordinaria manual, sin fingir acceso ni ejecución. `supersede_evidence` sustituye solo los vínculos cubiertos de un intento `not_run/blocked`, conservando la observación original y los pendientes ajenos; no elimina fallos reales ni rebaja requisitos.
- El prompting distingue resultados acordados de métodos de comprobación, guía la reconciliación de tareas/bloqueos y el cierre por readiness, nunca por inactividad. Se consolidaron repeticiones de Knowledge, QA y publicación; las recetas específicas de SQL se reemplazaron por un método general de investigación y verificación.
- Las pruebas comprueban contratos y casos de recuperación, permisos, concurrencia y evidencia. El workflow existente incluye ahora la suite completa, smokes del núcleo e instalación temporal, no solo pruebas del instalador. Véanse [cobertura y límites](v4/tests/README.md).
- Paquetes OpenCode, VSIX e instalador autocontenido regenerados y verificados, manteniendo la versión **4.2.0**. Detalles y límites de verificación en la [guía técnica](v4/README.md#verification-gates).

## Utilitario recomendado: Pulso Knowledge

Para mejorar el trabajo con documentación tecnológica, recomendamos **[Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge)**, repositorio privado que requiere acceso autorizado. Es un utilitario separado: **Pulso no lo incluye, instala ni configura**.

Sigue su [README](https://github.com/vmorenoz/pulso-knowledge#readme) como fuente única de instalación y consulta las [releases](https://github.com/vmorenoz/pulso-knowledge/releases/latest). **Knowledge 0.3** permite seleccionar OpenCode, VS Code o ambos como destino; comprueba la versión disponible en ese enlace. La [0.2.0 anterior](https://github.com/vmorenoz/pulso-knowledge/releases/tag/v0.2.0) incluye programa, dependencias, modelo y conocimiento CELLS/APX/ASO con sus vectores: tras descargarla, se instala sin red y requiere macOS Apple Silicon con Metal y Node 24 preinstalado. La ingesta sirve para añadir o actualizar conocimiento, no es requisito de esa instalación inicial. Instalar el VSIX de Pulso no instala automáticamente ese MCP en VS Code. Más contexto en la [guía de instalación](v4/INSTALLATION.md#6-política-cellsapxaso-y-conocimiento-externo).

## Versiones anteriores

Los directorios históricos no son entradas de construcción de V4 y se conservan sin cambios:

- [OpenCode V1 anterior](v3-opencode-v1/README.md)
- [Extensión VS Code anterior](v3-vscode/README.md)
- [OpenCode V2 anterior](v3/README.md)
- Referencias históricas: `v1/` y `v2/`
