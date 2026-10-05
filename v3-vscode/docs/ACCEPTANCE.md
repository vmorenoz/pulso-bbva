# Verificación de integración 3.1.4 — 5 de octubre de 2026

Base: main 72e7cd1 (PR #11 integrado). Se conservan los 110 archivos del árbol OpenCode, incluidos las skills BBVA, con hashes Git idénticos. No se modifica su código ni sus tests.

- OpenCode: build y check PASS; 204/204 tests aislados PASS con Node 24.19.0 y el paquete oficial OpenCode 1.18.2 existente en el entorno.
- Core VS Code ensamblado: 149 tests canónicos PASS, además de regresiones de recuperación/paginación específicas.
- VS Code: build/check PASS, 66 recursos y 79/79 tests offline PASS, sin omitidos. Incluye memoria revisionada, evidencia observada, validate_result contra catálogo empaquetado, rechazo de complete_map y protección de binding.
- Los contratos planos y la API de registro/confirmación se contrastaron con la [documentación oficial](https://code.visualstudio.com/api/extension-guides/ai/tools).
- Extension Host real, conversaciones Copilot y Local: NOT_RUN para 3.1.4. Los resultados siguientes son históricos y no acreditan esta versión. El recorrido breve vigente está en [LIVE-CHECK](LIVE-CHECK.md).

## Registros históricos (3.1.1)

# Aceptación de Pulso

Las verificaciones offline y del Extension Host real para **Pulso 3.1.1** se ejecutaron el **2026-10-05** con selección de proyecto por ventana y dos comandos. **No hay PASS implícitos de conversación.** El entorno instalado de referencia es VS Code 1.139.1, macOS arm64 y GitHub Copilot builtin 0.67.0. La aceptación de conversaciones completas en Copilot / Agent Host y Local permanece en **LIVE NOT_RUN**.

## Matriz de ejecución

| ID | Ámbito | Ejecución / criterio | Estado | Evidencia |
| --- | --- | --- | --- | --- |
| O1 | Offline | `npm ci --ignore-scripts` | PASS | Node 24.18.0, npm 11.16.0; 115 paquetes; audit sin vulnerabilidades |
| O2 | Offline | `npm run build` | PASS | 64 recursos, provenance, 4 tools, 10 agentes y 10 skills |
| O3 | Offline | `npm run verify` | PASS | Check de recursos/referencias/sintaxis y 54 tests; sin omitidos |
| O4 | Offline | Empaquetado con `scripts/package.mjs`, después de verify | PASS | VSIX local con 74 archivos; checksum adyacente `dist/pulso-3.1.1.vsix.sha256` |
| O5 | Offline | `npm run verify` en `v3-opencode-v1` | PASS | 144 tests; sin omitidos; memoria compatible e inputs validados |
| O6 | Offline | Continuidad entre core fuente y core empaquetado | PASS | `tests/continuity.test.mjs`: 2 tests con prioridades urgent y critical, revisión obsoleta, ciclos e historial |
| E1 | Extension Host real | `npm run test:host` (run inicial) | PASS histórico | VS Code 1.139.1: activación, 4 tools en `vscode.lm.tools`, 1 comando (`pulso.openChat`) y 10+10 recursos existentes; sin inicializar workspace |
| E2 | Extension Host real | `npm run test:host` con Pulso 3.1.1 | PASS | 4 tools y 2 comandos; 3 consultas reales de solo lectura sin selector en carpeta única y sin inicializar `.pulso` |
| H1 | Copilot / Agent Host | Instalación, descubrimiento, selección, tools, delegación y persistencia según pasos inferiores | LIVE NOT_RUN | Pendiente |
| L1 | Local | Repetir el mismo recorrido completo en sesión Local | LIVE NOT_RUN | Pendiente |
| R1 | Ambos destinos | Cancelación, carpeta única, multi-root, worktree y aislamiento | LIVE NOT_RUN | Pendiente |
| T1 | Ambos destinos | Intentos sin observer live; telemetría heredada sin afirmar vida ni modificar Work | LIVE NOT_RUN | Pendiente |

El responsable de la ejecución debe coordinar el run offline y las sesiones reales, asignar identificador, fecha y ejecutor, y registrar cada resultado como PASS, FAIL o NOT_RUN. Una ausencia de capacidades en el harness se registra como fallo o bloqueo concreto, no como soporte comprobado. Un PASS offline no cambia H1 ni L1.

### Alcance de E1

El smoke usa el ejecutable instalado, sin mocks ni descarga de VS Code. Crea workspace, extensiones y user data temporales; la desactivación de Workspace Trust se limita a ese proceso de prueba y no modifica configuración del usuario. El recibo real indicó `status=PASS`, `vscodeVersion=1.139.1`, `extensionId=pulso-local.pulso`, `toolInvocations=0`, `liveChat=false`, `delegation=false`; exit code 0. El fixture se limpia al terminar. Esto acredita registro y activación, no llamadas de modelo, descubrimiento efectivo en el selector de cada harness ni aceptación del flujo conversacional.

E1 se conserva como registro histórico. E2 produjo un nuevo recibo con exit code 0: `status=PASS`, `vscodeVersion=1.139.1`, `commands=[pulso.openChat,pulso.selectProject]`, `toolInvocations=3`, `liveChat=false`, `delegation=false`. Se invocaron mediante la API pública `vscode.lm.invokeTool` las consultas de estado, historial y contexto de proyecto en una carpeta única; no hubo selector ni escrituras. Los 54 tests offline también verifican cache multi-root, elección concurrente, cambio explícito, cancelación, invalidación y protección de operaciones en curso.

## Run offline

Desde `v3-vscode`, ejecutar y conservar salida y códigos de retorno:

```sh
npm ci
npm run build
npm run verify
npm run test:host
npm run package
```

`npm ci` necesita un lockfile coherente; si falta, registrar el bloqueo antes de continuar. Build genera `resources/` y actualiza las contribuciones del manifiesto. Verify repite build y ejecuta check y tests; package repite verify. Revisar el inventario del VSIX, incluidos documentación, licencia, core, agentes, skills, templates, schemas y provenance. Comprobar los hashes de provenance, las prioridades `low/normal/high/critical` y la conservación de la severidad de resultados.

## Preparación del run LIVE

1. Usar **solo proyectos de prueba aislados**, fuera de este repositorio. No inicializar ni modificar su `.pulso/` para esta aceptación.
2. Preparar carpetas A y B y un worktree de prueba abierto como carpeta. Conservar un inventario inicial de archivos de cada carpeta y de las preferencias de usuario; evitar datos personales en las evidencias.
3. Instalar manualmente `dist/pulso-3.1.1.vsix` desde **Extensions: Install from VSIX…**, o con el CLI instalado y la ruta del VSIX entre comillas. Registrar versión, hash del paquete y cualquier recarga requerida por el host.
4. Registrar versiones reales de VS Code y Copilot, arquitectura, destino/harness, carpetas abiertas y confianza. La extensión no configura settings ni instala componentes automáticamente.

## Recorrido manual por destino

Ejecutar primero en **Copilot / Agent Host** y repetir en **Local**, manteniendo evidencias separadas:

1. **Descubrimiento:** comprobar que aparece **Pulso**, que `/skills` descubre las 10 skills y que están disponibles las cuatro tools. Revisar el catálogo empaquetado de Pulso y nueve especialistas. Registrar cualquier recurso no expuesto por el harness.
2. **Selección manual:** abrir chat con **Pulso: Abrir chat**, seleccionar Pulso y el destino manualmente. Invocar una skill operativa con otro agente y comprobar que pide seleccionar Pulso y se detiene sin tools, delegación ni escrituras.
3. **Consulta inicial:** saludar y usar `/pulso-status` y `/pulso-recap` antes de preparar el proyecto. Verificar que no se crea estado Pulso por esas consultas. Con una única carpeta local, no debe aparecer picker. En multi-root, elegir A una vez y comprobar que las llamadas siguientes conservan `receipt.workspace` sin repetir el picker; llamadas concurrentes deben compartir el picker pendiente. Las aprobaciones normales de VS Code siguen siendo independientes de la selección de proyecto.
4. **Preparación:** con Pulso seleccionado y A como proyecto activo, invocar `/pulso-init` y verificar los recibos y artefactos del proyecto aislado. Comprobar que B y el worktree no reciben metadatos de A.
5. **Objetivo y delegación:** pedir un objetivo pequeño con criterio verificable, por ejemplo crear un documento en un output acotado del fixture. Registrar `workId`, revisión, tareas, alcance delegado, llamada nativa al especialista, resultado y verificación. Confirmar que el especialista no usa tools Pulso ni delega y que sus escrituras respetan su scope.
6. **Ciclo de trabajo:** consultar estado y trabajo, aplicar una actualización con revisión explícita y probar un conflicto de revisión. Cerrar con resumen y evidencia suficiente; consultar `/pulso-recap`. Probar reapertura y `/pulso-resume` sin asumir que se reanuda una sesión nativa anterior.
7. **Aislamiento de raíz:** usar **Pulso: Seleccionar proyecto** (`pulso.selectProject`) para elegir B y después el worktree abierto, y repetir consultas y mutaciones. Los recibos deben conservar cada raíz activa hasta el siguiente cambio. Mover el editor activo a A y enviar una ruta de A en el mensaje: la operación debe seguir vinculada exclusivamente al proyecto activo. Verificar que el binding se comparte entre sesiones de la ventana, sin API de raíz por sesión; usar el comando o una ventana separada para otro proyecto. Ante deriva del recibo respecto al objetivo conservado, detener nuevas delegaciones y consolidaciones sin mezclar trabajos ni resultados.
8. **Cancelación y cambios de workspace:** en multi-root sin binding, cancelar el picker inicial y comprobar ausencia de escrituras. Cancelar **Pulso: Seleccionar proyecto** con binding vigente debe conservar el proyecto anterior sin escrituras. Probar workspace no confiable y sin carpetas locales. Cambiar el listado o las raíces abiertas debe invalidar la selección; al recargar, multi-root elige de nuevo. Retirar o reemplazar una carpeta durante la selección debe rechazar la operación; cambiar el binding o workspace durante una mutación debe detenerla mediante su checker antes de escribir. Un worktree solo es seleccionable si está abierto como carpeta.
9. **Preferencias:** crear una preferencia de usuario de prueba mediante `pulso_context`, comprobar que es visible desde otro proyecto aislado y otra sesión y eliminarla al finalizar. Verificar que el contexto de proyecto sigue aislado. Los tests offline deben usar `homeDir` inyectado; no confundir ese fixture con una preferencia guardada en el HOME real.
10. **Telemetría:** invocar `attempts` y `reconcile_attempts` sin datos heredados y comprobar el resultado vacío. Si se dispone de una fixture de telemetría heredada, comprobar lectura y vida desconocida. Una nueva delegación real no debe presentarse como observada por un hook de esta extensión. Estas acciones no modifican Work ni reanudan agentes.

## Registro de evidencia y cierre

Para cada fila registrar: run ID, fecha, ejecutor, comando o paso, versiones, destino/harness, hash del VSIX, proyecto/worktree elegido, resultado esperado y observado, código de salida cuando aplique, logs/recibos/capturas y diff de archivos. Asociar delegación y trabajo mediante referencias observables; no inferir correlación ni vida de agentes.

Guardar evidencias en el espacio aislado de aceptación. Documentar bloqueos y pasos no ejecutados. El cierre debe indicar por separado resultado offline, Copilot / Agent Host y Local; mantener **LIVE NOT_RUN** en todo destino que no haya completado el recorrido real. Restaurar las preferencias de prueba y conservar los artefactos necesarios para reproducir los resultados.

