# WiWO Talk en wiwo.sac

WiWO Talk es HighLevel (GoHighLevel) con marca blanca. Los clientes que el equipo atiende en SAC (los marcados **En SAC** en Clientes) y que tienen su WhatsApp en una subcuenta de WiWO Talk se pueden atender desde **Gestión WhatsApp** en wiwo.sac. Sus chats se leen por la API v2 de HighLevel, con el token de integración privada (PIT) de esa subcuenta.

## Claves por conexión, en la base

- Cada subcuenta es una **conexión** (`wiwo_talk_connections`, migración `0028_wiwo_talk_connections.sql`) que pertenece a un cliente, así que puede haber varios clientes conectados a la vez. Solo se conectan clientes marcados **En SAC** en Clientes: el panel lista solo esos y la API responde `422 WIWO_TALK_BRAND_NOT_IN_SAC` para otro. Si ningún cliente está marcado, se puede elegir cualquiera.
- **No hay variables de entorno con tokens.** El token `pit-…` y el secreto del webhook se guardan cifrados en `encrypted_secrets` con `CredentialVault` (AES-256-GCM). La clave de cifrado es la de credenciales de la API (`SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY`), la misma de las demás credenciales.
- El token nunca vuelve al navegador ni a los registros: la web solo ve sus últimos 4 caracteres.
- Cualquier **admin** (principal o asignado desde la app) administra conexiones: el token da acceso a todos los chats y contactos de la subcuenta.

## Cómo llegan y salen los mensajes

```
Cliente ──WhatsApp── WiWO Talk (subcuenta) ──workflow "Customer Replied" → webhook── API wiwo.sac
                                         ◄──── API v2 de HighLevel (lee conversaciones, envía) ────┘
```

- **Webhook (tiempo real).** Un workflow de la subcuenta avisa a `POST /api/webhooks/wiwo-talk/<id>?key=<secreto>`. Basta con que el aviso traiga el id del contacto (`contact_id`, `contactId` o `contact.id`). La API responde 200 de inmediato y, tras una pausa de 1,5 s que junta avisos seguidos, lee esa conversación por la API. Así no depende de cómo venga armado el aviso.
- **Conciliación.** Cada `SAC_FLOW_WIWO_TALK_SYNC_MINUTES` minutos (10 por defecto; `0` la apaga) se leen las conversaciones con actividad reciente de cada conexión activa. Recupera avisos perdidos y trae también las respuestas del bot y de las personas en WiWO Talk.
- **Solo WhatsApp.** Se piden los mensajes `TYPE_WHATSAPP`; los SMS, correos o llamadas de la misma conversación no entran.
- **Sin duplicados.** Cada mensaje entra como interacción `whatsapp` con `externalId` `wa:<idConexión>:<idMensaje>` y `metricoolRef.whatsapp.provider: "wiwo_talk"`. Leer dos veces no duplica nada.
- **Primera lectura.** Al conectar, los chats recientes (hasta 60 conversaciones, 50 mensajes cada una) llegan como **historial**, sin contar como casos. Se exceptúa el último mensaje del cliente de cada chat si es de los últimos 7 días, que queda como caso para responder.
- **Respuestas de la cuenta.** Un mensaje saliente posterior (de una persona en WiWO Talk o del bot) cierra el caso como "Respondido por el equipo", igual que en Metricool. En la conversación se ve quién lo envió: "Equipo en WiWO Talk" o "Bot o automatización de WiWO Talk".
- **Responder.** Se usa `POST /api/interactions/:id/reply` como cualquier WhatsApp:
  - La API envía `POST /conversations/messages` con `type: "WhatsApp"`, el contacto y el texto, en la misma solicitud. El mensaje queda en la conversación con quién lo envió.
  - Solo se responde con texto: adjuntos y citas responden `422 WIWO_TALK_TEXT_ONLY`.
  - Un rechazo explícito de HighLevel (4xx, por ejemplo fuera de la ventana de 24 h de Meta) deja la entrega `failed` con su código.
  - Sin respuesta clara, la entrega queda `uncertain` y se concilia a mano; nunca se reenvía sola.
