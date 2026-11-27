# WhatsApp en wiwo.sac

Los mensajes de WhatsApp de las marcas entran a la bandeja y se responden desde **Gestión WhatsApp** (grupo Bandejas), con el mismo flujo de entrega auditable que los DMs de Metricool. La conexión usa **Baileys** (`@whiskeysockets/baileys`, versión fija `7.0.0-rc14`), que vincula cada número como un dispositivo de **WhatsApp Web**. Baileys queda detrás de un adaptador, así que se puede cambiar a la API oficial de Meta sin tocar la web ni la bandeja.

## Riesgos (leer antes de vincular un número)

- **No es oficial.** Usar WhatsApp Web automatizado va contra los términos de WhatsApp, y **el número puede quedar bloqueado**, a veces para siempre. El riesgo sube si el número escribe a quien no lo tiene agendado, si envía mucho, si contesta en ráfagas o si repite el mismo texto.
- **La sesión vive en el servidor.** Las credenciales de cada número dan acceso a **todos sus chats**: quien tenga la carpeta de sesiones puede leer y escribir como la marca. Esa carpeta va fuera del repositorio (`SAC_FLOW_WHATSAPP_AUTH_DIR`, por defecto `data/whatsapp-auth/`, ignorada por git), con permisos `0700` y, en producción, en su propio volumen de Docker.
- **Se cae cuando WhatsApp cambia.** Si WhatsApp cambia su protocolo, la librería puede dejar de recibir o enviar hasta que salga una versión nueva. No hay soporte al que reclamar.
- **El teléfono manda.** Si alguien cierra la sesión en *Dispositivos vinculados* o el teléfono pasa unos 14 días sin internet, el número se desvincula y hay que volver a vincularlo. WhatsApp admite hasta 4 dispositivos vinculados por número, y wiwo.sac ocupa uno.
- **Paquetes falsos.** En npm hay imitaciones de Baileys que roban sesiones. Usa solo `@whiskeysockets/baileys` con la versión exacta del `package-lock.json`.

### Comparación con la API oficial (WhatsApp Business Platform / Cloud API de Meta)

| | Baileys (hoy) | Cloud API de Meta |
| --- | --- | --- |
| Costo | Gratis | Meta cobra cada mensaje de plantilla (marketing, utilidad o autenticación), con tarifa según el país. Responder dentro de la ventana de atención es gratis. |
| Ventana | Sin ventana | Se responde libremente hasta 24 h después del último mensaje del cliente; después, solo con plantillas aprobadas. |
| Alta | Escanear un QR o ingresar un código | Verificar el negocio en Meta Business Manager, aprobar el nombre visible y registrar cada número (o usar coexistencia con la app WhatsApp Business). |
| Bloqueo | Posible | No por usar la API |
| Estabilidad | Depende de la librería | Estable, con webhooks y soporte |

**Para cambiar a la oficial**, se implementa otro `WhatsAppGateway` (`server/whatsapp/gateway.ts`) que entregue los mismos estados, mensajes normalizados y envíos con id. La web, las rutas de la API, la bandeja y el outbox no cambian. Lo que sí cambia es la ventana de 24 h: habría que agregar `whatsapp` a `replyWindowMs` (servidor y web).

## Cómo funciona

```
Teléfono de la marca ──(WhatsApp Web)── worker de WhatsApp ──(rutas internas + clave)── API ── repositorio ── bandeja en vivo
                                         server/whatsapp-worker.ts                        server/whatsapp-routes.ts
```

