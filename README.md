# WIWO.Nodes + SAC Flow

Plataforma visual de automatización general con **SAC Flow** como módulo operativo principal. Permite crear, validar, versionar, publicar y ejecutar workflows con triggers manuales, horarios, webhook, formulario o error; transformaciones, ramas, subworkflows, credenciales cifradas, variables, historial y worker durable. SAC Flow unifica mediante Metricool la atención multicuenta de Instagram, Facebook, X, TikTok Business, YouTube, LinkedIn y Google Business, con revisión humana, entrega durable de respuestas, métricas y exportación XLSX.

El entorno local puede arrancar en **modo demo** con 20 marcas ficticias y sin credenciales. La publicación de Sites no incluye esa API simulada: queda bloqueada hasta enlazar el backend real mediante un proxy servidor-servidor. El modo real requiere Metricool Advanced o Custom y una configuración autorizada; no se incluye ni se inventa ningún token.

> Estado: beta general validada localmente. El motor y la interfaz del overhaul compilan y tienen pruebas de catálogo, validación, ejecución, webhooks, cifrado, redacción, duplicación y bloqueo de salidas. El stack Docker PostgreSQL + migraciones + API + worker pasa sus probes locales; los nodos HTTP externos, las mutaciones Metricool y los envíos SAC permanecen gobernados por protecciones separadas. No se ha publicado este overhaul ni se ha modificado Metricool.

## Inicio rápido

Requisitos: Node.js 22 LTS, npm y, opcionalmente, Docker Desktop.

```powershell
Copy-Item .env.example .env
npm ci
npm run dev:all
```

Abrir `http://localhost:5173`. Vite reenvía `/api` a Fastify en `http://localhost:8787`; una sola orden inicia ambos procesos.

Comprobación rápida en otra terminal:

```powershell
Invoke-RestMethod http://localhost:8787/api/health
Invoke-RestMethod http://localhost:8787/api/ready
Invoke-RestMethod http://localhost:8787/api/brands
```

En macOS/Linux, reemplazar el primer comando por `cp .env.example .env` y usar `curl --fail http://localhost:8787/api/health` y `curl --fail http://localhost:8787/api/ready` para salud/readiness.

## Docker

El contenedor de producción local compila la web y la sirve desde Fastify en un solo puerto:

```powershell
Copy-Item .env.example .env
docker compose up --build -d
Invoke-RestMethod http://localhost:8787/api/health
Invoke-RestMethod http://localhost:8787/api/ready
```

Abrir `http://localhost:8787`. Los datos quedan en el volumen nombrado `sac-flow-data`.

Si la API exige clave, la propia web muestra **Acceso seguro requerido**. Pegar allí la clave de acceso del sitio (`SAC_FLOW_API_KEY`), no el token de Metricool. La clave se valida en `POST /api/session`, se elimina inmediatamente del estado del formulario y la API entrega una cookie de sesión de 8 horas con `HttpOnly`, `SameSite=Strict` y alcance `/api`; JavaScript no puede leerla. Cada reinicio de la API invalida las sesiones locales anteriores. En HTTPS la cookie también se marca `Secure`.

Para detenerlo sin borrar datos:

```powershell
docker compose down
```

No usar `docker compose down -v` salvo que se pretenda eliminar explícitamente el volumen local.

El stack profesional usa PostgreSQL, migraciones y un worker independiente:

```powershell
.\scripts\bootstrap-production.ps1 -OutputPath .env.production
docker compose --env-file .env.production -f docker-compose.production.yml up --build -d
Invoke-RestMethod http://localhost:8787/api/ready
docker compose --env-file .env.production -f docker-compose.production.yml ps
```

El bootstrap genera la contraseña PostgreSQL y la clave de cifrado localmente. Al terminar, solo se completan el token/referencias de Metricool y la clave de acceso del sitio. El cortacorriente queda activo por defecto. `postgres`, `api` y `worker` deben aparecer `healthy`; `migrate` debe terminar con código `0`.

El puerto publicado por Compose se limita a `127.0.0.1` por defecto. Cambiar `SAC_FLOW_BIND_ADDRESS` solo cuando exista un gateway/reverse proxy autorizado y controles de red equivalentes.

## Automation Studio

