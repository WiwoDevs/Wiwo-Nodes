# Opciones para leer y responder DMs de TikTok y LinkedIn en wiwo.sac

Investigación del 25 de noviembre de 2026. Es un documento de decisión: no cambia nada del producto. Todos los precios y condiciones se consultaron en esa fecha, salvo que se indique otra.

**Cómo leer las marcas:**

- **[V] Verificado:** se leyó en la fuente oficial del proveedor (documentación, centro de ayuda o página de precios).
- **[T] Tercero:** lo dice un integrador o partner, no el dueño de la red. Por ejemplo, respond.io hablando de las reglas de TikTok.
- **[S] Supuesto:** es una inferencia nuestra o un dato que no pudimos leer en la fuente oficial.

---

## 1. En resumen

- **TikTok sí se puede.** Existe una vía oficial, la **TikTok Business Messaging API**, para leer y responder DMs desde un servidor. Tiene condiciones:
  - Solo sirve para cuentas **Business**.
  - El cliente siempre escribe primero.
  - Hay **48 horas** para responder.
  - No funciona en cuentas registradas en Europa ni en el Reino Unido.

  Se puede usar de tres formas: pidiendo acceso directo a TikTok, a través de un agregador con API (Zernio) o mediante un partner de mensajería (respond.io, Infobip, Gupshup). Las tres caben detrás de un adaptador como el de Metricool.
- **LinkedIn casi no se puede.**
  - Los DMs de **Páginas de empresa** solo se exponen a seis partners elegidos por LinkedIn: Bird, Brandwatch, Hootsuite, Oktopost, Sprinklr y Zoho.
  - No hay API pública para nosotros.
  - De los seis partners, **Bird** es el único que documenta una API propia para conectarlo a otro sistema.
  - Las alternativas que usan la sesión de un perfil personal, como Unipile o los scrapers, van contra las condiciones de LinkedIn y no se recomiendan.
- **Metricool no lo trae ni lo anuncia para nuestra región.**
  - Su Inbox no tiene DMs de TikTok ni de LinkedIn.
  - Lo único en camino es un flujo automático de DMs de TikTok ("DM → DM"), marcado como "próximamente" y **solo para Estados Unidos**.
- **Recomendación corta:**
  1. Medir primero cuántos DMs de TikTok y LinkedIn llegan hoy por la planilla.
  2. Si el volumen de TikTok lo justifica, pedir el acceso directo a la Business Messaging API y, mientras se aprueba, hacer un piloto con Zernio.
  3. En LinkedIn, mantener la carga por Excel y pedir una cotización a Bird solo si el volumen es alto.

---

## 2. Qué hay hoy en wiwo.sac

| Red | Comentarios | DMs |
| --- | --- | --- |
| Instagram, Facebook | Sí, vía Metricool | Sí, vía Metricool |
| TikTok | Sí, vía Metricool (solo cuentas Business) | **No**: se cargan a mano desde la planilla (`Reportes → Cargar TikTok/LinkedIn`, `source: "planilla"`) |
| LinkedIn | Sí, vía Metricool | **No**: se cargan a mano desde la planilla |

Los casos cargados desde la planilla cuentan en Reportes y llegan a METRIQ. No aparecen en la bandeja, porque ya se atendieron fuera de wiwo.sac. El objetivo es que esos DMs entren a la Bandeja y a Gestión DMs como los de Instagram y Facebook, y que se puedan responder desde ahí.

---

## 3. Reglas de cada red (valen para cualquier herramienta)

Ninguna herramienta puede saltarse estas reglas, porque todas usan la misma API de la red. AGENTS.md exige respetarlas en el código y en la UI.

### TikTok: Business Messaging API

