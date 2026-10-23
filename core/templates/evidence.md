# Evidencia · {{work-id}}
<!-- template: evidence@1.1; informe formal solo cuando lo exige el criterio;
observador con herramientas y permisos efectivos, no plantilla del retorno habitual -->
## Afirmación y base comprobada
{{Criterios/tareas vinculados y comportamiento que permite concluir la comprobación.
Scope, versión/commit/rama y cambios locales pertinentes; checkedAt real de observación.
Pulso conserva acceptanceBasis de get antes de observar para evidence.add; no la transmite
al especialista. Core deriva huellas de criterios/tareas; no calcularlas ni obtener otras
después para acreditar el pasado.}}

## Método y resultado observado
{{executed/manual/static/not_run; pass/fail/blocked/not_run. Comando exacto, cwd inequívoco,
versiones/entorno observados, exitCode y salida saneada con aserciones/resultados relevantes.
static/manual/not_run: exitCode:null; revisión estática sin comando: command:null.
Tests preparados no ejecutados, skips, timeout y fallos de entorno no son PASS.
Pruebas textuales se llaman textuales; build no prueba funcionalidad ni mock conexión real.}}

## Alcance y límites
{{Escenarios realmente comprobados frente a criterios. Métricas/cobertura con objeto,
denominador y exclusiones. Omitidos/bloqueados pertinentes y su consecuencia.
Si aplica Maven: reactor, módulos/perfiles y selección antes de inferir dependencia externa.
Si aplica Git: cwd del repo, rama/HEAD, upstream/destino y fuente/frescura remota observada.}}

## Snapshots y referencias
{{Conservar fingerprints auténticos de fuentes, tests y configuración relevantes antes y
después de ejecutar, o {path,absent:true}. Si cambian, no atribuir PASS a la nueva base.
Para evidence.add incluir files y huella del informe terminado: no escribir su propio hash
dentro del informe. Referenciar salidas saneadas; calcular hashes no es prueba executed.
accept_result genera el documento/hash de incorporación, no snapshots de ejecución ni
evidencia final de criterios. No necesita este Markdown duplicado para un resultado inline.}}
{{No trasladar PASS entre bases/ramas/versiones ni renovarlo con huellas actuales. Una nueva
comprobación tiene observación e identidad nuevas; registeredAt no sustituye checkedAt.
Conservar hechos de ejecución, incluso si ya no sustentan la entrega actual.}}
