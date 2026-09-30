# Operación de artefactos

Todos los comandos usan el CLI de la instalación global con `--root /ruta/del/workspace`. Ninguno invoca agentes, ejecuta tests de producto o configura el runtime. Todas las rutas en datos son relativas al proyecto, con `/`, sin `..`, rutas absolutas ni symlinks. `writeScope` es ruta exacta o directorio, **no glob**.

## Crear y actualizar

```sh
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace new DEMO-1 --title 'Validar importe' --objective 'Rechazar importes negativos' --criterion 'Un importe negativo devuelve el error acordado' --verification 'Test de unidad negativo y caso positivo'
```

Pulso lee `.pulso/work/DEMO-1/work.json`, lo clona a `work.next.json`, cambia los campos pertinentes sin incrementar `revision` y guarda:

```sh
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace save .pulso/work/DEMO-1/work.next.json --expected-revision 1
```

La utilidad aumenta revision/updatedAt y sincroniza la entrada global. No cambia objective.id, createdAt ni cycle. Un candidato viejo falla: releer, reconciliar y volver a guardar, no sobrescribir a ciegas. `work.next.json` es temporal; puede eliminarse después de guardar. Los comandos se muestran con textos sintéticos; no insertar datos del usuario en shell sin escape correcto.

Los objetivos se modifican solo por decisión deliberada registrada. El helper valida forma, no puede saber si el humano autorizó el cambio. Tasks aceptan especialista, criterios, dependencias, scopes, recursos y aceptación. No se impone un plan para cada work.

## Evidencia

Usar las plantillas globales `~/.pulso/templates/evidence.md` y `evidence.json`. El JSON de ejemplo incluye hash cero y not_run: **no es evidencia positiva**. Generar huellas reales:

```sh
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace fingerprint src/amount.js tests/amount.test.js package.json
```

Reportar el comando realmente ejecutado, cwd, exitCode, kind/status, checkedAt, criterios y tareas comprobados, base (commit si existe + cambios locales), reporte y fingerprints relevantes. `manual`/`static` no se etiqueta como ejecución; `not_run` nunca aprueba. Los archivos de evidencia anteriores pueden ya no existir en el código actual; los hashes conservan su referencia histórica. Para aceptar una evidencia actual sí deben existir/coincidir.

Cada criterio y tarea done debe referenciar una evidencia positiva que a su vez los nombre. Documentación/decisiones pueden verificarse mediante revisión manual/estática cuando esa sea la aceptación apropiada; no inventar tests de código para trabajo puramente documental.

Una tarea de auditoría puede estar completada con hallazgos funcionales fallidos. Registra evidencia positiva de que la auditoría se realizó para la tarea de auditoría, pero NO la uses para aprobar el criterio de producto que falló. Los estados de encargo, tarea y comportamiento son distintos.

## Cerrar, reparar y reabrir

```sh
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace close DEMO-1 --outcome done --summary 'Validación implementada y comprobada'
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace sync DEMO-1
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace reopen DEMO-1 --reason 'Nuevo caso límite confirmado'
```

Done exige sin bloqueos/decisiones pendientes, tareas terminales y evidencia positiva vigente de todos los criterios/tareas done. Las tareas canceladas necesitan motivo y no sustituyen el cumplimiento del objetivo. Cancelar work requiere resumen/motivo y conserva limitaciones; sus tareas abiertas quedan canceladas con motivo explícito.

Repetir exactamente el mismo close no duplica history. Mismo ID de cierre con contenido distinto falla. Si se interrumpe después de guardar el canónico, `sync` completa historial/índice. Nunca retirar manualmente un work del índice antes de registrar el cierre.

Reopen conserva cierre anterior e incrementa cycle. Reinicia tareas a pending y vacía enlaces de aceptación para revisar antes de continuar; conserva archivos de evidencia. Nuevos evidenceIds deben ser únicos dentro del work; no reemplazar reportes ya usados por cierres previos.

```sh
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace validate
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace validate --fresh
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace repair
```

`validate --fresh` revisa evidencia positiva referenciada por criterios/tareas de trabajos abiertos. Los cierres conservan su validez histórica sobre su base original; no se comparan con código futuro. Reabrir implica reconsiderar la aceptación. Puede fallar tras cambios legítimos: actualizar/complementar evidencia, nunca falsificar hashes. `repair` recorre todos los works solo por solicitud explícita; conserva copia de índice ilegible en `.pulso/recovery/` y falla si canónicos/historial están corruptos. No descarta datos para conseguir PASS.

## Encargo y resultado

Plantillas delegation y result + esquemas. Pulso puede guardar encargo y retorno en su work cuando ayuda a la trazabilidad, no necesariamente cada exploración trivial. Resultado contiene revisión DEL ENCARGO, no la revisión global actual si otros trabajos avanzaron.

```sh
node ~/.pulso/bin/pulso.mjs --root /ruta/del/workspace validate-result --delegation .pulso/work/DEMO-1/assignments/D-1.json --result .pulso/work/DEMO-1/results/D-1.json
```

Comprueba identidad declarada, forma, existencia/rutas declaradas. No certifica ownership nativo, ausencia de cambios no declarados ni aceptación semántica. Pulso debe inspeccionar diff y respuesta real de la llamada.

## Consultas

`status`: un único índice; no verifica vigencia del repo por sí mismo. `history --since`: fecha de cierre, no fecha de cada acción. Para continuar abrir solo el work elegido y contrastar repo. Para informes globales no leer todos los objetivos de nuevo. No prometer una bitácora exhaustiva que no existe.

## Inicializar no es activar

Ver la receta canónica `skills/pulso-init/SKILL.md`, instalada globalmente bajo
`.agents/skills`. Pulso solo coordina: no ejecuta `prepare.mjs`, no hace el
levantamiento técnico ni redacta `project.md`. Conserva sus comandos de metadatos
para el trabajo real después de la preparación. Cuando `/pulso-init` es el objetivo,
crea el Work antes del mapeo con `new ... --compact` y, tras aceptar el resultado del
Explorador, usa `complete-map ID --summary TEXTO [--limitation TEXTO]`. Esa operación
registra el documento, tarea, evidencia y cierre sin candidatos JSON manuales.
`status`/`history` no crean nada si falta estado y no deben dar validez actual a datos
legacy. `repair` no se usa como migración automática.
