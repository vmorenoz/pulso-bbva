---
name: pulso-safe-recovery
description: "Recuperar fallos sin repetir efectos ni debilitar identidad, leases o recibos."
---

# pulso-safe-recovery

## Clasificación
Distingue preparación sin claim, task iniciado, transporte incierto, resultado rechazado y error de presentación posterior a aceptación. No todos los errores tienen la misma recuperación.

Preparación expirada sin claim puede renovarse de forma idempotente para el mismo item. Un claim existente no se vuelve a despachar. Si hubo efectos posibles, inspeccionar receipt, autoridad y cambios antes de una decisión explícita de retry. No repetir un Executor para arreglar formato JSON.

## Cancelación
Verificar parent-child antes de abortar. La solicitud de detener no demuestra detención. Conservar reservas hasta extinguir autoridad y observar final. Con sideEffectsMayContinue no liberar por timeout ni por falta de heartbeat solamente.

## Evidencia
Conservar historial, hashes y diagnósticos saneados. Un fallo de presenter se corrige leyendo el receipt ya aceptado, no reejecutando. No inventar IDs, retirar comparaciones estrictas o ampliar permisos para destrabar una tarea. Comunicar la parte entregada y el bloqueo concreto.