- Inicio SAC-first con cola priorizada, revisión humana, casos sin asignar, salud de cuentas y estado del flujo; el inventario general de automatizaciones queda como contexto secundario.
- Editor visual React Flow con biblioteca buscable, conexiones, drag, zoom e inspector dinámico.
- El editor especializado de Flujo SAC inicia en solo lectura, requiere rol supervisor para habilitar cambios y permite guardar por conexión tres trazados: curvo, recto u ortogonal suavizado.
- Catálogo inicial de 34 nodos ejecutables para triggers, control de flujo, transformación, datos, HTTP y SAC.
- Triggers manual, horario, webhook, formulario y error; schedule ejecutado por worker.
- DAG topológico con ramas, merge, expresiones `{{ $json.* }}`, variables `{{ $vars.* }}`, subworkflows y manejo de fallos.
- Proyectos, carpetas, tags, workflows, settings, borradores, versiones, publicación, activación, archivo y duplicación.
- Historial por ejecución y nodo, retry con linaje, input/output limitado y secretos redactados por nombre y valor.
- Credenciales AES-256-GCM y variables secretas; sus valores nunca se devuelven al navegador.
- HTTP node con controles SSRF, timeouts, límites y bloqueo global por defecto.
- Plantillas para webhooks, calidad/deduplicación y SAC con revisión humana.
- API `/api/platform/*` y `/api/webhooks/:path` con validación Zod y roles.
- Estado beta en PostgreSQL mediante `automation_platform_states`, RLS por organización, índice JSONB y lecturas/escrituras específicas que no reescriben el dominio SAC.

La matriz exacta frente al repositorio local de n8n y las brechas restantes está en [N8N_PARITY_AUDIT.md](./docs/N8N_PARITY_AUDIT.md). La implementación es original y no copia componentes Enterprise de n8n.

## Funciones del módulo SAC

