# Prueba manual corta de orquestación

No es un harness ni un requisito de escribir otra suite. Reutiliza
`examples/smoke-project/`: copia la carpeta **fuera** de la distribución. Un workspace
nuevo por runtime evita arrastrar el resultado de otro. Usa tus permisos y modelos
habituales, datos sintéticos y un solo Pulso activo. No habilites bypass ni Allow all
para conseguir que pase una prueba.

Instala con el comando existente, abre el runtime y selecciona `pulso`. En VS Code
elige el motor que coincide con el adaptador instalado. Registra la versión observada
(en la interfaz o CLI nativa) y el motor, sin credenciales. No deduzcas la selección
actual de `opencode agent list`, archivos o del resultado de `doctor`.

## Cuatro mensajes, un mismo caso

**1. Descubrimiento y trabajo independiente de lectura**

> En este proyecto de ejemplo, pide al Explorador que localice implementación y
> pruebas, y al Code Reviewer que revise de forma independiente el contrato actual
> de total. Usa delegación nativa; hazlo en paralelo solo si está disponible. No
> cambies el producto. Carga la skill bbva-engineering desde el runtime y menciona
> una restricción realmente leída, sin aplicar APX o Cells a este fixture Node.

Observar las llamadas reales, los agentes elegidos y la carga de skill en la interfaz.
Una afirmación del asistente no sustituye esa observación. Si carga/delegación no están
expuestas, registrar el bloqueo; no desarrollar una herramienta para simularlas.
Si se secuencia, no declarar paralelismo comprobado. No se exigen frases exactas.

**2. Cambio pequeño y comprobación**

> Implementa que total rechace importes finitos negativos con RangeError y mensaje
> NEGATIVE_AMOUNT. Conserva positivos, cero, vacío, INVALID_AMOUNTS e INVALID_AMOUNT.
> Delega la implementación y encarga a QA añadir y ejecutar la prueba negativa.
> No hace falta plan maestro ni documentos que no aporten. Conserva el trabajo en
> .pulso/ y cierra solo cuando esté comprobado.

Observar que Pulso orquesta y el especialista modifica producto; QA ejecuta las pruebas
reales en el fixture. Los casos base siguen pasando y el negativo queda comprobado.
Si falla o falta una herramienta, queda fallo/bloqueo visible, nunca PASS por omisión.

**3. Estado e historial**

> /pulso-status

Comprobar que el trabajo cerrado ya no figura abierto y que su cierre y referencias
siguen en `history.jsonl` y su carpeta. Para fallo/bloqueo debe seguir abierto.
No tiene sentido exigir ambos resultados a la vez; depende de lo observado.

**4. Continuidad en una nueva sesión, sin otro Pulso simultáneo**

> ¿Qué trabajamos en el ejemplo y cómo quedó? Continúa solo si quedó pendiente.
> Si está cerrado, resume el resultado sin reabrirlo ni repetir cambios.

Comprobar el mismo ID, evidencia y próximos pasos cuando correspondan. No hace falta
esperar una semana ni trasladar sesiones internas entre motores.

## Regresión manual de saludo e inicialización (3.0.4)

Reutiliza el mismo fixture y runtime disponible. No construyas harnesses ni otra
suite. Antes del caso anterior, una sesión nueva recibe «Hola Pulso»: comprobar
que el agente solo saluda, sin llamadas a herramientas ni escrituras iniciadas por
él. La carga interna de instrucciones del host no cuenta como herramienta del agente.

Después da el primer encargo real. Observa delegación de inspección/mapeo al
Explorador y preparación por Ejecutor únicamente si faltan recursos. Pulso no
explora código ni ejecuta la preparación. No debe inventar IDs de Work previos a
su creación. Con contexto ya levantado, otro saludo o sesión no repite el mapeo.

Para el caso legacy puede usarse una carpeta temporal con una copia sintética
mínima `{"schema_version":1,"status":"verified"}` en `.pulso/state.json`, sin
credenciales. Un saludo no debe leerla. Una petición de trabajo debe producir
inspección delegada y bloqueo explicativo sin mutarla ni adoptar ese «verified».
No uses el repositorio real del usuario para esta comprobación ni migres datos.
Una consulta de estado en proyecto sin datos informa ausencia, no inicializa.

Todos estos comportamientos son **NOT_RUN** en esta entrega; no se aprueban por
inspeccionar prompts ni por pasar la suite de archivos. No se exige un texto exacto,
solo las acciones y el alcance observados.

## Registrar, no automatizar

Una tabla en un informe Markdown es suficiente. Esta tabla es una plantilla de
resultados de **3.0.4**, no arrastra PASS live de versiones anteriores:

| Entorno / versión / motor | Saludo sin tools | Inicio delegado | Función y pruebas | Continuidad | Motivo si no se probó |
|---|---|---|---|---|---|
| OpenCode | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Sin sesión nativa en esta revisión |
| VS Code Copilot | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Sin sesión nativa en esta revisión |
| VS Code Local | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN | Sin sesión nativa en esta revisión |

Sustituir solo con observaciones reales y referencia mínima a diff/salida/captura
saneada. Las pruebas del fixture base por separado NO demuestran orquestación.
Ejecutar solo en el runtime disponible. No instalar motores, credenciales, CI ni
herramientas de seguimiento para completar la tabla.
