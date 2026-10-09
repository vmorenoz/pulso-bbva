# Plan · {{work-id}} · {{nombre}}
<!-- template: plan@1.0 -->
Guía para plan inline o documento asignado; tablas/subplanes solo cuando aporten.
Tipo: {{maestro/subplan}} · padre: {{ruta o ninguno}} · base: {{revisión de work y repositorio}}
## Objetivo y alcance
{{Criterios que cubre y exclusiones.}}
## Realidad comprobada
{{Archivos, patrones, comandos y contratos inspeccionados; supuestos por separado.}}
## Estrategia y decisiones
{{Enfoque mínimo suficiente, alternativas importantes y por qué se descartan.}}
## Trabajo propuesto
| ID propuesto/canónico | Entregable | Especialista | Dependencias | Escritura/recursos | Aceptación |
|---|---|---|---|---|---|
| {{T-ID}} | {{resultado}} | {{agente}} | {{IDs}} | {{rutas, puertos, fixtures}} | {{AC-ID}} |
Las tareas son propuestas hasta que Pulso las incorpore a work.json; su estado vive allí.
## Paralelismo y puntos de integración
{{Qué puede coexistir y por qué; qué exige orden; quién integra cada contrato compartido.}}
## Verificación prevista
{{Comportamiento y criterios que demuestra cada comprobación, scope/base/versión, comandos
confirmados y límites. Tests a preparar no ejecutados; pruebas textuales explícitas.
Si aplica Maven, reactor/módulos/perfiles; Git read-only a Executor con cwd, upstream/destino
y frescura remota, sin autorizar fetch o mutaciones por omisión.}}
## Riesgos y reversión
{{Riesgo concreto, señal observable y mitigación. Reversión solo cuando aplique.}}
## Incertidumbres y siguiente decisión
{{Preguntas bloqueantes y evidencia faltante. No convertir cada duda en una fase nueva.}}
