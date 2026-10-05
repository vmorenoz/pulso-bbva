# Desarrollo de Pulso para VS Code

Desde v3-vscode en el repositorio completo: npm ci, npm run verify y npm run package. El paquete se genera en dist con SHA-256 adyacente. No se necesitan estas herramientas para instalar el VSIX.

La composición reutiliza main 72e7cd1 (PR #11) de v3-opencode-v1, sin modificar ningún archivo fuente. Dos overrides efectivos (artifacts y work-mutations) conservan paginación, recuperación de informes históricos y recibos de persistencia parcial. memory y el schema work locales son copias idénticas del contrato canónico. Las instrucciones se adaptan al contrato plano de VS Code; resources/provenance.json registra origen y hashes. El catálogo se copia también a resources/catalog.json para validate_result.

Los overrides y schemas de desarrollo no se empaquetan por separado: solo sus salidas resources. Toda actualización exige revisar divergencias y ejecutar regresiones. Las observaciones de evidencia y los registros acceptanceChanges usan el contrato endurecido de OpenCode. No se expone complete_map ni se sintetiza PASS a partir de un marcador de plantilla. Los registros antiguos sin base observada pueden leerse, pero necesitan evidencia nueva para aceptar/cerrar.

La suite usa APIs públicas simuladas y filesystem temporal. No sustituye la prueba de conversación del usuario. No se exige un nuevo harness ni baterías masivas. Mantén las pruebas de bindings, aceptación, proyecciones parciales, historia, paginación, bloqueo de memoria y referencias del paquete.
