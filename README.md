# Pulso

<p align="center"><img src="v4/adapters/vscode/assets/pulso.svg" alt="Pulso: robot con antena y ondas de sonar" width="192" height="192"></p>

**Pulso, Asistente IA para desarrollo** coordina especialistas para entender, planificar, implementar y verificar cambios de software, con artefactos locales por proyecto.

## Pulso V4

V4 mantiene un núcleo común y entrega instalaciones nativas independientes:

- [OpenCode V1: instalación y uso](v4/adapters/opencode/README.md)
- [VS Code + GitHub Copilot: instalación y uso](v4/adapters/vscode/README.md)
- [Código, construcción y verificación técnica](v4/README.md)
- [Instalador global con selección de harness](v4/installer/README.md)
- [Changelog desde V1](CHANGELOG.md)
- [Continuidad multisesión de 4.2.0 y verificaciones](v4/ENTREGA-4.2.0.md)

Desde `v4/`, instala las dependencias de desarrollo con `npm ci`, ejecuta `npm run verify` y genera el paquete elegido con `npm run package:opencode` o `npm run package:vscode`. El instalador global permite elegir uno o ambos destinos y previsualizar los cambios antes de aplicarlos.

Pulso aporta un coordinador, nueve especialistas, diez skills y cuatro herramientas semánticas. Los datos de cada proyecto permanecen en `.pulso/`; las cinco skills BBVA se conservan sin modificaciones.

## Versiones anteriores

Los directorios históricos no son entradas de construcción de V4 y se conservan sin cambios:

- [OpenCode V1 anterior](v3-opencode-v1/README.md)
- [Extensión VS Code anterior](v3-vscode/README.md)
- [OpenCode V2 anterior](v3/README.md)
- Referencias históricas: `v1/` y `v2/`
