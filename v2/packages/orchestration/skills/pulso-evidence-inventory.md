---
name: pulso-evidence-inventory
description: "Inventariar código y pruebas con cobertura de alcance explícita y niveles de evidencia."
---

# pulso-evidence-inventory

## Entrada y universo
Fija el conjunto de archivos inspeccionables y la convención de componentes/specs. Registra inclusiones, exclusiones y resultados truncados. Completa paginación/búsqueda antes de afirmar exhaustividad. Los nombres no bastan para detectar cobertura indirecta.

## Niveles
Spec localizado: existe el archivo. Contenido revisado: se leyeron sus casos y se asocian a comportamientos. Ejecución comprobada: hay comando, resultado y entorno. Cobertura medida: hay instrumento y reporte de ejecución. Nunca elevar un nivel sin evidencia.

Cruza el conjunto de componentes con los specs. Conserva componentes sin asociación, pruebas indirectas y correspondencias ambiguas. Cuenta conjunto total, inspeccionado y excluido. Lee imports/describe/casos cuando el encargo pregunta qué se prueba. No ejecutar tests si no está autorizado.

## Artefacto
Publica pulso-inventory/1 con entries, exclusions, completeness y límites. Si no se completó el universo, completeness=false y la lista se presenta parcial. El resultado de Explorer resume hallazgos y referencia evidencia; el bridge conserva el artefacto completo.
