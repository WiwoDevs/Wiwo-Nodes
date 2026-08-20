# Handoff a Techlab

## Objetivo del traspaso

Entregar un MVP local reproducible y un camino explícito para integrarlo con la web de Techlab sin reescribir el frontend ni acoplar la aplicación al archivo JSON. El handoff se considera completo cuando Techlab puede construir, probar, desplegar, observar y revertir el servicio con su identidad, base de datos y secretos administrados.

## Inventario entregado

| Pieza | Estado del MVP | Destino Techlab |
| --- | --- | --- |
| Web React/Vite | UI completa; dashboard/cuentas/interacciones/settings leen API; bandeja y detalle crean borradores, resuelven/escalan, toman/liberan casos y guardan notas internas por API; controles visibles se ajustan al rol recibido desde `/api/me`; referencias Metricool, marcas y allowlist actualizan backend | Endurecer con SSO/RBAC y alojar detrás del gateway |
| API Fastify | Implementación local sobre `SacFlowRepository`; incluye alta/edición/desactivación recuperable de marcas para administradores con scope completo | Contenedor administrado |
| Persistencia | JSON para demo; selector `SAC_FLOW_REPOSITORY`; guardrail contra JSON live/producción; `PostgresRepository` runtime, auditor/importador JSON → PostgreSQL y 11 migraciones, incluidas coordinación multiagente, Inbox de Instagram, versiones, cola durable, outbox y backpressure | PostgreSQL administrado con backups/restore y secretos corporativos |
| Integración Metricool | Adaptador HTTP servidor contrastado con OpenAPI oficial; referencias `userId`/`blogId` y variante Instagram guardables por cuenta; normaliza mensajes/comentarios y emite payloads oficiales sin exponer referencias | UAT con token real, worker/cola y secretos administrados |
| Exportación | XLSX generado con ExcelJS | Descarga autorizada u object storage temporal |
| Identidad | API key temporal + puente `X-SAC-*` para rol/tenant/scope de marca desde gateway; API y UI aplican la misma matriz `viewer`/`agent`/`supervisor`/`admin` | OIDC/SSO y RBAC Techlab |
| Control operacional | `shadow/live`, cortacorriente de envíos y cortacorriente de mutaciones Metricool son compuertas independientes; el worker consume solo entregas automáticas identificadas; supervisores inspeccionan la DLQ desde `Ejecuciones` y solo administradores pueden reencolar | Runbook de incidentes, alertas y control administrado |
| Datos demo | Seed de 20 marcas | Fixtures únicamente en entornos no productivos |
| Observabilidad | Logs locales + `/api/metrics` Prometheus con agregados sin PII, antigüedad/vencimiento de jobs y runbook con PromQL base | Logs estructurados, scrape/alertas desplegadas, trazas y dashboards |
| Calidad de entrega | CI versionado para typecheck, build, API/Sites, migraciones, E2E, auditoría, SBOM y smoke del Compose productivo; actualizaciones Dependabot preparadas | Activar branch protection y escaneos corporativos en el repositorio definitivo |

## Paquete que debe recibir Techlab

- Repositorio completo, lockfile y documentación de `docs/`.
- Migraciones PostgreSQL de `db/migrations/` validadas con `npm run test:migrations`.
- Reporte de `npm run postgres:audit-json` sobre el JSON que se pretende migrar.
- `.env.example` sin valores reales.
- Dockerfile y Compose validados.
- Resultado de `npm test`, `npm run build` y smoke tests.
- Matriz de las 20 marcas sin token: nombre interno, owner, `blogId`, redes y zona horaria.
- Acceso al secreto por el canal de Techlab, nunca dentro del repositorio o el paquete.
- Decisiones abiertas con dueño y fecha; no presentarlas como implementadas.
- Cierre o aceptación explícita de cada P0/P1 aplicable en `docs/PROFESSIONAL_COMPLETION_CHECKLIST.md`.

## Comandos de recepción

En PowerShell:

```powershell
git clone <repositorio-autorizado> sac-flow
Set-Location sac-flow
Copy-Item .env.example .env
npm ci
npm run check
npm run build:all
npm run test:migrations
npm test
docker compose config
docker compose up --build -d
Invoke-RestMethod http://localhost:8787/api/health
Invoke-RestMethod http://localhost:8787/api/ready
docker compose down
```

