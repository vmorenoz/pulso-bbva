# Desarrollo de Pulso

Este repositorio construye Pulso; no utiliza Pulso para gestionar su propio desarrollo.

- Para esta migración autorizada a OpenCode v2 se permite desarrollar con Codex y sus herramientas/agentes nativos. El producto resultante usa exclusivamente la API nativa v2 de OpenCode.
- No invoques agentes `pulso-*`, skills `pulso-*` ni herramientas `pulso_*` para orquestar este repositorio o registrar el trabajo de desarrollo.
- Las pruebas pueden importar y ejecutar el código de Pulso en fixtures aislados: esto verifica el producto, no activa su orquestación sobre este repositorio.
- Delega trabajo independiente mediante agentes nativos del entorno autorizado, con ámbitos de escritura delimitados.
- El núcleo canónico está en `core` y la única integración nativa en `harness`. El nombre público es **Pulso**, versión `0.1.*` hasta nuevo aviso.
- Utiliza las herramientas nativas de búsqueda y lectura; el repositorio ya no conserva índices históricos de CodeGraph.
- No inicialices ni modifiques `.pulso/` de este repositorio para organizar el desarrollo.
