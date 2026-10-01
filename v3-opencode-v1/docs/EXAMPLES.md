# Ejemplos completos, no nuevos requisitos de trabajo

Los encargos, IDs y retornos de este documento son **didácticos**. No se han ejecutado
agentes ni creado esas rutas de trabajo. No copiar el ejemplo a state/history ni usarlo
para atribuir una aprobación a BBVA. Solo la comprobación base de la sección de evidencia
se ejecutó realmente en el entorno Linux de preparación del correctivo.

Contexto: `examples/smoke-project/` contiene `src/total.mjs`, un package Node sin
dependencias y tres tests. El ejemplo de cambio exige conservar positivo, vacío y
validaciones existentes, y rechazar importes negativos con `RangeError('NEGATIVE_AMOUNT')`.

## Encargo de revisión (JSON de ejemplo)

```json
{
  "schemaVersion": 1,
  "id": "D-REVIEW-1",
  "workId": "DEMO-NEG",
  "workRevision": 1,
  "taskIds": ["T-REVIEW"],
  "agent": "pulso-code-reviewer",
  "objective": "Contrastar total con AC-NEG: rechazar importes negativos sin alterar casos existentes.",
  "inputs": ["src/total.mjs", "tests/total.test.mjs", "package.json"],
  "template": "templates/review.md",
  "output": ".pulso/work/DEMO-NEG/review.md",
  "writeScope": [".pulso/work/DEMO-NEG/review.md"],
  "resources": [],
  "constraints": ["Solo lectura del producto; escribe únicamente la revisión asignada."],
  "acceptance": ["Identificar la validación faltante con referencia y separar inspección de pruebas ejecutadas."],
  "questions": []
}
```

## Retorno correspondiente (ilustración)

Este retorno solo sería válido tras crear realmente la revisión asignada. `completed`
termina el encargo de revisión, no afirma que la funcionalidad esté completada.

```json
{
  "schemaVersion": 1,
  "delegationId": "D-REVIEW-1",
  "workId": "DEMO-NEG",
  "workRevision": 1,
  "agent": "pulso-code-reviewer",
  "status": "completed",
  "summary": "La inspección detecta que total admite importes finitos negativos y no hay prueba negativa.",
  "artifacts": [".pulso/work/DEMO-NEG/review.md"],
  "changedFiles": [".pulso/work/DEMO-NEG/review.md"],
  "checks": [{"description": "Ejecución de las pruebas por este especialista", "status": "not_run", "evidenceRef": null}],
  "findings": [{
    "id": "F-NEG",
    "severity": "high",
    "description": "El reduce suma valores negativos; las validaciones solo cubren forma y finitud.",
    "reference": "src/total.mjs:2-8; tests/total.test.mjs:4-6",
    "recommendation": "Validar negativos después de la validación de tipo/finitud y añadir la prueba de error acordada."
  }],
  "questions": [],
  "limitations": ["Inspección estática; no revisión de producción ni aprobación institucional."],
  "suggestedNextStep": "Pulso puede encargar la corrección al Ejecutor y la regresión a QA."
}
```

## Plan terminado de ejemplo

# Plan · DEMO-NEG · Rechazo de importes negativos
<!-- template: plan@1.0 -->
Tipo: maestro · padre: ninguno · base: fixture original y work revision 1 del ejemplo.

### Objetivo y alcance
Cubrir AC-NEG sin alterar positivos, cero, vacío ni errores INVALID_AMOUNTS e
INVALID_AMOUNT. No añadir límites monetarios, redondeo, nuevas dependencias o persistencia.

### Realidad comprobada
`src/total.mjs` comprueba array y números finitos antes de sumar. Los tres tests base
cubren suma, vacío y NaN. `package.json` usa el test runner nativo de Node.
Las rutas aquí asumen la copia del fixture como raíz del proyecto.

### Estrategia y decisiones
Insertar el rechazo de negativos después de las validaciones actuales, conservando
su precedencia. No filtrar negativos silenciosamente ni convertirlos en cero.

### Trabajo propuesto
| ID | Entregable | Especialista | Dependencia | Escritura | Aceptación |
|---|---|---|---|---|---|
| T-FIX | Guard de negativos | Ejecutor | Ninguna | src/total.mjs | AC-NEG; errores previos conservados |
| T-QA | Regresión y ejecución | QA | T-FIX | tests/total.test.mjs y evidencia asignada | Negativo rechaza; casos base pasan |

Pulso incorpora las tareas que acepte; su estado vive en work.json, no en esta tabla.

### Paralelismo y puntos de integración
No hay beneficio material en paralelizar esta corrección. QA ejecuta sobre la base final.
Esto es una decisión para este caso, no un pipeline impuesto a otros trabajos.

