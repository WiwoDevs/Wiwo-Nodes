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
9. Si cambiar una marca, el workflow o una cuenta de Metricool devuelve 500/502 o tarda, revisar primero la conexión PostgreSQL y locks (`pg_stat_activity`): estas rutas ya no reescriben el store y en condiciones normales emiten solo uno o dos `UPDATE`. Una espera larga indica otra transacción reteniendo el lock de escritura de la organización (p. ej. un `postgres:import-json` o una sincronización), no volumen de interacciones.
10. Si falla solo una superficie, identificar plataforma y capacidad antes de reintentar: conversaciones (Instagram/Facebook/X), comentarios (Instagram/Facebook/TikTok/YouTube/LinkedIn) o reseñas (Google Business). El aislamiento por superficie permite que las demás continúen.

## Frescura de la bandeja

- `/api/ready` informa `checks.inboxSync.enabled`, `intervalMinutes`, `lastRunStatus` y `lastRunAt`. La hora corresponde a un run persistido de sincronización; no es la hora en que el navegador leyó la tabla.
- `SAC_FLOW_INBOX_SYNC_ENABLED=true` autoriza únicamente la ingesta periódica de lectura. No habilita respuestas manuales, autoenvío, mutaciones generales ni nodos externos.
- Inicio y la Bandeja priorizan por plazo de respuesta (7 d DMs, 24 h comentarios). Para limpiar el histórico vencido, un supervisor filtra **Plazo → Solo fuera de plazo** y usa **Archivar fuera de plazo** (vista previa y confirmación; los casos sensibles no se archivan y nada se envía a Metricool).
- Trabajo diario en la Bandeja: **Tomar siguiente** asigna a la persona en sesión el caso en plazo sin asignar que vence antes (según los filtros activos) y lo abre; el filtro **Asignación → Mis casos** muestra solo lo propio. En el detalle, **J/K** pasan al caso siguiente/anterior, **R** lleva a la respuesta y **E** abre el escalamiento (los atajos no actúan mientras se escribe); al resolver o escalar aparece **Siguiente caso**. El filtro de cuenta permite buscar por nombre o usuario y muestra los casos en plazo de cada cuenta. Los filtros (no la búsqueda) se recuerdan por navegador en `localStorage`, y la pestaña muestra `(N)` con los casos nuevos en plazo llegados mientras no se miraba una bandeja. En celular la bandeja se ve como tarjetas y los filtros se pliegan tras el botón **Filtros**.
- La bandeja es **en vivo** en todas las vistas (Inicio incluido): la API avisa cada cambio por `GET /api/inbox/stream` (Server-Sent Events) y el navegador pide solo los contactos que cambiaron a `GET /api/inbox/changes`, así los contadores (por ejemplo "Por atender en plazo") cambian en un segundo para todas las personas conectadas, sin recargar la página. Los plazos que vencen solos se recalculan cada minuto. Si el proxy retiene el stream, la UI pregunta cada 10 s; además descarga la bandeja completa cada 10 minutos. Con la pestaña oculta se cierra la conexión y al volver se pone al día. Si una consulta falla, conserva los datos ya cargados.
- Apache debe dejar pasar el stream sin acumularlo: no aplicar compresión (`mod_deflate`) a `text/event-stream` y mantener un tiempo de espera del proxy mayor a 25 s (el latido). Si no, todo sigue funcionando con la consulta cada 10 s.
- La lista se obtiene desde `/api/inbox/contacts`: cada fila representa una persona dentro de una cuenta y plataforma, pero las acciones usan el `replyTarget` exacto. Si el recuento de pendientes es mayor que uno, responder uno no debe cerrar los demás; la fila permanece y selecciona el siguiente caso pendiente tras actualizarse.
- En comentarios, el contexto del post solo aparece si la sincronización recibió `root.element`. La ausencia de miniatura o enlace no debe remediarse fabricando una URL desde `postId`; verificar primero una sincronización reciente y luego el payload/permiso del proveedor.
- **Gestión DMs/comentarios en vivo:** mientras la vista está abierta y la pestaña visible, la cuenta abierta se lee en Metricool cada 15 s (`POST /api/sync/live`, solo esa superficie, unos segundos). Lo nuevo aparece solo en la lista y en el chat abierto, y el encabezado muestra "En vivo · revisado hh:mm:ss". El servidor lee cada cuenta como mucho cada 10 s aunque la miren varias personas. El resto del portafolio sigue con la sincronización completa del worker cada 5 min. El retraso que queda es el de Metricool en recibir el mensaje desde Meta: Nodes no puede mostrar algo antes de que Metricool lo tenga.
- `Actualizar ahora` exige rol agente, ejecuta una sincronización de lectura y después relee la bandeja. Un `409 SYNC_IN_PROGRESS` indica que el worker u otro operador ya inició una; esperar a que termine en vez de disparar múltiples reintentos.
- El worker espera hasta 290 s la respuesta de cada sincronización programada (una del portafolio completo tarda ~2-3 min). Si al llegar su turno ya hay otra en curso (`409 SYNC_IN_PROGRESS`), la programada se da por cubierta: el job queda completado sin run propio y el log del worker registra `sync_job_skipped`. Por eso un choque de horarios ya no aparece como "trabajo fallido"; los `dead` de tipo `sync` que queden son fallos reales. Las sincronizaciones pedidas para cuentas puntuales siguen reintentándose.
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

