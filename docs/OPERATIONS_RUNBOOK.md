# Runbook de operación SAC Flow

## Alcance

Este runbook cubre señales locales de cola, jobs durables y respuestas automáticas. No autoriza envíos externos, cambios en Metricool ni activación de `live`. Los cortacorrientes del entorno prevalecen sobre cualquier reintento.

La conexión de los libros de registros y QA por marca es de solo lectura: la API descarga una copia XLSX desde `docs.google.com`, valida su contrato y nunca escribe en Google. Si `/api/brands/:brandId/workbook/export` devuelve `WORKBOOK_EXPORT_FAILED`, no fuerce la descarga ni edite el hash persistido; compare pestañas/encabezados con el libro fuente y revalide mediante la UI con rol administrador. Los enlaces del centro documental se guardan como metadatos locales; eliminarlos no borra el archivo original.

## Señales mínimas

`GET /api/metrics` requiere rol `supervisor` y expone agregados sin texto de conversaciones, nombres, handles, IDs de cuenta, claves ni errores completos.

| Alerta sugerida | PromQL base | Espera | Severidad | Interpretación |
| --- | --- | --- | --- | --- |
| Jobs agotados | `sac_flow_jobs_total{status="dead"} > 0` | 5 min | warning | Existe trabajo que agotó sus intentos y requiere diagnóstico |
| Job agotado envejecido | `sac_flow_oldest_job_state_age_seconds{status="dead"} > 900` | 5 min | critical | Un fallo terminal lleva más de 15 minutos sin resolverse |
| Procesamiento detenido | `sum(sac_flow_jobs_overdue_total) > 0` | 5 min | critical | Hay jobs `queued` o `retry` cuyo próximo intento ya venció |
| Cola de respuestas alta | `sac_flow_auto_reply_queue_pending_total / sac_flow_auto_reply_queue_max_pending > 0.8` | 10 min | warning | El outbox superó 80% de su capacidad configurada |
| Cola saturada | `sac_flow_auto_reply_queue_saturated == 1` | 1 min | critical | Nuevas candidatas automáticas están siendo retenidas |
| Envío incierto | `sac_flow_reply_deliveries_total{status="uncertain"} > 0` | 1 min | critical | Se desconoce si el proveedor recibió una respuesta; no reintentar a ciegas |
| Límite agotado | `sac_flow_reply_rate_limit_exhausted_total > 0` | 5 min | warning | Una entrega consumió todos sus reintentos por rate limit |

Los umbrales son una base de staging. Techlab debe ajustarlos con el volumen real, el intervalo del worker y los SLO aprobados. No convertir una alerta en reintento automático.

## Diagnóstico seguro

1. Confirmar `/api/health`, `/api/ready` y salud del worker antes de tocar un job.
2. Abrir `Automation Studio > Ejecuciones > Cola operativa` con rol supervisor.
3. Registrar ID del job, estado, número de intentos, hora de actualización y `X-Request-Id`; no copiar texto de clientes ni secretos al ticket.
4. Para `retry` vencido, revisar worker, conexión PostgreSQL y lease. No reiniciar masivamente si hay un despliegue o migración activa.
5. Para `dead`, corregir primero la causa. Solo un administrador puede confirmar `Reintentar ahora`.
6. Para `401/403`, revisar configuración o autorización del proveedor. No aumentar intentos.
7. Para `429`, conservar `Retry-After` y el cooldown por cuenta. No reencolar en lote.
8. Para `uncertain`, usar conciliación explícita. Nunca asumir que el envío falló.
9. Si falla solo una superficie, identificar plataforma y capacidad antes de reintentar: conversaciones (Instagram/Facebook/X), comentarios (Instagram/Facebook/TikTok/YouTube/LinkedIn) o reseñas (Google Business). El aislamiento por superficie permite que las demás continúen.

## Frescura de la bandeja