| Regla | Detalle | Fuente |
| --- | --- | --- |
| Tipo de cuenta | Solo **TikTok Business**. Las cuentas personales y Creator no se pueden conectar. | [T] respond.io, Chatwoot, Infobip; [V] Sprinklr |
| Quién inicia | Siempre el usuario. La marca no puede abrir conversaciones ni enviar difusiones. | [T] respond.io, Infobip |
| Ventana | **48 h** desde el último mensaje del usuario, con hasta **10 mensajes** seguidos de la marca. La ventana se reinicia cada vez que el usuario escribe. Sprinklr detalla el caso fino: 10 mensajes tras el primero del cliente, sin límite mientras el cliente responde y 3 más pasadas 48 h sin respuesta. | [T] respond.io; [V] Sprinklr |
| Región | No disponible para cuentas **registradas** en el EEE, Suiza o el Reino Unido. Según un extracto de la documentación de TikTok, está en "Open Beta" en APAC, LATAM, METAP y Norteamérica. Que Chile, Colombia y Perú estén habilitados es **[S]**: no figuran en ninguna exclusión, pero ninguna fuente los nombra. | [T] respond.io, Chatwoot; [V] Statusbrew, Hootsuite |
| Multimedia | Texto de hasta 6.000 caracteres e imagen JPG/PNG de hasta 3 MB. En **Colombia** (y en EE. UU., la UE y otros) no se pueden **enviar** archivos multimedia; el texto sí. | [T] respond.io |
| Solicitudes de mensaje | Los mensajes de quienes no siguen a la cuenta llegan como "solicitud". Hay que aceptarlos en la app de TikTok, o configurar la cuenta para recibir DMs de todos. | [T] Chatwoot; [V] Sprinklr |
| Acceso | Se postula en el portal de TikTok API for Business con caso de uso, manejo de datos y datos de la organización. TikTok lo aprueba "en pocos días". Desde abril de 2026 exige **Advanced Access**, que se obtiene vinculando la cuenta a Business Center. | [T] Chatwoot, respond.io (página modificada el 2026-11-20) |
| Técnica | OAuth por cuenta y **webhooks** para los mensajes entrantes. Necesita un endpoint HTTPS público. Límite de 10 consultas por segundo. | [T] respond.io, Chatwoot |
| Costo de la API | Gratis según respond.io. Cada partner cobra su propia tarifa. | [T] |

### LinkedIn: mensajes de Páginas

| Regla | Detalle | Fuente |
| --- | --- | --- |
| Qué existe | La bandeja de mensajes de **Páginas de empresa**, lanzada para todas las marcas en marzo de 2024. | [V] LinkedIn Help a1356464; SocialMediaToday 2024-03-27 |
| Quién inicia | El miembro. "Admins can only send a message to a member if they message the Page first". Solo los admins Super o de contenido leen y responden. | [V] LinkedIn Help |
| Acceso por API | Solo a través de **partners**: Bird CRM, Brandwatch, Hootsuite, Oktopost, Sprinklr y Zoho. No hay un programa abierto para nuevos integradores. | [V] LinkedIn Help a1356464 |
| Community Management API | **No incluye mensajería.** Cubre posts, comentarios, reacciones y analítica de la Página. | [V] learn.microsoft.com, actualizado 2026-05-15 |
| Messages API | Solo para partners aprobados y solo de miembro a miembro. Prohíbe el envío automatizado o programado. | [V] learn.microsoft.com |
| Pages Data Portability API | Incluye hilos y mensajes de la Página, pero **solo lectura**. Existe por la Ley de Mercados Digitales de la UE. Los datos del miembro llegan **ofuscados** salvo que la persona haya activado compartirlos (viene desactivado). | [V] learn.microsoft.com, actualizado 2026-11-24 |
| Ventana | No hay plazo numérico documentado. | [V] por omisión |
| Perfiles personales | No hay vía oficial. | [V] |

---

## 4. Tabla comparativa

El **esfuerzo** se mide en tamaños: **S** = días, **M** = 2 a 4 semanas, **L** = más de un mes o depende de aprobaciones o contratos externos. El costo es el publicado a la fecha. "Aparte" significa que el equipo tendría que trabajar en otra herramienta, fuera de wiwo.sac.

