# Evidencia · {{work-id}} · {{evidence-id}}
<!-- template: evidence@1.0 -->
## Afirmación verificada
{{AC-ID y tareas asociadas; qué permite concluir esta evidencia.}}
## Base comprobada
{{Registrar checkedAt (fecha real de observación), commit si existe y cambios locales relevantes.
Antes de comprobar, conservar los fingerprints {path, sha256} de fuentes relevantes, tests, configuración y lockfiles y acceptanceBasis por criterio/tarea obtenido al leer el Work. Para un archivo eliminado: {path, absent: true}.
Después de comprobar, contrastar la misma base de archivos y aceptación. Si cambió, no declarar PASS; repetir la comprobación con un ID nuevo.
Al terminar el informe, incluir también su fingerprint entre files. El core compara las huellas recibidas: no las sustituye por hashes de incorporación.}}
## Método y entorno
{{executed/manual/static/not_run; directorio, comando exacto, versiones observadas y prerrequisitos.}}
## Resultado observado
{{pass/fail/blocked/not_run; checkedAt real, comando, cwd y exitCode cuando es executed. Conservar aquí la salida/report saneada, aserciones y resultados, sin secretos.}}
## Cobertura
{{Positivo, vacío, error, integración y demás escenarios según proyecto.}}
## Omitido o bloqueado
{{Pruebas no ejecutadas, skips, servicios inaccesibles y consecuencias.}}
## Vigencia
{{La aceptación cambiada, el ciclo reabierto o los archivos distintos invalidan el PASS. Hashes prueban correspondencia, no ejecución ni cobertura completa. Una corrección solo puede cambiar summary/editedAt; checkedAt, archivos, base, vínculos, comando y resultado observados son inmutables. Una repetición requiere ID nuevo.}}
## Referencias
{{Informes o salidas saneadas, sin logs indiscriminados.}}
