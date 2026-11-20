# Propuesta: IA en wiwo.sac

Estudio de posibilidades, no implementación. Fecha: 2026-11-20. Precios y modelos según la referencia de la API de Claude vigente a esa fecha; antes de implementar hay que confirmarlos en la página de precios de Anthropic.

## Resumen

- **Ya hay IA escrita, pero no conectada a la aplicación.** `server/ai-classifier.ts` (clasificación caso SAC/ruido, categoría, tono y derivación) y `server/sac-editorial.ts` (cierre del informe mensual) llaman a Claude, pero solo los usan scripts de consola (`scripts/classify-interactions.mjs`, `scripts/draft-sac-editorial.mjs`). Ninguna ruta de la API ni el worker los invoca.
- **La "Recomendación de respuesta con IA" de la bandeja no usa IA.** Es una plantilla por reglas (`proposal` de `evaluateSacInteraction`): una respuesta del Excel QA aprobado si la intención detectada con expresiones regulares coincide, o un texto genérico si no.
- **Recomendación: empezar por la clasificación en modo sombra** (fase 1). El código ya existe, cada mensaje expone poco dato, nunca le escribe al cliente, cuesta del orden de USD 15 al mes y las marcas manuales del equipo sirven para medir la calidad. El borrador de respuesta con IA viene después (fase 2), solo a pedido del agente y nunca habilitado para envío automático.

## 1. Qué existe hoy

| Pieza | Dónde | Estado |
|---|---|---|
| SDK `@anthropic-ai/sdk` `^0.122.0` | `package.json` | Instalado. Solo lo importan los dos módulos de abajo. |
| Clasificador por lotes | [server/ai-classifier.ts](../server/ai-classifier.ts) | Usa `messages.parse` con un esquema Zod y caché del prompt de sistema, con `effort: "low"`. Envía `id`, texto (máximo 600 caracteres), canal y tipo; **no** envía nombre ni usuario. Modelo fijo en el código: `claude-opus-5`. |
| Script de clasificación | [scripts/classify-interactions.mjs](../scripts/classify-interactions.mjs) | Escribe `category`, `sentiment`, `confidence` y `sacTriage` (`modelo: "claude-opus-5"`). Se puede reanudar. |
| Redacción editorial del informe | [server/sac-editorial.ts](../server/sac-editorial.ts) + `scripts/draft-sac-editorial.mjs` | Recibe las cifras ya calculadas y una muestra de casos, y devuelve un borrador que una persona aprueba. Tiene tests (`tests/server/sac-editorial.test.ts`). Se diseñó para la plantilla PPTX, que hoy la web no usa. |
| Clasificación sin IA | [server/sac-report.ts:208](../server/sac-report.ts) `esMensajeGestionado`, [:272](../server/sac-report.ts) `esCasoSac` | Reglas: reacciones, menciones, emojis, textos ilegibles o de menos de 4 palabras no son caso. Si existe `sacTriage`, manda sobre las reglas. |
| Triage manual | [server/app.ts:687](../server/app.ts) `applyManualTriage`; rutas `PUT /api/interactions/:id/triage` y `POST /api/interactions/triage` | `sacTriage.modelo = "manual"` con `marcadoPor` y entrada de auditoría. Reportes ya distingue el origen: `manual`, `ia` o `reglas`. |
| Protocolo SAC por reglas | [server/sac-automation.ts](../server/sac-automation.ts) | Intención por regex (`INTENT_RULES`), riesgo, conocimiento (`approved`/`missing`/`live_source_required`), ruta recomendada y efectiva. `auto_reply` exige una respuesta QA aprobada para esa intención, más todas las compuertas. |
| "Recomendación IA" en la UI | [InteractionDetailPanel.tsx:755](../src/components/InteractionDetailPanel.tsx), [ManualManagementView.tsx:1239](../src/components/ManualManagementView.tsx) | Muestra `automation.proposal.text`, que es una plantilla. El texto solo pasa al compositor si el agente pulsa "Usar recomendación". |
| Excel QA aprobado | [server/brand-qa-workbook.ts](../server/brand-qa-workbook.ts) | Solo las filas Aprobada/Activo/Vigente y no vencidas alimentan `sacPolicy.approvedAnswers`. |
| Variables de entorno de IA | `.env.example` | **No hay ninguna.** `ANTHROPIC_API_KEY` no está documentada. |
| Decisión de arquitectura | [docs/ARCHITECTURE.md](ARCHITECTURE.md), "Decisiones que Techlab debe cerrar" | Deja abierto el "uso de IA, proveedor, residencia de datos y aprobación humana". No hay más detalle. |

