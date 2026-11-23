# IA en wiwo.sac: qué hace y cuánto cuesta

Guía para el equipo. Explica qué hace hoy la IA en wiwo.sac, qué no hace y cuánto se gasta en la API de DeepSeek a través de BytePlus ModelArk. El detalle técnico y el plan completo están en [PROPUESTA_IA.md](PROPUESTA_IA.md).

Fecha: noviembre de 2026.

## En corto

- La IA está **apagada por defecto**. Solo funciona si un administrador la enciende en el servidor y autoriza marca por marca.
- Hoy **clasifica** los mensajes que llegan y **sugiere respuestas** basadas en el QA aprobado de cada marca. Nunca envía nada: una persona revisa, edita y envía.
- Cuando detecta un caso delicado, lo manda a **revisión humana**. Nunca saca un caso de revisión.
- El gasto esperado es de **pocos dólares al mes**: unos USD 0,10 por cada 1.000 mensajes clasificados y unos USD 0,50 por cada 1.000 sugerencias de respuesta.

## 1. Qué hace la IA hoy

Cada pocos minutos, el worker toma los mensajes entrantes nuevos de las marcas autorizadas y se los pasa a DeepSeek en lotes de 20. Por cada mensaje la IA propone:

| Qué propone | Para qué sirve |
|---|---|
| **Caso o ruido.** Si el mensaje es un caso que el equipo debe atender, o solo una reacción social ("😍", "@amiga", "lindo") | Que el reporte mensual no cuente reacciones como casos. Las reglas actuales dejan cerca de 3 de cada 4 mensajes como "otro". |
| **Categoría.** Una de 14: reclamo, consulta de producto, precio, stock, despacho, seguimiento de pedido, postventa, pago y facturación, horarios y ubicación, contacto, agradecimiento, crítica, consulta general o no aplica | Motivos del reporte más precisos que los de las reglas |
| **Tono.** Positivo, neutro o negativo | Distribución de tono del mes |
| **Derivación.** Si responder exige información interna (un pedido puntual, una cuenta, un cobro) | Contar los casos que hay que derivar a otra área |
| **Sensible.** Amenaza, crisis, datos personales, fraude, legal, pago, reclamo, reclamo crítico, salud o seguridad | Que una persona revise antes de responder |

### Recomendación de respuesta con IA

Al abrir un caso abierto en la **Bandeja** o en **Gestión DMs/comentarios**, el recuadro **Recomendación de respuesta con IA** pide a DeepSeek una respuesta sugerida:

- **Se basa solo en el QA aprobado y vigente de la marca** para ese canal, más los últimos mensajes de la conversación y, en comentarios, el texto de la publicación.
- **Muestra en qué se basa:** las respuestas QA usadas, o el aviso "sin respuesta aprobada que la cubra" cuando el QA no cubre la consulta. En ese caso la IA no inventa: agradece, deriva o pide el dato que falta, como el número de pedido.
- **Advierte lo que no puede verificar:** si la sugerencia menciona un precio, número, enlace, correo o cuenta que no está en el QA citado ni en lo que escribió el cliente, aparece en ámbar para revisarlo.
- **Marca los casos delicados** (reclamos graves, temas legales, salud…) para responderlos con criterio.
- **Saluda por el nombre sin ver el nombre:** la IA escribe un marcador y el servidor pone el nombre de pila del cliente.
- **Se usa a mano:** el texto pasa al compositor solo con **Usar recomendación**; la persona lo edita y lo envía como siempre. **Otra sugerencia** pide una nueva.
- **No cobra dos veces:** reabrir el mismo caso devuelve la sugerencia guardada (30 minutos) sin llamar a la API.
- **Sin IA:** si la IA está apagada o la marca no está autorizada, el recuadro dice **Respuesta sugerida por reglas** y muestra la plantilla del protocolo SAC.

### Asistente de wiwo.sac

