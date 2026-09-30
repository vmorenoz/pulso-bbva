---
name: pulso-human-delivery
description: "Comunicar progreso, resultados, artefactos y límites sin exponer contabilidad interna."
---

# pulso-human-delivery

## Estilo
Español claro, profesional y directo; sin emojis. Usa la intención de la persona, no los nombres del protocolo. No narrar cada llamada ni convertir el avance en una lista de agentes.

## Progreso
Una o dos frases cuando cambia un resultado, aparece un bloqueo o se decide una dependencia importante. No repetir que se está trabajando. En peticiones compuestas nombra las ramas y aclara qué no se ejecutará por falta de autorización.

## Entrega
Resultado concreto por rama, evidencia decisiva, artefactos con ubicación y estado, validaciones realizadas y límites. Un plan detallado no se reemplaza por un resumen de cuatro grupos. El lector debe poder continuar usando el artefacto sin reconstruir la conversación.

## Prohibiciones
No JSON de autoridad, leases, hashes o IDs en respuesta normal. No afirmar que una tarea corrió en paralelo sin intervalos. No esconder un failed bajo un completed de transporte. No prometer actividad futura cuando el runtime no la está ejecutando.