## Seguir escribiendo en un DM (modo chat)

- En Gestión DMs, un DM ya respondido no se bloquea: el cuadro sigue disponible ("Ya está respondido. Puedes seguir escribiendo") y cada mensaje se envía a la misma conversación, con la confirmación de siempre (Ctrl + Enter abre esa confirmación). No hace falta esperar a que el cliente escriba de nuevo.
- Cuando no hay nada pendiente, el chat se abre en el último mensaje del cliente, no en la última respuesta de la cuenta.
- Sigue cerrado: un caso **resuelto** (se reabre con **Reabrir caso**), los comentarios (una respuesta pública por comentario) y cualquier caso con una entrega en curso o incierta.

## Casos cerrados por la cuenta y "Reabrir caso"

- Cuando la cuenta manda un mensaje después del del cliente, Nodes marca el caso **Respondido por el equipo** y bloquea la respuesta para no contestar dos veces. Los saludos automáticos de Meta (respuesta instantánea, mensaje de ausencia, bots) no cuentan: un texto que la cuenta mandó igual en 3 o más conversaciones dentro de los 60 s del mensaje del cliente se ignora y el caso sigue pendiente.
- Si aun así un caso quedó cerrado y el cliente necesita respuesta (por ejemplo, un saludo automático que se repite poco), **Reabrir caso** (en el aviso "Este caso ya no requiere respuesta" de Gestión DMs/comentarios o en el detalle de la Bandeja; permiso *Notas y estados*) vuelve a pendiente el último mensaje del cliente y lo deja seleccionado. Queda en la auditoría quién lo reabrió y la sincronización no lo vuelve a cerrar por la respuesta anterior.
- Este cambio no reabre solo los casos que ya estaban cerrados por un saludo automático antes del despliegue; esos se reabren a mano o con una corrección de datos aprobada.

## Clientes ocultos y carga manual de TikTok/LinkedIn

- **Ocultar un cliente** (Cuentas → **Ocultar**; vuelve desde el filtro **Ocultos** → **Mostrar**) es solo del admin principal (`SAC_FLOW_AUTH_ADMIN_EMAILS`). Oculto deja de sincronizar, sale de la bandeja, Inicio, Reportes y METRIQ, y no aparece en Cuentas para el resto del equipo. No borra nada; al mostrarlo vuelve con su historial y la sincronización siguiente trae lo pendiente. Si alguien dice que "desapareció" una marca, revisar primero el filtro **Ocultos** con un admin principal.
- **Carga manual** (Reportes → **Cargar TikTok/LinkedIn**, permiso *Cargar registros manuales*): se sube el Excel BD SAC de la marca (.xlsx; desde Google Sheets: Archivo → Descargar → Microsoft Excel). Primero se revisa: la ventana dice cuántos casos nuevos hay por red, cuántos ya estaban cargados, cuántos ya llegaron por Metricool, cuántas filas son de otras redes y qué filas tienen problemas (con su número). Solo al confirmar se guardan.
- Los casos cargados se guardan como `source: "planilla"` con la marca manual de caso SAC. Cuentan en Reportes, en el Excel y en METRIQ, pero no en la bandeja ni en los contadores de Inicio. Volver a subir el mismo archivo no duplica.
- Si una carga salió mal (marca equivocada), no hay botón para deshacerla: los registros llevan en la auditoría el lote, la fila, el archivo y la persona (`ingested`, `metadata.lote`), y se pueden identificar en la base por `external_id LIKE 'planilla:%'` y `source = 'planilla'`. Borrar filas de producción requiere aprobación explícita y un respaldo previo.

