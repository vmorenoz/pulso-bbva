# Pulso 4.2.0 — instalador autocontenido para OpenCode

Requisitos: OpenCode ya instalado, Node.js **22 o posterior**, y `tar` para extraer el archivo. No necesitas el repositorio, npm, instalar dependencias ni compilar. El archivo incluye el runtime OpenCode generado y el instalador con `jsonc-parser@3.3.1` (licencia MIT incluida en `installer/node_modules/jsonc-parser/LICENSE.md`).

Si tienes el repositorio y el paquete ya preparado en `v4/artifacts`, basta **`node install.mjs` desde la raíz o desde `v4`**: verifica SHA-256 y pide confirmación sin instalar dependencias ni compilar.

Para instalar sin checkout, descarga el artefacto del instalador desde **Artifacts** en la ejecución de GitHub Actions correspondiente al push a `main`. Extrae primero el contenedor de descarga para obtener el `.tar.gz` y su `.sha256`. Un artefacto de build no implica una release publicada; conserva la referencia de la ejecución y el commit.

Desde la carpeta donde descargaste el archivo y su `.sha256`:

```sh
shasum -a 256 -c pulso-opencode-installer-4.2.0.tar.gz.sha256
tar -xzf pulso-opencode-installer-4.2.0.tar.gz
cd pulso-opencode-installer-4.2.0
node install.mjs --dry-run
node install.mjs --yes
```

En Linux también puedes verificar con `sha256sum -c`. `CONTENTS.sha256` contiene las huellas de los archivos extraídos.

El primer comando de instalación muestra el plan sin escribir. El segundo aplica el plan al usuario actual. También puedes ejecutar `node install.mjs` para confirmar interactivamente. Reinicia OpenCode después de instalar.

Se registra el plugin en la configuración global OpenCode y se copian agentes, skills y comandos. El runtime queda en `~/.pulso/runtimes/opencode-v1`; después puedes borrar la carpeta extraída. Se respetan `XDG_CONFIG_HOME` y `OPENCODE_CONFIG_DIR` dentro del home. Consulta `installer/README.md` para conflictos y copias de seguridad; `--yes` no autoriza sobrescribir archivos ajenos. Si hay recursos gestionados modificados, revisa el plan con `node install.mjs --conflict backup-replace --dry-run` antes de aplicar esa opción.

La instalación elimina `model` y `variant` de los agentes Pulso actuales y legacy reconocidos en ambos archivos globales `opencode.json` y `opencode.jsonc`, incluso si coexisten. Conserva el modelo global, los demás agentes, comentarios y permisos; respalda las configuraciones modificadas. El plan muestra estas acciones como `agent-presets`. Las configuraciones de proyecto y el override explícito `OPENCODE_CONFIG` quedan fuera de esta limpieza global y pueden seguir aportando presets.

Este archivo distribuye la integración Pulso para OpenCode; OpenCode y Node se proporcionan por separado. La instalación verificada en un fixture no equivale a una conversación real en OpenCode.

## Generación para mantenedores

Con `dist/opencode` ya generado y las dependencias de desarrollo disponibles, desde `v4`:

```sh
node scripts/package-installer.mjs
node --test tests/installer/standalone.test.mjs
```

El empaquetador reutiliza el runtime existente y comprueba que no cambie durante la copia. Produce exclusivamente `artifacts/pulso-opencode-installer-4.2.0.tar.gz` y su `.sha256`.