### Problemas encontrados en lo existente

1. **`--rehacer` pisa las marcas manuales.** `scripts/classify-interactions.mjs:46` filtra `rehacer || !i.sacTriage`, así que con `--rehacer` reemplaza `sacTriage.modelo = "manual"`. Eso contradice la regla de que lo marcado a mano siempre manda.
2. **La IA puede bajar la alerta en vez de solo subirla.** El script sobrescribe `sentiment` y `confidence`, que lee el protocolo (`classify()` en `sac-automation.ts:78`). Un `negative` que viene de Metricool puede quedar como `neutral`, y una confianza alta puede saltarse `LOW_CLASSIFICATION_CONFIDENCE`.
3. **La taxonomía de la IA no coincide con las categorías de revisión obligatoria.** `SAC_CATEGORIES` no incluye `amenaza`, `fraude`, `legal`, `salud`, `seguridad`, `datos_personales` ni `crisis`, y usa `pago_facturacion` donde `HUMAN_INTENTS` y `safety-policy.ts` esperan `pago`. Un cobro que la IA clasifica como `pago_facturacion` y que ninguna regex detecta no termina en revisión humana.
4. **La etiqueta de la UI es engañosa.** Dice "con IA" y muestra un "% confianza" que sale de reglas. Mientras no haya IA real, debería decir "Respuesta sugerida (QA aprobado)".
5. **Modelo fijo en el código.** `claude-opus-5` está escrito a mano en tres lugares. Debería venir de configuración, y el valor por defecto actual es `claude-opus-5-5`, más barato ($4/$20 por millón de tokens contra $5/$25).

Los cuatro primeros conviene corregirlos en la fase 0, antes de que cualquier resultado de IA llegue a la bandeja.

## 2. Casos de uso, ordenados por valor y riesgo

| # | Caso | Valor | Riesgo | Fase |
|---|---|---|---|---|
| A | Clasificar caso/ruido, categoría y derivación | Alto: reportes confiables. Hoy cerca del 74% cae en "otro", según el propio módulo. | Bajo: no le escribe a nadie y la marca manual manda. | 1 |
| B | Detectar casos sensibles o negativos (solo para escalar) | Alto: los reclamos de pago o legales se encuentran antes. | Bajo, si la IA **solo puede agregar** revisión humana y nunca quitarla. | 1, en la misma llamada que A |
| C | Borrador de respuesta basado en el QA aprobado de la marca | Alto: ahorra tiempo de redacción por caso. | Medio: alucinación, inyección de instrucciones desde el mensaje del cliente, tono incorrecto. Se controla con aprobación humana. | 2 |
| D | Resumen de conversación larga | Medio: sirve para traspasos entre turnos y en hilos largos. | Bajo: lo lee solo el equipo. | 2 |
| E | Cierre editorial del informe mensual | Medio: hoy no hay PPTX, pero el texto sirve en Reportes. | Bajo: trabaja con cifras agregadas y lo aprueba una persona. | 3 |
| F | Detectar vacíos del QA (intenciones frecuentes sin respuesta aprobada) | Medio: mejora el Excel QA de cada marca. | Bajo: propone filas que la marca aprueba. | 3 |
| — | Envío automático de texto generado por IA | — | Alto | **Fuera de alcance.** |

### A + B. Clasificación y señales sensibles

- **Dónde vive:** se reutiliza `server/ai-classifier.ts`, ampliando el esquema con `sensible: boolean` y `motivoSensible` (con las categorías de `MANDATORY_HUMAN_REVIEW_CATEGORIES`). Se dispara desde el worker (`server/worker.ts` / `worker-sync.ts`) después de cada ingesta, en lotes de 20 a 40 mensajes nuevos. La reclasificación de un mes completo puede usar la Batch API (50% más barata, respuesta en horas).
- **Dónde se guarda:** en modo sombra, un campo aparte (`aiTriage`) que todavía no cuenta en Reportes. Cuando la concordancia con las marcas manuales sea suficiente, se promueve a `sacTriage` con `modelo = <id del modelo>` y `promptVersion`.
- **Datos que salen:** id interno, texto recortado a 600 caracteres, canal y tipo. Nunca nombre, usuario, `userId`/`blogId` ni identificadores de Metricool. Antes de enviar, se enmascaran RUT, correos, teléfonos y números de tarjeta (`[RUT]`, `[EMAIL]`…).
- **Reglas de seguridad:**
  - Lo marcado a mano nunca se reclasifica, y el lote no toca `modelo = "manual"`.
  - La IA solo puede **subir** el riesgo. `sensible = true` o un tono `negative` fuerzan `human_review`. Un tono positivo de la IA no borra un `negative` de reglas o de Metricool, y la confianza de la IA no entra en el umbral `minimumConfidence` que habilita `auto_reply`.
  - Si Claude rechaza la solicitud (`stop_reason: "refusal"`) o falla, el mensaje se queda con las reglas, sin bloquear la ingesta.

