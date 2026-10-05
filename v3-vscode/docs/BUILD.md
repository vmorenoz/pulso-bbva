# Desarrollo de Pulso para VS Code

Desde v3-vscode en el repositorio completo: npm ci, npm run verify y npm run package. El paquete se genera en dist con SHA-256 adyacente. No se necesitan estas herramientas para instalar el VSIX.

La composición reutiliza la distribución v3-opencode-v1 como entrada, sin modificarla. Tres overrides locales en core (artifacts, work-mutations y memory) y el schema work incorporan las correcciones específicas de VS Code. El resto del core y las skills BBVA se preservan; las instrucciones y enlaces de Markdown se adaptan a las capacidades empaquetadas. resources/provenance.json registra el origen y hash de cada archivo.

Los overrides y schemas de desarrollo no se empaquetan por separado: solo sus salidas resources. Cualquier actualización del upstream exige revisar la divergencia de esos tres módulos y ejecutar las regresiones focalizadas. Los fixtures sin cambios de aceptación preservan continuidad; los registros acceptanceChanges son una extensión del contrato y no son compatibles con lectores antiguos que rechacen campos nuevos.

La suite usa APIs públicas simuladas y filesystem temporal. No sustituye la prueba de conversación del usuario. No se exige un nuevo harness ni baterías masivas. Mantén las pruebas de bindings, aceptación, proyecciones parciales, historia, paginación, bloqueo de memoria y referencias del paquete.
