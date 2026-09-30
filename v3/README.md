# Pulso · inicio diferido y delegado

Pulso es un **Asistente IA para desarrollo** que coordina especialistas nativos de OpenCode y VS Code. Conserva planes y contexto
Markdown, trabajos JSON, un índice del proyecto activo y el historial de cierres en `.pulso/`.
**No ejecuta su propio runtime de agentes.** Mantiene los 10 roles y las cinco skills
BBVA originales, sin nuevas dependencias, perfiles, MCP, scheduler ni base de datos.

## Instalar y comenzar

Requiere Node.js 22+; sin `npm install`. Puede ejecutarse desde cualquier directorio:

```sh
node install.mjs
```

Selecciona con flechas y Enter el runtime: **OpenCode** o
**Visual Studio Code (Copilot)**. La instalación es siempre global.

La opción VS Code utiliza Copilot Agent Host. Después abre el runtime y selecciona
**pulso** como agente principal. Agentes, skills, utilidades, schemas y plantillas se
instalan globalmente; estado, trabajos e historial siguen separados en la `.pulso/`
de cada proyecto.

Para desinstalar, el único selector es Runtime:

```sh
node install.mjs uninstall
```

Se retira únicamente ese runtime de la instalación global. No se recorren proyectos
ni se eliminan sus trabajos. [Detalles](docs/INSTALLER.md).

Un saludo como **«Hola Pulso»** solo recibe un saludo: no inicia herramientas,
lecturas de `.pulso`, preparación o delegación. Puedes dar directamente el primer
encargo real: **«Corrige este problema; el resultado esperado es …»**.

Si falta contexto, Pulso aplica la receta única `skills/pulso-init/SKILL.md`:
Explorador inspecciona compatibilidad; Ejecutor prepara los recursos **solo si faltan**;
Explorador levanta `project.md` **solo si hace falta**. Pulso coordina y consolida
los metadatos del trabajo real. `/pulso-init` permite solicitarlo explícitamente.
No se inicia por una consulta de estado ni se repite un mapeo válido en cada sesión.

Una `.pulso` legacy o incompatible se informa y se conserva; no se mezcla su estado
ni se heredan autorizaciones antiguas. El instalador puede dejar un esqueleto vacío:
esto no equivale a contexto técnico levantado.

## Retomar trabajo

| Necesidad | Acceso nativo | Texto opcional de ejemplo |
|---|---|---|
| Estado global | `/pulso-status` | `solo bloqueos` o un ID de Work |
| Resumen del período | `/pulso-recap` | `últimos 7 días` o `2026-09-01 a 2026-09-29` |
| Continuar un trabajo | `/pulso-resume` | `work-checkout, retoma desde las pruebas` |
| Contexto inicial | `/pulso-init` | `enfoca el contexto en pagos` |

OpenCode recibe comandos generados; VS Code descubre las skills equivalentes. La
lógica vive solo en `skills/pulso-*/SKILL.md`. También puedes conversar normalmente
con Pulso. El texto opcional es lenguaje natural, no flags ni argumentos de shell; si
se omite, el comando usa su comportamiento predeterminado. Un estado guardado es el
último confirmado, no actividad en tiempo real.

## Límites que importan

**Un coordinador por checkout compartido, también durante instalación/actualización.**
Antes de pasar de un runtime a otro, termina la actividad anterior. Los especialistas
pueden trabajar en paralelo con dependencias y recursos compatibles. No hay locking
multiproceso ni sandbox propio; scopes y roles no reemplazan permisos del host.

El instalador reemplaza versiones anteriores **registradas** y elimina sus recursos
obsoletos. Conserva configuración, credenciales, archivos ajenos y datos de trabajo.
Una instalación antigua sin manifiesto reconocido o un archivo editado produce un
error explicativo, no un borrado a ciegas. Se mantiene la resolución canónica de
ancestros y la protección de symlinks dentro de las rutas administradas.

## Qué está comprobado

| Comprobación | Resultado de la entrega |
|---|---|
| Suite de utilidades, composición e instalación global | 94/94 PASS en macOS |
| Preparación de workspace sin instalación local | Comprobada offline |
| Cinco skills BBVA | Bytes preservados según procedencia registrada |
| Saludo e inicialización delegada con OpenCode/Copilot | NOT_RUN |
| macOS y Windows para esta revisión | NOT_RUN |

Los resultados reproducibles se obtienen con `npm run build` y `npm run verify`; logs
e informes generados no se versionan. La receta y los límites del rol son instrucciones
al modelo/runtime, no un control
de ejecución añadido por Pulso. Un PASS de archivos no demuestra obediencia del modelo.

Para desarrollar o verificar: ejecuta `npm run build` para comprobar la composición en
memoria y después `npm run verify`. La instalación no depende de ejecutar `build` y genera
solo los adaptadores seleccionados. No se versionan salidas nativas precompiladas.

[Adaptadores y garantías](docs/RUNTIMES.md) · [Fuentes y build](docs/BUILD.md) ·
[Ejemplos completos](docs/EXAMPLES.md) · [Operaciones](docs/OPERATIONS.md) ·
[Seguridad](docs/SECURITY.md) · [Procedencia BBVA](docs/bbva-provenance.json).