| Opción | DMs TikTok | DMs LinkedIn | ¿Integrable en el servidor? | Acceso | Costo (fuente) | Riesgo de términos | Esfuerzo |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **API oficial TikTok (directa)** | Leer y responder, solo Business | — | Sí: REST, OAuth y webhooks | Postular y obtener Advanced Access; regiones fuera de Europa | Gratis [T] | Bajo | M de código + L de trámite |
| **API oficial LinkedIn** | — | **No disponible** (solo partners) | No | Cerrado | — | — | Bloqueado |
| **LinkedIn Data Portability API** | — | Solo lectura, datos ofuscados | Sí, pero solo lee | Revisión de unos 7 días hábiles | Sin precio publicado | Medio: uso distinto del previsto | No recomendado |
| **Metricool** | No (Flow DM→DM "próximamente", solo EE. UU.) | No ("Private messages are not supported") | Ya integrado, pero sin estos DMs | Plan Advanced o Custom | Advanced 15 marcas USD 53/mes anual; 25 marcas USD 85 [V] | Bajo | S si algún día lo agrega |
| **Zernio** (antes Late) | Responder y recibir por webhook, solo Business fuera de Europa [V, con contradicciones] | **No** ("LinkedIn bloquea DMs") [V] | Sí, es una API | Cuenta en Zernio | 1–2 cuentas gratis, 3–10 USD 6, 11–100 USD 3 por cuenta/mes (unos USD 78 por 20 cuentas); 10.000 envíos/mes gratis [V] | Bajo | **S** |
| **respond.io** | Leer y responder, Business | No | Sí: API desde Growth, webhooks desde Advanced | Partner oficial de TikTok | Growth USD 159/mes anual (199 mensual); Advanced USD 279 (349) [V] | Bajo | M |
| **Infobip** | Leer y responder, Business; webhooks de entrada, entrega y lectura | No | Sí | Partner oficial de TikTok; contrato | Calculadora por país, sin cifra pública [V] | Bajo | M |
| **Gupshup, Blip.ai, Qiscus y otros partners** | Leer y responder | No | Sí (varía) | Partner oficial de TikTok | No verificado | Bajo | M |
| **Chatwoot** (código abierto) | Leer y responder con **nuestra propia** app aprobada | No | Sí, pero es otro servicio | Igual que la API directa | Gratis autoalojado | Bajo | M–L |
| **Bird** (MessageBird) | No como canal de DM | **Sí, Páginas**: bidireccional, con Channels API [V] | Probablemente sí [S] | Partner oficial de LinkedIn | No publicado | Bajo | M (falta validar precio y webhooks) |
| **Unipile** | No | Sí, usando la sesión de un **perfil personal** | Sí | Usuario y contraseña o cookies; "no es partner de LinkedIn" [V] | 49 €/mes hasta 10 cuentas; 5 €/cuenta entre 11 y 50 [V] | **Alto** | S (descartado) |
| **Ayrshare** | No (solo comentarios) | No (solo comentarios) | Sí | — | Premium USD 149, Business USD 599 [V] | Bajo | No sirve |
| **Upload-Post, bundle.social, Outstand** | No | No | — | — | — | — | No sirven |
| **Hootsuite** | Sí, Business, desde el 18-09-2025 [V] | Sí, Páginas, desde el 27-03-2024 [V] | **No** encontramos API de su bandeja [S] | Aparte | Standard USD 99, Professional 199, Advanced 399 por usuario/mes anual [V]; no dice qué plan trae estos DMs | Bajo | Aparte |
| **Sprinklr** | Sí, se activa a pedido; sin respuestas con imagen [V] | Sí, partner oficial [V] | API enterprise [S] | Contrato enterprise | Cotización [S] | Bajo | L |
| **Meltwater Engage** | Sí (extracto oficial) | Sí (extracto oficial) | No verificado | Contrato | Cotización [S] | Bajo | Aparte |
| **Sprout Social** | **No** [V por omisión] | Sí, Páginas | La API de Advanced solo **lee** mensajes [V] | — | Professional USD 299, Advanced 399 por asiento/mes [V] | Bajo | Aparte |
| **Statusbrew** | Sí, Business, LATAM incluida; respuestas de hasta 150 caracteres [V] | No [V] | Solo API de métricas (Enterprise) | — | Aprox. USD 89/179/299 al mes [S] | Bajo | Aparte |
| **Vista Social** | Sí, Business fuera de Europa (extracto oficial) | No (extracto oficial) | "Vista Social API", plan sin aclarar | — | Aprox. USD 99/199/449 al mes [S] | Bajo | Aparte |
| **Zoho Social** | No documentado | Sí, Páginas, últimos 60 días [V] | No mencionada | — | Agency Plus, 20 marcas: aprox. USD 330 anual / 460 mensual [S] | Bajo | Aparte |
| **Brandwatch** | No (extracto oficial) | Sí, Páginas (extracto oficial) | No verificado | — | Cotización [S] | Bajo | Aparte |
| **Trengo** | Sí, Business, fuera de Europa y EE. UU. [V] | No | Poco claro | — | No verificado | Bajo | Aparte |
| **Emplifi** | No confirmado | Probable [S] | No verificado | — | Cotización | Bajo | Preguntar en una demo |
| **Agorapulse, NapoleonCat, Sendible, Later, Planable, SocialBee** | No | No | — | — | — | — | No sirven |
| **Zendesk, Freshdesk** | Sin canal nativo; solo apps de terceros o TikTok Shop [S] | Solo comentarios [S] | — | — | — | — | No sirven |
| **Apify, HeyReach, Expandi, Waalaxy, Data365, Phyllo** | No | Scraping o automatización de perfiles | — | — | — | **Alto** | Descartados |