El orbe de la barra superior abre un asistente, como el de WiwoMetriQ, que responde cómo se usa wiwo.sac: dónde está cada función, qué permite el rol de quien pregunta y qué significa cada estado. Tiene preguntas sugeridas y sabe en qué sección está la persona. **Solo orienta**: no hace cambios, no envía mensajes y no ve casos ni clientes; a la IA solo le llegan la guía de uso, el rol, los permisos y la pregunta (con datos personales enmascarados si alguien los pega). Con la IA apagada, responde las preguntas sugeridas con respuestas escritas.

**Costo:** cada pregunta usa unos 2.800 tokens de entrada (sobre todo la guía) y unos 200 de salida, en 2 a 3 segundos: unos **USD 0,001 por pregunta** en hora punta, o **USD 1,10 por cada 1.000 preguntas**. Hay un límite de 30 preguntas por persona cada 10 minutos.

### Spam y ruido

Además de caso o ruido, la IA dice **qué tipo de ruido** es cada mensaje: reacción social, etiquetas o concurso, spam promocional o estafa que suplanta a Meta. Esa señal se suma a reglas que no usan IA (el mismo comentario repetido por una cuenta, el mismo texto desde varias cuentas, comentarios que solo etiquetan). En la Bandeja y en Gestión comentarios aparece el aviso **Posible spam** con el motivo, el spam va al final de la fila y un supervisor puede **descartarlo en lote** después de confirmar. Lo que solo sugiere la IA se muestra pero nunca se oculta por defecto. Detectar el tipo de ruido no agrega llamadas: viene en la misma clasificación.

### Qué cambia hoy en la web

- **Los casos sensibles van a revisión humana.** Si la IA marca un mensaje como sensible, el protocolo SAC lo deja en "revisión humana" (motivo `AI_SENSITIVE_SIGNAL`, riesgo al menos alto). Eso tiene tres efectos:
  - el caso no puede salir por respuesta automática;
  - enviarle una respuesta exige la aprobación de una persona;
  - no se archiva junto con los casos vencidos.
- **Todo lo demás queda "en sombra".** La categoría, el tono y la decisión caso/ruido se guardan aparte y todavía **no cambian** Reportes, la Bandeja, el Inicio ni el estado de los casos.
- **Medir antes de confiar.** Mientras dure la sombra, se compara cuántas veces la IA coincide con lo que el equipo marcó a mano (`GET /api/ai/agreement?month=AAAA-MM`, para supervisores y admins). Cuando la coincidencia sea suficiente, se decide si la clasificación pasa a contar en el reporte.

### Qué no hace

- No envía mensajes ni activa el envío automático: la recomendación de respuesta solo llega al compositor si una persona la usa.
- No escribe en Metricool.
- No cambia lo que una persona marcó a mano. Lo manual siempre manda.
- No ve nombres, usuarios ni identificadores de Metricool. Antes de salir, el texto se enmascara: correos, teléfonos, RUT, tarjetas, @usuarios y enlaces se reemplazan por marcadores como `[EMAIL]` o `[TELEFONO]`.
- No clasifica los registros cargados desde la planilla ni los mensajes sin texto.


## 2. Cuánto cuesta

### Precio de la API

BytePlus cobra por tokens. Un token es un pedazo de palabra: en español, unas 3 o 4 letras.

| Modelo | Entrada (por millón de tokens) | Salida (por millón de tokens) |
|---|---|---|
| `deepseek-v4-1-flash-261017` (el que usamos), hora punta | USD 0,30 | USD 1,20 |
| `deepseek-v4-1-flash-261017`, fuera de hora punta | USD 0,15 | USD 0,60 |
| `deepseek-v4-1-flash-economy-261017` (variante económica) | USD 0,12–0,24 | USD 0,48–0,96 |

