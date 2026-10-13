# Desarrollo de Pulso

Este repositorio construye Pulso; no utiliza Pulso para gestionar su propio desarrollo.

- Utiliza únicamente agentes, skills y herramientas nativas de OpenCode durante el desarrollo.
- No invoques agentes `pulso-*`, skills `pulso-*` ni herramientas `pulso_*` para orquestar este repositorio o registrar el trabajo de desarrollo.
- Las pruebas pueden importar y ejecutar el código de Pulso en fixtures aislados: esto verifica el producto, no activa su orquestación sobre este repositorio.
- Delega trabajo independiente mediante agentes nativos de OpenCode, con ámbitos de escritura delimitados.
- El desarrollo actual está en `v4`: núcleo canónico en `v4/core` y adaptadores nativos en `v4/adapters/opencode` y `v4/adapters/vscode`. El nombre público es **Pulso**.
- Las distribuciones anteriores se conservan como histórico. Si se mantiene expresamente `v3-vscode`, su base es exclusivamente `v3-opencode-v1`, nunca `v1`, `v2` o `v3`.
- Consulta CodeGraph primero para explorar código; si no cubre los archivos solicitados, utiliza herramientas nativas de búsqueda y lectura.
- No inicialices ni modifiques `.pulso/` de este repositorio para organizar el desarrollo.