### C. Borrador de respuesta basado en el QA aprobado

- **Dónde vive:** un módulo nuevo, `server/ai-reply-draft.ts`, y la ruta `POST /api/interactions/:id/ai/draft`, que solo se llama a pedido con un botón "Sugerir con IA". En la UI reemplaza el contenido de la sección `case-ai-recommendation` (Bandeja) y del bloque "Recomendación IA" (Gestión DMs/comentarios). Igual que hoy, el texto entra al compositor solo con "Usar sugerencia".
- **Contexto que recibe el modelo:**
  - instrucciones, tono y locale de la marca (`sacPolicy`) y sus respuestas QA aprobadas y vigentes para el canal. Es un bloque estable por marca, y se cachea;
  - los últimos 10 mensajes de la conversación enmascarados, más el contexto de la publicación si es un comentario.
- **Salida estructurada:** `{ texto, fuentesQa: string[], sinRespuestaAprobada: boolean, requiereHumano: boolean, motivo }`.
- **Controles:**
  - El nombre del cliente nunca sale. El modelo escribe `{nombre}` y el servidor lo reemplaza con `greetingName`, como ya hace `interpolate`.
  - Validación posterior: cada precio, número, URL o teléfono del borrador tiene que aparecer en las fuentes QA citadas. Si no aparece, el borrador se marca "requiere verificación" y no se ofrece como respuesta lista.
  - El mensaje del cliente va como dato, nunca como instrucción. El modelo no tiene herramientas y la salida es solo el JSON.
  - Sin QA aplicable, el borrador es una respuesta de contención ("lo revisamos y te escribimos") o la recomendación de derivar, nunca una respuesta inventada.
  - Un borrador de IA **nunca** es elegible para `auto_reply`. La ruta queda `draft` con un código nuevo, `AI_DRAFT_NOT_AUTOSENDABLE`. El envío sigue por el camino manual actual, con la confirmación existente, el plazo de Meta advertido y la idempotencia de entregas.

### D. Resumen de conversación

- **Dónde vive:** `POST /api/interactions/:id/ai/summary`, a pedido y solo en hilos de más de 8 mensajes. Se muestra plegado en el panel de detalle. Se guarda en caché local por `contactKey` y la versión del último mensaje, para no pagar dos veces.
- **Datos que salen:** el hilo enmascarado. La salida no se envía a nadie ni se usa para decidir rutas.

### E. Cierre editorial del informe

- **Dónde vive:** se conecta `server/sac-editorial.ts` a la vista Reportes como "Borrador de lectura del mes", detrás de `metrics.read`. El texto se puede editar y se guarda por marca y mes. Hoy no hay PPTX, así que solo se muestra y se copia.
- **Datos que salen:** cifras agregadas y una muestra de casos que ya pasaron por el enmascarado. El prompt ya prohíbe citar textualmente y nombrar a clientes finales.

### F. Vacíos del QA

- Toma las intenciones con `APPROVED_KNOWLEDGE_MISSING` más frecuentes del mes y propone preguntas y respuestas candidatas para el Excel QA de la marca, con estado "Propuesta". Solo cuentan después de que la marca las apruebe, porque `brand-qa-workbook.ts` ya filtra por estado.

## 3. Modelo, costo y volumen

**Supuestos:** 20 marcas, unos 5.000 mensajes entrantes al mes, 2.000 borradores pedidos al mes (alrededor del 40% de los casos abiertos), 500 resúmenes y 20 cierres editoriales. El costo crece casi linealmente: con 20.000 mensajes al mes, multiplicar por 4. Son estimaciones; hay que medirlas con `usage` en la fase 1.

Tokens estimados por unidad:

- clasificación: unos 150 de entrada (incluye el prompt de sistema prorrateado en lotes de 40) y unos 100 de salida;
- borrador: unos 1.000 de entrada sin caché, más 4.000 del bloque de marca cacheable, y unos 650 de salida (incluye el razonamiento con `effort: "medium"`);
- resumen: unos 2.500 de entrada y 400 de salida;
- editorial: unos 3.000 de entrada y 2.000 de salida.

