# Seguridad y privacidad

## Estado de seguridad del MVP

La versión local es una herramienta de demostración/desarrollo. Tiene una protección liviana por API key para live/staging y un puente temporal de contexto `X-SAC-*` desde gateway, pero no tiene todavía SSO nativo, RBAC conectado a identidad real ni almacenamiento productivo. Por eso:

- usarla solo en `localhost` o en una red de desarrollo confiable;
- mantener `METRICOOL_MODE=demo` si no se está realizando una prueba autorizada;
- no exponer el puerto de la API a Internet;
- no cargar DMs reales en equipos compartidos;
- no habilitar respuestas automáticas hasta completar controles y UAT.

Esta advertencia es una frontera de uso, no una certificación de seguridad.

Controles ya implementados en la beta: live falla si falta token, live puede exigir `SAC_FLOW_API_KEY`, CORS queda en mismo origen por defecto en live/producción, mutaciones cross-site se rechazan mediante `Origin` y Fetch Metadata, headers y rate limit se activan en live/producción, sync/envíos live requieren una reserva idempotente atómica y `SAC_FLOW_DISABLE_OUTBOUND_SENDS` bloquea `send`. `SAC_FLOW_ENABLE_MANUAL_REPLIES` es una excepción separada y explícita para respuestas aprobadas por una persona; no abre las mutaciones generales de Metricool. El despacho automático tiene una compuerta adicional `SAC_FLOW_AUTO_REPLY_DISPATCH_MODE=shadow|live`; `shadow` es el valor predeterminado, el worker exige además que los cortacorrientes de envíos y mutaciones Metricool estén desactivados, y `SAC_FLOW_AUTO_REPLY_MAX_PENDING` limita la presión de la cola. Automation Studio cifra credenciales/variables secretas con AES-256-GCM, redacta claves sensibles y valores secretos antes de persistir ejecuciones, valida workflows antes de publicar, resuelve DNS y bloquea rangos privados en HTTP, y mantiene `SAC_FLOW_DISABLE_EXTERNAL_NODES=true` y `SAC_FLOW_DISABLE_METRICOOL_MUTATIONS=true` por defecto. La API puede exigir actor/rol, PostgreSQL aplica RLS, health/readiness están separados y `/api/metrics` contiene agregados sin PII.

El módulo SAC conserva defensas propias: categorías críticas nunca pueden auto-responderse, `SAC_FLOW_REPOSITORY=json` queda bloqueado en live/producción salvo excepción explícita, las referencias de cuenta no exponen `userId`/`blogId`/token, el XLSX neutraliza fórmulas y cada respuesta incluye un `X-Request-Id` UUID para correlación segura.

## Datos sensibles

Los DMs y comentarios pueden contener nombres, handles, teléfonos, correos, números de pedido, reclamos y otros datos personales. El token de Metricool es un secreto de alto impacto porque puede autorizar acciones en varias marcas.

Clasificación mínima:

| Dato | Clasificación | Regla |
| --- | --- | --- |
| Token Metricool y credenciales SSO | Secreto | Solo gestor de secretos; nunca frontend/log/Excel |
| Texto de DMs y datos de contacto | Confidencial | Acceso por rol, cifrado y retención limitada |
| IDs de marcas/cuentas | Interno | No son secretos por sí solos, pero no publicarlos innecesariamente |
| Métricas agregadas sin identificadores | Interno | Endpoint protegido por rol/gateway; no incluir texto ni handles |
| Datos demo | Público interno | Deben ser inequívocamente ficticios |

## Controles obligatorios antes de producción

### Identidad y autorización

- Integrar OIDC/SSO de Techlab.
- Aplicar RBAC en la API, no solo ocultar botones.
- Definir al menos `viewer`, `agent`, `supervisor` y `admin`.
- Restringir cada usuario a sus marcas/tenant.
- Exigir reautenticación o permiso elevado para credenciales y auto-respuesta.
- Si se usa temporalmente `SAC_FLOW_TRUST_ACTOR_HEADERS=true`, el gateway debe eliminar cualquier `X-SAC-*` entrante del navegador y reconstruir esas cabeceras desde la sesión validada.

### Secretos

- Guardar el token de Metricool en el gestor de secretos de Techlab.
- Inyectarlo solo al proceso servidor/worker.
- Redactar `X-Mc-Auth`, cookies, authorization headers y cuerpos sensibles en logs.
- Rotar en incidentes, bajas y calendario aprobado; documentar dueño y última rotación.
- Mantener `SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY` separada de las credenciales cifradas y fuera de la base.
- Reemplazar claves de entorno por KMS/Vault con envelope encryption antes de producción multi-tenant.

