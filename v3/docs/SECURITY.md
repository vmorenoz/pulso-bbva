# Seguridad, información y garantías

Pulso no es una frontera de seguridad. Sus prompts delimitan roles y scopes; los runtimes administran tools y aprobaciones. No se elevan permisos, gestionan tokens, leen almacenes de auth ni usan APIs privadas. Los resultados de especialistas no son instrucciones ejecutables.

## Archivos

Los helpers restringen rutas al proyecto y rechazan rutas absolutas, `..`, separadores Windows dentro de paths portables y symlinks detectables. Usan escrituras atómicas por archivo y revisión leída para cambios secuenciales. Esto no equivale a protegerse contra otro proceso hostil cambiando directorios en mitad de la operación (TOCTOU); exige checkout confiable y escritor único.

No registrar secretos, datos reales de clientes o información restringida en `.pulso`, resultados o fuentes públicas. Los hashes solo identifican archivos, no autorizan leerlos ni subirlos. Los artefactos pueden contener conocimiento de negocio sensible incluso sin credenciales: el equipo decide qué versionar según su política, Pulso no certifica esa política.

El instalador precomprueba colisiones y no modifica configuraciones del host. Rechaza `.pulso` ajeno/v2 no reconocido. No usa shell, red, descargas ni paquetes externos. No hay `--force`. Se preservan archivos modificados por el usuario; la instalación no reconcilia automáticamente contenido editado.

## Qué NO garantizan los checks

- Esquema válido no prueba calidad de un plan ni cumplimiento de negocio.
- Hash vigente no prueba que el comando haya corrido ni que se seleccionaron todos los archivos relevantes.
- JSON con agent/delegationId correctos no prueba ownership nativo; revisar llamada y diff.
- Un estado in_progress no prueba ejecución actual.
- Una auditoría terminada no equivale a software aprobado.
- Tests offline de instalación/artefactos no equivalen a smoke live de modelos y herramientas.

Para aislamiento duro usar mecanismos nativos y políticas autorizadas; no añadir leases, tokens de permisos, schedulers ni sandboxes ad hoc a esta versión.

## Corrección de rutas y operación de una sola persona/sesión

El destino seleccionado no puede ser un symlink. Sus ancestros existentes se resuelven
con realpath, sin una lista especial de /var, /tmp o sistemas operativos. Así se admite
un alias de directorio confiable sin permitir enlaces dentro de las rutas administradas
del proyecto. La ruta canónica se usa también para impedir instalación dentro de la
propia distribución a través de un alias. Dry-run no crea directorios.

Esto no valida la confiabilidad de un tercero ni resuelve carreras de filesystem. Los
ancestros pertenecen al entorno explícitamente elegido por el usuario; el checkout debe
ser confiable y tener un solo coordinador/escritor. Detener la otra sesión antes de
instalar, actualizar o cambiar de host. No se añade ningún lock ni detector de procesos.
