# Pulso

**Pulso** es un framework de orquestación adaptativa de entrega para [OpenCode](https://opencode.ai) y GitHub Copilot CLI. Reúne en un único repositorio versionable los agentes, el protocolo de coordinación, los adaptadores de runtime, las herramientas, las bibliotecas del plano de control, la CLI y las pruebas que gobiernan una entrega técnica asistida por agentes.

Su diseño prioriza una idea sencilla: aplicar el menor proceso que permita entregar un cambio verificable y seguro. El flujo habitual conecta directamente a Pulso con Executor; Planner, Challenger, Explorer, Verifier y los auditores se incorporan únicamente cuando existe ambigüedad, evidencia insuficiente o un riesgo concreto.

## Resumen ejecutivo y propósito

Pulso actúa como responsable técnico de una solicitud: conserva el objetivo, las decisiones, los bloqueos y el estado de cada tarea, mientras delega el trabajo especializado con contratos acotados. El sistema evita que la coordinación se convierta en burocracia y exige evidencia para declarar una entrega completa.

El proyecto está orientado a equipos que necesitan:

- Coordinar tareas de ingeniería con agentes especializados sin perder el control del alcance.
- Reducir los ciclos de reparación especulativos y preservar la trazabilidad de la validación.
- Mantener memoria técnica y métricas operativas entre objetivos, sin almacenar datos sensibles en el estado del repositorio.
- Adaptar la ejecución a contextos BBVA —incluidos CELLS y APX— cuando la evidencia del proyecto lo justifica.

## Arquitectura y flujo de entrega

Pulso se organiza como un plano de control local sobre OpenCode. El orquestador recibe el objetivo, inspecciona el estado mínimo necesario y selecciona una ruta determinista mediante señales de riesgo.

```text
Solicitud del usuario
        │
        ▼
Pulso (objetivo, decisiones y enrutamiento)
        │
        ├── Ruta rápida: Executor
        ├── Ruta normal: Executor + Verifier
        ├── Ruta planificada: Planner → Executor
        └── Ruta sensible: Executor + auditor específico
        │
        ▼
Evidencia de implementación y validación
        │
        ▼
Experiencia, métricas y cierre del objetivo
```

Las rutas se escogen por señales explícitas, como ambigüedad, dependencias, cambios entre capas, autenticación, persistencia, datos sensibles, operaciones remotas, cambios destructivos o evidencia de validación contradictoria. No se añaden especialistas por orden ceremonial: se incorporan solo si ayudan a resolver un hecho, una decisión o un riesgo material.

Para editar, Executor adquiere un *lease* de 30 minutos sobre la tarea. Los cambios que se solapan se serializan; únicamente pueden paralelizarse trabajos independientes. La integración Git es deliberadamente restrictiva: requiere una petición explícita del usuario y una referencia Jira válida.

## Componentes y capas del sistema

| Capa | Componentes | Responsabilidad |
| --- | --- | --- |
| Orquestación | `agents/pulso.md`, `tools/pulso_route.ts` | Define el objetivo, mantiene decisiones y bloqueos, y selecciona la ruta mínima de entrega. |
| Ejecución y revisión | `pulso-executor`, Planner, Challenger, Explorer, Verifier y auditores | Implementan o aportan evidencia dentro de límites de autoridad y alcance definidos. |
| Protocolo y estado | `skills/pulso-protocol/`, `.pulso/` | Establece contratos de tareas, propiedad del estado, *leases* y comunicación entre agentes. |
| Resiliencia | `plugins/pulso-circuit-breaker.mjs`, `lib/pulso-circuit-breaker-core.js` | Limita reparaciones repetitivas y bloquea mutaciones cuando una tarea entra en un estado de riesgo. |
| Experiencia y observabilidad | `plugins/pulso-experience-engine.mjs`, dashboard y reporter | Conserva métricas y memorias verificadas en SQLite, y presenta el estado operativo de forma local. |
| Operación e instalación | `scripts/`, `bin/`, `tools/`, `pulso.manifest.json` | Sincroniza la distribución, instala el runtime y ofrece diagnóstico y operación local. |

La configuración local vive en `PULSO.md`: guarda una sola vez si `.pulso/**` se versiona y ofrece una sección `Project Rules` para instrucciones definidas por el usuario. Cuando se elige `untracked`, Pulso usa exclusivamente el exclude local de Git y no modifica `.gitignore`; cuando se elige `tracked`, elimina su propia exclusión local. El estado de coordinación incluye estado compartido, contratos de tarea, circuit breakers y *leases*. El motor de experiencia utiliza un almacén SQLite externo al estado de tareas; la memoria técnica se curará únicamente tras cierres `verified` o `integrated`.

El dashboard web es opt-in. Solo se inicia y abre cuando el usuario pide explícitamente ver el dashboard o ejecuta `/pulso-dashboard`; consultar métricas, memorias, preferencias o configuración no abre el navegador.

## Integración con el ecosistema BBVA

Pulso no presupone un stack BBVA para todos los repositorios. Detecta el perfil del proyecto a partir de evidencia y carga las habilidades aplicables solo cuando corresponden:

| Contexto confirmado | Habilidades aplicables |
| --- | --- |
| Proyecto BBVA | `bbva-engineering` |
| Aplicación CELLS | `bbva-engineering`, `bbva-cells` |
| Comportamiento o pruebas CELLS | Las anteriores y `bbva-cells-testing` |
| Unidad de despliegue APX | `bbva-engineering`, `bbva-apx` |
| Comportamiento o pruebas APX | Las anteriores y `bbva-apx-testing` |
| Integración CELLS con APX | Todas las habilidades CELLS y APX pertinentes |

Esta integración es condicional y basada en evidencia: si el contexto no está confirmado, el perfil permanece como `unknown`. Así se evitan reglas de plataforma ajenas al repositorio y se conserva el cumplimiento de las convenciones BBVA cuando sí aplican.

## Ecosistema de agentes y autoridades

Cada actor tiene una responsabilidad limitada para evitar conflictos de estado y autoaprobación:

| Agente o componente | Autoridad principal |
| --- | --- |
| `pulso` | Objetivo, prioridades, decisiones, bloqueos, asignación y ciclo de vida de tareas. |
| `pulso-planner` | Crea contratos de tareas y actualiza exclusivamente su sección `plan`. |
| `pulso-executor` | Implementa el cambio, gestiona `execution` e `integration`, y libera el *lease*. |
| `pulso-verifier` y auditores | Proporcionan revisión independiente y de solo lectura. |
| `pulso-challenger` | Revisa riesgos irreversibles, dependencias nuevas o decisiones materiales sin modificar el estado. |
| `pulso-experience-curator` y `pulso-delivery-reporter` | Generan propuestas de memoria y comunicación operativa; no cambian el resultado técnico. |
| Plugins y herramientas Pulso | Son propietarios exclusivos del circuit breaker, el almacén de experiencia, el enrutamiento, los *leases* y el diagnóstico. |

Los especialistas entregan evidencia estructurada y no pueden modificar la intención del usuario, las prioridades ni el alcance sin una delegación explícita. Pulso no declara éxito por narración: requiere pruebas, auditoría, verificación o confirmación humana pertinente.

## Concurrencia y resiliencia con circuit breaker

La concurrencia se protege mediante *leases* por tarea. Un Executor debe poseer un *lease* activo para editar y solo pueden recuperarse *leases* vencidos; nunca se desplaza a un propietario activo. El plugin valida además que las mutaciones se mantengan dentro de las rutas autorizadas por el contrato de tarea.

El circuit breaker observa validaciones y ciclos de reparación para evitar insistir sobre el mismo error. Por defecto abre el circuito ante dos errores de validación repetidos o tres ciclos de reparación sin progreso. Cuando está abierto, bloquea las herramientas mutantes, pero conserva la investigación de solo lectura y la validación diagnóstica. El reinicio del circuito requiere intervención humana mediante `pulso-breaker`.

Los fallos de infraestructura —por ejemplo, dependencias ausentes, puertos ocupados o navegadores de prueba no disponibles— se registran por separado y no abren el circuito. El consumo de tokens también es observacional: permite medir la operación sin impedir por sí mismo la entrega.

## Requisitos

- Node.js 22.5 o superior; el motor de experiencia utiliza `node:sqlite`.
- OpenCode con un proveedor de modelos configurado, GitHub Copilot CLI, o ambos.
- `npm` para instalar dependencias y ejecutar los comandos del proyecto.

## Desarrollo

Instale dependencias y ejecute la suite de pruebas:

```bash
npm install
npm test
```

Edite Pulso en este repositorio. El instalador interactivo pregunta si debe configurar OpenCode, GitHub Copilot CLI o ambos y después permite elegir uno de dos perfiles de modelos:

- **OpenAI:** Terra para orquestación, planificación y ejecución; Luna para exploración y tareas ligeras.
- **Claude:** Sonnet para orquestación, planificación y ejecución; Haiku para exploración y tareas ligeras.

Sol y Opus no se asignan por defecto debido a su mayor coste; siguen disponibles mediante personalización manual.

```bash
npm run install:local
```

En ejecución no interactiva se conserva OpenCode como destino predeterminado por compatibilidad. También puede elegirlo explícitamente:

```bash
npm run install:opencode
npm run install:copilot
npm run install:both
npm run install:both -- --profile claude
```

El adaptador OpenCode usa `~/.config/opencode` de forma predeterminada; `OPENCODE_CONFIG_DIR` permite elegir otra instalación. El adaptador Copilot instala el plugin local `pulso`, sus agentes, skill, hooks y servidor MCP. Ambos persisten el perfil seleccionado y asignan explícitamente el modelo correspondiente a cada agente. La instalación deja Pulso disponible, pero no lo selecciona como agente predeterminado. Inicie una sesión Copilot con `copilot --agent pulso`. Para hacer opt-in al agente predeterminado de OpenCode:

```bash
npm run install:opencode -- --set-default
```

El instalador no sobrescribe archivos administrados que hayan divergido de este repositorio. Revise primero esas diferencias y use el siguiente comando solo cuando el reemplazo sea intencional:

```bash
npm run install:local:force
```

Para retirar únicamente los archivos gestionados por el proyecto que siguen coincidiendo con este repositorio y desregistrar sus plugins:

```bash
npm run uninstall:local
```

Reinicie OpenCode o abra una sesión nueva de Copilot CLI después de instalar o desinstalar: ambos runtimes descubren agentes, skills, herramientas y plugins al iniciar la sesión, pero Pulso difiere su trabajo de estado hasta una activación explícita.

## Adaptadores de runtime

OpenCode sincroniza los archivos listados en `pulso.manifest.json` y registra circuit breaker y experiencia. Ambos plugins permanecen inertes en sesiones ajenas: SQLite, mantenimiento y migraciones se activan con el primer mensaje de un agente Pulso o con una operación Pulso explícita. `--set-default` permite configurar `pulso` como agente predeterminado de forma voluntaria.

Copilot CLI consume este repositorio como un plugin Agent Plugins 1.0. Los perfiles en `copilot/profiles/<profile>/agents/` se generan desde los agentes canónicos de `agents/` y el instalador coloca únicamente el perfil elegido en `~/.copilot/agents`; el plugin no aporta una segunda copia. `skills/pulso-protocol/` se comparte sin duplicación. Los perfiles `pulso` y `pulso-executor` registran `pulso-control` como MCP propio del agente; el servidor no se aporta globalmente. Solo `pulso` es invocable por el usuario. No se inyecta contexto Pulso al iniciar ni en cada prompt. El MCP permite al primario escribir solo `PULSO.md` y `.pulso/**`, consultar metadatos Git de solo lectura y diagnosticar leases sin identidad de executor. Los hooks activan exclusivamente Planner y Executor en un cache temporal del sistema: Planner solo puede editar `.pulso/**`; Executor no puede editar ni ejecutar comandos antes de adquirir un lease con su `owner_session`, y después se aplican alcance y circuito. Las sesiones ordinarias no reciben contexto ni MCP.

Los runtimes deben descubrir al inicio el catálogo de agentes y skills para poder seleccionarlos. Pulso evita trabajo activo fuera de sus sesiones: OpenCode no abre SQLite ni migra estado, y Copilot no añade instrucciones globales ni inicia `pulso-control`. En Copilot, Planner no recibe MCP y Executor recibe únicamente `pulso_lease`.

Flujo recomendado:

```bash
npm install
npm test
npm run install:both
```

Tras reiniciar OpenCode, Pulso quedará disponible para selección; solo será el agente predeterminado si se instaló con `--set-default`. En Copilot CLI se selecciona con `copilot --agent pulso` o `/agent`.

## Dashboard y Doctor

Abra el dashboard de métricas y experiencia de la instalación actual de estas formas:

```text
/pulso-dashboard
```

o, desde este repositorio:

```bash
npm run dashboard
```

El dashboard muestra estado y duración de objetivos, tokens y ejecuciones, actividad por agente, intervenciones humanas, ciclos de reparación, memorias verificadas y preferencias de perfil. OpenCode registra tokens mediante sus eventos de modelo; Copilot MCP no ofrece un contrato estable de esos eventos, por lo que sus objetivos se marcan con seguimiento de tokens no disponible, nunca como consumo cero. El doctor de Copilot informa la misma limitación.

El servidor se enlaza exclusivamente a `127.0.0.1`, usa un token temporal de acceso, lee SQLite sin modificarlo y se detiene tras 30 minutos de inactividad o al pulsar **Stop server**.

Para un diagnóstico de solo lectura de agentes, plugins, herramientas, estado local y almacén de experiencia, ejecute dentro de OpenCode:

```text
/pulso-doctor
```

## Configuración

Combine los campos pertinentes de `opencode.example.jsonc` con el `opencode.jsonc` de destino. Las rutas de los plugins son relativas al archivo de configuración de OpenCode.

El archivo de ejemplo configura `pulso` como `default_agent`, registra los plugins de circuit breaker y experiencia, y propone modelos para cada agente. Los modelos son ejemplos operativos: pueden sustituirse sin modificar los contratos de comportamiento de Pulso.

## Estructura del repositorio

```text
agents/                   Orquestador y especialistas acotados
bin/                      CLI de operación local
com.github.copilot/       Comandos y hooks del plugin Copilot
copilot/                  Adaptador MCP y perfiles de agentes para Copilot CLI
commands/                 Comandos de OpenCode para dashboard y diagnóstico
lib/                      Implementación del plano de control
plugins/                  Circuit breaker y motor de experiencia
scripts/                  Instalación y sincronización del runtime
skills/pulso-protocol/    Protocolo compartido de coordinación y estado
plugin.json               Manifiesto Agent Plugins 1.0
pulso.manifest.json       Archivos sincronizados por el instalador
opencode.example.jsonc    Configuración de referencia para OpenCode
```

## Bootstrap

El comando de bootstrap importa los archivos del manifiesto de runtime desde una instalación existente de OpenCode:

```bash
npm run bootstrap
```

Las pruebas y demás archivos exclusivos de desarrollo permanecen bajo propiedad del repositorio y no se esperan en el directorio de configuración de OpenCode. Use bootstrap únicamente para inicializar o reconciliar deliberadamente el repositorio. El flujo normal de desarrollo sincroniza desde este proyecto hacia OpenCode, no en sentido inverso.
