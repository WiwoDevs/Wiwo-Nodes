# Configuración de Metricool

## Requisitos previos

1. Cuenta Metricool con plan **Advanced o Custom**. La API no está incluida en Free ni Starter.
2. Las aproximadamente 20 marcas creadas y sus páginas/cuentas de Instagram y Facebook conectadas en Metricool.
3. Permisos suficientes en las páginas de Facebook y acceso a Instagram DMs habilitado al conectar Meta.
4. `userId`, token de API y un `blogId` por marca, obtenidos por una persona autorizada.

Fuentes oficiales: [acceso a la API](https://help.metricool.com/api-access-export-your-metricool-data-to-other-tools-and-automate-tasks-x8ln5), [guía básica de integración](https://help.metricool.com/basic-guide-for-api-integration-r97af), [documentación OpenAPI](https://app.metricool.com/resources/apidocs/index.html) y [límites del Inbox](https://help.metricool.com/inbox-manager-how-to-manage-messages-and-comments-from-metricool-s9zze).

## Obtener los identificadores sin compartir secretos

Desde la sesión autorizada de Metricool:

1. Ir a **Account Settings > API**.
2. Copiar el token en el gestor de secretos o en `.env` solo para desarrollo local.
3. Obtener el `userId` de la cuenta.
4. Abrir cada marca y registrar su `blogId`; Metricool indica que puede localizarse en la URL del navegador.
5. Asociar internamente cada `blogId` con el nombre y slug de marca de SAC Flow.

No pegar valores reales en `.env.example`, documentación, tickets, capturas, logs ni frontend. El token pertenece al usuario y puede dar acceso a varias marcas.

## Variables locales

Crear `.env` desde `.env.example` y completar solo en el equipo autorizado:

```dotenv
METRICOOL_MODE=live
METRICOOL_BASE_URL=https://app.metricool.com/api
METRICOOL_API_TOKEN=<valor-del-gestor-de-secretos>
METRICOOL_USER_ID=<id-real>
```

Con `METRICOOL_MODE=demo`, la API usa datos ficticios y no contacta a Metricool. Con `METRICOOL_MODE=live`, el arranque falla cerrado si falta `METRICOOL_API_TOKEN`; además, live exige `SAC_FLOW_API_KEY` por defecto salvo que se desactive explícitamente para una prueba local. Los `blogId` se configuran por marca mediante `METRICOOL_ACCOUNTS_JSON` o los datos persistidos; la vista **Cuentas** también puede guardar/reemplazar una referencia `userId`/`blogId` por cuenta llamando al backend. `METRICOOL_BLOG_ID` sirve solo como fallback de una marca y queda activo por defecto solo en demo. Mantener `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true` y el workflow en borrador durante la conexión y las pruebas de lectura.

La API local nunca devuelve `userId`, `blogId` ni el token en respuestas HTTP. En producción, estas referencias deben migrarse desde JSON a PostgreSQL/secret manager con auditoría administrativa y permisos por marca.

`METRICOOL_ACCOUNTS_JSON` es un objeto indexado por el `accountId` interno, no una lista:

```json
{
  "<account-id>": {
    "userId": "<user-id-autorizado>",
    "blogId": "<blog-id-de-la-marca>",
    "instagramProvider": "INSTAGRAMBUSINESS"
  }
}
```

Compactar ese objeto en una sola línea al guardarlo como variable de entorno. Los marcadores entre `<...>` describen el formato y deben sustituirse solo en `.env` o en el gestor de secretos; no son credenciales válidas.

## Autenticación y endpoints de Inbox

La API oficial usa:

- Cabecera `X-Mc-Auth: <userToken>`.
- Query params `userId=<userId>` y `blogId=<blogId>` en cada llamada.
- Base URL `https://app.metricool.com/api`.

Endpoints que usa el adaptador:

| Acción | Método y ruta Metricool | Dato adicional |
| --- | --- | --- |
| Leer DMs | `GET /v2/inbox/conversations` | Query obligatorio `provider`; SAC Flow usa `INSTAGRAMBUSINESS`, `INSTAGRAM` o `FACEBOOK` |
| Responder DM | `POST /v2/inbox/conversations` | Body `conversationId`, `provider`, `recipient`, `text` |
| Leer comentarios | `GET /v2/inbox/post-comments` | Query obligatorio `provider` |
| Responder comentario | `POST /v2/inbox/post-comments` | Body `objectId`, `provider`, `text` |
| Leer reseñas | `GET /v2/inbox/reviews` | Query obligatorio `provider`; WIWO.Nodes usa `GMB` |
| Responder reseña | `POST /v2/inbox/reviews/replies` | Body `reviewId`, `provider`, `text` |
| Cambiar estado | `PUT /v2/inbox/status` | Body según `ChangeStatusRequest` |

El contrato anterior fue contrastado el 12 de agosto de 2026 con el [OpenAPI oficial](https://app.metricool.com/api/swagger.json). `Conversation` contiene `participants[]` y `messages[]`; cada mensaje expone, entre otros, `from`, `to`, `text` y `publicationDateTime`. Los comentarios se entregan como `PostCommentsThread`, con `root` y sus `comments[]`; `root.element` puede aportar el ID, enlace, texto y medios de la publicación. WIWO.Nodes conserva únicamente el identificador del autor y el contexto mínimo del post, valida los enlaces públicos como HTTPS y completa metadatos faltantes en registros ya existentes sin sobrescribir el estado operativo ni los borradores. Ver la [verificación contractual detallada](./METRICOOL_API_VERIFICATION.md).

Los mensajes sin texto no se convierten en texto inventado. El normalizador revisa `attachments[]`, `mediaUrl`, `properties.story.reply_to`, `properties.story.mention`, `properties.reactions`, `properties.is_unsupported` y `status=DELETED`. Conserva solo la categoría y enlaces HTTPS públicos minimizados, sin credenciales ni destinos privados; no persiste el payload completo ni copia los archivos de Meta. La UI intenta mostrar el medio y mantiene un enlace/fallback si ya expiró. Si Metricool marca el mensaje como eliminado, se descartan el texto y los enlaces anteriores. Las historias y adjuntos eliminados, efímeros o nunca entregados por la API no pueden reconstruirse.

Para Instagram, usar `INSTAGRAMBUSINESS` cuando la cuenta fue conectada a Metricool vía Facebook —opción recomendada por Metricool para el conjunto completo de funciones— y `INSTAGRAM` cuando se conectó con credenciales directas de Instagram. La vista **Cuentas** permite guardar esa elección por marca.

## Prueba de conectividad

Antes de usar un token real, validar el cliente HTTP completo contra el simulador contractual local:

```powershell
npm run smoke:metricool-contract
```

La prueba levanta un servidor efímero únicamente en `127.0.0.1`, comprueba rutas, cabeceras, query, cuerpos de respuesta y los casos `204`, `401`, `429` con `Retry-After`, `500` y timeout. No se conecta a Metricool ni usa credenciales reales.

## Consumo responsable de la API

Metricool no publica una cuota numérica fija en su OpenAPI ni en el centro de ayuda. Por eso SAC Flow no inventa una: serializa las llamadas de cada token con al menos 250 ms entre ellas, usa un mínimo de 5 minutos para la sincronización programada y trata `429`/`Retry-After` como la autoridad. Mientras ese plazo esté vigente, no emite otra llamada al proveedor. No se reintenta en bucle ni se incrementa la frecuencia para compensar una lectura parcial.

Con la API local iniciada y respuestas desactivadas:

```powershell
Invoke-RestMethod http://localhost:8787/api/health
Invoke-RestMethod http://localhost:8787/api/ready
Invoke-RestMethod -Method Post http://localhost:8787/api/sync
```

En live, añadir `X-API-Key` y un `Idempotency-Key` único en cada sincronización o envío real.

Cada envío se persiste antes de llamar a Metricool. Si la respuesta del proveedor es ambigua, SAC Flow lo marca `uncertain`, bloquea cualquier nueva entrega sobre ese caso y exige que un supervisor verifique la conversación en Metricool. Después debe conciliar desde el detalle SAC o con `POST /api/deliveries/:id/reconcile`, dejando una nota de evidencia. Nunca reenviar manualmente antes de resolver ese estado.

Para una prueba live draft-only, dejar `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true`. La API seguirá guardando borradores, pero cualquier `mode: "send"` responderá `423 OUTBOUND_SENDS_DISABLED` sin llamar a Metricool.

Para un UAT limitado a respuestas humanas, configurar `SAC_FLOW_DISABLE_OUTBOUND_SENDS=false` y `SAC_FLOW_ENABLE_MANUAL_REPLIES=true`, manteniendo `SAC_FLOW_DISABLE_METRICOOL_MUTATIONS=true`, `SAC_FLOW_DISABLE_EXTERNAL_NODES=true` y `SAC_FLOW_AUTO_REPLY_DISPATCH_MODE=shadow`. Así, solo el botón confirmado por un agente puede contactar a Metricool; el worker automático y las mutaciones de workflows continúan bloqueados.

Para mantener fresca la bandeja sin habilitar respuestas automáticas, configurar `SAC_FLOW_INBOX_SYNC_ENABLED=true`. Este gate permite únicamente que el worker ejecute la lectura periódica de DMs, comentarios y reseñas según `pollIntervalMinutes`; no levanta ningún cortacorriente de salida. La bandeja consulta luego la copia local cada 30 segundos mientras está visible. `Actualizar ahora` ejecuta la misma lectura de forma excepcional y permanece en la bandeja.

Verificar en la respuesta:

- que cada marca correcta finaliza sin error;
- que un `401`/`403` no se reintenta indefinidamente;
- que un `blogId` inválido afecta solo a esa marca;
- que el recuento no se duplica al repetir la sincronización;
- que ninguna respuesta salió mientras el workflow esté configurado en modo borrador.
- que al simular un timeout la entrega queda `uncertain`, un segundo intento no contacta al proveedor y la conciliación queda auditada.

Si se necesita diagnosticar directamente contra Metricool, usar Postman o una terminal local con variables de entorno. No guardar el token en el historial ni incluirlo en un comando compartido.

## Restricciones operativas de Meta/Metricool

- Instagram expone únicamente la **bandeja principal**; solicitudes y carpetas filtradas no aparecen.
- No se puede responder desde el Inbox a comentarios de anuncios de Facebook o Instagram.
- En Facebook e Instagram, Metricool informa un plazo de **24 horas para comentarios** y **7 días para DMs**. WIWO.Nodes permite intentar manualmente una respuesta más antigua, pero Metricool/Meta pueden rechazarla; si ocurre, debe responderse directamente desde la red social. La automatización conserva estos casos para revisión humana.
- Metricool trabaja por marca y no ofrece una bandeja unificada; SAC Flow agrega esa vista consultando cada `blogId`.
- El estado leído/no leído no se comparte de forma fiable entre Metricool y las redes.
- Metricool no conserva historial permanente del Inbox. La copia local/PostgreSQL debe considerarse necesaria para reporting, sujeta a la política de retención.
- Metricool no ofrece respuestas automáticas dentro de su Inbox; cualquier automatización queda bajo control y auditoría de SAC Flow.

La automatización rechaza comentarios y DMs fuera del plazo aplicable antes de enviarlos. En un envío manual, la interfaz advierte que el plazo recomendado venció y permite un único intento explícito; Metricool/Meta deciden la aceptación y el borrador se conserva ante rechazo. Nunca intentar sortear las políticas del proveedor.

## Incorporar las 20 marcas

Hacer el alta en lotes pequeños:

1. Crear la marca/cuenta interna desde la vista **Cuentas** o con `POST /api/brands` usando un actor `admin` con scope completo (`X-SAC-Brand-Ids: *`).
2. Guardar la referencia Metricool de esa cuenta desde la pestaña **Cuentas** o con `PUT /api/accounts/:accountId/metricool`.
3. Conectar una marca piloto y sincronizar Instagram en lectura.
4. Repetir con Facebook.
5. Validar IDs, horas, acentos, saltos de línea y deduplicación.
6. Enviar una respuesta de prueba aprobada manualmente dentro del plazo y validar aparte que un caso vencido muestre advertencia, se intente una sola vez y registre cualquier rechazo sin reintento automático.
7. Incorporar 4 marcas y observar errores/límites.
8. Completar las 20 marcas.
9. Mantener auto-respuesta apagada hasta aprobar plantillas, exclusiones y rollback.

Para el MVP local, la marca nueva puede crearse desde la UI o por API y una referencia también puede guardarse desde la pestaña **Cuentas**: seleccionar una marca, ingresar `userId`, `blogId` y el tipo de conexión de Instagram, y guardar. Si se desconecta una cuenta desde esa misma vista, se elimina la referencia persistida y también se retira la cuenta de `autoReplyAccountIds`. Si una marca se desactiva desde la UI o con `DELETE /api/brands/:brandId`, la operación es recuperable: desactiva marca/cuenta, retira la referencia persistida y no borra historial.

El cambio a live no autoriza envíos automáticos. Conservar `autoReplyEnabled=false` y `autoReplyAccountIds=[]`; después de UAT, incorporar cada `accountId` únicamente con aprobación registrada de esa marca.

Para cada marca registrar dueño operativo, `blogId`, redes conectadas, zona horaria, plantilla permitida, contacto de escalamiento y fecha de última prueba. No registrar el token por marca si todas usan el mismo usuario.

## Rotación o revocación

Ante exposición, baja de una persona o error `401` generalizado:

1. Desactivar sincronización/respuestas.
2. Regenerar el token desde Metricool.
3. Actualizar el secreto en el entorno, sin commit.
4. Reiniciar el servicio o refrescar el secreto según la plataforma.
5. Ejecutar salud y sincronización de una marca piloto.
6. Revisar logs por posibles usos posteriores del token anterior.