Estos precios vienen de comparadores externos ([Maxim](https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/byteplus/model/deepseek-v4-1-flash-261017), [models.dev](https://models.dev/models/deepseek/deepseek-v4.1-flash-1017/), [toolso.ai](https://toolso.ai/tool/byteplus)), que no coinciden del todo. BytePlus no publica una tabla única: **la tarifa real hay que confirmarla en la consola de facturación de BytePlus.** Los cálculos de abajo usan la tarifa de hora punta, que es la más cara.

### Cuánto consume cada mensaje

Lo medimos en una corrida real con 60 mensajes ficticios de la demo:

- **Entrada:** unos 121 tokens por mensaje. Incluye las instrucciones fijas, repartidas en lotes de 20, y el texto del mensaje, recortado a 600 caracteres como máximo.
- **Salida:** unos 55 tokens por mensaje, la clasificación en JSON.
- **Tiempo:** unos 10 segundos para los 60 mensajes.

Eso da **unos USD 0,10 por cada 1.000 mensajes** en hora punta, o USD 0,05 fuera de ella.

### Gasto mensual estimado

| Mensajes entrantes al mes | Hora punta | Fuera de hora punta |
|---|---|---|
| 2.000 | USD 0,20 | USD 0,10 |
| 5.000 (estimación para ~20 marcas) | USD 0,51 | USD 0,26 |
| 10.000 | USD 1,02 | USD 0,51 |
| 20.000 | USD 2,04 | USD 1,02 |
| 50.000 | USD 5,10 | USD 2,55 |

**Reclasificar meses anteriores** es un gasto único: un año de historia a 5.000 mensajes al mes (60.000 mensajes) cuesta unos USD 6.

Los mensajes cortos (emojis, "gracias") consumen menos que el promedio y los largos más, hasta el tope de 600 caracteres. Por eso conviene leer estas cifras como un orden de magnitud y no como una factura.

### Cuánto cuesta cada recomendación de respuesta

Medido en vivo con mensajes ficticios: unos **1.070 tokens de entrada** (instrucciones, QA de la marca y el caso) y **140 de salida** por sugerencia, en 2 a 3 segundos. Eso es **unos USD 0,0005 por sugerencia** en hora punta, o **USD 0,50 por cada 1.000**. Una marca con mucho QA aprobado consume más entrada; se puede estimar sumando unos 30 tokens por cada respuesta QA.

| Sugerencias al mes | Hora punta | Fuera de hora punta |
|---|---|---|
| 2.000 | USD 1,00 | USD 0,50 |
| 5.000 | USD 2,50 | USD 1,25 |
| 10.000 | USD 5,00 | USD 2,50 |

Se genera una sugerencia por cada caso abierto que alguien abre (y otra cada vez que se pulsa **Otra sugerencia** o llega un mensaje nuevo al hilo). Reabrir el mismo caso dentro de 30 minutos no cuesta nada.

**Total con clasificación y recomendaciones**, a 5.000 mensajes y 5.000 sugerencias al mes: unos **USD 3 mensuales** en hora punta.

### Qué no genera gasto

- **Sin mensajes nuevos no se llama a la API.** El worker revisa cada 5 minutos, pero si no hay mensajes pendientes no hace ninguna llamada.
- **Cada mensaje se clasifica una sola vez.** Lo ya clasificado, lo marcado a mano, la planilla y los mensajes sin texto se saltan.
- **Solo pagan las marcas autorizadas.** Una marca que no está en la lista no envía nada.

### Cómo se mantiene acotado

| Control | Qué limita | Valor por defecto |
|---|---|---|
| `SAC_FLOW_AI_ENABLED` | Interruptor general | Apagado |
| `SAC_FLOW_AI_BRAND_IDS` | Qué marcas envían mensajes | Ninguna |
| `SAC_FLOW_AI_MAX_PER_RUN` | Mensajes por pasada del worker | 100 |
| `SAC_FLOW_AI_INTERVAL_SECONDS` | Cada cuánto corre | 300 s (5 min) |
| `SAC_FLOW_AI_LOOKBACK_DAYS` | Antigüedad máxima de lo que mira | 7 días |
| `SAC_FLOW_AI_MODEL` | Modelo; se puede pasar a la variante económica | `deepseek-v4-1-flash-261017` |

Con los valores por defecto, el máximo teórico es de 100 mensajes cada 5 minutos, unos 28.800 al día. Eso son menos de USD 3 diarios, aun si llegara ese volumen, que es muy superior al real.

**Pendiente:** un tope de gasto mensual que apague la IA sola al llegar a un monto (`SAC_FLOW_AI_MONTHLY_BUDGET_USD` en la propuesta) todavía no está implementado. Mientras tanto, conviene configurar una alerta de facturación en la consola de BytePlus.

### Cómo ver el gasto real

- **Consola de BytePlus:** facturación y consumo por modelo. Es la cifra oficial.
- **Registros del worker:** cada pasada deja un evento `ai_shadow_triage` con mensajes clasificados, sensibles, lotes fallidos y tokens de entrada y salida. Nunca incluye textos. Sumar esos tokens y multiplicarlos por la tarifa da el gasto del período.

### Comparación con otras opciones

A este volumen, el precio no decide el proveedor. Estimaciones para 5.000 mensajes al mes, tomadas de la propuesta:

| Opción | Clasificación (5.000 mensajes/mes) |
|---|---|
| DeepSeek V4.1 Flash en BytePlus (medido) | ~USD 0,50 |
| Claude Haiku 5.5 | ~USD 0,35 |
| Claude Sonnet 5.5 | ~USD 6,50 |
| Claude Opus 5.5 | ~USD 13 |

Las cifras de Claude son estimaciones, no mediciones. Cambiar de proveedor es configuración (`SAC_FLOW_AI_PROVIDER`), así que lo que debería decidir es la calidad medida con la concordancia y las condiciones de tratamiento de datos.

## 3. Lo que viene y su costo estimado

Nada de esto está implementado. Son las fases siguientes de la propuesta, calculadas con DeepSeek en hora punta:

| Función | Qué ayudaría en la web | Volumen supuesto | Gasto estimado |
|---|---|---|---|
| **Resumen de conversación** | Ponerse al día con un hilo largo o en un cambio de turno | 500 al mes | ~USD 0,60 |
| **Cierre del reporte mensual** | Borrador de la "lectura del mes" y dos próximos pasos por marca, para editar | 20 al mes | ~USD 0,07 |
| **Vacíos del QA** | Proponer preguntas frecuentes que aún no tienen respuesta aprobada | Mensual | Menos de USD 0,10 |

La recomendación de respuesta ya está implementada (ver arriba). Con todo funcionando y 5.000 mensajes al mes, el total rondaría los **USD 4 mensuales**.

## 4. Datos personales

- **Dónde se procesa:** BytePlus es la nube internacional de ByteDance. Los mensajes no van a los servidores de DeepSeek en China, sino a la región Asia Pacífico de BytePlus (Johor, Malasia). BytePlus indica que puede procesarlos en Malasia, Indonesia o la UE.
- **Condiciones de BytePlus:** actúa como encargado del tratamiento y no entrena modelos con los datos sin autorización. Guarda 180 días solo el contenido que activa su filtro de seguridad.
- **Antes de autorizar una marca** hay que tener su visto bueno al tratamiento de datos por un tercero fuera de Chile (Ley 21.719). Por eso cada marca se habilita por separado.
- **La clave de la API** vive solo en el servidor. Nunca llega al navegador, a los registros ni al repositorio.

## 5. Cómo se enciende y se apaga

Lo hace un administrador en el servidor; el paso a paso está en [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md), sección "IA en modo sombra".

1. Aplicar la migración `0020_ai_triage.sql`.
2. En el `.env` del servidor, definir `SAC_FLOW_AI_ENABLED=true`, `BYTEPLUS_API_KEY` y `SAC_FLOW_AI_BRAND_IDS` con las marcas autorizadas.
3. Reiniciar la API y el worker.

Para apagarla, `SAC_FLOW_AI_ENABLED=false` y reiniciar el worker. Lo ya clasificado queda guardado y no afecta los reportes.