En bash:

```bash
git clone <repositorio-autorizado> sac-flow
cd sac-flow
cp .env.example .env
npm ci
npm run check
npm run build:all
npm run test:migrations
npm test
docker compose config
docker compose up --build -d
curl --fail http://localhost:8787/api/health
curl --fail http://localhost:8787/api/ready
docker compose down
```

`<repositorio-autorizado>` es deliberadamente un placeholder: debe reemplazarse por el repositorio creado por Techlab, no por una URL inventada.

## Evidencia de validación local

Ejecutado el 2026-08-13 sobre Windows, desde este workspace:

| Verificación | Resultado |
| --- | --- |
| `npm run check` | OK, frontend y API sin errores TypeScript |
| `npm run build:all` | OK, web/Sites y `dist-api/` generados |
| `npm test` | OK, 100/100 tests servidor/API, 4/4 tests Sites y 11 migraciones PostgreSQL validadas |
| `npm run test:migrations` | OK, 11 migraciones PostgreSQL revisadas estáticamente |
| `npm run test:e2e` | Última ejecución registrada: 8 escenarios Playwright aprobados y 4 exclusiones intencionales por dispositivo |
| `npm run smoke:metricool-contract` | OK, 7 escenarios HTTP locales: lectura, forma de escritura, 204, 401, 429/Retry-After, 500 y timeout; sin red externa |
| `npm run security:audit` | OK, 0 vulnerabilidades conocidas; SBOM CycloneDX generado |
| `npm run postgres:audit-json -- <json>` | OK en fixture local de smoke; genera hash, recuentos y riesgos sin exponer `userId`/`blogId` |
| Servidor compilado | OK con `app.inject`: salud `ok`, readiness `ready`, `X-Request-Id` UUID en éxito/error, repositorio JSON consultable, factory `PostgresRepository`, métricas Prometheus supervisor sin PII, contexto de actor requerido, scope a `brand-01`, 401 sin actor, 403 cross-brand/export viewer, alta/edición/desactivación de marca admin sin filtrar credenciales, limpieza de allowlist al desactivar, kill switch `423 OUTBOUND_SENDS_DISABLED`, drafts permitidos, simulación sin auto-replies, XLSX supervisor y frontend HTTP 200 |
| Frontend servido por Fastify | HTTP 200 `text/html` |
| Referencia Metricool por cuenta | HTTP 200 al guardar/leer/desconectar; no filtró `userId`/`blogId`; al desconectar retiró la cuenta de `autoReplyAccountIds` |
| Coordinación multiagente | Toma/liberación, transferencia de supervisor, notas internas, filtros por asignación, scope de marca y conflicto 409 por versión antigua probados; sin escrituras externas |
| Cola operativa | GET de `dead`/`retry` restringido a supervisor, reencolado restringido a admin, confirmación UI y replay idempotente probados; smoke Docker devolvió HTTP 200 con cola vacía |
| Permisos visibles | `/api/me` entrega contexto seguro; UI deshabilita sincronización, exportación, reglas, marcas, referencias Metricool y automatización según rol; la API conserva la autorización definitiva |
| Exportación | HTTP 200, XLSX filtrado por scope de actor de 8.892 bytes en el smoke ejecutado |
| Ruta API inexistente | HTTP 404 JSON; no cayó al fallback SPA |
| `docker-compose.yml` y `docker-compose.production.yml` | `docker compose config --quiet` correcto con Docker Desktop 4.86.0 |
| Build/healthcheck real de Docker | Completado localmente después del reinicio: PostgreSQL, API y worker saludables; migraciones finalizan en código 0, la API publica solo en loopback y el smoke del outbox prueba cooldown, exclusión por cuenta, breaker/conciliación, capacidad atómica concurrente y limpia su fixture efímero |

El editor visual se carga bajo demanda: el build actual deja el chunk mayor en 466,14 kB minificado (125,31 kB gzip), separa `WorkflowCanvas` en 23,84 kB (7,41 kB gzip) y Automation Studio en 66,15 kB (17,14 kB gzip), sin advertencias de Vite por superar 500 kB. Techlab debe definir y medir un presupuesto real de rendimiento dentro del portal.

La validación Docker sigue siendo una puerta explícita del handoff: ejecutarla en un host con Docker y adjuntar salida de `docker compose config`, `docker compose build`, `/api/health`, `/api/ready` y el healthcheck antes de promover el artefacto.