---

## 5. Detalle por opción

### 5.1 API oficial de TikTok, conectada directamente

- **Qué cubre:** leer (por webhook) y responder DMs de cuentas TikTok Business. Texto e imagen; no video, voz ni stickers [T].
- **Ventajas:**
  - Gratis [T].
  - Ningún tercero ve los DMs.
  - Encaja en la arquitectura actual: un adaptador más en `server/`, credenciales en el vault y un receptor de webhooks idempotente por ID de mensaje.
- **Desventajas:**
  - Requiere postular y pasar la revisión de TikTok, en una beta cuyas reglas cambian (como el Advanced Access de abril de 2026).
  - Cada una de las ~20 cuentas debe ser Business, estar vinculada a Business Center y autorizar la app.
  - Necesita un endpoint HTTPS público para los webhooks. Hoy wiwo.sac solo consulta a Metricool y no recibe llamadas de fuera.
  - El refresh token dura unos 30 días [T, Chatwoot]: una cuenta sin actividad puede pedir re-autorización.
- **Esfuerzo:** **M de código, L de calendario** (detalle en la sección 6).
- **Riesgo de términos:** bajo. Es la vía oficial; solo hay que cumplir las políticas de datos de TikTok al guardar los DMs.

### 5.2 Zernio (antes Late / getlate.dev)

- **Qué cubre:**
  - Según su página de DMs, recibe DMs de TikTok por webhook [V].
  - Según su ficha de TikTok, permite "Replies only" en cuentas Business fuera de Europa [V].
  - Su novedad del 11-09-2026 dice que se pueden responder desde la API.
  - **Contradicción:** su página de precios lista la mensajería sin TikTok. Hay que probarlo con una cuenta antes de comprometerse.
- **LinkedIn:** dice explícitamente que no da DMs porque LinkedIn los bloquea a terceros [V].
- **Ventajas:**
  - Es lo más barato y rápido: unos USD 78 al mes por 20 cuentas [V].
  - API REST con webhooks.
  - Nos ahorra la postulación a TikTok, porque usa su propia app aprobada [S].
- **Desventajas:**
  - Es un proveedor pequeño y reciente que cambió de nombre en 2026.
  - Los DMs pasan por un tercero, lo que exige revisar su acuerdo de tratamiento de datos.
  - Dependemos de que mantenga su acceso a TikTok.
- **Esfuerzo:** **S** (1–2 semanas) para un adaptador con webhook de entrada y envío.

### 5.3 Partners oficiales de mensajería de TikTok: respond.io, Infobip y Gupshup

- TikTok lista como Messaging Partners a Blip.ai, Halosis, Haravan, Pancake, Qiscus, Respond.io, Zwiz, Gupshup e Infobip [V, ayuda de TikTok actualizada en agosto de 2025].
- **respond.io:**
  - Es una bandeja omnicanal.
  - Su API está desde el plan Growth (USD 159/mes anual, 10 usuarios) y los webhooks desde Advanced (USD 279) [V].
  - Sirve como herramienta aparte o como pasarela, pero pagaríamos por usuarios de una bandeja que no usaríamos.
- **Infobip:**
  - Es un CPaaS con presencia en Latinoamérica: API, webhooks de entrada, entregado y leído [V].
  - Precio por país sin cifra pública. Probablemente exige contrato o un mínimo [S].
