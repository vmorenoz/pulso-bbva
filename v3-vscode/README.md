# Pulso

Organiza objetivos, coordina nueve especialistas y conserva el contexto de tu proyecto en VS Code. Incluye diez skills, con prácticas BBVA y verificación de integración.

## Instalar

1. Necesitas VS Code **1.139.1 o posterior**, un proyecto local de confianza y acceso al chat con las capacidades de agentes y herramientas requeridas.
2. Abre la paleta de comandos y elige **Extensions: Install from VSIX…**. Selecciona **pulso-3.1.4.vsix** y recarga la ventana si VS Code lo solicita.
3. En Extensiones, comprueba que Pulso muestra la versión **3.1.4** y su icono.

No necesitas descargar el repositorio ni instalar herramientas de desarrollo. La extensión no cambia tu configuración ni instala otras extensiones. Es una distribución privada; el publisher local no implica publicación en Marketplace.

## Primer uso

1. Abre tu proyecto o worktree. Con una carpeta Pulso la selecciona automáticamente; con varias te pide elegir. **Pulso: Seleccionar proyecto** permite cambiarla.
2. Abre Chat o ejecuta **Pulso: Abrir chat**. Selecciona **Pulso** y el destino **Copilot** o **Local** disponible. El comando no cambia el agente por ti.
3. Pide: «Consulta el estado de este proyecto sin modificarlo». Un saludo o consulta no crea archivos.
4. Usa **/pulso-init** para preparar y mapear el proyecto cuando lo necesites. **/pulso-status** consulta objetivos, **/pulso-recap** resume cierres y **/pulso-resume** retoma el trabajo. Estas skills operativas requieren tener Pulso seleccionado.
5. Revisa las solicitudes de aprobación del host. Los especialistas necesitan las herramientas y permisos disponibles para el encargo.

## Qué conserva

- Objetivos, tareas, criterios, bloqueos, decisiones, evidencias e historial en la carpeta **.pulso** del proyecto.
- Contexto y preferencias del proyecto; las preferencias de usuario se comparten entre proyectos en **~/.pulso/preferences.json**.
- Evidencia histórica cuando un trabajo se reabre. Cambiar la aceptación retira sus validaciones activas y exige comprobarla de nuevo.

Pulso consulta el proyecto antes de modificarlo y utiliza un identificador de selección. Si otra conversación cambia de proyecto, las escrituras con la selección anterior se rechazan. Confirma el destino previsto antes de continuar. Recargar la ventana o cambiar las carpetas invalida esa selección.

## Herramientas

- **pulso_workspace:** preparar, consultar, validar, sincronizar y recuperar el estado explícitamente.
- **pulso_work:** crear, consultar por secciones, actualizar, bloquear, cerrar y reabrir objetivos.
- **pulso_history:** consultar cierres con fechas, ciclos y limitaciones, por páginas.
- **pulso_context:** consultar y guardar contexto, preferencias y aprendizajes.

Las consultas paginadas indican si quedan resultados. Ante un error de persistencia parcial, el recibo indica qué se guardó y cómo recuperar las proyecciones; no repitas la operación a ciegas ni edites los JSON manualmente.

## Límites y resolución de problemas

La selección de proyecto se comparte entre conversaciones de una ventana. Usa ventanas separadas para trabajar simultáneamente en proyectos distintos. Se requiere un workspace confiable y carpetas locales; no se anuncia soporte web ni remoto.

Pulso coordina mediante las capacidades nativas del host. No añade un planificador, no reanuda sesiones de especialistas ni observa delegaciones en vivo. La revisión del resultado delegado contra su encargo y schema es manual. Los permisos de escritura de los especialistas los controla el host; las instrucciones de alcance no son un sandbox.

Si una preferencia global informa que el almacén está ocupado, vuelve a intentarlo al terminar la otra operación. Si el bloqueo persiste tras un cierre inesperado, cierra todas las ventanas de Pulso y pide revisar el bloqueo antes de retirarlo.

Las pruebas automatizadas y el paquete se verifican por separado de una conversación real. **La aceptación real en Copilot y Local está pendiente**: sigue la [prueba breve de uso](docs/LIVE-CHECK.md) para cada destino que utilices.

- [Compatibilidad](docs/COMPATIBILITY.md)
- [Cambios de esta versión](CHANGELOG.md)
- [Documentación para desarrollo](https://github.com/vmorenoz/pulso-bbva/blob/feature/v3-vscode/v3-vscode/docs/BUILD.md)
- [Licencia de distribución privada](LICENSE.md)