## Variables por entorno

| Variable | Local demo | Staging | Producción |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` | `production` | `production` |
| `LOG_LEVEL` | `info` | Según observabilidad | Según observabilidad |
| `API_HOST` | `127.0.0.1` | `0.0.0.0` | `0.0.0.0` |
| `PORT` | `8787` | Asignado por plataforma | Asignado por plataforma |
| `SERVE_FRONTEND` | `false` con Vite | `true` en imagen integrada | `true` en imagen integrada |
| `FRONTEND_DIR` | `./dist/client` | Ruta del artefacto | Ruta del artefacto |
| `VITE_API_BASE_URL` | `/api` vía proxy Vite | URL/gateway staging | Preferir `/api` mismo origen |
| `VITE_APP_BASE_PATH` | `/` | Ruta web, ej. `/sac/` | Ruta web, ej. `/sac/` |
| `SAC_FLOW_REPOSITORY` | `json` | `json` solo puente o `postgres` al conectar adapter | `postgres` |
| `SAC_FLOW_DATA_FILE` | `./data/sac-flow.json` | Solo durante migración JSON | No usar; PostgreSQL |
| `SAC_FLOW_POSTGRES_URL` | Vacío | Secret manager/config al usar `postgres` | Secret manager/config |
| `SAC_FLOW_POSTGRES_ENCRYPTION_KEY` | Vacío | Secret manager/config al usar `postgres` | Secret manager/KMS |
| `SAC_FLOW_POSTGRES_ORGANIZATION_SLUG` | `techlab-sac` | Slug tenant staging | Slug tenant producción |
| `SAC_FLOW_POSTGRES_ORGANIZATION_NAME` | `Techlab SAC` | Nombre tenant staging | Nombre tenant producción |
| `SAC_FLOW_POSTGRES_SEED_DEMO` | `true` en demo no productivo | `false` salvo fixture controlado | `false` |
| `SAC_FLOW_ALLOW_JSON_IN_LIVE` | Vacío | `true` solo puente controlado | `false`/vacío |
| `SAC_FLOW_API_KEY` | Vacío | Secret manager temporal | Reemplazar por SSO/BFF |
| `SAC_FLOW_REQUIRE_API_KEY` | `false` | `true` hasta SSO | `true` hasta SSO |
| `SAC_FLOW_CORS_ORIGINS` | Vacío | Allowlist si cross-origin | Preferir mismo origen |
| `SAC_FLOW_SECURITY_HEADERS` | Vacío | `true` | `true` |
| `SAC_FLOW_ENFORCE_ORIGIN_CHECK` | Vacío | `true` | `true` |
| `SAC_FLOW_RATE_LIMIT_ENABLED` | Vacío | `true` | `true` |
| `SAC_FLOW_RATE_LIMIT_WINDOW_MS` | `60000` | Según gateway | Según gateway |
| `SAC_FLOW_RATE_LIMIT_MAX` | `600` | Según gateway | Según gateway |
| `SAC_FLOW_TRUST_ACTOR_HEADERS` | `false` | `true` solo detrás de gateway | `true` solo detrás de gateway |
| `SAC_FLOW_REQUIRE_ACTOR_CONTEXT` | `false` | `true` | `true` |
| `SAC_FLOW_DEFAULT_ROLE` | `admin` | `viewer` como fallback defensivo | `viewer` como fallback defensivo |
| `SAC_FLOW_DISABLE_OUTBOUND_SENDS` | `false` | `true` durante UAT/cortes; `false` solo con aprobación | `true` por defecto operacional hasta go-live aprobado |
| `SAC_FLOW_DISABLE_METRICOOL_MUTATIONS` | `true` | `true` salvo ventana de UAT autorizada | `true` hasta go-live aprobado |
| `SAC_FLOW_AUTO_REPLY_DISPATCH_MODE` | `shadow` | `shadow`; `live` solo en canary supervisado | `shadow` hasta aprobación; luego `live` por cambio controlado |
| `SAC_FLOW_AUTO_REPLY_MAX_PENDING` | `1000` | Ajustar con carga; alerta al 80% | Límite aprobado según capacidad y SLO |
| `METRICOOL_BASE_URL` | Oficial | Oficial o mock controlado | Oficial |
| `METRICOOL_MODE` | `demo` | `live` tras configurar | `live` |
| `METRICOOL_API_TOKEN` | Vacío | Secret manager | Secret manager |
| `METRICOOL_USER_ID` | Vacío | Secret/config | Secret/config |
| `METRICOOL_INSTAGRAM_PROVIDER` | `INSTAGRAMBUSINESS` | Config | Config por cuenta |
| `METRICOOL_BLOG_ID` | Vacío | Evitar; usar tabla por marca | Evitar; usar tabla por marca |
| `METRICOOL_ALLOW_FALLBACK_ACCOUNT` | Vacío/demo | `false` | `false` |
| `METRICOOL_ACCOUNTS_JSON` | Vacío | Puente temporal | Evitar; usar tabla por cuenta |

El MVP ahora falla cerrado si se solicita `METRICOOL_MODE=live` sin token, live exige API key por defecto y `NODE_ENV=production` + `METRICOOL_MODE=live` no permite `SAC_FLOW_REPOSITORY=json` salvo opt-in explícito `SAC_FLOW_ALLOW_JSON_IN_LIVE=true`. También puede exigir contexto `X-SAC-*` de usuario/tenant/rol/marcas desde el gateway y bloquear envíos o mutaciones sin impedir borradores. El despacho automático permanece en `shadow` salvo cambio explícito a `live`; incluso entonces exige workflow publicado, allowlist, outbox y ambos cortacorrientes desactivados. PostgreSQL y el outbox ya tienen smoke local real. Antes de producción, Techlab debe reemplazar la barrera temporal por SSO/RBAC nativo o BFF, asegurar que el gateway elimine cabeceras `X-SAC-*` spoofeadas, incorporar backups/restore y prohibir seeds demo.

## Migración de JSON a PostgreSQL

### Esquema mínimo recomendado

El esquema objetivo ya está materializado en:

- `db/migrations/0001_initial_sac_flow.sql`: tablas, constraints, índices, idempotencia, auditoría y referencias Metricool cifrables.
- `db/migrations/0005_metricool_inbox_provider.sql`: persiste y restringe la variante de conexión Instagram usada por el Inbox API.
- `db/migrations/0002_tenant_rls.sql`: RLS por tenant usando `SET LOCAL app.organization_id`.
- `db/migrations/0003_runtime_repository_alignment.sql`: claves runtime estables y columnas que usa `PostgresRepository`.
- `db/migrations/0004_multiagent_case_coordination.sql`: versión optimista, responsable, notas internas, constraints e índice de asignación.
- `db/migrations/0006_interaction_status_reason.sql`: persiste el motivo estructurado del último cambio operativo de estado.

La explicación de tablas, mapeo desde JSON y procedimiento está en [POSTGRESQL_MIGRATION.md](./POSTGRESQL_MIGRATION.md).

Restricciones clave:

- única `(social_account_id, external_id, kind)` para deduplicación;
- claves foráneas siempre dentro del mismo tenant;
- timestamps en UTC;
- índices por `brand_id`, `received_at`, `status`, `provider` y `kind`;
- idempotency key única para envíos.
- `version >= 1` y asignación completa (ID + nombre o ambos nulos) para coordinación de agentes.

### Procedimiento

1. Congelar cambios al formato JSON y versionar el reporte de auditoría.
2. Crear migraciones SQL revisables; no crear tablas al vuelo en el arranque productivo.
3. Respaldar el JSON y ejecutar `npm run postgres:audit-json -- <json>`.
4. Ejecutar `npm run postgres:import-json -- <json>` en staging dentro de una transacción.
5. Comparar recuentos por marca/red/tipo/estado y muestrear contenido/timestamps.
6. Configurar `SAC_FLOW_REPOSITORY=postgres`, `SAC_FLOW_POSTGRES_URL`, `SAC_FLOW_POSTGRES_ENCRYPTION_KEY` y tenant slug/name.
7. Ejecutar la API contra PostgreSQL real con pruebas de contrato.
8. Realizar dual-read o shadow comparison temporal si el riesgo lo justifica; evitar dual-write indefinido.
9. Definir corte, ventana de solo lectura y rollback.
10. Tras aceptación, retirar el acceso de escritura al JSON y conservarlo cifrado solo el período aprobado.

Ejemplo de verificaciones posteriores — adaptar nombres a las migraciones reales:

```sql
SELECT count(*) FROM brands;
SELECT provider, kind, count(*) FROM interactions GROUP BY provider, kind;
SELECT brand_id, count(*) FROM interactions GROUP BY brand_id ORDER BY brand_id;
SELECT count(*) FROM interactions WHERE external_id IS NULL;
```

## SSO y autorización

1. Registrar un cliente OIDC para staging y otro para producción.
2. Definir redirect/logout URIs exactas y rotación de secretos.
3. Validar `iss`, `aud`, firma, expiración y nonce/state.
4. Mapear subject estable a usuario local; no usar email como único identificador inmutable.
5. Mapear grupos/claims a roles `viewer`, `agent`, `supervisor`, `admin`.
6. Aplicar tenant y brand scope en cada endpoint y query.
7. Probar acceso negado, sesión expirada, usuario retirado y cambio de rol.

## Polling y workers

El polling de 20 marcas no debe depender del proceso web en producción:

- scheduler publica trabajos por cuenta/proveedor;
- cola limita concurrencia y separa reintentos;
- worker obtiene secreto y llama a Metricool;
- deduplicación hace seguros los reintentos;
- `401/403` se marca como configuración, `429` respeta backoff y `5xx` usa reintento acotado con jitter;
- una marca fallida no bloquea el resto;
- alertas consideran antigüedad de última sincronización y tasa de error.

La frecuencia final se decide después de medir cuota, latencia y volumen reales; no fijarla solo por intuición.

## Checklist de migración

### Repositorio y ownership

- [ ] Repositorio creado dentro de la organización Techlab.
- [ ] CODEOWNERS/equipo responsable y canal de soporte definidos.
- [ ] Rama protegida, revisiones y CI requeridos.
- [ ] Licencias de dependencias y política de actualizaciones revisadas.

### Build y artefactos

- [ ] `npm ci`, pruebas y build pasan desde checkout limpio.
- [ ] Imagen se construye desde lockfile, corre sin root y es escaneada.
- [ ] Artefacto tiene versión/commit y se promueve, no se recompila entre entornos.
- [ ] Health/readiness checks distinguen proceso vivo de dependencias listas.

### Configuración y secretos

- [ ] Ningún token real aparece en Git, imagen, frontend, logs o XLSX.
- [ ] Variables de staging/producción documentadas y validadas al arrancar.
- [ ] Secreto Metricool almacenado, rotado y con dueño.
- [ ] Las 20 marcas tienen `blogId`, owner y redes validados.

### Datos

- [ ] Migraciones PostgreSQL revisadas y reversibles o forward-fix documentado.
- [x] Selector de repositorio y guardrail contra JSON live/producción implementados.
- [x] `PostgresRepository` runtime conectado a la factory con transacciones, pool, tenant context y cifrado de referencias Metricool.
- [x] Auditoría/importación JSON → PostgreSQL agregada con modo seco, hash, recuentos y bloqueo por errores.
- [ ] Pruebas de contrato contra PostgreSQL real ejecutadas en staging.
- [ ] Importación reconcilia recuentos y hashes/muestras.
- [ ] Backups, cifrado, retención, RPO/RTO y restore test definidos.
- [ ] Borrado/anonimización y expiración de XLSX implementados.

### Identidad y seguridad

- [x] Puente temporal de actor/rol/scope por gateway implementado y probado con casos negativos.
- [ ] SSO/BFF definitivo, RBAC, aislamiento tenant/marca y casos negativos pasan sobre identidad real.
- [x] API rechaza mutaciones cross-site y prueba allowlist exacta; mantener pendiente TLS/cookies/gateway real.
- [ ] Auditoría cubre sync, reply, configuración, exportación y administración.
- [x] Kill switch de respuestas implementado y probado para bloquear `send` manteniendo borradores.
- [ ] Rotación de token ensayada.
- [ ] Revisión de [SECURITY.md](./SECURITY.md) aprobada.

### Metricool y operación

- [ ] Plan Advanced/Custom y permisos confirmados.
- [ ] Lectura piloto validada para Instagram y Facebook.
- [x] UI muestra límites: inbox principal, sin comentarios de ads, 24 h/7 días e historial no permanente.
- [x] Deduplicación, `429`/`Retry-After`, cooldown por cuenta, timeout incierto y conciliación tienen pruebas locales; falta repetir con respuestas reales controladas del proveedor.
- [ ] Dashboards y alertas para sync, errores, latencia, cola y respuestas.
- [x] Endpoint `/api/metrics` agregado con contadores agregados sin texto/handles de conversaciones.
- [x] Métricas de jobs `dead`/`retry`, antigüedad, vencimiento y umbrales base documentados en `OPERATIONS_RUNBOOK.md`.
- [ ] UAT de respuestas manuales aprobada antes de cualquier automatización.
- [ ] Live inicia en draft-only; `autoReplyAccountIds` está vacío durante el corte.
- [ ] `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true` permanece activo hasta aprobación explícita de go-live por marca.
- [ ] Cada marca tiene aprobación documentada antes de entrar a `autoReplyAccountIds`.

### Integración web

- [x] Dashboard, cuentas e interacciones consumen brands/interactions/stats/workflow y muestran aviso si la API falla.
- [x] Borradores, envío manual confirmado y resolución desde bandeja usan API; los plazos 24 h/7 días restringen la automatización y los intentos manuales quedan advertidos y auditados.
- [x] Toma/liberación y transferencia de casos usan API, rol/scope, auditoría y versión optimista.
- [x] Notas internas persisten separadas de respuestas y no se envían ni incluyen completas en XLSX/auditoría.
- [x] Settings globales y allowlist por cuenta actualizan `/api/workflow`.
- [x] Después de sync/reply/status/workflow, la UI invalida/refresca datos del servidor en vez de simularlos localmente.
- [x] Detalle de conversación usa `/api/interactions/:id`, muestra auditoría/asignación/notas y opera borrador/resolución/escalamiento con motivos estructurados contra backend.
- [x] Reconexión/configuración básica de referencias Metricool por cuenta usa `/api/accounts/:accountId/metricool` y no expone `userId`, `blogId` ni token en respuestas.
- [x] API administrativa crea, edita y desactiva marcas/cuentas sin borrar historial ni exponer referencias Metricool.
- [x] UI administrativa básica crea, edita y desactiva marcas/cuentas desde la vista **Cuentas**.
- [ ] Rotación de token y administración productiva de credenciales/secretos dejan de ser trabajo manual.
- [ ] Ruta/subdominio, gateway, CSP y navegación aprobados.
- [ ] `VITE_API_BASE_URL` resuelve correctamente en staging/producción.
- [ ] Deep links, refresh, logout y sesión expirada probados.
- [ ] Responsive y accesibilidad verificados con la web anfitriona.

### Go-live y rollback

- [ ] Ventana, responsables, canal de incidentes y criterios go/no-go acordados.
- [ ] Snapshot/backup y última sincronización registrados antes del corte.
- [ ] Auto-respuesta apagada durante el primer despliegue.
- [ ] Live permanece en draft-only hasta una aprobación explícita por marca, nunca por activación global implícita.
- [ ] Canary por una marca, luego lote pequeño, luego 20 marcas.
- [ ] Rollback probado: artefacto anterior, configuración anterior y pausa de workers.
- [ ] Hypercare y revisión post-lanzamiento agendados.

## Criterios de aceptación

El traspaso no se cierra solo porque el contenedor inicia. Debe existir evidencia de:

1. build/pruebas reproducibles desde un checkout limpio;
2. sincronización repetida sin duplicados para las 20 marcas de staging o fixtures equivalentes;
3. falla aislada por marca con reintento observable;
4. respuesta manual idempotente fuera de plazo, con aceptación o rechazo del proveedor registrado;
5. XLSX consistente con los filtros y protegido contra fórmulas;
6. SSO/RBAC y aislamiento entre marcas;
7. restauración de backup y rollback de aplicación ensayados;
8. secretos ausentes de cliente, logs y artefactos;
9. dashboards, alertas y ownership operativo activos.

## Plan de reversa

Ante errores de datos, permisos o respuestas:

1. activar kill switch y detener workers;
2. volver el frontend/API al artefacto anterior;
3. conservar PostgreSQL en solo lectura si hay duda de integridad;
4. restaurar solo con evidencia y aprobación, evitando sobrescribir respuestas externas ya enviadas;
5. atender desde Metricool/Meta mientras se reconcilia;
6. comparar auditoría antes de reactivar una marca piloto.
