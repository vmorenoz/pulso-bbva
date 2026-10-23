# Pruebas de Pulso

Ejecuta desde la raíz con Node.js 22 o posterior. Los tests usan workspaces y homes temporales; no instalan en un perfil real ni utilizan credenciales o llamadas de modelo facturables.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm test
npm run test:continuity
npm run package:opencode
node scripts/package-installer.mjs
npm run verify:packages
npm run verify:installer-staged
```

`verify` construye, comprueba el paquete y ejecuta los smokes reales del núcleo; **no sustituye** a `npm test`. La prueba del bootstrap necesita el archivo real del instalador. Para incluir el archivo recién construido:

```sh
export PULSO_INSTALLER_ARCHIVE="$PWD/artifacts/pulso-opencode-installer-$(node -p "JSON.parse(require('node:fs').readFileSync('package.json')).version").tar.gz"
npm test
npm run verify:installer-staged
unset PULSO_INSTALLER_ARCHIVE
```

## Cobertura y límites

- **Núcleo:** identidad, scopes, schemas, revisión concurrente, evidencia, aceptación, cierre/reapertura, migración, persistencia parcial, locks, snapshots, retornos y operaciones idempotentes. Los formatos persistidos anteriores siguen sujetos a sus pruebas; el reinicio de la versión de producto no borra esas garantías.
- **Adaptador OpenCode v2:** registro nativo de cuatro herramientas, inputs JSON Schema, identidad de sesión/mensaje/llamada, permisos y cancelación, autoridad de especialistas, correlación de `subagent`, captura inmediata y background, retorno `running` no terminal, recuperación tras reinicio/compactación y fallos seguros ante información ausente. Los fixtures implementan contratos del tag 2.1.2, no una fachada v1.
- **Distribución:** renderizado de roles/skills, permisos nativos ordenados y `external_directory:ask`, límites de coordinación/especialistas, política Knowledge, integridad exacta BBVA, inventario positivo, paquetes aislados, imports del archivo extraído y reproducibilidad de contenido. Las variantes editoriales y mutaciones negativas protegen las obligaciones sin fingir una evaluación semántica de modelos.
- **Instalación:** configuración JSONC, propiedad/recursos prestados, colisiones, backups, rollback, migración e idempotencia en homes temporales; bootstrap y archivo autocontenido staged. No se escribe configuración global del usuario.
- **Smokes del núcleo:** ejecutan operaciones reales y un proceso Node en un proyecto desechable. Comprueban contratos, captura previa al rechazo, revisiones, retry, evidencia y cierre. No son una conversación nativa ni certifican la conducta de un modelo.

La carga de un plugin, un mock de proveedor local y la aceptación conversacional con un proveedor real son evidencias diferentes. Registra comandos, versión del host, conteos y límites contra la revisión exacta. No reutilices resultados históricos ni describas una prueba no ejecutada como aprobada. La verificación final de la migración se informa junto al commit local y los archivos generados.

## Host nativo real, proveedor local

Tras `npm run build`, ejecuta el smoke opt-in con un binario ya instalado o compilado:

```sh
PULSO_NATIVE_BINARY=/ruta/absoluta/opencode npm run smoke:native
```

El test inicia un servidor propio, HOME/XDG temporales y un proveedor HTTP local con credencial sintética. Comprueba cuatro herramientas, scopes de hijos foreground/background, capturas, denegación/cancelación, reinicio y compactación nativa seguida de replay de mensajes auténticos sin duplicados. No valida la conducta de un LLM ni autenticación/conectividad de proveedores externos. El replay poscompactación lo invoca el driver del test; las decisiones de retoma automática se verifican además con fixtures deterministas.