- **Ventajas:** respaldo oficial de TikTok y soporte comercial.
- **Desventajas:** cuestan más que Zernio y no resuelven LinkedIn.
- **Esfuerzo:** **M**.

### 5.4 Chatwoot (código abierto)

- Tiene un canal de TikTok, pero exige **nuestra propia** app aprobada en Business Messaging. Es el mismo trámite que la vía directa, con un servicio extra que alojar.
- AGENTS.md pide un runtime autocontenido, así que agregar Chatwoot como componente no conviene.
- Sí sirve como **referencia** de cómo implementar la vía directa. Hay que revisar su licencia antes de reutilizar código.

### 5.5 LinkedIn por un partner oficial: Bird

- Bird es partner de Page messaging según LinkedIn [V].
- Su canal "LinkedIn Pages Messaging" recibe los DMs que los miembros envían a la Página, permite conversación bidireccional y envía por su Inbox, Flows o **Channels API** [V, docs.bird.com].
- Se instala con un admin de la Página y su Organization ID.
- **No encontramos su precio ni detalles de webhooks de entrada [S].** Hay que pedirlo a ventas.
- **Ventaja:** es la única vía oficial y programable que encontramos para LinkedIn.
- **Desventajas:**
  - Es un proveedor más, con contrato.
  - Puede que solo convenga si el volumen de DMs de LinkedIn es relevante.
- **Esfuerzo:** **M**, más el trámite comercial.

### 5.6 Herramientas aparte con ambos DMs: Hootsuite, Sprinklr y Meltwater

- **Hootsuite** es la única de gama media que documenta **ambos** DMs: TikTok desde septiembre de 2025 y Páginas de LinkedIn desde marzo de 2024 [V].
  - Para ~20 marcas (más de 10 cuentas) se necesita Professional (USD 199 por usuario/mes anual) o Advanced (USD 399, que agrega asignación y ruteo) [V].
  - No dice qué plan trae estos DMs.
  - No encontramos API de su bandeja: el equipo trabajaría en dos herramientas y lo de Hootsuite no entraría a la Bandeja ni a Reportes sin otra carga manual.
- **Sprinklr y Meltwater** cubren ambos, pero son contratos enterprise, desproporcionados para un equipo SAC de pocos agentes.

### 5.7 Lo que se descarta

- **Unipile y scrapers (Apify, HeyReach, Expandi, Waalaxy, Data365, Phyllo):**
  - Se conectan con el usuario y contraseña o las cookies de un perfil personal.
  - Unipile se describe como "independent technical intermediary… not a LinkedIn partner" y recomienda espaciar llamadas para evitar avisos de automatización [V].
  - La ayuda de LinkedIn prohíbe el software de terceros que automatiza o extrae datos, con riesgo de restringir la cuenta [V].
  - Pondría en juego el perfil personal de quien administra cada marca, y no cubre la bandeja de la Página por la vía oficial.
- **LinkedIn Pages Data Portability API:**
  - Solo lee, entrega los datos ofuscados y su propósito es la portabilidad que exige la UE, no la atención al cliente.
- **Sprout Social:** no trae DMs de TikTok y su API solo lee mensajes [V].
- **Agorapulse, NapoleonCat, Sendible, Later, Planable, SocialBee, Ayrshare, Upload-Post, bundle.social y Outstand:** no ofrecen DMs de TikTok ni de LinkedIn.
- **Zendesk y Freshdesk:** no tienen canal nativo de DMs de TikTok ni de LinkedIn.

### 5.8 Metricool

- **Hoy:**
  - El Inbox trae DMs de Facebook, Instagram y X.
  - De TikTok trae solo comentarios (cuentas Business).
  - De LinkedIn trae comentarios y menciones, y dice explícitamente "Private messages are not supported" [V, help.metricool.com y blog del 2026-11-12].
- **Lo anunciado:**
  - En Metricool Flows, la plantilla de TikTok "DM → DM" está "coming soon".
  - Será solo para Estados Unidos (no la UE ni el Reino Unido), con un máximo de 10 mensajes automáticos [V, help.metricool.com/flows-on-tiktok].
  - Es una automatización, no una bandeja ni un endpoint de API, y no aplica a nuestra región.
  - Sugiere que Metricool ya trabaja con la API de mensajería de TikTok [S].
