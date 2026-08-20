# Verificación de DMs y comentarios en la API de Metricool

Verificación realizada el **12 de agosto de 2026** contra documentación oficial pública. Conclusión: **sí, la API de Metricool tiene capacidad para extraer conversaciones/DMs y comentarios del Inbox, y también para responderlos**, sujeto al plan, permisos, conexión de cada red y restricciones de Meta/Metricool.

## Evidencia oficial

- La [documentación API de Metricool](https://app.metricool.com/resources/apidocs/index.html) publica el contrato de Inbox.
- El [OpenAPI/Swagger oficial](https://app.metricool.com/api/swagger.json) define `GET /v2/inbox/conversations` y `GET /v2/inbox/post-comments`, ambos con `provider`, `userId` y `blogId`.
- La [ayuda oficial del Inbox](https://help.metricool.com/inbox-manager-how-to-manage-messages-and-comments-from-metricool-s9zze) confirma redes compatibles y limitaciones operativas.
- La [explicación oficial de planes y API](https://help.metricool.com/plans-add-ons-and-api-access-explained-xux1u) sitúa el acceso API en planes Advanced y Custom.

Una solicitud sin `X-Mc-Auth` a ambas rutas responde `401`; esto confirma que las rutas públicas existen y exigen autenticación, pero no sustituye una prueba funcional con un token autorizado.

## Contrato confirmado

| Operación | Contrato oficial relevante |
| --- | --- |
| Extraer DMs | `GET /api/v2/inbox/conversations?provider=...&userId=...&blogId=...` |
| Extraer comentarios | `GET /api/v2/inbox/post-comments?provider=...&userId=...&blogId=...` |
| Extraer reseñas | `GET /api/v2/inbox/reviews?provider=...&userId=...&blogId=...` |
| Responder DM | `POST /api/v2/inbox/conversations` con `conversationId`, `provider`, `recipient` y `text` |
| Responder comentario | `POST /api/v2/inbox/post-comments` con `objectId`, `provider` y `text` |
| Responder reseña | `POST /api/v2/inbox/reviews/replies` con `reviewId`, `provider` y `text` |

`Conversation` contiene `self`, `provider`, `status`, `participants[]` y `messages[]`. Cada `Message` incluye `id`, `from`, `to`, `text`, `publicationDateTime`, adjuntos y estado. `PostCommentsThread` contiene `self`, `provider`, estado, participantes y `root`; el root incluye el comentario principal, `comments[]` y un `element` con el contexto disponible de la publicación (`id`, `link`, `text` y `mediaUrls[]`).

Para el alcance actual, WIWO.Nodes consulta conversaciones de Facebook, Instagram y X; comentarios de Facebook, Instagram, TikTok Business, YouTube y LinkedIn; y reseñas de Google Business. En Instagram selecciona `INSTAGRAMBUSINESS` si la conexión se hizo vía Facebook o `INSTAGRAM` si se hizo directamente.

## Qué quedó implementado

- Consulta separada por cuenta y proveedor, sin enviar parámetros no documentados a Metricool.
- Normalización de cada mensaje dentro de `Conversation.messages[]`.
- Expansión del comentario raíz y sus respuestas en interacciones individuales.
- Conservación de `provider`, `conversationId`, `recipient`, `objectId`, `commentId`, `postId` y un identificador mínimo de actor para responder y agrupar sin mezclar cuentas o plataformas.
- Vista previa del post desde `root.element`, con enlace y miniatura solo cuando Metricool entrega una URL HTTPS válida; no se reconstruyen URLs desde identificadores sociales.
- Enriquecimiento local de metadatos faltantes al volver a leer un mensaje conocido, sin modificar su estado, versión, asignación, borrador ni auditoría.
- Filtro `since` y límite aplicados localmente después de normalizar.
- Pruebas contractuales con fixtures equivalentes al OpenAPI para lectura y payloads de respuesta.
- Selección por cuenta del método de conexión de Instagram y persistencia en JSON/PostgreSQL.

## Límites y validación pendiente

- Plan Advanced o Custom y token con permisos adecuados.
- Instagram: solo Inbox principal; solicitudes o carpetas filtradas pueden no aparecer.
- Facebook: páginas, no perfiles personales.
- Respuesta aproximada de 24 horas para comentarios y 7 días para DMs, según la ayuda vigente.
- No se responden comentarios de anuncios desde el Inbox.
- Metricool no ofrece una bandeja multicuenta unificada ni historial Inbox permanente; SAC Flow debe persistir lo leído.
- Sigue pendiente ejecutar UAT con una marca real autorizada para validar scopes, volumen, orden, eventuales variantes de payload, cuotas y entrega efectiva. Sin token real no es posible afirmar que una cuenta específica tenga acceso habilitado.
