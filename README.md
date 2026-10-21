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
- Política de documentación primero para CELLS/APX/ASO reforzada en `<technology_knowledge_policy>` de [`common.md`](v4/core/agents/common.md) y [`pulso.md`](v4/core/agents/pulso.md): catálogo, búsqueda, lectura de originales y contraste de versiones. Permite reutilizar evidencia vigente y bloquea únicamente el trabajo dependiente de información insuficiente. Son instrucciones para los agentes, no consultas forzadas por el runtime.
- Paquetes OpenCode, VSIX e instalador autocontenido regenerados y verificados, manteniendo la versión **4.2.0**. Detalles y límites de verificación en la [guía técnica](v4/README.md#verification-gates).

## Utilitario recomendado: Pulso Knowledge

Para mejorar el trabajo con documentación tecnológica, recomendamos **[Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge)**, repositorio privado que requiere acceso autorizado. Es un utilitario separado: **Pulso no lo incluye, instala ni configura**.

Sigue su [README](https://github.com/vmorenoz/pulso-knowledge#readme) como fuente única de instalación: incluye el conocimiento CELLS/APX/ASO y sus vectores; descarga explícitamente el modelo y configura el MCP en el host donde lo vayas a utilizar. La ingesta sirve para añadir o actualizar conocimiento, no es requisito de la instalación inicial con la receta compatible. Instalar el VSIX de Pulso no instala automáticamente ese MCP en VS Code. Más contexto en la [guía de instalación](v4/INSTALLATION.md#6-política-cellsapxaso-y-conocimiento-externo).

## Versiones anteriores

Los directorios históricos no son entradas de construcción de V4 y se conservan sin cambios:

- [OpenCode V1 anterior](v3-opencode-v1/README.md)
- [Extensión VS Code anterior](v3-vscode/README.md)
- [OpenCode V2 anterior](v3/README.md)
- Referencias históricas: `v1/` y `v2/`