### Verificación prevista
Usar `node --test tests/total.test.mjs` en el fixture. Conservar tests base y comprobar
el tipo de error y mensaje para negativos. Un fallo no se resuelve quitando aserciones.

### Riesgos y reversión
Riesgo: alterar el error de entradas que mezclan un negativo con datos inválidos.
Mantener primero la validación de tipo/finitud. Si hay una regresión, corregir solo el
cambio propio; no revertir modificaciones del usuario.

### Incertidumbres y siguiente decisión
Sin preguntas bloqueantes bajo el contrato sintético dado. El enunciado del ejemplo
no permite extrapolar una política financiera real.

## Revisión terminada de ejemplo

# Revisión · Code Reviewer · DEMO-NEG
<!-- template: review@1.0 -->

### Alcance y base revisada
Implementación y tres tests originales de `examples/smoke-project`, anteriores al cambio.
Criterio AC-NEG; fuera de alcance, políticas de negocio no presentes en el fixture.

### Método y evidencia
Inspección estática de la función y los casos. Esta revisión de ejemplo no atribuye
la ejecución de tests a un especialista.

### Hallazgos
| ID | Severidad | Hallazgo e impacto | Referencia | Corrección |
|---|---|---|---|---|
| F-NEG | high | El reduce acepta negativos; AC-NEG no se satisface | src/total.mjs:2-8 | Rechazar negativos conservando la precedencia de errores y añadir prueba |

### Cobertura frente a aceptación
La suma y el vacío están representados en las pruebas; no hay aserción sobre negativo.
Tener tres tests no acredita la aceptación nueva.

### Conclusión
Requiere corrección del producto y nueva comprobación antes de cerrar el trabajo.

### Límites y decisiones pendientes
No acredita seguridad global, accesibilidad o funcionamiento de APX/Cells. No hay una
aprobación de BBVA implicada por terminar esta revisión.

## Evidencia base real: ejemplo de alcance limitado

# Evidencia · Fixture original · E-BASE
<!-- template: evidence@1.0 -->

### Afirmación verificada
Las tres pruebas del fixture original pasan. **No** se verifica AC-NEG ni orquestación.

### Base comprobada
Archivo `examples/smoke-project/src/total.mjs`, SHA-256: df2a546cad0bb85f96332b8d39fbc4ea5908eb59cc13ee4798c26ca2d31ce29e.
Archivo `examples/smoke-project/tests/total.test.mjs`, SHA-256: f900171e06ee9c32c3ef702c13fd6a82aedd176bc674d409e381e333f6fa13b0.
Sin atribución a commit: ejecución sobre la copia de la distribución adjunta.

### Método y entorno
Ejecución real de `node --test tests/total.test.mjs`, directorio
`examples/smoke-project`, Node v22.16.0, Linux, 2026-09-29.

### Resultado observado
Exit code 0. Tres pruebas PASS, cero fallos y cero omitidas: suma, vacío y rechazo de NaN.

### Cobertura
Solo esos tres casos base. No existe prueba de negativos en esa versión del fixture.

### Omitido o bloqueado
AC-NEG, agentes reales, macOS, Windows y entornos BBVA: no comprobados aquí.

### Vigencia
Cualquier cambio de esos archivos exige reconsiderar esta evidencia. Los hashes no
prueban por sí solos que una nueva ejecución ocurrió.

### Referencias
Resultado observado durante la preparación del correctivo; fuente y tests incluidos en
`examples/smoke-project/`. Este ejemplo no se registra automáticamente en un work.

## Decisión terminada de ejemplo

# Decisión · D-NEG
<!-- template: decision@1.0 -->
Fecha: 2026-09-29 · trabajo: DEMO-NEG · estado: propuesta didáctica.

### Contexto y fuentes
El enunciado sintético exige un error para negativos y conservar validaciones actuales.

### Decisión
Proponer RangeError con mensaje NEGATIVE_AMOUNT después de la comprobación de finitud.
El usuario de un trabajo real debe haber confirmado ese contrato; este documento no lo hace.

### Alternativas y motivo
Filtrar negativos ocultaría datos inválidos. Otra librería añade coste sin beneficio
para este contrato pequeño. Comprobar negativos antes de tipo/finitud cambia precedencias.

### Consecuencias y revisión
Afecta solo al módulo y sus tests. Revisar si el contrato real admite ajustes negativos.
No existe una política institucional inferida a partir de este fixture.

## Cómo distinguir contenido útil de relleno

«Tests OK» es insuficiente; «comando, base, tres casos, exit code y AC-NEG no verificado»
permite evaluar el resultado. «Mejorar calidad» no define tarea; «rechazar negativo con
este error conservando estas validaciones» sí. Para Explorador/Researcher usar fuentes y
preguntas concretas; para Security/UI, alcance y limitaciones observadas. No ampliar una
corrección simple para llenar todas las plantillas.