### Workflows generales

- Mantener nodos HTTP externos y mutaciones Metricool desactivados en desarrollo/UAT inicial.
- No admitir `eval`, shell ni código arbitrario dentro del proceso API/worker.
- Autenticar cada webhook mediante secreto o firma y aplicar replay protection antes de exposición pública.
- Tratar parámetros, payloads, expresiones, URLs y outputs como datos no confiables.
- Aplicar límites de items, tamaño, profundidad de objetos, tiempo, concurrencia y subworkflows.
- Registrar cambios de credencial, publicación, activación y ejecución sin copiar valores secretos.
- Operar nodos HTTP detrás de un proxy/firewall de egreso en producción; la validación DNS previa no elimina por sí sola una carrera de DNS rebinding.

### Protección HTTP

- TLS en tránsito y cifrado administrado en PostgreSQL/backups.
- Aplicar las migraciones de `db/migrations/` con RLS activo y `SET LOCAL app.organization_id` en cada transacción tenant-scoped.
- Configurar `SAC_FLOW_REPOSITORY=postgres` en producción; `SAC_FLOW_ALLOW_JSON_IN_LIVE=true` solo puede usarse como excepción temporal aprobada y con fecha de retiro.
- CORS con allowlist exacta; nunca `*` junto con credenciales.
- Mantener `SAC_FLOW_ENFORCE_ORIGIN_CHECK=true`; consultar [GATEWAY_CONTRACT.md](./GATEWAY_CONTRACT.md).
- Cookies `HttpOnly`, `Secure` y `SameSite` si se usa sesión web.
- Protección CSRF para mutaciones basadas en cookies.
- Límites de tamaño de body, timeouts y rate limits por usuario/marca.
- Allowlist de salida limitada a hosts oficiales de Metricool; no aceptar URLs arbitrarias como destino de proxy.
- Los enlaces de publicaciones se aceptan solo si Metricool entrega una URL HTTPS, se abren con aislamiento de pestaña y nunca se reconstruyen desde IDs sociales. Las miniaturas remotas se tratan como contenido no confiable, se solicitan sin referrer y no reciben credenciales de WIWO.Nodes; no existe un proxy abierto por URL. El navegador aún puede aplicar su propia política de cookies del dominio remoto, por lo que una futura política de privacidad más estricta debe usar un proxy cerrado con allowlist o prescindir de miniaturas externas.

### Integridad operativa

- Idempotency key o restricción única para respuestas, evitando duplicados al reintentar.
- `expectedVersion` obligatorio en mutaciones de casos para rechazar sobrescrituras concurrentes con `409 INTERACTION_VERSION_CONFLICT`.
- En **Gestión manual por cuenta**, `viewer` solo consulta; `agent` puede guardar borradores y confirmar respuestas; `supervisor` puede además asignar y conciliar entregas ambiguas; `admin` conserva las operaciones de configuración. El backend valida rol y scope de marca en cada request: ocultar un control en la UI no concede ni revoca permisos.
- Abrir la vista, cambiar cuenta/pestaña, seleccionar una persona y el polling periódico son operaciones GET. Ninguna de ellas debe ejecutar sincronización, protocolo SAC o respuesta; el envío nace exclusivamente del control manual, su confirmación visible y el `replyTarget` exacto.
- Un fallo o conflicto conserva el texto del operador y no presenta éxito. Una entrega `uncertain` bloquea el reenvío ciego hasta conciliación; un rollback local de UI o código no puede retractar una respuesta que el proveedor ya confirmó.
- Notas internas separadas del mensaje saliente: no enviarlas a Metricool ni incluir su texto en XLSX o eventos de auditoría resumidos.
- Auditoría inmutable de sincronización, aprobación, respuesta, exportación y cambios de configuración.
- Auto-respuesta desactivada por defecto, lista de cuentas vacía, aprobación explícita por marca, modo sombra ambiental y controles de apagado separados para envíos y mutaciones Metricool.
- Plantillas versionadas, pruebas por marca, lista de temas prohibidos y derivación humana.
- Respeto estricto de los plazos de 24 horas para comentarios y 7 días para DMs en auto-respuesta. Los intentos manuales fuera de plazo requieren confirmación visible, auditoría y aceptación final de Metricool/Meta.