- **LinkedIn:** no encontramos anuncio ni roadmap.
- **Ventaja si llegara:** sería el camino más corto (S), porque el adaptador `MetricoolGateway` ya tiene `listConversations` y `replyToConversation`. Bastaría habilitar el proveedor.
- **Plan y precio:** la API de Metricool solo está en los planes Advanced y Custom [V].

---

## 6. Qué implica integrarlo detrás de un adaptador

El adaptador actual (`MetricoolGateway` en `server/metricool-client.ts`) **consulta** a Metricool: `listConversations` y `replyToConversation`. Un proveedor de DMs de TikTok cambia el modelo, porque los mensajes entrantes llegan por **webhook**. Para cualquier opción integrable haría falta:

1. **Interfaz de proveedor de mensajería**, separada de Metricool: listar o recibir mensajes y responder a uno concreto. El frontend no cambia: sigue usando `/api`.
2. **Receptor de webhooks** en Fastify:
   - Con firma verificada.
   - Idempotente por el ID externo del mensaje, con deduplicación como la de hoy.
   - Expuesto por HTTPS público (por ejemplo, en el dominio de producción). Hay que documentarlo en el runbook y en `.env.example`.
3. **Credenciales por marca** (tokens OAuth o API key del agregador) en `server/credential-vault.ts`, nunca en el navegador ni en archivos versionados.
4. **Ventanas de respuesta:**
   - Agregar en `server/reply-window.ts` y `src/lib/reply-window.ts` la regla de TikTok: DM de 48 h desde el último mensaje del cliente.
   - Agregar el tope de 10 mensajes.
   - Igual que con Meta: avisar, dejar intentar y que TikTok decida. Nunca eludir el límite.
5. **Reglas de AGENTS.md:**
   - Envío automático apagado.
   - Cada intento auditado.
   - Reintentos sin duplicar.
   - Revisión humana para casos sensibles.
   - Los DMs de TikTok y LinkedIn que hoy entran por la planilla deben deduplicarse contra los que lleguen por API (como ya se hace con `source: "planilla"`).
6. **Documentación:** README, `docs/API_CONTRACT.md`, `docs/GUIA_COMENTARIOS_Y_MENCIONES.md` y el runbook, en el mismo cambio.

| Vía | Código | Trámite externo |
| --- | --- | --- |
| Zernio (TikTok) | S: 1–2 semanas | Cuenta y pago; revisar el acuerdo de tratamiento de datos |
| API directa de TikTok | M: 2–4 semanas (OAuth por marca, webhooks, renovación de tokens) | L: postulación, Advanced Access y vincular unas 20 cuentas a Business Center |
| respond.io / Infobip (TikTok) | M | Contrato o plan |
| Bird (LinkedIn) | M | Contrato; validar API y webhooks |

---

## 7. Recomendación para unas 20 marcas

**Por dónde empezar:**

1. **Medir antes de decidir (sin costo).** Con los datos que ya están en Reportes (`source: "planilla"`), contar cuántos DMs de TikTok y de LinkedIn llegaron por marca en los últimos 3–6 meses. Si son pocos por semana, la planilla sigue siendo razonable y no conviene sumar proveedores.
2. **Inventariar las cuentas de TikTok:** cuáles marcas son **Business** (no Creator), en qué país están registradas y si están vinculadas a Business Center. Sin eso ninguna opción funciona.
3. **Si TikTok lo justifica:**
   - **Camino principal:** postular a la **TikTok Business Messaging API** directa. Es gratis, ningún tercero ve los DMs y encaja con la arquitectura.
   - **Mientras se aprueba:** un **piloto con Zernio** en 1–2 marcas para confirmar que recibe y responde DMs en nuestra región. Cuesta pocos dólares.
   - Si la postulación se rechaza o se demora, **Zernio** puede quedar como proveedor definitivo detrás del mismo adaptador.
4. **LinkedIn:**
   - Mantener la carga por Excel.
   - Solo si el volumen es alto, pedir a **Bird** precio, cobertura en Latinoamérica y detalle de su API y webhooks para LinkedIn Pages Messaging.
   - Si el equipo prefiere una herramienta aparte en vez de integrar, **Hootsuite** es la única de gama media que cubre ambas redes, a costa de trabajar fuera de wiwo.sac.
