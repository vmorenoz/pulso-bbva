# Pulso 0.1.0 · instalador autocontenido

Requisitos: **OpenCode 2.1.2**, Node.js **22+** y `tar` en macOS/Linux. El archivo incluye Pulso para OpenCode v2 y `jsonc-parser@3.3.1`, con licencia MIT en `installer/node_modules/jsonc-parser/LICENSE.md`. Configura el plugin: no instala el ejecutable de OpenCode, y no necesita npm, repositorio o compilación.

Si tienes el repositorio y el paquete preparado en `artifacts`, ejecuta `node install.mjs --dry-run` desde la raíz; después `node install.mjs` para confirmar interactivamente.

Sin checkout, conserva juntos el archivo y su checksum:

```sh
shasum -a 256 -c pulso-opencode-installer-0.1.0.tar.gz.sha256
tar -xzf pulso-opencode-installer-0.1.0.tar.gz
cd pulso-opencode-installer-0.1.0
node install.mjs --dry-run
node install.mjs
```

En Linux también puedes usar `sha256sum -c`. `CONTENTS.sha256` registra las huellas de los archivos extraídos. `--yes` sustituye la confirmación interactiva, no las protecciones de propiedad. Reinicia OpenCode después de instalar. Este paquete sólo configura OpenCode; no admite selección de otro host.

El plugin se registra como directorio en `plugins`; el runtime queda en `~/.pulso/runtimes/opencode-v2`, con inventario independiente en `~/.pulso/installations/opencode-v2.json`. OpenCode utiliza `~/.config/opencode/opencode.json(c)` y `OPENCODE_CONFIG_DIR`, respetando `XDG_CONFIG_HOME` dentro del home. El instalador valida el contrato nativo 2.1.2 y rechaza paquetes anteriores.

Los recursos anteriores de OpenCode se migran únicamente con propiedad comprobada. Los archivos desconocidos, prestados, de otros hosts y los datos de proyectos se conservan. Los recursos gestionados modificados requieren revisar `--conflict backup-replace --dry-run` antes de confirmar esa opción. Una inscripción V1 prestada bloquea la migración; no se modifica silenciosamente.

La limpieza de presets elimina `model`/`variant` sólo de IDs Pulso exactos en `agent`/`agents` de los archivos globales `opencode.json(c)`. Conserva modelos globales, permisos, comentarios y configuración ajena; respalda los originales. No modifica overrides `OPENCODE_CONFIG` ni configuraciones de proyecto.

Consulta `installer/README.md` para propiedad, rollback y límites. La instalación en un fixture o la carga del plugin con dobles no acredita una conversación real en OpenCode.

## Generación para mantenedores

Desde la raíz, con el runtime generado:

```sh
npm run build:opencode
npm run package:installer
PULSO_INSTALLER_ARCHIVE="$PWD/artifacts/pulso-opencode-installer-0.1.0.tar.gz" node --test tests/installer/*.test.mjs
npm run verify:installer-staged
```

El empaquetador verifica el runtime y su inventario, evita copiar un stage cambiante y produce exclusivamente el archivo del instalador y su SHA-256. Esto no publica una release ni instala globalmente.