- **Sin envío automático.** Como todo WhatsApp: solo sale lo que aprobó una persona (`WHATSAPP_HUMAN_ONLY`), y respeta el ajuste individual de WhatsApp de cada persona.
- **Leído.** Abrir el chat lo marca leído en wiwo.sac y deja la conversación en 0 no leídos en WiWO Talk (`PUT /conversations/:id`).

## Conectar una subcuenta

En WiWO Talk (lo hace WiWO, como administrador de la subcuenta):

1. Settings → Private Integrations → **Create new Integration** con los scopes mínimos:
   - `contacts.readonly`
   - `conversations.readonly` y `conversations.write`
   - `conversations/message.readonly` y `conversations/message.write`
   - `locations.readonly`, para comprobar la subcuenta.
2. Copia el token `pit-…` (se muestra una sola vez) y el **Location ID** (Settings → Business Profile, o la URL `…/location/<id>/…`).

En wiwo.sac (admin):

3. **Gestión WhatsApp → WiWO Talk → Conectar subcuenta.** Elige el cliente En SAC (si no aparece, márcalo En SAC en Clientes), ponle un nombre y pega el Location ID y el token. wiwo.sac lo comprueba contra HighLevel antes de guardarlo; un token inválido o sin permisos no se guarda.
4. Copia la **URL del webhook** (botón **Ver webhook**). Lleva la clave propia de la conexión, así que compártela solo por un canal seguro.

De vuelta en WiWO Talk:

5. Crea un workflow con disparador **Customer Replied** (canal WhatsApp) y la acción **Webhook** (POST) a esa URL.
6. Si la subcuenta tiene un bot (Conversation AI), excluye con una condición los contactos que atiende el bot (por etiqueta), o haz que el bot no responda a los que atiende wiwo.sac. Si no, cada mensaje puede recibir dos respuestas. Mientras no esté la URL definitiva, deja el workflow en borrador.

## Operación

| Señal en el panel | Qué hacer |
| --- | --- |
| "WiWO Talk rechazó el token" | Crea un token nuevo en la subcuenta y usa **Cambiar token**. La URL del webhook no cambia. |
| "Al token le falta un permiso (scope)" | Agrega el scope en la integración privada. El token no cambia; luego usa **Sincronizar ahora**. |
| "El webhook aún no avisa nada" | Revisa que el workflow esté publicado y apunte a la URL actual. Mientras tanto, la conciliación trae los mensajes cada 10 minutos. |
| URL del webhook filtrada | **Nueva clave de webhook**: la anterior deja de funcionar de inmediato. Pega la nueva en el workflow. |
| Pausar | **Pausar** detiene la lectura y los envíos de esa subcuenta sin borrar nada. |
| Quitar | **Quitar** borra el token y la conexión. Las conversaciones ya traídas se conservan. Desactiva también el workflow en WiWO Talk. |

**Límites de HighLevel:** unas 100 solicitudes cada 10 s por token y subcuenta, y 200.000 al día por subcuenta. Ante un 429 el cliente espera y reintenta hasta 3 veces. Si se acabó el cupo diario no insiste (`WIWO_TALK_DAILY_LIMIT`).

**Cabecera `Version`:** `2021-04-15` para conversaciones y `2021-07-28` para subcuentas, como en la guía de integración. Si HighLevel exigiera otra, se cambia en `server/wiwo-talk/client.ts`.

**Demo** (`METRICOOL_MODE=demo`): el token no se verifica, no hay red, y **Simular mensaje** deja un mensaje ficticio por el mismo camino que uno real.

## Código

- `server/wiwo-talk/client.ts`: cliente HTTP, con el token como Bearer, reintentos ante 429 y códigos de error legibles.
- `server/wiwo-talk/service.ts`:
  - administración de conexiones;
  - webhook con clave en tiempo constante;
  - lectura y conciliación, una por conexión a la vez;
  - copia de adjuntos desde los hosts de HighLevel (HTTPS, 16 MB, tipos de WhatsApp);
  - envío.
- `server/wiwo-talk/routes.ts`: rutas `/api/wiwo-talk/connections…` y `/api/webhooks/wiwo-talk/:id`.
- `src/components/WiwoTalkPanel.tsx`: panel de conexiones en Gestión WhatsApp.
- Pruebas: `tests/server/wiwo-talk.test.ts`, con HighLevel simulado.
