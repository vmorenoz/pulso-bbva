# Encargo ligero
<!-- template: delegation.md@1.1; guía del orquestador, no formulario para rellenar -->

Envía a task SOLO el `specialistPrompt` recibido de `prepare_delegation`.
Pulso conserva delegation, acceptanceBasis y hostContext originales internamente;
no adjunta esos objetos, schemas, paths internos ni instrucciones instaladas.
Si falta contexto conversacional indispensable, añade una frase breve en la sección
pertinente sin repetir condiciones. No reconstruyas el prompt a partir de esta guía.

Para trabajo persistente habitual usa output `conversation`. Solicita un archivo
solo cuando el documento sea necesario y esté autorizado. La revisión externa
read_only_review conserva readBase explícita, output conversation, writeScope vacío,
sin Work ni inicialización; tampoco requiere envelope JSON.

## Ejemplo renderizado: bump patch

Ejemplo ilustrativo de encargo pequeño (alrededor de 150 palabras); IDs y rutas
los proporciona core en un encargo real. No representa una ejecución observada.

```markdown
## Objetivo

Encargo: D-1 · workId: PATCH-1 · taskIds: T-1

Subir la versión patch del paquete de 1.2.3 a 1.2.4.

## Alcance

Workspace: /workspace/repo

Alcance de escritura (relativo al workspace):
- package.json
- package-lock.json

## Condiciones

- Solo cambios de archivos (files only), sin commit ni push.
- Actualiza la versión del paquete raíz en ambos archivos; conserva las versiones de dependencias y los cambios ajenos.
- Comprueba que ambas versiones coinciden y que el diff se limita al bump solicitado.

## Entrega

Responde en Markdown con las secciones «## Resultado», «## Cambios o hallazgos» y «## Comprobación y pendientes». Describe el estado en lenguaje natural, los cambios o hallazgos, las comprobaciones realizadas y sus resultados, y las limitaciones o preguntas pendientes.
```

La respuesta usa `result.md`: breve estado y resumen, rutas con antes/después,
y comprobaciones realmente observadas o límites. No copies checks de este ejemplo.
Pulso conserva el texto literal y lo mapea a result compacto para `accept_result`;
el especialista no devuelve identidad, revisión, hashes ni JSON.