| Caso | Claude Opus 5.5 (`claude-opus-5-5`, $4/$20 por MTok) | Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2/$10) | Claude Haiku 5.5 (`claude-haiku-5-5`, $0,10/$0,50) |
|---|---|---|---|
| A+B clasificación (5.000/mes) | ~USD 13 (~6,5 con Batch API) | ~USD 6,5 | ~USD 0,35 |
| C borradores (2.000/mes, con caché al 50%) | ~USD 40–80 | ~USD 20–40 | ~USD 1–3 |
| D resúmenes (500/mes) | ~USD 9 | ~USD 4,5 | ~USD 0,25 |
| E editorial (20/mes) | ~USD 1 | ~USD 0,5 | <USD 0,05 |
| **Total** | **~USD 65–105/mes** | **~USD 30–50/mes** | **~USD 2–4/mes** |

- **Modelo por defecto:** Claude Opus 5.5 (`claude-opus-5-5`), el modelo actual por defecto de la API. Usar `effort: "low"` para clasificar y `"medium"` para redactar. En este modelo el razonamiento no se puede desactivar, solo bajar el `effort`.
  - Haiku 5.5 cuesta unas 40 veces menos y podría bastar para clasificar. Usarlo es **una decisión del equipo**, que conviene tomar con la evaluación de la fase 1: misma muestra, concordancia con las marcas manuales y con el mismo umbral de calidad.
  - El modelo se configura por caso con `SAC_FLOW_AI_MODEL_CLASSIFY` y `SAC_FLOW_AI_MODEL_DRAFT`.
- **Caché de prompts:**
  - el prompt de sistema del clasificador y el bloque QA de cada marca van primero, con `cache_control`; lo variable (mensajes, fechas, ids) va después;
  - la lectura cacheada cuesta $0,20 por MTok en Opus 5.5, y la escritura, 1,25 veces la entrada;
  - un prompt corto puede quedar bajo el mínimo cacheable del modelo. Se verifica con `usage.cache_read_input_tokens`.