### Excel

Antes de escribir texto controlado por usuarios en XLSX, neutralizar celdas que comiencen con `=`, `+`, `-` o `@` para prevenir inyección de fórmulas. No incluir tokens, payloads crudos innecesarios ni PII que no forme parte del propósito del reporte.

### Dependencias y entrega

- Usar lockfile y builds reproducibles.
- Ejecutar pruebas, `npm audit` según política, análisis de secretos y escaneo de imagen.
- Fijar una imagen Node soportada y reconstruir ante parches críticos.
- Ejecutar el contenedor sin root, con filesystem de solo lectura salvo volúmenes explícitos.
- Generar SBOM y conservar procedencia del artefacto en CI/CD de Techlab.

## Amenazas principales

| Amenaza | Riesgo | Mitigación mínima |
| --- | --- | --- |
| Token expuesto al navegador/log | Control de múltiples marcas | Backend-only, secrets manager y redacción |
| Respuesta duplicada por reintento | Mala experiencia/reputación | Idempotencia y registro de `externalId` |
| Usuario accede a otra marca | Fuga entre clientes | Tenant/brand scope en cada query y RBAC |
| Mensaje malicioso altera automatización | Respuesta inapropiada o exfiltración | Tratar texto como no confiable, reglas cerradas y aprobación |
| Fórmula en XLSX | Ejecución al abrir exportación | Sanitización de celdas y pruebas específicas |
| Pérdida del JSON local | Pérdida de historial | Backup; migración temprana a PostgreSQL |
| API externa lenta/fallida | Saturación y duplicados | Timeout, backoff, circuit breaker y cola durable |
| Auto-respuesta fuera de plazo | Incumplimiento de políticas | `replyEligible`, reloj UTC, derivación a revisión humana y cortacorriente |

## IA y contenido no confiable

Si Techlab añade clasificación o generación con IA:

- tratar el texto recibido como entrada no confiable y posible prompt injection;
- no exponer secretos, instrucciones internas, datos de otras marcas ni herramientas arbitrarias al modelo;
- usar salida estructurada validada y umbral de confianza;
- exigir aprobación humana para reclamos, pagos, salud, amenazas, asuntos legales, datos personales o respuestas negativas;
- registrar modelo, versión de prompt, resultado, decisión humana y mensaje finalmente enviado;
- definir retención y residencia de datos con el proveedor antes de enviar DMs reales.

## Retención, exportación y borrado

Techlab debe acordar una política explícita antes del piloto real:

- finalidad y base autorizada para conservar conversaciones;
- período de retención por tipo de dato;
- mecanismo de búsqueda, corrección y borrado;
- caducidad de archivos XLSX y links de descarga;
- tratamiento de backups y logs;
- responsables ante solicitudes de titulares e incidentes.

No conservar indefinidamente “por si acaso”. Un borrado en la red o en Metricool no borra automáticamente la copia de SAC Flow.

## Respuesta a incidentes

1. Desactivar auto-respuesta y, si corresponde, sincronización.
2. Revocar/rotar token y sesiones afectadas.
3. Preservar auditoría sin copiar PII a canales inseguros.
4. Delimitar marcas, usuarios, período y acciones afectadas.
5. Notificar por el proceso de Techlab y obligaciones aplicables.
6. Recuperar desde artefactos limpios y validar una marca piloto.
7. Registrar causa raíz y controles correctivos antes de reactivar.

## Checklist de revisión

- [ ] SSO/RBAC y aislamiento por marca probados con casos negativos.
- [ ] Secret scanning confirma que no hay token en repositorio/imagen/frontend.
- [ ] CORS, CSRF, cookies, TLS y rate limiting verificados.
- [ ] Reserva idempotente y deduplicación validadas bajo reintentos/fallos contra PostgreSQL real.
- [ ] Logs y trazas no contienen tokens ni cuerpos completos.
- [ ] Exportación XLSX neutraliza fórmulas y respeta filtros/roles.
- [ ] Producción usa PostgreSQL; cualquier puente JSON live tiene aprobación, backup, monitoreo y fecha de apagado.
- [ ] Política de retención, backups, RPO/RTO y borrado aprobada.
- [ ] Live inicia draft-only; auto-respuesta cuenta con allowlist por marca, kill switch, plantillas aprobadas y auditoría.
- [ ] Runbook de rotación e incidentes ensayado.
