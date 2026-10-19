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

Para instalar **OpenCode**, ejecuta el mismo comando desde la raíz del repositorio o desde `v4/`:

```sh
node install.mjs
```

Usa el paquete ya preparado en `v4/artifacts/`, verifica su SHA-256 y solicita confirmación. No requiere npm, instalar dependencias ni compilar; utiliza Node.js 22 o posterior y `tar` de macOS/Linux. Puedes previsualizar con `node install.mjs --dry-run` o actualizar archivos reconocidos de Pulso con `node install.mjs --conflict backup-replace`. Reinicia OpenCode tras instalar.

Para **VS Code**, instala el `.vsix` preparado en `v4/artifacts/` mediante «Extensions: Install from VSIX…».

Los builds de GitHub Actions tras un push a `main` proporcionan los paquetes en **Artifacts** de la ejecución: descarga el correspondiente a tu host y extrae el contenedor de descarga. Para OpenCode sin checkout, sigue la [guía del instalador autocontenido](v4/installer/STANDALONE.md). Son artefactos de build, no una release publicada.

El empaquetado corresponde a los desarrolladores: consulta [construcción y verificación técnica](v4/README.md). El instalador global avanzado permite elegir uno o ambos destinos.

Pulso aporta un coordinador, nueve especialistas, diez skills y cuatro herramientas semánticas. Los datos de cada proyecto permanecen en `.pulso/`; `/pulso-init` prepara el mapa contextual sin crear Work ni exigir QA o cierre. Las cinco skills BBVA se copian sin modificaciones desde la fuente canónica revisada de V4; su [procedencia](v4/scripts/bbva-provenance.md) distingue esa fuente de las versiones históricas.

## Versiones anteriores

Los directorios históricos no son entradas de construcción de V4 y se conservan sin cambios:

- [OpenCode V1 anterior](v3-opencode-v1/README.md)
- [Extensión VS Code anterior](v3-vscode/README.md)
- [OpenCode V2 anterior](v3/README.md)
- Referencias históricas: `v1/` y `v2/`