5. **Metricool:** preguntar a su soporte por el roadmap de DMs de TikTok y LinkedIn en el Inbox y en la API, sin esperar a eso para decidir.

**Qué descartar:** Unipile y cualquier herramienta que use la sesión de un perfil personal o scraping (riesgo de que LinkedIn restrinja la cuenta), la Data Portability API de LinkedIn, Chatwoot como componente, Sprout Social, y las herramientas que no tienen ninguno de los dos DMs.

---

## 8. Preguntas abiertas para el equipo

1. ¿Cuántos DMs de TikTok y de LinkedIn reciben hoy las marcas por semana? ¿Cuáles concentran el volumen?
2. ¿Qué marcas tienen TikTok **Business** y cuáles Creator o personal? ¿En qué país está registrada cada cuenta? Si alguna está registrada en Europa, queda fuera.
3. ¿Las cuentas de TikTok están vinculadas a TikTok Business Center? ¿Quién de WIWO o del cliente puede autorizar la app en cada una?
4. ¿Las Páginas de LinkedIn de las marcas tienen activados los mensajes? ¿Quién es admin Super o de contenido en cada una?
5. ¿Aceptamos que los DMs pasen por un tercero (Zernio, Bird, respond.io)? ¿Hace falta acuerdo de tratamiento de datos con los clientes?
6. ¿Podemos exponer un endpoint HTTPS público de webhooks en el servidor de producción?
7. ¿Hay presupuesto mensual tope por esto? Referencias: unos USD 78/mes con Zernio; desde USD 159/mes con respond.io; desde USD 199 por usuario/mes con Hootsuite.
8. ¿Preferimos una herramienta aparte, rápida pero que divide la operación, o integrar en wiwo.sac, más lento pero con todo en la Bandeja y Reportes?
9. **Para validar con proveedores:**
   - TikTok: elegibilidad de Chile, Colombia, Perú y Centroamérica.
   - Zernio: si lee DMs entrantes de TikTok en nuestra región.
   - Bird: precio y webhooks de LinkedIn.
   - Hootsuite: qué plan incluye ambos DMs y si hay API de su bandeja.
   - Metricool: roadmap de DMs.

---

## 9. Fuentes

Consultadas el 2026-11-25 salvo otra fecha indicada.

**TikTok**

- Ayuda de TikTok, Marketing API (incluye Business Messaging API), actualizada en septiembre de 2025: https://ads.tiktok.com/help/article/marketing-api
- Ayuda de TikTok, Messaging Partners, actualizada en agosto de 2025: https://ads.tiktok.com/help/article/about-message-management-tools?lang=en
- Blog de TikTok, Messaging Partner Specialty, 2025-05-09: https://ads.tiktok.com/business/en/blog/introducing-messaging-partner-specialty
- Portal de la Business Messaging API (no legible sin JS; solo extracto de búsqueda): https://business-api.tiktok.com/portal/docs/business-messaging-api/v1.3
- respond.io, TikTok overview y quick start, modificadas el 2026-11-20: https://respond.io/help/tiktok/tiktok-overview y https://respond.io/help/tiktok/tiktok-quick-start
- respond.io, integración TikTok Business Messaging: https://respond.io/integrations/tiktok-business-messaging
- Chatwoot, integración TikTok: https://developers.chatwoot.com/self-hosted/configuration/features/integrations/tiktok
- Infobip, TikTok: https://www.infobip.com/docs/tiktok.md
- Sprinklr, DMs de TikTok: https://www.sprinklr.com/help/articles/engage-with-tiktok-direct-messages/engage-with-direct-messages-from-tiktok-company-accounts-to-profiles/68317e03c74d2f1a73934077
- Qiscus, TikTok DM: https://documentation.qiscus.com/omnichannel-chat/tiktok-direct-message
- Trengo, TikTok: https://trengo.com/products/tiktok y https://trengo.com/blog/tiktok-inbox (2026-10-06)

**LinkedIn**