- Presentación demo reproducible de 20 marcas/cuentas.
- **Gestión manual por cuenta** con navegación account-first: selector de cuenta y dos zonas operativas para cola y conversación/compositor. El contexto imprescindible de la publicación permanece dentro de la conversación, sin un panel lateral redundante. Los DMs se mantienen por persona; las superficies de comentarios muestran una tarjeta por publicación, ordenada por la fecha real entregada por el proveedor y, cuando esa fecha no existe, por actividad reciente claramente identificada. Al abrir un post se cargan únicamente sus comentarios inbound pendientes, del más antiguo al más reciente, y cada acción conserva el ID y la versión exactos del comentario seleccionado.
- La respuesta manual siempre parte del `replyTarget` exacto, exige confirmación humana, `expectedVersion` e idempotencia. Abrir, filtrar, seleccionar o recibir el polling GET de 30 segundos nunca envía mensajes ni ejecuta el protocolo automático.
- Bandeja normalizada con una fila por persona dentro de cada cuenta y plataforma, contadores de mensajes y pendientes, y DMs, comentarios, menciones o reseñas de todas las plataformas disponibles en Metricool Inbox.
- Panel de detalle por caso con contexto de marca/cuenta, texto original, historial cronológico del contacto, vista previa y enlace oficial del post para comentarios, borrador editable, resolución/escalamiento y auditoría.
- Coordinación multiagente con toma/liberación de casos, asignación por supervisor, notas internas no enviables y control de versión optimista para evitar sobrescrituras.
- Filtros por marca, cuenta, red, tipo, estado, sentimiento, texto y fechas.
- Resumen de recuentos, cobertura del protocolo, candidatas automáticas, bloqueos de conocimiento y desempeño.
- Workflow configurable con ejecución manual.
- Canvas SAC de 19 nodos respaldado por el grafo especializado; se conserva como entrada principal del producto.
- Validación previa a publicación, historial de versiones y rollback auditable.
- Historial de ejecuciones con filtros, detalle, trazabilidad y reintento con linaje.
- Scheduler/worker durable en PostgreSQL con leasing, recuperación, backoff exponencial y estado de fallo definitivo.
- Cola operativa visible en `Ejecuciones`: supervisores ven jobs `dead`/`retry`, su causa, intentos y próxima acción; solo administradores pueden reencolar después de una confirmación.
- Sincronización Metricool por marca/proveedor con detección de `Brand.networksData`, fallback a la configuración local y aislamiento de errores por superficie.
- Ingesta periódica de solo lectura gobernada por `SAC_FLOW_INBOX_SYNC_ENABLED`, independiente del protocolo y del autoenvío. La bandeja relee la persistencia local cada 30 segundos cuando está visible y ofrece `Actualizar ahora` para una sincronización excepcional sin sacar al operador de su vista.
- Cobertura por capacidad real de plataforma: conversaciones para Instagram/Facebook/X, comentarios para Instagram/Facebook/TikTok Business/YouTube/LinkedIn y reseñas para Google Business. La UI, filtros, métricas, Excel y QA conservan la red y el tipo de interacción de origen.
- Protocolo ejecutable `sac-v1` para toda interacción nueva: contexto conversacional, clasificación de intención/riesgo, conocimiento aprobado, ventana Meta, allowlist/publicación/horario, propuesta y ruta auditable.
- Reprocesamiento local desde la bandeja con `POST /api/sac/protocol/evaluate`; nunca escribe en Metricool y permite cubrir casos históricos sin assessment.
- Respuestas dinámicas (precio, stock, despacho y seguimiento) bloqueadas hasta contar con fuente en vivo; categorías sensibles o negativas se derivan obligatoriamente a una persona.
- IDs demo estables para probar deduplicación entre sincronizaciones distintas sin inflar métricas.
- Contrato Inbox verificado: DMs desde `Conversation.messages[]`, comentarios desde `PostCommentsThread.root/comments[]`, contexto de publicación desde `root.element`, reseñas desde `Review` y respuestas con los campos oficiales requeridos. Los enlaces se conservan solo cuando el proveedor entrega una URL HTTPS válida; nunca se fabrican desde un ID social.
- Compatibilidad de proveedor Instagram: comentarios por `INSTAGRAM` y fallback de lectura para DMs entre `INSTAGRAMBUSINESS` e `INSTAGRAM`, conservando el alias efectivo en cada interacción.
- Reconciliación de conversaciones: si la cuenta envió un mensaje después de una consulta entrante, el caso se marca como **Respondido por el equipo** y ya no vuelve a entrar al protocolo como pendiente.
- Envío manual confirmado desde el detalle sin bloqueo local por antigüedad: se muestra el plazo recomendado 24 h/7 días, un agente puede intentar el envío y Metricool conserva la decisión final. El protocolo automático mantiene fuera de auto-respuesta los casos vencidos.
- Outbox persistente para respuestas con estados `pending/sending/sent/failed/uncertain`, exclusión de entregas simultáneas por caso y por cuenta, recuperación de leases y conciliación manual de supervisor. Un resultado ambiguo activa un breaker durable para esa cuenta y nunca se reenvía automáticamente; un `429` confirmado respeta `Retry-After`, vuelve a `pending` y enfría solo esa cuenta.
- Despacho SAC asíncrono: el protocolo encola solo candidatas `auto_reply`, el worker consume la entrega más antigua y reutiliza la misma clave idempotente. `SAC_FLOW_AUTO_REPLY_MAX_PENDING` reserva capacidad atómicamente en JSON/PostgreSQL y retiene nuevas candidatas cuando se satura, con estado en readiness/UI y métricas Prometheus. `SAC_FLOW_AUTO_REPLY_DISPATCH_MODE=shadow` es el valor seguro por defecto; `live` todavía exige allowlist publicada y ambos cortacorrientes desactivados.
- Alta, edición y desactivación recuperable de marcas/cuentas desde UI y API administrativa, sin borrar historial ni exponer credenciales.
- Conexión/reconexión básica de referencias `userId`/`blogId` por cuenta desde backend, sin exponer token ni IDs completos en respuestas.
- Dos Google Sheets/Excel por marca: uno maestro para toda interacción y otro de QA aprobado con alcance opcional por plataforma o tipo. Ambos se validan servidor-servidor con contratos estrictos; el libro fuente nunca se modifica. El centro documental agrega además enlaces HTTPS ordenados por cuenta.
- Puente temporal de autorización por gateway con roles `viewer`, `agent`, `supervisor`, `admin` y scope de marca.
- Controles visibles de la UI derivados de `/api/me`, alineados con los permisos del servidor para operación, exportación, reglas, marcas y credenciales.
- Cortacorriente operacional `SAC_FLOW_DISABLE_OUTBOUND_SENDS` para bloquear todo envío externo y mantener solo borradores.
- Excepción de mínimo privilegio `SAC_FLOW_ENABLE_MANUAL_REPLIES`: permite únicamente respuestas SAC confirmadas por una persona, aunque las mutaciones generales de Metricool sigan bloqueadas. No habilita el dispatcher automático.
- Probes separados de liveness/readiness y selector explícito `SAC_FLOW_REPOSITORY=json|postgres` para evitar despliegues live ambiguos sobre JSON.
- Endpoint `/api/metrics` en formato Prometheus con agregados operativos sin PII, protegido por rol `supervisor`.
- Métricas alertables para jobs agotados, antigüedad en `dead`/`retry` y próximos intentos vencidos; respuesta recomendada en [OPERATIONS_RUNBOOK.md](./docs/OPERATIONS_RUNBOOK.md).
- Endpoint `/api/security/audit` con gates y remediaciones sin exponer secretos.
- Identificador `X-Request-Id` UUID por solicitud para correlación segura entre gateway, API y soporte.
- Adaptador `PostgresRepository` conectado al selector runtime; requiere migraciones aplicadas, `SAC_FLOW_POSTGRES_URL` y `SAC_FLOW_POSTGRES_ENCRYPTION_KEY`.
- Auditoría/importación de JSON local a PostgreSQL con hash, recuentos, detección de duplicados/orfandad/riesgos de fórmula y sin exponer `userId`/`blogId`.
- Respuestas como borrador o envío según configuración y elegibilidad.
- Exportación XLSX general de detalle/resumen y copia por marca basada en su formato maestro, incluyendo riesgo, ruta, estado de conocimiento y motivos del protocolo.
- Persistencia JSON atómica para desarrollo local y adapter PostgreSQL para staging/producción, incluyendo asignaciones, notas internas y versión de caso.

