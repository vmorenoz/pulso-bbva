# Desarrollo de Pulso

Este repositorio construye Pulso; no utiliza Pulso para gestionar su propio desarrollo.

- Utiliza únicamente agentes, skills y herramientas nativas de OpenCode durante el desarrollo.
- No invoques agentes `pulso-*`, skills `pulso-*` ni herramientas `pulso_*` para orquestar este repositorio o registrar el trabajo de desarrollo.
- Las pruebas pueden importar y ejecutar el código de Pulso en fixtures aislados: esto verifica el producto, no activa su orquestación sobre este repositorio.
- Delega trabajo independiente mediante agentes nativos de OpenCode, con ámbitos de escritura delimitados.
- La distribución VS Code se desarrolla en `v3-vscode`, derivada exclusivamente de `v3-opencode-v1`. Su nombre público es **Pulso**.
- No uses `v1`, `v2` o `v3` como base de esta adaptación.
- Consulta CodeGraph primero para explorar código; si no cubre los archivos solicitados, utiliza herramientas nativas de búsqueda y lectura.
- No inicialices ni modifiques `.pulso/` de este repositorio para organizar el desarrollo.