## Respaldos de la base

En producción, el servicio `backup` de `docker-compose.production.yml` respalda la base PostgreSQL completa con `pg_dump` (script `scripts/postgres-backup.sh`). La base guarda todo el historial: mensajes, borradores, respuestas, asignaciones, casos marcados a mano, marcas, usuarios y roles.

- **Cuándo:** al arrancar el servicio, si ese día todavía no hay respaldo, y después todos los días a las `SAC_FLOW_BACKUP_HOUR_UTC` (por defecto 06:00 UTC, 03:00 en Chile). Si falla, reintenta dos veces cada diez minutos.
- **Dónde:** en el servidor, en `SAC_FLOW_BACKUP_DIR` (por defecto `/var/backups/sac-flow`), fuera del volumen de Docker. Así, un `docker compose down -v` o un volumen dañado no se llevan los respaldos.
- **Cuántos:** se guardan `SAC_FLOW_BACKUP_RETENTION_DAYS` días (por defecto 14). Los tres más recientes no se borran nunca, y un respaldo que falla no borra los anteriores.
- **Formato:** `sac-flow-AAAA-MM-DDTHHMMSSZ.dump`, formato custom de PostgreSQL y comprimido. Antes de guardarlo se comprueba que se pueda leer.
- **Salud:** `docker compose ... ps` muestra `backup` como `unhealthy` si no hay un respaldo de las últimas 26 horas.

Desde la carpeta del despliegue, primero se define un alias para no repetir el prefijo:

```bash
alias nodes='docker compose --env-file .env.production -f docker-compose.production.yml'
nodes ps backup                                          # healthy = hay respaldo reciente
nodes logs --tail 20 backup                              # último respaldo y errores
nodes exec backup sh /usr/local/bin/sac-flow-backup list # respaldos guardados
nodes exec backup sh /usr/local/bin/sac-flow-backup once # respaldo ahora (antes de un cambio riesgoso)
```

### Restaurar

Restaurar reemplaza **toda** la base por el contenido del respaldo. Lo ocurrido después de ese respaldo se pierde de Nodes, aunque la próxima sincronización vuelve a traer de Metricool los mensajes que este todavía entregue.

1. Detener la API y el worker: `nodes stop api worker`.
2. Restaurar:
   ```bash
   nodes run --rm -e SAC_FLOW_CONFIRM_RESTORE=sac_flow backup restore sac-flow-AAAA-MM-DDTHHMMSSZ.dump
   ```
   El script se niega si falta la confirmación o si la base tiene conexiones abiertas. Antes de restaurar guarda un respaldo del estado actual. La carga ocurre en una sola transacción: si falla, la base queda como estaba.
3. Levantar de nuevo: `nodes up -d api worker`. `migrate` corre antes de la API y vuelve a aplicar las migraciones posteriores al respaldo.
4. Verificar `/api/ready` y que Reportes muestre los meses esperados.

Los datos cifrados de la base (referencias de Metricool y credenciales) solo se leen con las mismas `SAC_FLOW_POSTGRES_ENCRYPTION_KEY` y `SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY`. Esas claves deben guardarse aparte, en el gestor de secretos, nunca junto a los respaldos.

### Copia fuera del servidor

Estos respaldos protegen contra borrados, migraciones fallidas y volúmenes dañados, pero viven en el mismo servidor. Para sobrevivir a la pérdida del servidor, copiar `/var/backups/sac-flow` a otro lugar (otro servidor o un almacenamiento de objetos), cifrado y con acceso restringido. Contienen mensajes y datos de clientes: nunca se suben a repositorios, tickets, chats ni carpetas compartidas abiertas.

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