El frontend ya consume `/api/brands`, `/api/accounts/:accountId/metricool`, todas las páginas de `/api/inbox/contacts`, `/api/inbox/posts`, `/api/inbox/posts/:postKey/comments`, `/api/interactions/:id`, `/api/interactions/:id/conversation?scope=contact`, `/api/stats/summary`, `/api/sac/protocol/evaluate` y `/api/workflow` para dashboard, cuentas, referencias Metricool, bandejas, detalle y reglas globales. `/api/interactions` se mantiene como contrato por mensaje para protocolo, exportación y compatibilidad; la bandeja principal agrupa por una identidad opaca de persona, mientras Gestión manual pagina publicaciones mediante una clave opaca y carga sus comentarios pendientes bajo demanda. Ambas conservan un `replyTarget` exacto para no responder al comentario equivocado. El panel muestra el mensaje completo, historial local disponible, contexto del post cuando Metricool lo entrega, recomendación fundamentada en QA, borrador editable y acciones operativas. Borrar un borrador nunca elimina el mensaje remoto. Mientras la bandeja está visible, un polling GET de 30 segundos actualiza filas y métricas desde PostgreSQL sin contactar Metricool ni tocar el borrador abierto; el worker realiza la lectura real del proveedor según el intervalo configurado. La UI distingue la hora de esa lectura local de la última sincronización real. Si la API no responde, conserva el último estado conocido y señala el retraso sin vaciar la tabla. La vista **Cuentas** permite administrar marcas/cuentas y abrir su centro documental. Antes de habilitar autoenvío real aún faltan fuentes en vivo por marca, rotación de token, SSO/RBAC, UAT con Metricool, medición de cuotas reales y administración productiva de credenciales; outbox, conciliación, backpressure por cuenta y smoke concurrente en PostgreSQL ya están implementados.

Checkpoint local anterior a esta vista: `checkpoint/before-account-manual-inbox-20260817`, commit `e9ee6301049c59e53fdf96a20dd75bfbf49197d9`. Volver el código a ese checkpoint no retracta respuestas que Metricool/Meta ya haya confirmado como enviadas.

## Restricciones de Metricool/Meta

- La API de Metricool requiere plan **Advanced o Custom**.
- Capacidades implementadas: Instagram/Facebook (DMs y comentarios), X (DMs), TikTok Business/YouTube (comentarios), LinkedIn (comentarios y menciones) y Google Business (reseñas).
- Instagram solo expone la bandeja principal; solicitudes y carpetas filtradas no aparecen.
- No se pueden responder comentarios de anuncios de Facebook/Instagram desde el Inbox.
- Metricool informa plazos de 24 horas para comentarios y 7 días para DMs. WIWO.Nodes permite redactar, guardar e intentar una respuesta manual fuera de plazo, pero Metricool/Meta pueden rechazarla; en ese caso debe responderse desde la red social.
- El Inbox trabaja por marca y no conserva un historial permanente; SAC Flow construye la vista multicuenta y su propio historial operativo.
- El proveedor de Instagram debe coincidir con cómo se conectó la cuenta en Metricool: `INSTAGRAMBUSINESS` vía Facebook o `INSTAGRAM` mediante credenciales directas.