- **Rechazos:** activar el parámetro `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) y tratar siempre `stop_reason: "refusal"`. Ante un rechazo, el caso queda con reglas y a revisión humana.
- **Presupuesto:** un tope mensual (`SAC_FLOW_AI_MONTHLY_BUDGET_USD`) que, al alcanzarse, apaga los borradores y deja solo la clasificación. Un contador local de tokens por caso de uso y por marca.

## 4. Datos personales y proveedor

- **Qué sale:** texto de DMs y comentarios, que son datos personales de los clientes de cada marca. Con el enmascarado se quitan RUT, correo, teléfono, tarjeta, nombre y usuario, pero el texto libre puede seguir identificando a alguien. Hay que tratarlo como dato personal de todas formas.
- **Ley 21.719:** la ley chilena de protección de datos entra en vigor en diciembre de 2026, según su plazo de 24 meses desde la publicación. Antes de la fase 1, legal debe confirmar:
  - si cada marca cliente autoriza a Anthropic como encargado o subencargado;
  - la transferencia internacional, porque la inferencia ocurre fuera de Chile;
  - el texto de la política de privacidad.
- **Términos de Anthropic:** con la API comercial, los datos no se usan para entrenar por defecto. Hay que confirmar el plazo de retención vigente y, si el contrato con las marcas lo exige, pedir retención cero (ZDR) y revisar qué funciones usadas son elegibles (caché, Batch API).
  - `inference_geo` fija la geografía de inferencia, por ejemplo `"us"`. No hay opción en Chile.
- **Credenciales:** `ANTHROPIC_API_KEY` vive solo en el servidor, o en la bóveda de credenciales (`server/credential-vault.ts`), igual que el token de Metricool. Nunca llega al navegador, a un fixture ni a un log.
- **Activación por marca:** la IA se activa por marca (`brand.aiEnabled`, apagado por defecto) además del interruptor global. Una marca que no autoriza nunca envía datos al proveedor.
- **Retención local:** los borradores y resúmenes se guardan con la interacción y siguen su misma retención. Los registros de llamadas no guardan texto, solo metadatos.

## 5. Aprobación humana, permisos y auditoría

**Invariantes**, que deberían tener un test cada una:

1. Ningún texto generado por IA se envía sin que una persona pulse enviar. La IA no habilita `auto_reply` y el envío automático sigue apagado por defecto, con sus compuertas actuales.
2. Lo marcado a mano siempre manda. La IA nunca escribe sobre `modelo = "manual"` y el triage en lote tampoco lo pisa.
3. La IA solo escala: puede mandar a revisión humana, nunca sacar de ella.
4. Con la IA apagada (`SAC_FLOW_AI_ENABLED=false`, el valor por defecto) o sin clave, todo funciona exactamente como hoy.
5. El modo demo usa un cliente falso inyectado (los módulos ya aceptan `client`) y no necesita credenciales.

**Permisos** (`server/permissions.ts` y `src/lib/permissions.ts`):

| Clave nueva | Para qué | Por defecto |
|---|---|---|
| `ai.suggest` | Pedir borrador o resumen | Agente, Supervisor, Admin |
| `ai.classify` | Reclasificar un mes o una marca en lote, y ver la concordancia | Supervisor, Admin |
| Activar IA, elegir modelo, presupuesto y marcas habilitadas | Configuración del proveedor | Solo Admin, no delegable (`ADMIN_ONLY_CAPABILITIES`). Activar una marca debería ser exclusivo de los administradores maestros, porque es una transferencia de datos de un cliente. |

**Auditoría:**

- Cada llamada registra: caso de uso, ids de interacción, marca, modelo, `promptVersion`, tokens de entrada, salida y caché, latencia, resultado (`ok`, `refusal` o error) y actor. **Nunca** el texto.
- En la interacción, entradas de auditoría `ai_classified`, `ai_draft_suggested` y `ai_summary`.
- Al enviar una respuesta se guarda el origen del texto (`human`, `ai`, `ai_edited`) y cuánto lo cambió la persona. Así se mide si los borradores sirven.
- Reportes ya muestra el origen de la clasificación (manual, IA, reglas). Se agrega la versión del modelo.
- `/api/metrics` agrega solo conteos y costos, sin datos personales.

**Configuración nueva** (actualizar `.env.example`, README, `docs/API_CONTRACT.md`, `docs/SECURITY.md` y el runbook en el mismo cambio):
`SAC_FLOW_AI_ENABLED`, `ANTHROPIC_API_KEY`, `SAC_FLOW_AI_MODEL_CLASSIFY`, `SAC_FLOW_AI_MODEL_DRAFT`, `SAC_FLOW_AI_MONTHLY_BUDGET_USD`, `SAC_FLOW_AI_INFERENCE_GEO`.

## 6. Plan por fases

**Fase 0 — Bases (≈1 semana, sin llamar a la IA desde la app)**
- Decisión legal y contractual de la sección 4, y lista de marcas que autorizan.
- Corregir los cuatro problemas de la sección 1:
  - que `--rehacer` respete lo manual;
  - que la IA solo escale;
  - alinear la taxonomía con las categorías obligatorias;
  - cambiar la etiqueta de la UI.
- Cliente común (`server/ai-client.ts`): configuración, interruptor global y por marca, enmascarado, presupuesto, registro de auditoría, rechazos y errores tipados (hoy duplicados en dos módulos).
- Permisos y variables nuevas, y tests de los cinco invariantes.
- Conjunto de evaluación: los mensajes que el equipo ya marcó a mano son la verdad de referencia. Se guarda fuera del repositorio, porque contiene datos reales.

**Fase 1 — Clasificación en sombra (2–4 semanas)**
- El worker clasifica cada ingesta en `aiTriage` sin efecto en Reportes ni en la bandeja, salvo la señal sensible, que puede escalar desde el primer día.
- Panel de concordancia para supervisores: IA contra marca manual y contra reglas, por marca y categoría.
- Promover a `sacTriage` cuando la concordancia con lo manual supere un umbral acordado. Aquí se decide con datos si basta Haiku 5.5.

**Fase 2 — Borrador y resumen a pedido (3–4 semanas)**
- "Sugerir con IA" en la Bandeja y en Gestión DMs/comentarios, con fuentes QA citadas, validación de cifras y enlaces, y `{nombre}` reemplazado en el servidor.
- Resumen de hilos largos.
- Piloto con 2 o 3 marcas que tengan un QA aprobado sólido; medir el origen del texto enviado y cuánto se edita.

**Fase 3 — Reporte y QA**
- Borrador de lectura del mes en Reportes, con `sac-editorial.ts`.
- Propuestas de filas QA para intenciones frecuentes sin respuesta aprobada.

**No contemplado:** envío automático de texto generado por IA, agentes con herramientas sobre Metricool y cualquier escritura en Metricool desde la IA. Si algún día se considera, requiere otra propuesta y una autorización explícita.

## 7. Por dónde empezar

La fase 0 completa y, en seguida, la fase 1 en sombra:

- reutiliza código ya escrito y probado;
- expone el mínimo de datos por mensaje: texto corto enmascarado, sin identidad;
- no le escribe a ningún cliente;
- cuesta del orden de USD 15 al mes con el modelo por defecto;
- resuelve el problema más visible de hoy, el informe donde casi todo es "otro";
- deja medida la calidad, con las marcas manuales del equipo, antes de poner IA frente a un agente en el compositor.
