---
name: pulso-executable-plans
description: "Crear un plan detallado, persistido y verificable sin transferir decisiones al implementador."
---

# pulso-executable-plans

## Entrada
Objetivo, alcance, criterios, inventario verificado y restricciones de la rama. Si falta evidencia, completar investigación o mantener draft explícito.

## Contenido obligatorio
Para cada objetivo: ruta existente comprobada o ruta nueva identificada; comportamiento observable; evidencia de soporte; cambio o prueba propuesta; criterio de finalización. Para cada unidad: propietario lógico, archivos exactos de escritura, dependencias por claves y validación. Usa unidades equilibradas y no un grupo residual enorme.

Cierra decisiones técnicas y explica el motivo en el artefacto. No escribir “evaluar tecnología”, “según convenga” o “el ejecutor decidirá” para una decisión material pendiente. Un dato de negocio desconocido es unresolved; no un supuesto oculto.

Publica pulso-plan/1 mediante pulso_artifact. El JSON es canónico y genera Markdown. Solo ready si inventoryComplete, evidence y behaviors no vacíos, grafo válido y unresolved vacío. La revisión independiente contrasta el contenido con el código, no solo el JSON Schema.

## Límite
Plan ready no significa implementación autorizada. No crear specs, instalar dependencias o ejecutar pruebas cuando la tarea es únicamente planificar. La publicación del plan no cambia por sí sola el Work a implementación.