- **Worker aparte** (`npm run dev:whatsapp` / `npm run start:whatsapp`). Mantiene la sesión de cada número, informa el estado y el QR, entrega los mensajes nuevos y toma de la cola las respuestas aprobadas. Habla con la API solo por `/api/internal/whatsapp/*`, con la clave `SAC_FLOW_WHATSAPP_WORKER_KEY`, y nunca por la sesión de una persona. Debe correr **un solo worker** por servidor: dos procesos con la misma sesión se expulsan entre sí.
- **Mensajes entrantes.** Se guardan como interacciones `channel: "whatsapp"`, `source: "whatsapp"`, `type: "dm"`, con `externalId` estable `wa:<lineId>:<messageId>` (un reenvío no duplica). Pasan por `insertInteractions` y el protocolo SAC, como los de Metricool, así que la bandeja en vivo los ve al instante. En `metricoolRef`, `conversationId`/`actorId`/`recipient` llevan la clave del chat, para que la bandeja agrupe por persona, y `whatsapp` guarda `{ lineId, chatId, messageId }`. Se ignoran grupos, estados, listas de difusión, canales, reacciones y mensajes técnicos.
- **Respuestas desde el teléfono.** Un mensaje escrito en el teléfono de la marca entra como saliente y cierra el caso como "Respondido por el equipo".
- **Responder.** Se usa `POST /api/interactions/:id/reply`, como cualquier DM. Para WhatsApp la API deja la entrega `pending` ("en cola") y responde `meta.delivery: "queued"`. Cuando el número está conectado y cumplió su pausa, el worker la reserva con un lease de 2 min, marca el chat como leído, muestra "escribiendo…", envía y confirma (`sent` con el id del mensaje). Si el envío falla antes de escribir en la conexión, queda `failed`. Si no se sabe si salió, queda `uncertain` y se concilia a mano, nunca se reenvía sola. El eco del mensaje enviado no vuelve como mensaje nuevo.
- **Por persona, en la base.** Quién usa WhatsApp no es una variable de entorno: es un ajuste individual de cada persona (**Usuarios y roles → persona → WhatsApp**, `user_access.whatsapp_enabled`), **activado por defecto** para todas (migración `0025_user_whatsapp_enabled.sql`). Solo un admin lo apaga; apagado, la persona no ve Gestión WhatsApp y la API rechaza sus envíos (`403 WHATSAPP_DISABLED_FOR_USER`). `SAC_FLOW_DISABLE_OUTBOUND_SENDS` y `SAC_FLOW_ENABLE_MANUAL_REPLIES` siguen gobernando solo Metricool.
- **Sin envío automático.** WhatsApp solo envía lo que aprobó una persona: la API rechaza `approvedByHuman: false` (`WHATSAPP_HUMAN_ONLY`), la cola automática salta WhatsApp y el protocolo SAC nunca recomienda `auto_reply` efectivo para este canal (`WHATSAPP_MANUAL_ONLY`).
- **Una marca por número.** Cada número (`whatsapp_lines`) pertenece a una marca, y sus chats entran a la cuenta de esa marca. Un cliente oculto no recibe mensajes de WhatsApp.

### Historial antiguo

WhatsApp solo deja traer mensajes anteriores a la vinculación de dos formas, y siempre que el teléfono esté encendido y con internet:

1. **Al vincular.** En **Números de WhatsApp**, marca **Traer el historial del teléfono al vincular** antes de agregar o volver a vincular el número (`importHistory`; se guarda en `whatsapp_lines.import_history`). El worker le pide al teléfono el historial completo (`syncFullHistory`). Cuánto entrega lo decide WhatsApp: suelen ser meses, no años. Para un número ya vinculado sin esta opción, hay que desvincularlo y volver a vincularlo con la casilla marcada.
2. **Por chat, después.** **Cargar anteriores**, en la cabecera del historial de un chat de Gestión WhatsApp, pide al teléfono hasta 50 mensajes previos al más antiguo que ya tiene wiwo.sac (`POST /api/whatsapp/history`, con una espera de 20 s por chat). Sirve para chats que ya existen en wiwo.sac.

Cómo se guarda (`server/whatsapp/ingest.ts`):

- Cada mensaje antiguo entra como interacción `whatsapp` con `metricoolRef.whatsapp.history: true`. Los del cliente llegan **resueltos**, con motivo "Historial importado de WhatsApp", y no pasan por el protocolo SAC. El mismo `externalId` evita duplicados con lo que ya entró en vivo.
- **No cuentan** en Reportes, en el tablero de Clientes ni en las filas de METRIQ (`isImportedHistory`), así que no cambian meses ya informados. Solo se ven como contexto en la conversación.
- Excepción al vincular: el último mensaje de cada chat, si es del cliente y de los últimos 7 días, entra como **caso normal**, porque es alguien esperando respuesta.
- Baileys sincroniza el historial como WhatsApp Web aunque no se importe: lo necesita para asociar los identificadores privados (LID) con los números. Si no se pidió, wiwo.sac simplemente no lo guarda.

### Chat completo