Configuración completa: [METRICOOL_SETUP.md](./docs/METRICOOL_SETUP.md).

## Comandos

| Comando | Resultado |
| --- | --- |
| `npm run dev:all` | Vite 5173 + Fastify 8787 |
| `npm run dev` | Solo frontend Vite |
| `npm run dev:api` | Solo API Fastify |
| `npm run check` | Typecheck frontend y API |
| `npm run build` | Build frontend y artefactos Sites |
| `npm run build:api` | Compila Fastify a `dist-api/` |
| `npm run build:all` | Compila frontend/Sites y API |
| `npm run postgres:audit-json` | Audita el JSON local sin escribir en PostgreSQL |
| `npm run postgres:import-json` | Importa JSON a PostgreSQL con `--write`; requiere env de PostgreSQL |
| `npm run postgres:import-json:allow-warnings` | Variante de importación cuando el equipo aceptó warnings de auditoría |
| `npm run test:migrations` | Valida migraciones PostgreSQL objetivo |
| `npm test` | Pruebas servidor/API + contrato Sites + migraciones PostgreSQL |
| `npm run test:e2e` | Pruebas Playwright desktop/mobile del editor, ejecución, retry y evaluación |
| `npm run security:audit` | Audita dependencias y falla desde severidad alta |
| `npm run security:sbom` | Genera `dist/sbom.cdx.json` en CycloneDX 1.5 |
| `npm run migrate` | Aplica migraciones pendientes con checksum inmutable |
| `npm run start:worker` | Inicia el scheduler/worker durable; requiere PostgreSQL |
| `npm start` | Ejecuta `dist-api/index.js`; requiere `npm run build:all` |
| `npm run test:sites` | Contrato de empaquetado del prototipo Sites |

La lista autoritativa siempre es `scripts` en `package.json`.

## Documentación

- [Desarrollo local](./docs/LOCAL_DEVELOPMENT.md)
- [Arquitectura](./docs/ARCHITECTURE.md)
- [Contrato HTTP](./docs/API_CONTRACT.md)
- [Migración a PostgreSQL](./docs/POSTGRESQL_MIGRATION.md)
- [Configuración de Metricool](./docs/METRICOOL_SETUP.md)
- [Seguridad y privacidad](./docs/SECURITY.md)
- [Integración con la web](./docs/WEBSITE_INTEGRATION.md)
- [Handoff y migración a Techlab](./docs/HANDOFF_TECHLAB.md)
- [Lista profesional de funciones y brechas pendientes](./docs/PROFESSIONAL_COMPLETION_CHECKLIST.md)
- [Auditoría comparativa con n8n](./docs/N8N_PARITY_AUDIT.md)
- [Auditoría de Inicio SAC y roadmap del flujo operativo](./docs/SAC_HOME_AUDIT_AND_WORKFLOW_ROADMAP.md)
- [Auditoría y simplificación con Ponytail](./docs/PONYTAIL_AUDIT.md)

## Estructura

```text
src/                 frontend React/Vite
server/              API Fastify, worker, dominio, Metricool y repositorios
data/                estado local ignorado por Git
db/migrations/       esquema PostgreSQL objetivo y RLS
docs/                contratos, operación y handoff
tests/               pruebas de API y empaquetado
worker/               fallback SPA para el prototipo Sites
Dockerfile            imagen integrada web + API
docker-compose.yml    ejecución local persistente
docker-compose.production.yml  PostgreSQL + migración + API + worker
```

## Regla de seguridad principal

`METRICOOL_API_TOKEN` solo existe en `.env` local o en el gestor de secretos de Techlab. Nunca debe aparecer en React, respuestas HTTP, Excel, logs, capturas ni commits.

Para staging/live, configurar `SAC_FLOW_API_KEY` y dejar `SAC_FLOW_REQUIRE_API_KEY=true` hasta reemplazarlo por SSO/RBAC detrás del gateway. Mantener `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true` durante cortes, incidentes o pruebas draft-only. Para un UAT manual-only, usar `SAC_FLOW_DISABLE_OUTBOUND_SENDS=false`, `SAC_FLOW_ENABLE_MANUAL_REPLIES=true`, `SAC_FLOW_DISABLE_METRICOOL_MUTATIONS=true` y `SAC_FLOW_AUTO_REPLY_DISPATCH_MODE=shadow`. Si la app se monta bajo una ruta de la web existente, compilar con `VITE_APP_BASE_PATH=/sac/` y `VITE_API_BASE_URL` apuntando al prefijo real de la API.
