---
name: pulso-parallel-work
description: "Paralelizar lecturas y ediciones independientes sin colisiones ni falsas garantías."
---

# pulso-parallel-work

## Activación
Usar cuando hay dos o más nodos listos o el usuario solicita paralelismo.

## Comprobar independencia
Enumera recursos leídos y escritos por nodo. Dos lecturas son compatibles. Una escritura y otra lectura sobre el mismo archivo/árbol no lo son. Dos escritores necesitan archivos exactos distintos. Considera fixtures, configuración, mocks, manifests y lockfiles, no solo el archivo principal.

En modo files usa solo edición nativa acotada; sin comandos. Separa las pruebas en nodos exclusive posteriores. No mantengas locks parciales esperando ampliación. Shell, acciones desconocidas o destructivas serializan el workspace. No retires la barrera antigua hasta que la reserva transaccional y guardas de todas las herramientas estén operativas.

## Medir
Paralelo real exige intervalos de ejecución de hijos solapados. Publicar dos nodos o llamar prepare dos veces no lo demuestra. Foreground procesa tandas; no prometas que el padre reacciona a cada hijo mientras sigue esperando la misma tanda.

## Entrega
Comunica qué pudo correr en paralelo y qué tuvo que serializarse por un recurso real. No atribuyas demoras a un agente sin evidencia.