- Ayuda de LinkedIn, mensajes de Páginas y partners: https://www.linkedin.com/help/linkedin/answer/a1356464 y https://www.linkedin.com/help/linkedin/answer/a6246714
- Ayuda de LinkedIn, software de terceros prohibido: https://www.linkedin.com/help/linkedin/answer/a1341387
- Community Management API, actualizada el 2026-05-15: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/community-management-overview
- Revisión de apps de Community Management, actualizada el 2026-02-11: https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review
- Messages API: https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages
- Pages Data Portability API, actualizada el 2026-11-24: https://learn.microsoft.com/en-us/linkedin/dma/pages-data-portability-overview
- SocialMediaToday, mensajes de Páginas para todas las marcas, 2024-03-27: https://www.socialmediatoday.com/news/linkedins-rolling-out-company-page-messaging-to-all-brands/711413/
- Bird, LinkedIn Pages Messaging: https://docs.bird.com/applications/channels/channels/supported-channels/linkedin-pages-messaging y https://bird.com/blog/launching-our-newest-channel-linkedin-page-messaging
- Oktopost, integración: https://www.oktopost.com/press/linkedin-messaging-social-inbox/

**Metricool**

- Inbox: https://help.metricool.com/inbox-manager-how-to-manage-messages-and-comments-from-metricool-s9zze y https://help.metricool.com/comments-or-messages-not-appearing-in-inbox-tmofe
- Blog de mensajes por red, 2026-11-12: https://metricool.com/social-media-messages/
- Flows en TikTok ("DM → DM" próximamente, solo EE. UU.): https://help.metricool.com/flows-on-tiktok-xebfi
- Precios y acceso a la API: https://metricool.com/en/pricing/ y https://help.metricool.com/plans-add-ons-and-api-access-explained-xux1u

**Agregadores y APIs**

- Zernio: https://docs.zernio.com/platforms/tiktok, https://docs.zernio.com/platforms/linkedin, https://zernio.com/social-media-dms, https://zernio.com/pricing, https://docs.zernio.com/webhooks/inbox y https://zernio.com/blog/september-11-2026-product-updates
- Unipile: https://www.unipile.com/pricing-api/ y https://developer.unipile.com/docs/provider-limits-and-restrictions
- Ayrshare: https://www.ayrshare.com/docs/apis/messages/overview y https://www.ayrshare.com/pricing/
- Upload-Post: https://docs.upload-post.com/introduction/
- bundle.social: https://bundle.social/social-media-dm-api
- Comparativa de APIs de bandeja unificada (escrita por un proveedor), 2026-11-16: https://postproxy.dev/blog/best-unified-social-inbox-api/

**Herramientas de bandeja social**

- Hootsuite: https://www.hootsuite.com/whats-new/tiktok-business-messaging-has-officially-landed-in-your-hootsuite-inbox (2025-09-18), https://www.hootsuite.com/whats-new/respond-to-messages-on-linkedin-pages-in-hootsuite (2024-03-27) y https://www.hootsuite.com/plans
- Sprout Social: https://sproutsocial.com/pricing/, https://sproutsocial.com/integrations/tiktok/ y https://api.sproutsocial.com/docs
- Statusbrew: https://statusbrew.com/help/articles/tiktok-direct-messages-not-working y https://statusbrew.com/pricing; precio de terceros: https://napoleoncat.com/blog/statusbrew-pricing/
- Vista Social: https://support.vistasocial.com/hc/en-us/articles/25311040215195-What-the-Inbox-supports-by-network y https://vistasocial.com/pricing/
- Brandwatch: https://social-media-management-help.brandwatch.com/hc/en-us/articles/4626417075869
- Zoho Social: https://help.zoho.com/portal/en/kb/social/monitoring-conversations-on-social-media/articles/interact-with-your-audience-on-your-linkedin-page y https://www.zoho.com/social/pricing.html
- Meltwater: https://community.meltwater.com/engage-conversations-213/conversations-channel-specific-options-7909
- Emplifi: https://docs.emplifi.io/platform/latest/home/incoming-messages
- respond.io, precios: https://respond.io/pricing
- Agorapulse: https://support.agorapulse.com/en/articles/8712660-api-limitations-per-network
- Zendesk: https://support.zendesk.com/hc/en-us/community/posts/5688253402266-Import-TikTok-Direct-Messages-to-Zendesk
