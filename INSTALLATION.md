# Instalar Pulso

Pulso **0.1.0** admite únicamente **OpenCode 2.1.2**. Requiere Node.js 22 o posterior y `tar` en macOS/Linux. Instala y configura el host según su [documentación oficial v2](https://dev.opencode.ai/v2/docs/). La instalación de Pulso no instala OpenCode, elige un proveedor, añade credenciales ni autoriza consumos.

## Construir desde una revisión concreta

Usa un checkout de la revisión que quieras verificar y conserva su SHA. Todos los comandos siguientes se ejecutan **desde la raíz**, sin `cd v4`:

```sh
git rev-parse HEAD
node --version
opencode --version
npm ci --ignore-scripts --no-audit --no-fund
npm run verify
npm test
npm run package:opencode
node scripts/package-installer.mjs
npm run verify:packages
npm run verify:installer-staged
```

Las salidas son `artifacts/pulso-opencode-0.1.0.tar.gz` y `artifacts/pulso-opencode-installer-0.1.0.tar.gz`, cada una con su `.sha256`. Un número de versión coincidente no prueba que un archivo corresponda al checkout actual: utiliza el inventario y las verificaciones del mismo build.

## Revisar e instalar

El archivo de **installer** incluye el runtime y no necesita npm en el equipo de destino. Descarga juntos el archivo y su checksum, verifica la huella, extrae en un directorio nuevo y revisa el plan:

```sh
# macOS: shasum -a 256 -c pulso-opencode-installer-0.1.0.tar.gz.sha256
sha256sum -c pulso-opencode-installer-0.1.0.tar.gz.sha256
mkdir pulso-installer
tar -xzf pulso-opencode-installer-0.1.0.tar.gz -C pulso-installer --strip-components=1
cd pulso-installer
node install.mjs --dry-run
node install.mjs
```

Desde un checkout con el archivo generado, también puedes ejecutar `node install.mjs --dry-run` y después `node install.mjs`. Confirma sólo tras revisar rutas, cambios y backups. `--yes` confirma el plan en uso no interactivo; no permite sobrescribir recursos ajenos. Consulta `--help` para las opciones admitidas.

El instalador utiliza el directorio global XDG de OpenCode y, cuando existe, `OPENCODE_CONFIG_DIR` dentro de las raíces admitidas. Conserva `OPENCODE_CONFIG` como override de archivo, no como destino de assets. Registra un **directorio de paquete** en `plugins`, no el antiguo archivo de plugin v1. Los agentes, commands y skills usan sus directorios plurales nativos.

Los recursos administrados y modificados exigen `--conflict backup-replace`; primero revisa el backup y el plan. La migración retira sólo registros y archivos OpenCode cuya propiedad está reconocida. Datos del proyecto, recursos prestados, archivos ajenos y configuraciones no relacionadas permanecen protegidos. No reutilices configuración v2 con un host v1.

## Comprobar en el host

Reinicia OpenCode y verifica su identidad/versiones, el plugin Pulso activo, los diez agentes, seis skills y cuatro herramientas. En un proyecto de prueba, comprueba lectura, denegación de permisos, cancelación, delegación foreground/background, recuperación tras reinicio/compactación y ausencia de efectos duplicados. Un lanzamiento background no es un resultado terminal.

La comprobación conversacional necesita un proveedor configurado por el usuario y puede tener costes; no queda autorizada por instalar Pulso. Los tests con fixtures y la extracción de paquetes no sustituyen esa aceptación. Si falta identidad, correlación o evidencia nativa, conserva los IDs y utiliza inspección/reconciliación explícita: no repitas el trabajo ni amplíes permisos para ocultar el fallo.

[Pulso Knowledge](https://github.com/vmorenoz/pulso-knowledge) se instala y configura por separado como MCP opcional. Este procedimiento no modifica su repositorio ni su corpus.

## Servicio nativo

Para un servidor OpenCode `--standalone` ya ejecutándose, configura las opciones del paquete Pulso con `serviceUrl:"http://127.0.0.1:PORT"`, usando el puerto observado del mismo host. El origen debe ser local y no puede contener credenciales, query ni rutas. Un servicio protegido admite `servicePassword` como opción privada del operador, no como argumento de herramienta. En modo administrado se consulta el registro del servicio existente 2.1.2 sin iniciarlo ni modificarlo.

Sin un servicio verificable, o si el historial completo supera el límite de 500 mensajes, las operaciones dependientes del replay fallan de forma segura. El plugin nunca arranca otro servicio ni toma el contexto compactado como historial completo. Los tests con dobles no equivalen a aceptación conversacional real.