- **Archivos.** El worker descarga fotos, videos, audios, stickers y documentos de hasta 16 MB, de los tipos aceptados. La API guarda su propia copia por sha256 (`whatsapp_media`, migración `0027_whatsapp_media.sql`). Se abren con `GET /api/media/whatsapp/:key`, solo para quien ve la marca; los documentos se descargan, nunca se muestran en la página. El historial no descarga archivos: queda la etiqueta ("[Imagen]").
- **Adjuntar y citar.** En el compositor, **Adjuntar** sube un archivo (`POST /api/whatsapp/media`) y **Citar su mensaje** cita el del cliente. El worker envía el archivo con su leyenda; un audio se "graba" en vez de "escribirse".
- **Tics, reacciones, ediciones y borrados.** Llegan como cambios sobre el mensaje ya guardado (`lines/:id/updates`) sin cambiar la versión del caso. Los tics solo avanzan: enviado → entregado → leído → reproducido.
- **Quién envió.** Cada mensaje enviado desde wiwo.sac muestra la persona que lo envió.

### Lectura y presencia

- **Leído.** Abrir un chat a la vista lo marca leído en wiwo.sac (`POST /api/whatsapp/read`). Si la persona puede responder, también en WhatsApp: el cliente ve los tics azules. Nada se marca leído en el teléfono sin que alguien lo haya abierto. La lista muestra cuántos mensajes sin leer tiene cada chat, y el filtro **No leídos** deja solo esos.
- **El cliente escribe.** Mientras un chat está abierto, la API sigue su presencia (el worker se suscribe) y la vista muestra "está escribiendo…" o "está grabando un audio…".
- **El equipo escribe.** Mientras alguien redacta, el cliente ve "escribiendo…". Sale como mucho una señal cada 4 s por chat, se apaga sola a los 6 s sin escribir, y nunca pone el número "en línea".

### Robustez del worker

- **Sesión cifrada.** La sesión de cada número se guarda cifrada en disco: AES-256-GCM, con una clave derivada de `SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY`, y nombres de archivo con hash, porque los de Baileys llevan teléfonos. Una sesión antigua en texto plano se cifra sola al primer uso, sin volver a escanear. Sin esa clave, copiar la carpeta no sirve.
- **Cola durable.** Los mensajes recibidos se guardan cifrados en `<carpeta de sesiones>/_spool/` antes de entregarlos a la API. Se borran cuando la API los aceptó, y si el worker o la API se caen se reenvían al volver, sin duplicar.
- **Respuestas vencidas.** Una respuesta que lleva 24 h en cola (número desconectado) falla con `WHATSAPP_QUEUE_EXPIRED` en vez de salir un día tarde.
- **Salud.** `/health` del worker informa los envíos de la última hora y del último día por número, y los mensajes pendientes de entregar. No incluye datos de clientes.

### Resguardos contra el marcado como spam

| Resguardo | Dónde | Por defecto |
| --- | --- | --- |
| Pausa al azar entre envíos del mismo número | worker (`SendPacer`) | 4–12 s (`SAC_FLOW_WHATSAPP_MIN_GAP_MS`, `_MAX_GAP_MS`) |
| Tope por minuto, por hora y por día | worker | 6 por minuto, 60 por hora, 400 por día (`_MAX_PER_MINUTE`, `_MAX_PER_HOUR`, `_MAX_PER_DAY`) |
| Pausa extra al pasar a otro chat y al enviar un archivo | worker | +3 s y +4 s (`_CHAT_CHANGE_EXTRA_MS`, `_ATTACHMENT_EXTRA_MS`) |
| "Escribiendo…" según el largo del texto (±20 %) | worker | 45 ms por carácter, entre 1,5 y 8 s (`_TYPING_*`) |
| Marcar como leído antes de responder | worker | siempre |
| Mismo texto exacto a muchos chats en 30 min | API (`WHATSAPP_REPEATED_TEXT`) | bloquea desde el 5.º chat (`_REPEATED_TEXT_LIMIT`) |
| Solo se responde a quien escribió | API | la respuesta siempre cuelga de un mensaje entrante |
| No aparecer "en línea" todo el día | worker | `markOnlineOnConnect: false` |
| Reconexión con esperas crecientes; si WhatsApp cierra la sesión, se detiene | worker | 2 s → 2 min |

Si un mensaje no cabe en el ritmo, espera su turno en la cola; nunca se descarta. No hay rotación de números ni disfraz del dispositivo: en *Dispositivos vinculados* el teléfono muestra "wiwo.sac".

## Puesta en marcha

### Local (número de prueba)

