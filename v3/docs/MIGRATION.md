# Procedencia y transición desde v2

Únicamente se reutilizaron `bbva-engineering`, `bbva-apx`, `bbva-apx-testing`, `bbva-cells`, `bbva-cells-testing` desde `packages/orchestration/skills` del ZIP `pulso-bbva-v2.1-evolution-r1(1).zip` proporcionado en la Library. Se compararon también con `pulso-bbva-v2-review.zip`; las cinco copias coinciden byte por byte.

Cada carpeta fuente contiene un SKILL.md; no se omitieron recursos anexos de esas carpetas. `bbva-provenance.json` registra archivo fuente, hash del ZIP, ruta interna, tamaño y hash de cada copia. No se redujeron, reescribieron ni «actualizaron» sus reglas como parte de esta entrega.

Todo otro componente de esta entrega fue escrito de cero. No se migran Work System, Capabilities MCP, plugins, state/runtime bindings, SQLite, logs, instalador, prompts ni protocolos anteriores. `pulso-integration-verification` pertenece a Pulso; no se presenta como skill original BBVA.

## Instalar sin colisiones

Probar en un checkout de proyecto limpio respecto de Pulso v2. Mantener las configuraciones legítimas del host. Si `.pulso` ya pertenece a v2, respaldarlo fuera de las rutas de descubrimiento y conservarlo como archivo; no ejecutar comandos de borrado masivo ni desinstalar MCP ajenos. El instalador bloquea esta colisión para que decidas conscientemente.

Agentes antiguos del mismo nombre o skills duplicadas pueden alterar el descubrimiento. El instalador detecta rutas concretas dentro del proyecto; personalizaciones globales deben revisarse desde el runtime. No modifica home ni elimina agentes nativos. No inventa que una lista de disponibles identifica el agente activo.

Para actualizar Pulso: ejecutar de nuevo el instalador. Archivos propios intactos se actualizan; iguales se preservan; modificados manualmente causan conflicto. Guardar modificaciones fuera y reconciliarlas explícitamente. Los trabajos/project/decisions/history no son archivos gestionados y nunca se reemplazan al actualizar.
