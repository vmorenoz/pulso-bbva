# Implementación · {{objetivo breve}}
<!-- template: implementation@1.1 -->
Guía para documento expresamente solicitado; omitir apartados/tablas sin contenido útil.
El retorno habitual en conversación usa las tres secciones de result.md, sin crear este archivo.
## Encargo y base
{{Objetivo, criterios y scope recibidos; repo/cwd efectivos y base técnica observada.
Identidad/revisión/basis internos los conserva Pulso, no son campos que solicitar al especialista.}}
## Cambios realizados
{{Archivo/símbolo y razón del cambio; preservar cambios preexistentes, patrones y controles.
En inspección Git sin edits, indicar conclusión, rama/HEAD, upstream/destino y frescura remota.}}
## Comprobaciones
| Comprobación | Comando/directorio | Resultado observado | Evidencia |
|---|---|---|---|
| {{nombre}} | {{comando o inspección}} | {{pass/fail/blocked/not_run}} | {{ruta}} |
{{Precisar comportamiento, scope/base/versión y salida real. Tests textuales nombrados como
tales, métricas con denominador; no trasladar PASS entre ramas. En Maven comprobar reactor
y módulos/perfiles antes de diagnosticar dependencia externa.}}
## Integración y compatibilidad
{{Contratos conservados, cambios coordinados y riesgos pendientes.}}
## Pendientes y limitaciones
{{Sin afirmar pruebas no ejecutadas ni atribuirse cambios ajenos. Bloqueo de rol/operación
concreto, información nueva para reintento; sin limpieza ni expansión automática de scope.}}
