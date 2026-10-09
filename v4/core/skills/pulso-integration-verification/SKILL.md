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
6. Comprueba el conjunto integrado cuando los cambios lo requieran; no heredes PASS de partes o ramas ni repitas pruebas sin cambio o incertidumbre que lo justifique. Distingue preparación de tests, ejecución real y comprobaciones textuales. Registra lo no ejecutado/bloqueado y riesgos residuales; no reconstruyas huellas actuales para acreditar una observación pasada.

Salida: integra los hallazgos en las tres secciones Markdown de QA o review, sin tercera revisión, JSON ni documento duplicado. Usa el alcance autorizado recibido; referencia solo artefactos existentes. Pulso conserva delegation, hostContext y base previa internamente y mapea el reporte literal al result compacto de accept_result, sin inventar checks ni inferir PASS. Aceptar tareas no sustituye evidencia final de integración: cuando el criterio la exige, un observador con herramientas efectivas captura observaciones y snapshots reales, sin renovar los de una prueba pasada. La aceptación manual de accept_delivery tampoco acredita pruebas automatizadas. No edites metadatos, no delegues y no certifiques cumplimiento institucional. Esta skill no reemplaza ni modifica las skills BBVA.
