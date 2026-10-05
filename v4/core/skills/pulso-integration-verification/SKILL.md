---
name: pulso-integration-verification
description: Checklist auxiliar de QA y Code Reviewer para contratos, wiring y flujos entre componentes modificados; no es un encargo independiente.
user-invocable: false
---

{{ADAPTER_BOUNDARY}}
# Integración observable
Usa esta skill cuando el cambio cruce interfaces, capas, servicios o módulos. No inventes arquitectura APX/CELLS si no existe.

1. Identifica productor, contrato (campos, tipos, errores, versiones), transporte, consumidor y efectos. Refiere código/configuración reales.
2. Comprueba wiring: exports/imports, registro de dependencias, rutas, handlers, serialización, adaptadores y configuración efectiva. Una función implementada pero no consumida no completa un recorrido.
3. Sigue datos y errores: validación, autorización, transformación, persistencia/eventos, idempotencia/transacciones cuando aplique y respuesta final. Comprueba qué pasa en timeout o respuesta inesperada.
4. Contrasta contrato compartido entre implementaciones paralelas. Detecta incompatibilidades de nombres, tipos, estados, códigos de error y versiones. No cambies el contrato unilateralmente para integrar.
5. Verifica con la menor prueba que realmente cruce la frontera. Unit tests con mocks no prueban conectividad; declara el alcance del mock. Cuando el entorno lo permita y sea requerido, ejecuta integración/E2E real con fixtures sintéticos.
6. Repite la comprobación relevante sobre el conjunto integrado y su fingerprint, no heredes PASS de partes. Registra lo no ejecutado/bloqueado y riesgos residuales.

Salida: forma parte de la evidencia de QA o review del Code Reviewer según el encargo; no genera una tercera revisión obligatoria. No edites el índice del proyecto, no delegues y no certifiques cumplimiento institucional. Esta skill pertenece a Pulso; no reemplaza ni modifica el contenido de las cinco skills BBVA preservadas.
