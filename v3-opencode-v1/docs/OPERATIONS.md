# Operaciones de Pulso en OpenCode v1

La interfaz operativa son las custom tools del plugin. No existe CLI de operaciones. El único CLI de Pulso es `install.mjs`/`uninstall.mjs`, que administra recursos globales y nunca datos del proyecto.

## Ciclo normal

1. `pulso_workspace` orienta sin escanear todos los Work.
2. `pulso_work` crea un objetivo con criterio verificable.
3. Especialistas trabajan mediante las delegaciones nativas visibles de OpenCode.
4. Pulso consolida el lote aceptado con `pulso_work` action `update`, pasando siempre `expectedRevision` actual.
5. `pulso_workspace` action `validate` comprueba estructura/referencias; `fresh: true` comprueba fingerprints.
6. `pulso_work` action `close` cierra solo después de revisar evidencia. Reabrir requiere motivo y `expectedRevision`.

## Contrato de mutación

`pulso_work` action `update` admite entre 1 y 20 acciones semánticas en una operación: `work.set_overview`, `criterion.add/update/remove`, `task.add/update/set_status/remove`, `document.register/unregister` y `evidence.add/update/remove`.

La entrada no admite una raíz de proyecto, JSON completo de Work, JSON Patch, hashes proporcionados por el modelo ni rutas absolutas. El core valida referencias, computes hashes desde archivos reales y guarda una vez. Las revisiones obsoletas fallan; se debe releer y reconciliar, nunca reintentar sobrescribiendo.

La tool devuelve un recibo breve con ID, revisión, estado, cambios y siguiente acción. Los archivos canónicos permanecen disponibles bajo `.pulso/` para auditoría; no se presentan completos en cada operación.

## Evidencia y cierre

Cada evidencia requiere un informe existente, enlaces a IDs existentes y archivos fingerprintados. `done` exige criterios y tareas terminadas cubiertas por evidencia positiva y vigente; la estructura por sí sola no prueba la calidad semántica ni que una afirmación de ejecución sea cierta. Las tareas y los criterios con dependencias no se pueden quitar; los cierres archivados son inmutables.

`pulso_history` devuelve cierres filtrables y limitados. `pulso_project_complete_map` es solo para el Work exclusivo de mapeo inicial y también compara revisión.

## Preparación

`pulso_workspace` action `prepare` solo se invoca ante un primer encargo concreto o `/pulso-init`. Crea el esqueleto ausente, incluidos memoria, preferencias y aprendizaje; si encuentra datos legacy/incompatibles o una preparación incompleta, preserva y reporta el error. Consultar estado/historial no prepara automáticamente.

## Límites de consistencia

El core usa validación y escrituras atómicas por archivo, pero no es una transacción multiproceso. Debe existir un coordinador escritor por checkout. No hay daemon, scheduler, locks, actividad en tiempo real ni procesos de agentes propios.
