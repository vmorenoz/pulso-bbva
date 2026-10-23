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
5. Verifica con la menor comprobación autorizada que cruce la frontera. Respeta «no tests» y steering vigente, sin ejecución indirecta ni bypass de hooks; declara lo pendiente. Unit tests con mocks no prueban conectividad; integración/E2E real requiere entorno y autorización, con fixtures sintéticos.
6. Comprueba el conjunto integrado cuando los cambios lo requieran; no heredes PASS de partes o ramas ni repitas pruebas sin cambio o incertidumbre que lo justifique. Distingue preparación de tests, ejecución real y comprobaciones textuales. Registra lo no ejecutado/bloqueado y riesgos residuales; no reconstruyas huellas actuales para acreditar una observación pasada.

Salida: integra hallazgos en las tres secciones Markdown de QA o review, sin tercera revisión, JSON ni documento duplicado. Usa el scope autorizado; separa archivos inspeccionados de cambios propios. Core conserva snapshot/base durable contractVersion:2 y Pulso incorpora por IDs el reporte literal y una decisión sustentada; un error de registro se recupera, no repite la ejecución. Aceptar tareas no sustituye evidencia final: si se exige, un observador capaz captura observaciones/snapshots reales sin renovar pruebas pasadas. Separa captura, aceptación, ejecución y cese reportado/confirmado; conserva timestamps conocidos de ejecuciones tardías. La aceptación manual no acredita pruebas automatizadas. No edites metadatos ni delegues ni certifiques cumplimiento.