1. En `.env`:
   ```
   SAC_FLOW_WHATSAPP_WORKER_KEY=<32+ caracteres al azar>   # opcional: sin ella se deriva de SAC_FLOW_API_KEY
   ```
   Con la clave, WhatsApp queda en vivo y cada persona lo tiene activado salvo que un admin se lo apague.
   Genera la clave con `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. `npm run dev:all` en una terminal y `npm run dev:whatsapp` en otra. Si tu `.env` tiene `SAC_FLOW_INTERNAL_API_URL=http://api:8787` (la dirección dentro de Docker), arranca el worker con `SAC_FLOW_INTERNAL_API_URL=http://127.0.0.1:8787`.
3. Entra como **admin** (`SAC_FLOW_AUTH_ADMIN_EMAILS`, o cualquier admin si no hay inicio de sesión) → **Gestión WhatsApp** → **Números de WhatsApp** → **Agregar número**. Elige la marca y "Escanear QR" (o "Código de 8 caracteres" con el número de la marca).
4. En el teléfono: WhatsApp → **Dispositivos vinculados** → **Vincular un dispositivo** → escanea el QR. Con código: **Vincular con número de teléfono** e ingresa el código.
5. Escríbele al número desde otro teléfono: el mensaje aparece en Gestión WhatsApp. Responde y mira cómo sale con "escribiendo…".

### Modo demo (sin conexión real)

Con `METRICOOL_MODE=demo` no hay worker. Desde **Números de WhatsApp**, "Agregar número" muestra un QR de muestra que no vincula nada, y el número queda "Conectado" a los pocos segundos. **Simular mensaje** deja un mensaje ficticio en la bandeja por el mismo camino que uno real, y las respuestas se simulan (`demo_simulated`).

### Producción

- No hace falta configurar nada en el servidor: si no se define `SAC_FLOW_WHATSAPP_WORKER_KEY`, la API y el worker derivan la misma clave de `SAC_FLOW_API_KEY` (HMAC de un solo sentido; no expone la clave del sitio ni sirve como ella). Quién puede usar WhatsApp se decide por persona en **Usuarios y roles** (activado por defecto).
- El servicio `whatsapp` de `docker-compose.production.yml` arranca con el resto del stack; sin números vinculados no hace nada. Para detenerlo: `docker compose -f docker-compose.production.yml stop whatsapp`. Guarda las sesiones en el volumen `sac-flow-whatsapp-auth`.
- Cambiar `docker-compose*.yml` hace que el deploy pida **aprobación manual en el servidor**.
- Salud: `GET http://127.0.0.1:8789/health` dentro del contenedor (gateway, números, conectados, último error).
- Respaldo: el volumen de sesiones **no** entra en el `pg_dump`. Perderlo solo obliga a volver a vincular, así que no se respalda: es preferible a tener copias de credenciales repartidas.

## Operación

| Síntoma | Qué hacer |
| --- | --- |
| "Esperando vinculación" y no aparece el QR | Revisa que el worker esté encendido (la pantalla dice "El worker de WhatsApp no responde") y que la clave sea la misma en la API y el worker. |
| "El QR o el código vencieron sin usarse" | **Volver a vincular** y escanear en menos de un minuto. |
| "Desvinculado desde el teléfono" | Alguien cerró la sesión en el teléfono o WhatsApp la expulsó. **Volver a vincular**. |
| "WhatsApp rechazó la conexión de este número" | Posible bloqueo. Revisa el teléfono antes de reintentar; no lo vincules de nuevo en bucle. |
| "Otra conexión de wiwo.sac tomó este número" | Hay dos workers con la misma sesión. Deja uno solo. |
| Respuesta "en cola" que no sale | El número está desconectado, o el worker está apagado o esperando su pausa. La cola espera; no se pierde. |
| Entrega incierta | Revisa en el teléfono si el mensaje salió y concíliala desde el detalle del caso (como con Metricool). |
| `WHATSAPP_REPEATED_TEXT` | Personaliza el texto (nombre, detalle del caso) antes de enviarlo. |

**Desvincular** cierra la sesión en WhatsApp, borra las credenciales y deja de recibir. Las conversaciones ya recibidas se conservan. **Quitar** borra el número de la lista, y solo se puede después de desvincularlo.

Los logs del worker y de la API solo registran ids de número, estados y códigos de error: nunca textos, teléfonos ni chats.
