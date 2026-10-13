# Proyecto sintético para una primera sesión real

Copia `smoke-project` a un directorio **fuera** de la distribución de Pulso. No contiene datos BBVA ni dependencias. Instala Pulso en esa copia y abre el runtime elegido con Pulso como principal.

La base actual acepta importes negativos finitos, suma positivos, devuelve cero para vacío y rechaza no finitos. Sus tres tests de base pasan; no pretenden validar el nuevo requisito.

Solicitud sugerida para la prueba live:

> Modifica total para que rechace cualquier importe negativo con RangeError('NEGATIVE_AMOUNT'), mantenga positivos y vacío, y conserve INVALID_AMOUNT para no finitos. No cambies el contrato fuera de eso. Escribe y ejecuta pruebas de positivos, vacío y negativo. Conserva evidencia y el índice del proyecto en .pulso/. No hagas commit.

Después pregunta «¿Qué quedó hecho?» y «¿Qué trabajos siguen abiertos?». Verifica la delegación real, pruebas nuevas efectivas, evidencia y cierre. El fixture no es una prueba automática del LLM.
