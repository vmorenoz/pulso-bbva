# Migración a OpenCode v2 tools

La distribución actual sustituye por completo las adaptaciones anteriores: solo OpenCode v2, plugin de tools y core semántico. Ya no se mantiene CLI de operaciones ni adaptación VS Code.

## Instalación global anterior de Pulso

`install.mjs` reconoce el manifest previo para verificar ownership y hashes. Puede retirar recursos de Pulso registrados e intactos de agentes/comandos legacy, VS Code, skills anteriores y binarios operativos. Un recurso modificado, un manifest inválido o una integración sin propiedad demostrable bloquean la actualización antes de escribir. No se cambia `opencode.json(c)` ni recursos ajenos.

Se exige OpenCode major 2. Si el preflight falla, no se escribe ningún recurso. Resuelve cualquier archivo modificado explícitamente y vuelve a ejecutar el instalador; no borres la configuración de usuario como atajo.

## Datos de proyecto

El instalador no recorre workspaces y no actualiza ni convierte Work/State/History. El plugin usa los formatos canónicos existentes. Si el workspace contiene datos legacy o incompatibles, las tools preservan y reportan el bloqueo; no se hace migración o repair automática.

Los cinco archivos de skills BBVA conservan procedencia y bytes originales según `bbva-provenance.json`.