- `/api/ready` informa `checks.inboxSync.enabled`, `intervalMinutes`, `lastRunStatus` y `lastRunAt`. La hora corresponde a un run persistido de sincronización; no es la hora en que el navegador leyó la tabla.
- `SAC_FLOW_INBOX_SYNC_ENABLED=true` autoriza únicamente la ingesta periódica de lectura. No habilita respuestas manuales, autoenvío, mutaciones generales ni nodos externos.
- La UI relee PostgreSQL cada 30 segundos solo cuando la bandeja está visible. Si ese GET falla, conserva los datos ya cargados y marca la vista con retraso.
- La lista se obtiene desde `/api/inbox/contacts`: cada fila representa una persona dentro de una cuenta y plataforma, pero las acciones usan el `replyTarget` exacto. Si el recuento de pendientes es mayor que uno, responder uno no debe cerrar los demás; la fila permanece y selecciona el siguiente caso pendiente tras actualizarse.
- En comentarios, el contexto del post solo aparece si la sincronización recibió `root.element`. La ausencia de miniatura o enlace no debe remediarse fabricando una URL desde `postId`; verificar primero una sincronización reciente y luego el payload/permiso del proveedor.
- `Actualizar ahora` exige rol agente, ejecuta una sincronización de lectura y después relee la bandeja. Un `409 SYNC_IN_PROGRESS` indica que el worker u otro operador ya inició una; esperar a que termine en vez de disparar múltiples reintentos.
- Investigar una última sincronización `partial` o `failed` por cuenta y superficie. No borrar el histórico ni habilitar salidas para corregir un problema de lectura.

## Gestión manual por cuenta

1. Seleccionar primero la cuenta autorizada y luego la superficie. En DMs se elige una persona; en comentarios se elige una publicación y después el comentario exacto pendiente.
2. Confirmar que las publicaciones estén ordenadas por `publishedAt` descendente. Si la tarjeta indica “Actividad”, Metricool no entregó la fecha del post y el orden usa `latestCommentAt`; no presentar ese valor como fecha de publicación.
3. Dentro del post, atender la cola inbound abierta del comentario más antiguo al más reciente. Antes de responder, verificar el usuario, texto completo, estado y resaltado “Seleccionado para responder”. El panel derecho debe corresponder siempre a la misma cuenta y publicación.
4. Revisar el contexto del post. Solo se acepta un permalink HTTPS entregado por el proveedor; si falta, operar sin inventar un enlace o timestamp.
5. Guardar borrador no envía nada. Para responder, revisar el texto y aceptar la confirmación humana; la API aplica rol, scope, ID exacto, `expectedVersion` e idempotencia.
6. Tras éxito confirmado, actualizar el contador y avanzar al siguiente pendiente. Ante `409`, recargar la versión sin perder el texto; ante `423`, revisar cortacorrientes/permisos; ante rechazo conservar el borrador; ante `uncertain`, bloquear un segundo envío y escalar a conciliación de supervisor.
7. En mensajes con adjunto o historia, revisar la vista previa o el enlace antes de responder. Si el recurso expiró, usar el contexto textual disponible o abrir la conversación en la red social; no inferir el contenido ni automatizar el caso.

El polling visible solo ejecuta lecturas GET y no activa `/sync`, el protocolo SAC ni `/reply`. Si aparecen envíos al abrir, filtrar o seleccionar, detener la prueba y revisar requests/auditoría antes de continuar.

## Checkpoint y rollback local

El punto previo a la bandeja account-first es `checkpoint/before-account-manual-inbox-20260817`, commit `e9ee6301049c59e53fdf96a20dd75bfbf49197d9`. Usarlo revierte código local, no el estado externo: una respuesta ya confirmada por Metricool/Meta no se retracta al volver el repositorio. Antes de un rollback, detener nuevas respuestas, registrar entregas `sent`/`uncertain` y conciliar las ambiguas.

## Cierre del incidente

- La cola `dead` vuelve a cero o cada excepción queda aceptada con dueño y fecha.
- `sac_flow_jobs_overdue_total` permanece en cero por al menos dos intervalos del worker.
- No quedan entregas `uncertain` sin decisión documentada.
- Readiness continúa `ready` y la cola automática está bajo 80%.
- Se conserva evidencia del motivo, acción, actor y resultado sin PII.

## Escalamiento

- SAC supervisor: priorización, impacto y validación funcional.
- Administrador de plataforma: reintento manual y configuración interna.
- SRE/Backend: worker detenido, lease, PostgreSQL, migraciones o crecimiento de cola.
- Seguridad/Integraciones: autorización, credenciales, filtración potencial o comportamiento inesperado del proveedor.
