# Arquitectura y límites

## Core independiente del runtime

`lib/artifacts.mjs` conserva schemas, validación, persistencia atómica, historial y revisión de Work. `lib/work-mutations.mjs` ofrece operaciones semánticas sobre ese core; `lib/receipts.mjs` valida y formatea recibos breves. `lib/workspace.mjs` inicializa datos ausentes sin mutar workspaces incompatibles.

El core no conoce OpenCode, no ejecuta procesos, no recibe comandos de consola y no crea actividad de agentes. OpenCode v1 es el único adaptador distribuido actualmente. Un runtime futuro tendría que implementar sus propias tools sobre las operaciones del core; no se promete compatibilidad de UI.

## Adaptador OpenCode v1

`plugins/opencode-v1/index.mjs` registra cuatro tools mediante el mapa `tool` de la API v1. La raíz de trabajo proviene de `context.directory`; ninguna tool toma una ruta desde el modelo. Las llamadas devuelven título y recibo breve. El host conserva la visibilidad nativa de delegaciones `task`.

`lib/composition.mjs` genera en memoria agentes y comandos nativos v1, skills globales y archivos del plugin. No genera salidas precompiladas ni ramas de runtime legacy.

## Artefactos por workspace

```text
<workspace>/.pulso/
  state.json
  history.jsonl
  project.md
  memory.json
  decisions.md
  work/<ID>/
    work.json
    plan.md / plans/ / spec.md / evidence/ ...
```

Los recursos globales se instalan en `~/.pulso/{templates,schemas,lib,docs}` y `~/.config/opencode/{agents,commands,skills,plugins/pulso}`. El instalador registra únicamente `./plugins/pulso/index.mjs` en la configuración global. El workspace conserva solo sus datos.

## Mutaciones

El flujo es: intención semántica → lectura vigente → comparación `expectedRevision` → aplicación de acciones permitidas → validación del Work completo → una escritura canónica y actualización de índice → recibo compacto.

No se acepta JSON Patch ni Work completo. Cada archivo usa temporal + fsync + rename; la consistencia de múltiples artefactos no constituye una transacción multiproceso. La revisión protege frente a candidatos obsoletos secuenciales y se requiere un solo coordinador por checkout.

## Evidencia

La validación separa estructura/referencias, vigencia de archivos y aceptación semántica. El core puede comprobar rutas, hashes, dependencias, cobertura y estado terminal; no puede probar por sí solo que una persona ejecutó un comando ni que el resultado cumple negocio.
