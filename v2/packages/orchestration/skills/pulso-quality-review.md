---
name: pulso-quality-review
description: "Verificar criterios y calidad de entregables sin confundir protocolo con éxito funcional."
---

# pulso-quality-review

## Dimensiones
Separar transporte, autoridad, resultado funcional y calidad de contenido. Un receipt aceptado solo acredita el contrato y la autoridad; no prueba que un plan sea exhaustivo ni que el código haga lo pedido.

## Procedimiento
Leer objetivo, criterios y límites. Revisar artefacto/código real. Para cada criterio: evidencia precisa, comprobación y resultado. No modificar el objeto revisado para hacerlo pasar. No usar coincidencias de palabras en el resumen del modelo como gate funcional.

En planes: rutas, inventario, decisiones cerradas, tareas equilibradas, dependencias y autorizaciones. En código: pruebas observadas, efectos y conservación de cambios previos. En UI: inspección real cuando está disponible. El verificador es independiente del autor; no tiene obligación de encontrar fallos ni de aprobar.

## Resultado
completed + verdict fail/partial es válido y no aprueba la entrega. Fallos de infraestructura producen límites explícitos; pruebas con skips no satisfacen el smoke exigido. La revisión semántica puede permanecer pending aunque las capas deterministas pasen.
