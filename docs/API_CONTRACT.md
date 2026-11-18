# Contrato HTTP de Flow Studio y SAC Flow

## Alcance y estabilidad

Este documento describe la API Fastify de la beta actual. La base es `/api`; en desarrollo puede llamarse directamente en `http://localhost:8787/api` o a través del proxy Vite desde `http://localhost:5173/api`. El contrato contiene el módulo general `/api/platform/*`, webhooks y las rutas especializadas SAC.

El contrato es `v0`: Techlab debe versionarlo antes de habilitar clientes externos. El MVP incluye una barrera temporal por API key para live/staging y puede aplicar rol/scope de marca desde cabeceras de gateway, pero no implementa SSO nativo ni una identidad propia. OIDC/BFF, RBAC definitivo y aislamiento tenant productivo siguen siendo requisitos previos a producción.

## Convenciones

- JSON UTF-8 para solicitudes/respuestas, salvo la descarga XLSX.
- Fechas en ISO 8601 UTC.
- Los IDs son strings opacos; el cliente no debe derivar significado de ellos.
- Todas las respuestas incluyen `X-Request-Id` con un UUID generado por la API. El gateway debe conservarlo en logs y propagarlo a workers/trazas; el valor no contiene PII.
- Un éxito JSON normal usa `{ "data": ..., "meta": ... }`.
- Salud responde un objeto directo y la exportación responde binario.
- `meta` contiene al menos `demoMode: boolean` y `mode: "demo" | "live"`.
- Ninguna respuesta incluye token, `userId` ni `blogId`.
- Los probes `/api/health` y `/api/ready` no están pensados para consumo de la UI y quedan fuera de API key, actor context y rate limit.

### Autenticación temporal

Con `SAC_FLOW_AUTH_MODE=google` (o `dev` en pruebas locales) esta clave compartida no se exige: la sesión de inicio de sesión (ver más abajo) es la única credencial del navegador y `SAC_FLOW_REQUIRE_API_KEY` se ignora. En modo `local`, cuando `SAC_FLOW_REQUIRE_API_KEY=true`, todos los endpoints `/api/*` salvo `/api/health`, `/api/ready` y el inicio de sesión requieren `X-API-Key: <key>`, `Authorization: Bearer <key>` o una sesión temporal válida. En live este requisito está activo por defecto. Es una protección de handoff, no un sustituto de SSO/RBAC.

`POST /api/session` recibe `{ "apiKey": "..." }`, valida la misma clave mediante comparación de tiempo constante y responde `204` con una cookie firmada `sac_flow_session`. La cookie dura 8 horas, usa `HttpOnly`, `SameSite=Strict`, `Path=/api` y agrega `Secure` sobre HTTPS. La firma vive solo en memoria, por lo que reiniciar la API revoca todas las sesiones locales. `DELETE /api/session` responde `204` y expira la cookie. Estas rutas siguen protegidas por same-origin y rate limit; no deben recibir el token de Metricool.

### Contexto temporal de usuario/tenant

Cuando `SAC_FLOW_TRUST_ACTOR_HEADERS=true`, la API lee contexto entregado por el gateway:

```http
X-SAC-User-Id: user-123
X-SAC-User-Name: Nombre visible
X-SAC-Tenant-Id: tenant-abc
X-SAC-Role: viewer | agent | supervisor | admin
X-SAC-Brand-Ids: brand-01,brand-02
```

`X-SAC-Brand-Ids: *` permite todas las marcas dentro del tenant validado por el gateway. Si `SAC_FLOW_REQUIRE_ACTOR_CONTEXT=true`, las rutas protegidas rechazan solicitudes sin usuario, tenant y rol con `401 ACTOR_CONTEXT_REQUIRED`. Los probes `/api/health` y `/api/ready` quedan fuera de esta barrera para que infraestructura pueda verificar liveness/readiness sin credenciales de usuario.

Esta es una frontera de integración, no un SSO propio. Solo debe activarse detrás de un gateway que elimine cabeceras `X-SAC-*` entrantes del navegador y las reconstruya desde una sesión validada.

Roles mínimos del MVP:

Cada ruta exige un **permiso**; los roles son conjuntos de permisos editables desde **Usuarios y roles** (ver más abajo). Cualquier rol puede leer marcas, bandeja, detalle, stats, workflow, catálogo, proyectos, workflows y ejecuciones de su alcance. Los permisos por defecto reproducen los niveles anteriores:

| Permiso | Qué abre | Por defecto |
| --- | --- | --- |
| `inbox.reply` | `POST /api/interactions/:id/reply`, `DELETE /api/interactions/:id/draft`, `GET /api/deliveries` | Agente, Supervisor |
| `inbox.triage` | Notas, `PATCH .../status`, `POST /api/sac/protocol/evaluate` | Agente, Supervisor |
| `inbox.assign` | `PUT .../assignment` sobre sí mismo | Agente, Supervisor |
| `inbox.assign_others` | Asignar a otra persona y soltar casos ajenos | Supervisor |
| `inbox.archive_expired` | `POST /api/interactions/archive-expired` | Supervisor |
| `sync.run` | `POST /api/sync` | Agente, Supervisor |
| `export.xlsx` | `GET /api/export/xlsx` | Supervisor |
| `metrics.read` | `GET /api/metrics`, `GET /api/jobs` | Supervisor |
| `deliveries.reconcile` | `POST /api/deliveries/:id/reconcile` | Supervisor |
| `workflow.edit` | `PUT /api/workflow` sin activar auto-respuesta | Supervisor |
| `workflow.publish` | `POST /api/workflow/publish` y `/rollback` | Admin |
| `automations.run` | Ejecutar/reintentar workflows y ejecuciones, webhooks | Agente, Supervisor |
| `automations.edit` | Crear/editar/publicar/importar/archivar workflows generales, proyectos, carpetas y tags | Admin |
| `brands.manage` | Marcas, referencias Metricool por cuenta, catálogo/importación Metricool, libros y recursos | Admin |

Solo Admin, sin delegación posible: usuarios y roles, credenciales y variables (incluida su lectura), activar la auto-respuesta, `GET /api/security/audit` y `POST /api/jobs/:id/retry`. Sin el permiso la API responde `403 FORBIDDEN` con el nombre del permiso. El actor de servicio del worker tiene fijos `sync.run` e `inbox.reply`.

Además del rol, la API aplica scope por marca en listados, métricas, sincronización, detalle, respuestas, estados, exportación y administración de cuentas. Si el usuario solicita una marca fuera de `X-SAC-Brand-Ids`, responde `403 FORBIDDEN`.

## Integración de solo lectura para MetriQ

Rutas `GET /api/integrations/*` con la clave `SAC_FLOW_SERVICE_API_KEY` (`Authorization: Bearer` o `X-API-Key`; admite varias claves separadas por comas para rotar), independientes de la sesión de usuario y de solo lectura (`405` para otros métodos): `sac-brands` (marcas activas con `datosDesde`/`datosHasta`), `sac-rows` (filas SAC con el formato de MetriQ; solo casos SAC salvo `incluirRuido=true`, estados `Pendiente | En proceso | Resuelto | Derivado`), `sac-totals` (totales por mes, máximo 24 meses), `sac-report` (cifras de Reportes del mes, solo agregados) y `sac-export` (Excel del mes). Todas informan `meta.lastSyncAt`, `meta.lastSyncStatus` y `meta.generatedAt`. Contrato completo con ejemplos: [INTEGRACION_METRIQ.md](INTEGRACION_METRIQ.md).

## Contrato de Automation Studio

Las respuestas del módulo general usan `{ data, meta }`. `meta` incluye `externalNodesDisabled` y `metricoolMutationsDisabled`. Las credenciales nunca incluyen `encryptedData`; las variables secretas muestran un placeholder; input, output y node runs redactan claves sensibles.

### Rutas de lectura

| Método | Ruta | Contenido |
| --- | --- | --- |
| GET | `/api/platform` | Estado público de proyectos, carpetas, tags, workflows, credenciales, variables, versiones y ejecuciones. Para roles distintos de `admin`, `credentials` y `variables` vuelven como `[]` |
| GET | `/api/platform/catalog` | Definiciones de nodos y tipos de credencial |
| GET | `/api/platform/templates` | Plantillas instaladas |
| GET | `/api/platform/workflows` | Lista filtrable por proyecto, archivo y búsqueda |
| GET | `/api/platform/workflows/:id` | Workflow, validación y versiones |
| GET | `/api/platform/executions` | Historial filtrable por workflow, status y mode |
| GET | `/api/platform/executions/:id` | Detalle redactado con recorrido por nodo |

### Lifecycle de workflows

| Método | Ruta | Rol | Efecto |
| --- | --- | --- | --- |
| POST | `/api/platform/workflows` | admin | Crea workflow vacío o desde template |
| PUT | `/api/platform/workflows/:id` | admin | Guarda borrador y crea una versión |
| POST | `/api/platform/workflows/:id/validate` | viewer | Valida sin modificar |
| POST | `/api/platform/workflows/:id/publish` | admin | Publica solo si no hay errores |
| POST | `/api/platform/workflows/:id/rollback` | admin | Crea un borrador nuevo desde un snapshot inmutable |
| POST | `/api/platform/workflows/:id/active` | admin | Activa solo una versión publicada con trigger automático |
| POST | `/api/platform/workflows/:id/archive` | admin | Archiva/restaura y desactiva |
| POST | `/api/platform/workflows/:id/duplicate` | admin | Clona nodos y remapea conexiones |
| POST | `/api/platform/workflows/:id/run` | agent | Ejecuta manualmente y persiste auditoría |
| GET | `/api/platform/workflows/:id/export` | admin | Descarga grafo sin secretos ni asignaciones de credencial |
| POST | `/api/platform/workflows/import` | admin | Importa y remapea IDs; exige validación/publicación posterior |
| POST | `/api/platform/executions/:id/retry` | agent | Reintenta con linaje `retryOf` |

### Recursos y secretos

| Método | Ruta | Rol | Nota |
| --- | --- | --- | --- |
| POST | `/api/platform/credentials` | admin | Cifra el objeto `data` con AES-256-GCM |
| PUT | `/api/platform/credentials/:id` | admin | Reemplaza nombre y/o secreto cifrado |
| DELETE | `/api/platform/credentials/:id` | admin | Rechaza credenciales en uso |
| PUT | `/api/platform/variables` | admin | Upsert por proyecto/clave; secreto opcional |
| DELETE | `/api/platform/variables/:id` | admin | Elimina variable |
| POST | `/api/platform/projects` | admin | Crea proyecto de equipo |
| POST | `/api/platform/folders` | admin | Crea carpeta |
| POST | `/api/platform/tags` | admin | Crea tag |

### Webhooks

`GET|POST|PUT|PATCH /api/webhooks/:path` busca un workflow activo y publicado con `core.webhook` o `core.formTrigger`, ruta y método coincidentes. Acepta JSON y formularios `application/x-www-form-urlencoded`. En la beta hereda API key, actor context, origin check y rate limit globales. Una solicitud del navegador marcada `Sec-Fetch-Site: cross-site` se rechaza con `403 CROSS_SITE_WEBHOOK`, para que un enlace desde otro sitio no lo dispare con la sesión de quien hace clic. La respuesta incluye la salida terminal y `meta.executionId`, o el campo `response` configurado por el workflow.

Un nodo webhook puede exigir además una credencial Bearer o Header Auth cifrada. Esta comprobación usa comparación en tiempo constante y responde `401 WEBHOOK_UNAUTHORIZED` sin revelar el secreto.

Antes de exponer webhooks a terceros se requieren autenticación por webhook, firma/HMAC, idempotencia, límites específicos, replay protection y política de payload/PII.

Crear marcas nuevas requiere rol `admin` y `X-SAC-Brand-Ids: *`, porque una marca nueva aún no pertenece al scope acotado de un actor. Editar o desactivar una marca existente requiere `admin` y acceso a esa marca.

### Errores

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "La solicitud contiene datos inválidos.",
    "details": [
      { "path": "pageSize", "message": "Too big: expected number to be <=200" }
    ]
  },
  "meta": { "demoMode": true, "mode": "demo" }
}
```

`details` es opcional. Los consumidores deben decidir por `error.code`, no por el texto traducido.

### Idempotencia

`POST /workflow/run`, `POST /sync`, `POST /sac/protocol/evaluate`, `POST /interactions/:id/reply`, runs/retries de Automation Studio y webhooks mutables aceptan:

```http
Idempotency-Key: client-operation-unique-id
```

Formato: 8–200 caracteres de `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`, `-`.

- Misma key, mismo scope y mismo payload: devuelve la respuesta guardada con `Idempotent-Replay: true`.
- Misma key y payload distinto: `409 IDEMPOTENCY_KEY_REUSED`.
- Misma key mientras la primera solicitud sigue en curso: `409 IDEMPOTENCY_IN_PROGRESS` y `Retry-After: 3`; la reserva expira tras cinco minutos si el proceso no alcanza a guardar la respuesta final.
- Sin header: en demo la operación funciona, pero el cliente pierde protección contra reintentos.
- En live, sync, envíos, runs/retries generales y webhooks no-GET devuelven `428 IDEMPOTENCY_KEY_REQUIRED` si falta el header.

## Modelos

### PublicBrand

```ts
type PublicBrand = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sacPolicy?: {
    enabled: boolean;
    locale: string;
    tone: string;
    timeZone: string;
    businessHours?: Record<string, { start: string; end: string } | null>;
    approvedAnswers: Array<{
      id: string;
      intent: string;
      answer: string;
      sourceLabel: string;
      verifiedAt: string;
      expiresAt?: string;
    }>;
  };
  account: {
    id: string;
    brandId: string;
    name: string;
    handle: string;
    channels: Array<"instagram" | "facebook" | "x" | "tiktok" | "youtube" | "linkedin" | "google_business">;
    active: boolean;
    metricoolConfigured: boolean;
    metricool: {
      referenceStored: boolean;
      tokenConfigured: boolean;
      liveReady: boolean;
      source: "none" | "stored" | "env" | "fallback";
      configurationLocked: boolean;
      instagramProvider: "INSTAGRAMBUSINESS" | "INSTAGRAM";
    };
  };
};
```

`metricoolConfigured` y `metricool.liveReady` informan si la API puede resolver token + `userId`/`blogId` en live; no revelan esos valores. `referenceStored` indica si existe una referencia guardada en la persistencia local. `tokenConfigured` es solo un booleano de disponibilidad del token, no el token. `source` permite distinguir referencias por entorno, JSON local o fallback.

### Libro de registros por marca

| Método | Ruta | Rol | Efecto |
| --- | --- | --- | --- |
| GET | `/api/brands/:brandId/workbook` | viewer | Devuelve el contrato público o `null` |
| PUT | `/api/brands/:brandId/workbook` | admin | Descarga y valida en lectura un Google Sheet, luego fija pestañas, encabezados, mapeo y hash |
| GET | `/api/brands/:brandId/workbook/export` | viewer | Descarga una copia XLSX con interacciones de la marca agregadas sin alterar la fuente |

`PUT` acepta `{ "spreadsheetUrl": "https://docs.google.com/spreadsheets/d/.../edit" }`. La API solo permite HTTPS sobre `docs.google.com`, construye internamente la URL de exportación y limita tamaño/tiempo. No sigue URLs de otros hosts y nunca escribe en Google. Una exportación se bloquea con `WORKBOOK_EXPORT_FAILED` si el hash de pestañas o encabezados cambió desde la validación; el administrador debe revalidar explícitamente. Las columnas desconocidas se preservan vacías y no se inventan campos. El contrato de Converse usa exactamente `Histórico!A:I`.

### QA y centro documental por marca

| Método | Ruta | Rol | Efecto |
| --- | --- | --- | --- |
| GET/PUT | `/api/brands/:brandId/qa-workbook` | viewer/admin | Lee o valida el Google Sheet de respuestas aprobadas y actualiza la base de conocimiento local |
| GET | `/api/brands/:brandId/qa-workbook/template` | viewer | Descarga una plantilla XLSX vacía con el contrato QA |
| GET/POST | `/api/brands/:brandId/resources` | viewer/admin | Lista o registra enlaces HTTPS del centro documental |
| DELETE | `/api/brands/:brandId/resources/:resourceId` | admin | Elimina solo la referencia local; los libros gestionados se desconectan desde su flujo específico |

El importador QA solo incorpora filas con estado aprobado/activo y exige columnas de pregunta, respuesta y estado. Los recursos son metadatos y enlaces HTTPS; no se suben binarios ni se modifica el archivo fuente.

### Interaction

`GET /api/interactions/:id/conversation` devuelve el historial cronológico disponible en la persistencia local. `scope=thread` (default) conserva el hilo estricto del proveedor; `scope=contact` reúne la actividad de la persona dentro de la misma cuenta y plataforma sin cambiar las reglas de reconciliación. `DELETE /api/interactions/:id/draft` exige `expectedVersion`, elimina únicamente el borrador local y devuelve `externalWrites: false`; nunca elimina el mensaje del cliente ni llama a Metricool.

```ts
type Interaction = {
  id: string;
  externalId: string;
  brandId: string;
  accountId: string;
  channel: "instagram" | "facebook" | "x" | "tiktok" | "youtube" | "linkedin" | "google_business";
  type: "dm" | "comment" | "review";
  direction: "inbound" | "outbound";
  customerName: string;
  customerHandle: string;
  text: string;
  category: string;
  sentiment: "positive" | "neutral" | "negative";
  confidence: number;
  status: "new" | "pending" | "drafted" | "replied" | "escalated" | "resolved";
  source: "demo" | "metricool";
  version: number;
  createdAt: string;
  updatedAt: string;
  assignedTo?: { userId: string; displayName: string };
  internalNotes: Array<{
    id: string;
    authorId: string;
    authorName: string;
    text: string;
    createdAt: string;
  }>;
  responseText?: string;
  automation?: {
    protocolVersion: "sac-v1";
    evaluatedAt: string;
    intent: string;
    risk: "low" | "medium" | "high" | "critical";
    classificationConfidence: number;
    knowledge: {
      status: "approved" | "missing" | "live_source_required" | "not_required";
      sourceIds: string[];
    };
    conversation: {
      key: string;
      messageCount: number;
      inboundCount: number;
      outboundCount: number;
      continuation: boolean;
    };
    replyWindow: { eligible: boolean; expiresAt: string };
    recommendedRoute: "auto_reply" | "draft" | "human_review" | "quarantine" | "ignore";
    effectiveRoute: "auto_reply" | "draft" | "human_review" | "quarantine" | "ignore";
    reasonCodes: string[];
    proposal?: { text: string; templateId: string; sourceIds: string[] };
  };
  respondedAt?: string;
  metricoolRef?: {
    provider?: "FACEBOOK" | "INSTAGRAM" | "INSTAGRAMBUSINESS" | "TWITTER" | "TIKTOKBUSINESS" | "YOUTUBE" | "LINKEDIN" | "GMB";
    conversationId?: string;
    recipient?: string;
    objectId?: string;
    commentId?: string;
    postId?: string;
    actorId?: string;
    threadId?: string;
    parentCommentId?: string;
    contentContext?: {
      kind: "text" | "story_reply" | "story_mention" | "reaction" | "attachment" | "unsupported" | "deleted" | "unavailable";
      mediaUrls?: string[];
      permalink?: string;
      storyId?: string;
    };
    post?: {
      id: string;
      url?: string;
      text?: string;
      mediaUrl?: string;
      publishedAt?: string;
    };
  };
  audit: Array<{
    id: string;
    at: string;
    action: "ingested" | "classified" | "automation_evaluated" | "draft_created" | "delivery_reconciled" | "reply_sent" | "escalated" | "status_changed" | "assigned" | "unassigned" | "note_added";
    actor: "system" | "workflow" | "agent";
    detail: string;
    metadata?: Record<string, string | number | boolean>;
  }>;
};
```

`confidence` está entre 0 y 1. `version` comienza en 1 y aumenta con cada mutación del caso; las escrituras deben enviar `expectedVersion` para impedir que un agente sobrescriba trabajo más reciente. `internalNotes` es información interna de SAC Flow y nunca se envía a Metricool. Los payloads recién normalizados desde Metricool pueden comenzar con categoría `sin_clasificar`, sentimiento neutral y confianza 0, pero `/sync` los hace pasar inmediatamente por `sac-v1`. `automation.recommendedRoute` conserva la decisión ideal y `effectiveRoute` incorpora bloqueos operativos como el cortacorriente o la falta de infraestructura de entrega.

### Workflow

```ts
type Workflow = {
  id: string;
  name: string;
  enabled: boolean;
  pollIntervalMinutes: number;
  autoReplyEnabled: boolean;
  autoReplyAccountIds: string[];
  minimumConfidence: number;
  requireHumanFor: string[];
  businessHoursOnly: boolean;
  updatedAt: string;
  lastRunAt?: string;
  lastRunStatus?: "success" | "partial" | "failed";
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
};

type WorkflowConnectorType = "smoothstep" | "bezier" | "straight";

type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  connectorType?: WorkflowConnectorType;
};
```

Tipos de nodo: `schedule`, `metricool`, `normalize`, `deduplicate`, `classify`, `guardrail`, `reply`, `excel`, `escalate`.

`connectorType` define el trazado visual por conexión: `smoothstep` es ortogonal suavizado y el valor compatible para datos antiguos, `bezier` es curvo y `straight` es recto. No modifica la semántica de ejecución del DAG.

El estado demo inicial es `autoReplyEnabled=false` y `autoReplyAccountIds=[]`. `confirmAutoReply` es un campo de confirmación del request PUT; no se persiste.

### WorkflowRun

```ts
type WorkflowRun = {
  id: string;
  kind: "simulation" | "sync";
  startedAt: string;
  finishedAt: string;
  status: "success" | "partial" | "failed";
  demoMode: boolean;
  accountIds: string[];
  totals: {
    fetched: number;
    created: number;
    duplicates: number;
    drafted: number;
    replied: number;
    escalated: number;
    errors: number;
  };
  auditTrail: Array<{
    id: string;
    node: string;
    status: "success" | "skipped" | "warning" | "failed";
    detail: string;
    count?: number;
    at: string;
  }>;
};
```

## Endpoints

### `GET /api/health`

No recibe parámetros. Desde internet (solicitud que llega por el proxy, con `X-Forwarded-For`) y sin sesión válida responde solo `{ status, service, timestamp }`; el detalle (modo, Metricool, cortacorrientes, seguridad, persistencia) queda para las sondas internas sin proxy y para personas con sesión. Lo mismo aplica a `GET /api/ready`, que sin sesión desde internet conserva su código 200/503 pero no incluye `checks`.

```json
{
  "status": "ok",
  "service": "sac-flow-api",
  "timestamp": "2026-08-11T20:00:00.000Z",
  "mode": "demo",
  "demoMode": true,
  "modeReason": "explicit_demo",
  "metricool": {
    "configured": false,
    "accountOverrides": 0,
    "fallbackAccountConfigured": false,
    "fallbackAccountActive": false
  },
  "operations": {
    "outboundSendsDisabled": false,
    "externalNodesDisabled": true,
    "metricoolMutationsDisabled": true,
    "autoReplyDispatchMode": "shadow",
    "autoReplyMaxPending": 1000
  },
  "security": {
    "apiKeyRequired": false,
    "cors": "any",
    "securityHeaders": false,
    "rateLimitEnabled": false,
    "actorContextRequired": false,
    "trustedActorHeaders": false,
    "defaultRole": "admin"
  },
  "persistence": {
    "ready": true,
    "driver": "json",
    "jsonLiveAllowed": true
  }
}
```

`modeReason` puede ser `explicit_demo` o `credentials_configured` en un arranque válido. Si se solicita `METRICOOL_MODE=live` sin token, el servidor falla al arrancar. Este endpoint indica liveness/configuración básica; no debe usarse como prueba de que el repositorio está consultable.

### `GET /api/ready`

No recibe parámetros. Devuelve 200 si el proceso puede leer su repositorio configurado (catálogo de marcas/workflow, últimas ejecuciones y conteos); devuelve 503 si la dependencia de persistencia no está lista. `brands`, `interactions` y `deliveries` son conteos (`count(*)` en PostgreSQL): el probe no materializa las interacciones, de modo que su costo no crece con el volumen de la bandeja, y `deliveries` informa el total real en vez de las primeras 500 filas.

```json
{
  "status": "ready",
  "service": "sac-flow-api",
  "timestamp": "2026-08-12T14:30:00.000Z",
  "checks": {
    "repository": {
      "status": "ok",
      "driver": "json",
      "brands": 20,
      "interactions": 60,
      "deliveries": 0
    },
    "metricool": {
      "status": "ok",
      "mode": "demo",
      "configured": false
    },
    "outboundSends": {
      "status": "enabled"
    },
    "inboxSync": {
      "enabled": true,
      "intervalMinutes": 5,
      "lastRunStatus": "success",
      "lastRunAt": "2026-08-12T14:25:00.000Z"
    }
  },
  "meta": { "demoMode": true, "mode": "demo" }
}
```

Readiness no hace llamadas externas a Metricool; solo confirma configuración local y disponibilidad del repositorio. En producción, Techlab debe ampliar el probe del adaptador PostgreSQL con timeout/pool y mantener checks externos separados para no bloquear despliegues por una caída temporal de Metricool.

### `GET /api/metrics`

Devuelve métricas agregadas en formato Prometheus `text/plain; version=0.0.4`. Requiere rol `supervisor` o superior; si `SAC_FLOW_REQUIRE_API_KEY=true`, también requiere API key. No incluye texto de conversaciones, nombres de clientes, handles, `userId`, `blogId` ni token.

Ejemplo abreviado:

```text
# HELP sac_flow_up Whether the SAC Flow API can produce metrics.
# TYPE sac_flow_up gauge
sac_flow_up 1
sac_flow_brands_total{active="true"} 20
sac_flow_pending_interactions_total 40
sac_flow_protocol_evaluated_total 20
sac_flow_protocol_routes_total{route="draft"} 14
sac_flow_protocol_knowledge_total{status="live_source_required"} 8
sac_flow_workflow_auto_reply_enabled 0
sac_flow_outbound_sends_disabled 1
sac_flow_jobs_total{status="dead"} 0
sac_flow_oldest_job_state_age_seconds{status="dead"} 0
sac_flow_jobs_overdue_total{status="retry"} 0
sac_flow_mode_info{mode="demo",repository="json"} 1
```

Métricas incluidas:

- marcas y cuentas por estado activo;
- interacciones por red, tipo, estado y fuente;
- pendientes operativos;
- cobertura del protocolo SAC por ruta efectiva y estado de conocimiento;
- estado global de auto-respuesta, allowlist y kill switch;
- modo runtime y driver de repositorio;
- estado de la última ejecución si existe;
- runs de sincronización por resultado y totales fetched/created/duplicate/error;
- jobs durables por estado, antigüedad del job más viejo en `retry`/`dead` y jobs `queued`/`retry` cuyo próximo intento ya venció;
- timestamp de la última sincronización exitosa;
- antigüedad del pendiente más viejo y número de casos asignados.

Techlab debe exponer esta ruta solo detrás del gateway/red de observabilidad y scrapearla con una identidad de servicio autorizada. Los umbrales iniciales y el protocolo de respuesta están en [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md).

### Inicio de sesión (`SAC_FLOW_AUTH_MODE=google` o `dev`)

- `GET /api/auth/config` (público): `{ data: { enabled, provider, requiredPermission } }`, con `provider` en `google`, `dev` o `null`. La UI muestra el inicio de sesión cuando `enabled` es `true`.
- `GET /api/auth/google/start` (público, solo `google`): genera `state`, `nonce` y verificador PKCE, los guarda en la cookie firmada `HttpOnly` `wiwo_nodes_session_oauth` (10 minutos, `Path=/api/auth/google`) y responde `302` hacia Google.
- `GET /api/auth/google/callback` (público, solo `google`): Google vuelve con `code` y `state`. La API comprueba el `state`, canjea el código con el client secret y el verificador, verifica firma, audiencia, emisor, vigencia y `nonce` del `id_token`, exige correo verificado y consulta la allowlist del backend (archivo `SAC_FLOW_AUTH_ALLOWED_USERS_FILE`, variables `SAC_FLOW_AUTH_ADMIN_EMAILS`/`SAC_FLOW_AUTH_SUPERVISOR_EMAILS`/`SAC_FLOW_AUTH_ALLOWED_EMAILS` y dominios opcionales). Si todo es válido emite la cookie `HttpOnly` `wiwo_nodes_session` (`SAC_FLOW_AUTH_COOKIE`) y responde `302` a `SAC_FLOW_AUTH_POST_LOGIN_REDIRECT`; si no, `302` al mismo destino con `?login_error=CODIGO` (`ACCOUNT_NOT_ALLOWED`, `PERMISSION_REQUIRED`, `EMAIL_NOT_VERIFIED`, `GOOGLE_CANCELLED`, `OAUTH_STATE_INVALID`, `GOOGLE_TOKEN_INVALID`). El navegador nunca recibe tokens de Google.
- `POST /api/auth/dev-session` (público, solo con `SAC_FLOW_AUTH_MODE=dev`, nunca en producción): recibe `{ "email", "password" }`, valida contra los usuarios ficticios de `SAC_FLOW_DEV_AUTH_USERS_FILE` , emite la misma cookie de sesión y responde con el actor (`userId`, `displayName`, `email`, `role`, `brandIds`, `source`). Errores: `401 INVALID_CREDENTIALS` (mismo mensaje exista o no el correo), `403 PERMISSION_REQUIRED`. Sin ese modo responde `404`.
- Procesos internos: Con inicio de sesión activo, `SAC_FLOW_API_KEY` deja de ser una credencial de navegador y pasa a ser solo interna: con `X-API-Key` o `Authorization: Bearer` abre únicamente `POST /api/sync` (worker) y `POST /api/interactions/:id/reply` (despachador de respuestas automáticas), con un actor de servicio `service:worker`, rol `agent` y todas las marcas. Una clave incorrecta en esas rutas responde `401 UNAUTHORIZED`; en cualquier otra ruta o método la clave no tiene efecto y se exige la cookie de una persona (`401 SESSION_REQUIRED`). Cada uso queda registrado como evento `service_actor`, sin la clave.
- `DELETE /api/auth/session`: responde `204` y expira la cookie. La UI lo usa en **Cerrar sesión**.
- Toda ruta protegida sin cookie válida responde `401 SESSION_REQUIRED`. La allowlist se relee en cada solicitud: quitar a alguien corta su sesión.
- Precedencia del rol, de mayor a menor: archivo `SAC_FLOW_AUTH_ALLOWED_USERS_FILE`; `SAC_FLOW_AUTH_ADMIN_EMAILS` (siempre admin); rol asignado desde **Usuarios y roles** (incluido `none`, sin acceso, que responde `403 ACCESS_REVOKED` y en el callback `?login_error=ACCESS_REVOKED`); `SAC_FLOW_AUTH_SUPERVISOR_EMAILS`; `SAC_FLOW_AUTH_ALLOWED_EMAILS`; dominios permitidos. Un rol asignado también deja entrar a un correo fuera de los dominios. Los roles asignados y el catálogo de roles se cachean hasta 15 segundos por proceso y la caché se descarta al cambiar una asignación o un rol, así que el cambio rige en la siguiente solicitud sin volver a iniciar sesión.

### Usuarios y roles (`admin`)

- `GET /api/admin/users`: `{ data: { users: UserAccessView[], roles: RoleView[], permissions: PermissionDefinition[], adminOnly: string[], masterOnlyPermissions: Permission[], viewer: { masterAdmin: boolean }, policy: { authEnabled, allowedDomains, defaultRole } } }`. `viewer.masterAdmin` es `true` si quien consulta está en `SAC_FLOW_AUTH_ADMIN_EMAILS` (admin principal) y `false` si su rol Admin se asignó desde la app (admin asignado); `masterOnlyPermissions` lista los permisos que solo un admin principal puede otorgar (`brands.manage`, `automations.edit`, `workflow.publish`, `inbox.archive_expired`, `export.xlsx`). `RoleView` = `{ id, name, baseRole, permissions, builtIn, editable, customized, userCount, defaultPermissions?, updatedBy?, updatedAt? }`; `admin` aparece siempre con todos los permisos y `editable: false`. Lista a quienes están en el archivo o en las listas del entorno, tienen un rol asignado o ya iniciaron sesión. `UserAccessView` = `{ email, name, effectiveRole, assignedRole?, assignedBy?, assignedAt?, serverRole, serverSource, locked, lastSignInAt?, isSelf, rolePermissions, permissions, permissionsAdd, permissionsRemove, permissionsUpdatedBy?, permissionsUpdatedAt? }` (`permissions` = los del rol más los ajustes personales), con `effectiveRole`/`assignedRole` = id de un rol (`admin`, `viewer`, `agent`, `supervisor` o un rol propio `rol-…`) o `none` y `serverSource` en `allowlist_file | server_admin | server_supervisor | server_allowed | domain | null`.
- `PUT /api/admin/users/role` con `{ "email", "role" }`: asigna el rol; `role: null` quita la asignación y vuelve a la regla del servidor. El correo va en el cuerpo, nunca en la URL, para que no quede en registros de acceso. Responde el listado completo más `user`. `409 ACCESS_LOCKED` si el correo es el propio, está en `SAC_FLOW_AUTH_ADMIN_EMAILS` o en el archivo; `400 ROLE_NOT_FOUND` si el rol no existe; `400 VALIDATION_ERROR` con correo inválido. Un admin asignado recibe `403 MASTER_ADMIN_REQUIRED` si intenta dar el rol Admin o cambiar a otro admin, y `403 MASTER_ONLY_PERMISSION` si el rol nuevo agregaría a esa persona un permiso de `masterOnlyPermissions` que no tenía (bajar de rol o quitar permisos sí está permitido).
- `PUT /api/admin/users/permissions` con `{ "email", "permissions" }`: ajusta lo que puede hacer una persona en específico. La API guarda la diferencia con su rol como permisos agregados y quitados, así un cambio posterior del rol o de sus permisos se sigue aplicando con esos ajustes encima; `permissions: null` los quita. `409 ACCESS_LOCKED` (propio, admin del entorno o archivo), `409 ADMIN_HAS_ALL` si su rol es Admin, `409 ACCESS_REVOKED` si no tiene acceso, `404 USER_NOT_FOUND` si no está en la lista. Los permisos exclusivos de Admin nunca se pueden agregar. Un admin asignado recibe `403 MASTER_ONLY_PERMISSION` si el ajuste agrega un permiso de `masterOnlyPermissions` que la persona no tenía; quitarlo sí puede.
- Crear, editar, borrar o restablecer roles (`POST`, `PUT` y `DELETE /api/admin/roles…`) es solo de admin principal; un admin asignado recibe `403 MASTER_ADMIN_REQUIRED`.
- `POST /api/admin/roles` con `{ name, baseRole: viewer|agent|supervisor, permissions }`: crea un rol propio (id `rol-<nombre>`); los permisos desconocidos o de administración se descartan. `409 ROLE_NAME_TAKEN` si el nombre ya existe. Responde el listado más `roleId`.
- `PUT /api/admin/roles/:roleId` con `{ permissions, name? }`: cambia los permisos de un rol de base o propio (el nombre solo en los propios). `409 ROLE_LOCKED` para `admin`.
- `DELETE /api/admin/roles/:roleId`: borra un rol propio (`409 ROLE_IN_USE` si alguien lo tiene asignado) o restablece un rol de base a sus permisos por defecto.
- Un rol propio lleva un `baseRole` que da el nivel nominal (`role` en `/api/me`); los permisos efectivos salen siempre del rol. `GET /api/me` agrega `roleId`, `roleName` y `permissions` (ausente para Admin, que los tiene todos).
- Cada inicio de sesión exitoso (Google o `dev`) registra nombre y fecha en `user_access` (PostgreSQL, migración `0018_access_control.sql`, que también crea `access_roles` y guarda los ajustes personales en `user_access.permissions_add`/`permissions_remove`) o en `userAccess` del JSON local; un fallo al registrarlo no impide entrar. Los registros de la API anotan el cambio de rol sin el correo.

### `GET /api/me`

Devuelve el contexto seguro que la UI usa para ajustar acciones de solo lectura, coordinación y supervisión. Requiere identidad de nivel `viewer` o superior.

```json
{
  "data": {
    "userId": "user-opaque",
    "displayName": "Agente SAC",
    "tenantId": "tenant-opaque",
    "role": "agent",
    "brandIds": ["brand-01"],
    "source": "google",
    "email": "agente@example.test",
    "masterAdmin": false
  },
  "meta": { "demoMode": false, "mode": "live" }
}
```

`brandIds` puede ser `"all"`. `source` indica el origen de la identidad (`local`, `trusted_headers`, `google` o `dev`); `email` solo aparece con sesión de Google o de prueba local y alimenta el menú de perfil. `masterAdmin` es `true` solo para un admin principal (`SAC_FLOW_AUTH_ADMIN_EMAILS`; sin inicio de sesión propio, el admin local), el único que oculta o muestra clientes. Esta respuesta informa la experiencia visual, pero la autorización sigue aplicándose en cada endpoint servidor.

### `GET /api/brands`

Respuesta: `{ data: PublicBrand[], meta: { demoMode, mode, count } }`.

Un store nuevo devuelve 20 marcas demo cuando el actor tiene scope completo. Con contexto de actor, la lista se filtra por `X-SAC-Brand-Ids`. La API omite las referencias privadas de Metricool. Los clientes ocultos (`active: false` o `account.active: false`) solo se devuelven al admin principal, para que pueda volver a mostrarlos; para el resto del equipo no existen.

### `POST /api/brands`

Crea una marca y su cuenta social interna. No contacta a Metricool, no crea páginas en Meta y no guarda token.

```json
{
  "id": "brand-21",
  "name": "Marca Nueva",
  "color": "#22c55e",
  "accountId": "account-21",
  "accountName": "Marca Nueva IG",
  "accountHandle": "@marca_nueva",
  "channels": ["instagram", "facebook"],
  "active": true,
  "accountActive": true
}
```

Reglas:

- `id` y `accountId` son opcionales; si faltan, la API genera slugs únicos desde `name`.
- `id`/`accountId`: minúsculas, números y guiones; no comienzan ni terminan con guion.
- `accountHandle`: se normaliza con `@` inicial si falta.
- `color`: hexadecimal `#RRGGBB`.
- `channels`: uno o más de `instagram`, `facebook`, `x`, `tiktok`, `youtube`, `linkedin`, `google_business`.
- Requiere rol `admin` y scope completo `X-SAC-Brand-Ids: *`.
- Duplicados de `brandId`, `accountId` o `accountHandle` responden `409`.

Respuesta: `{ data: PublicBrand, meta: { demoMode, mode, created: true, externalWrites: false } }`.

### `PATCH /api/brands/:brandId`

Actualiza metadatos operativos de una marca/cuenta. No cambia `brandId` ni `accountId`.

```json
{
  "name": "Marca Nueva Editada",
  "color": "#0ea5e9",
  "accountName": "Marca Nueva SAC",
  "accountHandle": "@marca_nueva_sac",
  "channels": ["facebook"],
  "active": true,
  "accountActive": true
}
```

Todos los campos son opcionales, pero debe enviarse al menos uno. Requiere `brands.manage` y acceso a la marca. Si el nuevo handle ya existe en otra cuenta, responde `409 ACCOUNT_HANDLE_ALREADY_EXISTS`. Cambiar `active` o `accountActive` (ocultar o mostrar) exige además admin principal: si no, `403 MASTER_ADMIN_REQUIRED`; enviarlos con el mismo valor que ya tienen no cuenta como cambio.

Respuesta: `{ data: PublicBrand, meta: { demoMode, mode, updated: true, externalWrites: false } }`.

### `PUT /api/brands/:brandId/visibility`

Oculta (`{ "hidden": true }`) o vuelve a mostrar (`{ "hidden": false }`) un cliente. Solo un admin principal (`SAC_FLOW_AUTH_ADMIN_EMAILS`); un admin asignado desde la app recibe `403 MASTER_ADMIN_REQUIRED`. No borra historial ni contacta a Metricool.

Un cliente oculto (`active` y `account.active` en `false`):

- deja de sincronizar con Metricool (la referencia se conserva, así que la vinculación automática no lo vuelve a crear);
- sale de la bandeja, Inicio, el resumen, Reportes y las rutas de integración de METRIQ (`sac-brands` lo omite; pedirlo por `brandId` responde `409 BRAND_INACTIVE`);
- deja de aparecer en `GET /api/brands` para todos salvo el admin principal;
- al ocultarlo se retira de `autoReplyAccountIds` y se apaga `autoReplyEnabled` si la allowlist queda vacía.

Al mostrarlo vuelve con todo su historial y la sincronización siguiente trae lo que llegó mientras estuvo oculto.

Respuesta: `{ data: PublicBrand, meta: { demoMode, mode, hidden, externalWrites: false } }`.

### `DELETE /api/brands/:brandId`

Equivale a `PUT /api/brands/:brandId/visibility` con `{ "hidden": true }` y se conserva por compatibilidad. Mismas reglas: solo admin principal, no borra historial ni contacta a Metricool.

Respuesta: `{ data: PublicBrand, meta: { demoMode, mode, deactivated: true, hidden: true, autoReplyRemoved: true, externalWrites: false } }`.

### `POST /api/brands/:brandId/manual-records`

Carga manual del Excel BD SAC de una marca, para lo de TikTok y LinkedIn que Metricool no trae (sus DMs y lo registrado en la planilla; los comentarios sí llegan por Metricool y no se duplican). Requiere el permiso `records.import` ("Cargar registros manuales"; por defecto Supervisor y Admin) y acceso a la marca. El cuerpo es el archivo `.xlsx` tal cual, con `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (máximo 8 MB y 20.000 filas); otro tipo responde `415 UNSUPPORTED_MEDIA_TYPE` y un archivo ilegible o sin las columnas de la planilla, `422 MANUAL_RECORDS_FORMAT_INVALID`. Una marca oculta responde `409 BRAND_INACTIVE`.

Query:

- `dryRun=true|false` (por defecto `true`): con `true` solo revisa y cuenta; con `false` guarda los casos nuevos.
- `red=tiktok|linkedin` (opcional): red para las filas sin "Plataforma".
- `archivo` (opcional): nombre del archivo, para la auditoría.

Lee la pestaña "Histórico" si existe (si no, la primera hoja cuyas primeras filas tengan los encabezados) con las columnas de la planilla: "Fecha comentario" y "Reclamo / Mensaje" obligatorias; "Nombre usuario cliente", "Plataforma / RRSS", "Canal" (DM o comentario), "Clasificación / Categoría comentario", "Tonalidad" y "Estado" opcionales. Las filas de otras redes se omiten (ya llegan por Metricool). Cada fila válida se guarda como interacción entrante `source: "planilla"`, marcada a mano como caso SAC (`sacTriage.modelo = "manual"`), con el estado de la planilla (Resuelto, Pendiente, En proceso, Derivado). No duplica: la misma fila ya cargada (huella por marca, fecha, usuario y texto en `externalId`) se cuenta como `yaCargadas`, y el mismo texto que Metricool ya trajo para esa red (mismo día, o hasta 3 días si es distintivo) como `yaEnNodes`.

Estos casos cuentan en Reportes, en el Excel de interacciones y en las rutas de METRIQ, pero no en la bandeja, Inicio ni `GET /api/stats/summary`: ya se atendieron fuera de Nodes y no se responden desde aquí. No escribe en Metricool.

```json
{
  "data": {
    "dryRun": true, "hoja": "Histórico", "leidas": 120, "nuevas": 112, "creadas": 0,
    "yaCargadas": 0, "yaEnNodes": 3, "repetidasEnArchivo": 1, "otraRed": 2, "invalidas": 2,
    "problemas": [{ "fila": 14, "motivo": "Fecha vacía o con formato no reconocido (usa DD/MM/AAAA)." }],
    "porRed": { "tiktok": 98, "linkedin": 14 }, "porTipo": { "comment": 90, "dm": 22 },
    "desde": "2026-10-01", "hasta": "2026-10-31"
  },
  "meta": { "demoMode": false, "mode": "live", "externalWrites": false }
}
```

### `GET /api/manual-records/template`

Plantilla vacía del Excel BD SAC (pestaña "Histórico" más una hoja "Cómo llenar"). Requiere `records.import`.

### `GET /api/accounts/:accountId/metricool`

Devuelve el estado seguro de configuración Metricool de una cuenta. No devuelve `userId`, `blogId` ni token.

```ts
{
  data: {
    accountId: string;
    brandId: string;
    brandName: string;
    accountName: string;
    accountHandle: string;
    active: boolean;
    metricoolConfigured: boolean;
    metricool: {
      referenceStored: boolean;
      tokenConfigured: boolean;
      liveReady: boolean;
      source: "none" | "stored" | "env" | "fallback";
      configurationLocked: boolean;
    };
  };
  meta: { demoMode: boolean; mode: "demo" | "live" };
}
```

### `PUT /api/accounts/:accountId/metricool`

Guarda o reemplaza la referencia `userId`/`blogId` y la variante de conexión Instagram de una cuenta. No guarda el token Metricool y no contacta al proveedor. Exige `brands.manage` y alcance de todas las marcas (`403 FORBIDDEN` con alcance parcial), porque el token es compartido y vincular una marca permite leer sus mensajes. `409 METRICOOL_BRAND_ALREADY_LINKED` si ese `blogId` ya está vinculado a otra cuenta.

```json
{
  "userId": "123456",
  "blogId": "987654",
  "instagramProvider": "INSTAGRAMBUSINESS"
}
```

Reglas:

- `userId` y `blogId`: string o number, 1–120 caracteres después de normalizar.
- `instagramProvider`: `INSTAGRAMBUSINESS` (vía Facebook, default) o `INSTAGRAM` (conexión directa).
- La respuesta nunca incluye los valores recibidos.
- Si la cuenta se resuelve por `METRICOOL_ACCOUNTS_JSON` o fallback activo, la referencia queda guardada, pero la fuente efectiva puede seguir siendo `env` o `fallback`.

Respuesta: mismo `data` seguro de `GET /api/accounts/:accountId/metricool`, con `meta.credentialsStored=true` y `externalWrites=false`.

### `DELETE /api/accounts/:accountId/metricool`

Elimina la referencia `userId`/`blogId` guardada localmente y quita la cuenta de `autoReplyAccountIds`. Si era la única cuenta allowlisted, también apaga `autoReplyEnabled`.

No contacta a Metricool y no elimina credenciales configuradas por variables de entorno ni fallback servidor.

Respuesta: mismo `data` seguro de `GET /api/accounts/:accountId/metricool`, con `meta.credentialsStored=false`, `autoReplyRemoved=true` y `externalWrites=false`.

### `GET /api/interactions`

Filtros opcionales:

| Query | Valores/regla |
| --- | --- |
| `brandId` | string no vacío |
| `accountId` | string no vacío |
| `channel` | `instagram`, `facebook`, `x`, `tiktok`, `youtube`, `linkedin` o `google_business` |
| `type` | `dm`, `comment` o `review` |
| `status` | `new`, `pending`, `drafted`, `replied`, `escalated`, `resolved` |
| `sentiment` | `positive`, `neutral`, `negative` |
| `assignment` | `assigned` o `unassigned` |
| `assigneeId` | ID opaco del responsable; máximo 120 caracteres |
| `search` | 1–200 caracteres; busca texto, cliente, handle, categoría, respuesta y responsable |
| `from` / `to` | fecha ISO; `from` no puede superar `to` |
| `page` | entero ≥ 1; default 1 |
| `pageSize` | entero 1–200; default 50 |

Orden: `createdAt` descendente.

En cada sincronización live, la API intenta leer `GET /v2/settings/brands/{blogId}` para detectar las redes realmente conectadas. Si Metricool no permite esa lectura, continúa con `account.channels`; la detección es de solo lectura y no altera conexiones ni configuración remota.

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "pageSize": 50,
    "total": 0,
    "totalPages": 1
  },
  "meta": { "demoMode": true, "mode": "demo" }
}
```

### `GET /api/inbox/revision`

Rol `viewer`. Responde `{ data: { revision } }`, una cadena opaca que cambia con cada escritura exitosa en la API (sincronización, borrador, respuesta, asignación, estado, marcas…) y nunca con lecturas ni con rutas de sesión. El prefijo cambia en cada arranque de la API. La UI la usa como punto de partida para los cambios en vivo (abajo).

### `GET /api/inbox/changes?since=<revision>`

Rol `viewer`. Bandeja en vivo: responde `{ data: { revision, full, contacts } }` con solo los contactos (mismo formato que `/api/inbox/contacts`) de las personas cuyos casos cambiaron después de `since`, dentro del alcance de marcas del actor. Cada escritura de casos en la API (respuesta, borrador, estado, asignación, nota, marca para el reporte, sincronización con Metricool, archivado) queda anotada por revisión. `full: true` (sin contactos) pide descargar la bandeja completa: revisión de otro arranque o demasiado antigua (se recuerdan las últimas 1.000), más de 2.000 casos cambiados, o un cambio de catálogo (marcas, flujo) que no dice qué casos tocó. La lectura de origen se comparte entre todos los navegadores que piden la misma revisión.

### `GET /api/inbox/stream`

Rol `viewer` (exige sesión). Server-Sent Events (`text/event-stream`, sin caché, `X-Accel-Buffering: no`): al conectar envía `event: revision` con la revisión actual, luego un `event: revision` en cada cambio y un `event: ping` cada 25 s. Solo lleva el número de revisión; el navegador pide el detalle a `/api/inbox/changes` con su sesión, así nadie recibe casos fuera de su alcance. Máximo 300 conexiones simultáneas por proceso (`503 LIVE_CAPACITY_REACHED` por encima). La UI mantiene la conexión con la pestaña visible, en todas las vistas, y si no llegan avisos (proxy que retiene el stream) pregunta a `/api/inbox/changes` cada 10 s. Además hace una descarga completa cada 10 minutos para cubrir cambios hechos fuera de la API (despachador automático del worker).

### Plazos de respuesta y `POST /api/interactions/archive-expired`

Metricool informa 7 días para responder DMs y 24 horas para comentarios en Instagram y Facebook, contados desde el último mensaje del cliente (para DMs, el último entrante de la conversación). La UI usa `latestInboundAt` de cada contacto para mostrar "Vence en…"/"Venció hace…", contar en Inicio solo lo que sigue **en plazo** y, en la Bandeja, ocultar por defecto lo vencido (filtro **Plazo**). Fuera de plazo igual se puede abrir, redactar e intentar una respuesta manual: Metricool/Meta deciden.

`POST /api/interactions/archive-expired` (permiso `inbox.archive_expired`) con `{ dryRun?: boolean = true, accountId?, type?: "dm" | "comment" }`: cierra como `resolved` con motivo `reply_window_expired` ("Fuera de plazo de respuesta (histórico)") los casos entrantes abiertos (`new`, `pending`, `drafted`, `escalated`) cuyo plazo venció, dentro del alcance de marcas del actor. Nunca archiva casos sensibles (sentimiento negativo o riesgo `high`/`critical`), nunca escribe en Metricool y deja una entrada de auditoría por caso (`metadata.bulk: true`). Responde `{ data: { dryRun, archived, eligible, skippedSensitive } }`; con `dryRun` solo cuenta. Un caso archivado se reabre cambiando su estado.

### `GET /api/inbox/contacts`

Contrato optimizado de la bandeja. Cada contacto incluye `latestInboundAt` (último mensaje del cliente), usado para el plazo de respuesta. Aplica el scope de marca del actor antes de agrupar y pagina después de construir contactos. Si la persona no tiene nada pendiente y lo último lo escribió la cuenta, el contacto trae `latestInboundId` (el último mensaje del cliente), para que el chat se abra ahí y se pueda seguir la conversación. No incluye clientes ocultos ni los casos cargados a mano desde el Excel BD SAC (`source: "planilla"`); lo mismo vale para `/api/inbox/posts`, `/api/inbox/changes`, `/api/interactions`, `/api/stats/summary`, el marcado en lote y el archivado de vencidos. Una fila representa una persona dentro de la misma cuenta y plataforma; nunca fusiona marcas o redes. La identidad pública `contactKey` es un SHA-256 opaco y no revela el ID social.

Acepta `page` y `pageSize` con las mismas reglas de `/api/interactions`. Primero filtra interacciones y luego agrupa el subconjunto resultante; por eso los recuentos representan los mensajes que cumplen los filtros, no necesariamente todo el historial del contacto. La bandeja principal carga el conjunto autorizado sin filtros de servidor y aplica sus filtros sobre los contactos ya agregados.

Como el agrupado recorre todas las interacciones del alcance, las solicitudes con los mismos filtros comparten un único cálculo durante 10 segundos (incluido el que está en curso), de modo que pedir decenas de páginas cuesta un solo cálculo. Cualquier escritura exitosa (`POST`/`PUT`/`PATCH`/`DELETE` con respuesta < 400) y cada sincronización invalidan ese cálculo. El frontend pide como máximo 4 páginas en paralelo.

```ts
type InboxContact = {
  contactKey: string;
  brandId: string;
  accountId: string;
  channel: Interaction["channel"];
  customerName: string;
  customerHandle: string;
  replyTarget?: PublicInboxInteraction; // interacción exacta usada por borrador/respuesta
  latest: {
    id: string;
    text: string;
    direction: "inbound" | "outbound";
    createdAt: string;
    type: "dm" | "comment" | "review";
    status: Interaction["status"];
    contentContext: InteractionContentContext;
    postContext?: {
       postId: string;
       permalink?: string;
       caption?: string;
       thumbnailUrl?: string;
       publishedAt?: string;
    };
  };
  messageCount: number;
  pendingCount: number;
  dmCount: number;
  commentCount: number;
  reviewCount: number;
  threadCount: number;
  assignmentConflict: boolean;
};

type PublicInboxInteraction = Omit<Interaction, "metricoolRef" | "audit" | "internalNotes"> & {
  contentContext: InteractionContentContext;
  postContext?: {
     postId: string;
     permalink?: string;
     caption?: string;
     thumbnailUrl?: string;
     publishedAt?: string;
  };
};

type InteractionContentContext = {
  kind: "text" | "story_reply" | "story_mention" | "reaction" | "attachment" | "unsupported" | "deleted" | "unavailable";
  mediaUrls?: string[]; // HTTPS públicas, sin credenciales, deduplicadas, máximo 4
  permalink?: string;  // HTTPS pública, sin credenciales
  storyId?: string;
};
```

`replyTarget` es el caso inbound abierto más relevante. Si no existe uno, `latest.id` permite abrir el último mensaje en modo lectura. El DTO no expone `metricoolRef`, `audit`, `internalNotes`, `recipient` ni `actorId`; cualquier key conversacional incluida en la evaluación automática también sale hasheada. `contentContext` categoriza adjuntos, historias, reacciones, eliminados y formatos no disponibles sin exponer el payload bruto; sus enlaces se aceptan solo si son HTTPS públicas, sin credenciales ni destinos privados, y pueden expirar en Meta. El contexto público del comentario se entrega como `postContext?: { postId, permalink?, caption?, thumbnailUrl?, publishedAt? }`; no se generan permalink ni fecha cuando Metricool no los proporciona.

Respuesta: `{ data: InboxContact[], pagination: { page, pageSize, total, totalPages }, meta }`.

La ruta por mensaje `/api/interactions` se mantiene para protocolo, exportación y compatibilidad. Las mutaciones continúan dirigiéndose a `replyTarget.id`, nunca a `contactKey`.

### `GET /api/inbox/posts`

Lista publicaciones para Gestión manual. Requiere `accountId`; acepta `channel`, `pendingOnly`, `page` y `pageSize`. El scope de marca se aplica antes de agrupar. `postKey` es una clave SHA-256 opaca derivada de marca, cuenta, canal y publicación; no se usa para mutar interacciones.

```ts
type InboxPost = {
  postKey: string;
  brandId: string;
  accountId: string;
  channel: Interaction["channel"];
  postContext: PublicInboxInteraction["postContext"];
  publishedAt?: string;
  latestCommentAt: string;
  sortAt: string;
  sortSource: "published_at" | "latest_comment_at";
  commentCount: number;       // comentarios inbound
  pendingCount: number;       // inbound new/pending/drafted/escalated
  teamReplyCount: number;
  participantCount: number;
  latestComment: PublicInboxInteraction;
  replyTarget?: PublicInboxInteraction;
};
```

Orden: `sortAt DESC`, usando `publishedAt` cuando existe. Si Metricool no entrega la fecha del post, `sortAt=latestCommentAt` y `sortSource="latest_comment_at"`; el cliente debe mostrarlo como actividad reciente, no como fecha de publicación.

Respuesta: `{ data: InboxPost[], pagination, meta: { ordering: "newest_first", primarySort: "published_at", fallbackSort: "latest_comment_at", pendingOnly, externalWrites: false } }`.

### `GET /api/inbox/posts/:postKey/comments`

Devuelve los comentarios exactos de una publicación autorizada. Acepta `pendingOnly` (por defecto `true`), `page` y `pageSize`.

- Con `pendingOnly=true`, incluye solo comentarios inbound en `new`, `pending`, `drafted` o `escalated`, ordenados del más antiguo al más reciente para priorizar SLA.
- Con `pendingOnly=false`, devuelve el contexto completo disponible de la publicación.
- Cada elemento es un `PublicInboxInteraction`; la respuesta nunca expone `metricoolRef`, actor IDs ni recipient IDs.
- Las acciones posteriores usan `data[i].id` y `data[i].version`, nunca `postKey`.
- Una clave inexistente o fuera del scope responde `404 INBOX_POST_NOT_FOUND` sin revelar su existencia a otro actor.

Respuesta: `{ data: PublicInboxInteraction[], pagination, meta: { post: InboxPost, pendingOnly, ordering: "oldest_first", externalWrites: false } }`.

### `GET /api/interactions/:id`

Devuelve el detalle operativo de un caso. Es la ruta que usa el panel lateral de la bandeja para revisar el mensaje original, editar el borrador, resolver, escalar y mostrar la línea de auditoría.

Respuesta:

```ts
{
  data: Interaction & {
    brandName: string;
    accountHandle: string;
    postContext?: {
       postId: string;
       permalink?: string;
       caption?: string;
       thumbnailUrl?: string;
       publishedAt?: string;
    };
  };
  meta: { demoMode: boolean; mode: "demo" | "live" };
}
```

Campos relevantes para la UI:

- `text`, `category`, `sentiment`, `confidence` y `source` describen el item normalizado.
- `responseText` contiene el último borrador o respuesta registrada, si existe.
- `audit` conserva eventos como ingesta, clasificación, borrador, envío y cambios de estado.
- `brandName` y `accountHandle` son contexto derivado; el cliente no debe usarlos como autorización.
- `postContext` contiene una vista minimizada de la publicación para comentarios cuando el proveedor la entregó. `permalink` y `thumbnailUrl` son opcionales y se validan como HTTPS; `publishedAt` solo existe si el proveedor entregó una fecha válida. Ninguno se reconstruye desde `postId`.
- `contentContext` conserva la categoría y, cuando Metricool la entregó, hasta cuatro URLs HTTPS públicas de medios. Rechaza credenciales, localhost y redes privadas. Un enlace presente no garantiza que Meta siga sirviendo el recurso; la UI debe conservar un fallback legible. Si el proveedor marca el mensaje como eliminado, se descartan texto y enlaces previos y se conserva solo el tombstone.
- El detalle público omite `metricoolRef`; los identificadores de actor, destinatario e hilo quedan exclusivamente del lado servidor.

Si el ID no existe, responde `404 INTERACTION_NOT_FOUND`.

### `GET /api/reports/sac`

Cifras del informe SAC mensual de cada marca activa dentro del alcance del actor (permiso `metrics.read`; con los permisos por defecto, Supervisor y Admin). Solo lectura. Query: `month=AAAA-MM` (obligatorio) y `volumen=gestionado|bruto` (por defecto `gestionado`). Usa los mismos días UTC y el mismo cálculo que `scripts/generate-sac-report.mjs` (`buildSacReport`), con el mes anterior para la variación.

```json
{
  "data": {
    "month": "2026-10", "label": "Octubre 2026", "from": "2026-10-01", "to": "2026-10-31",
    "previous": { "from": "2026-09-01", "to": "2026-09-30" },
    "volumen": "gestionado",
    "brands": [{ "brandId": "...", "brandName": "...", "accountHandle": "@...", "figures": { "casosSac": 0, "volumenBruto": 0, "mensajesGestionados": 0, "ilegibles": 0, "derivados": 0, "respondidos": 0, "coberturaPct": 0, "canales": {}, "privados": 0, "publicos": 0, "motivos": [], "tono": { "positivo": 0, "neutro": 0, "negativo": 0 }, "variacion": { "anterior": 0, "deltaPct": 0, "comparable": true }, "advertencias": [] } }],
    "warnings": ["Cuentas con el mismo usuario: ..."],
    "generatedAt": "2026-11-16T..."
  }
}
```

`variacion` trae `revisar: true` cuando, siendo comparable, cambió ±200 % o más (casi siempre un mes anterior con pocos datos), con su advertencia. Lo decidido por reglas no se repite como advertencia de cada marca: viaja en `clasificacion`. Cada `figures` incluye `clasificacion: { manual, ia, reglas }`: cuántos mensajes entrantes del mes se decidieron como caso o ruido a mano, con IA o por reglas sin IA (reacciones, menciones en historias, emojis sueltos, textos de menos de cuatro palabras e ilegibles no son casos). `brands` viene ordenado por casos SAC de mayor a menor. `warnings` avisa de cuentas activas que apuntan al mismo usuario de red social (sus mensajes se contarían dos veces). `400 VALIDATION_ERROR` con un mes inválido o ausente; `403` sin `metrics.read`. El Excel del mes se descarga con `GET /api/export/xlsx` usando `from=<mes>-01T00:00:00.000Z` y `to=<último día>T23:59:59.999Z`.

### `PUT /api/interactions/:id/triage`

Marca a mano si un mensaje entrante cuenta como caso SAC en el reporte mensual (permiso `inbox.triage`, alcance de marca). Cuerpo `{ esCasoSac: boolean | null, requiereDerivacion?: boolean, expectedVersion }`; `null` quita la marca manual y vuelve a la decisión automática (IA si existe, si no reglas). La marca manual manda sobre la IA y las reglas, queda en `sacTriage` con `modelo: "manual"` y `marcadoPor` (en PostgreSQL, columna `interactions.sac_triage`, migración `0019_manual_records_and_triage.sql`; antes de esa migración la marca no se guardaba en PostgreSQL), y deja una entrada `classified` en la auditoría. No cambia el estado del caso ni escribe en Metricool. Responde el estado del caso más `reportTriage`. `GET /api/interactions/:id` también incluye `reportTriage: { esCasoSac, requiereDerivacion, source: "manual" | "ia" | "reglas", marcadoPor?, clasificadoEn? }`.

### `POST /api/interactions/triage`

Marca en lote, como caso o ruido, todos los mensajes entrantes de las conversaciones elegidas en la Bandeja: `{ contactKeys: string[] (1-200), esCasoSac: boolean }`, permiso `inbox.triage` y alcance de marcas del actor. Los mensajes que alguien ya marcó a mano no se cambian. Responde `{ data: { updated, contacts } }`.

### `GET /api/stats/summary`

Acepta los mismos filtros de interacción salvo `page` y `pageSize`.

La respuesta `data` contiene:

- `generatedAt`, `total`, `dms`, `comments`, `pending`, `replied`, `escalated`;
- `automatedResponses`, `automationEvaluated`, `automationScope`, `autoReplyCandidates`, `humanReviewRequired`, `knowledgeBlocked`, `responseRate` (porcentaje 0–100) y `averageResponseMinutes` (`null` sin datos). La cobertura usa `automationEvaluated / automationScope`, no el total histórico de respuestas ya cerradas.
- `byChannel`, `byStatus` y `byBrand`.

Con contexto de actor, los recuentos se limitan al scope de marca permitido.

### `GET /api/workflow`

Respuesta: `{ data: Workflow, meta }`.

### `PUT /api/workflow`

Acepta uno o más campos:

```json
{
  "enabled": true,
  "pollIntervalMinutes": 5,
  "autoReplyEnabled": false,
  "autoReplyAccountIds": [],
  "minimumConfidence": 0.82,
  "requireHumanFor": ["reclamo", "crisis", "legal", "datos_personales"],
  "businessHoursOnly": false
}
```

Reglas:

- `pollIntervalMinutes`: entero 1–1440.
- `minimumConfidence`: 0–1.
- `autoReplyAccountIds`: máximo 20; cada ID debe pertenecer a una cuenta existente.
- `requireHumanFor`: máximo 30 strings de hasta 50 caracteres.
- `nodes`: 1–100; `edges`: máximo 200.
- Cada edge acepta `connectorType` con uno de estos valores: `smoothstep`, `bezier`, `straight`; si se omite se normaliza a `smoothstep`.
- Si se envían `nodes` y `edges` juntos, cada edge debe referenciar nodos existentes.
- En live, pasar `autoReplyEnabled=true` requiere `confirmAutoReply=true` y una allowlist no vacía; si no, `409 AUTO_REPLY_CONFIRMATION_REQUIRED`.

`confirmAutoReply` no aparece en la respuesta ni queda guardado.

### `POST /api/workflow/run`

Simula el workflow; no llama ni escribe en Metricool.

```json
{
  "accountIds": ["account-01"],
  "sampleSize": 25
}
```

- `accountIds`: opcional, máximo 20; sin valor selecciona todas las cuentas activas.
- `sampleSize`: entero 1–500, default 25.

Respuesta: `{ data: WorkflowRun, meta: { demoMode, mode, simulated: true, externalWrites: false } }`.

Los totales `replied` significan “serían enviados” dentro de esta simulación; el endpoint no los entrega externamente. Si `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true`, los casos allowlisted se cuentan como borradores y el audit trail indica que el cortacorriente bloqueó auto-respuestas.

### `POST /api/sac/protocol/evaluate`

Evalúa casos existentes y persiste solo el resultado local del protocolo: intención/riesgo, contexto conversacional, estado de conocimiento, ventana, ruta, motivos y propuesta. No llama ni escribe en Metricool.

```json
{
  "accountIds": ["account-01"],
  "interactionIds": ["interaction-001"],
  "limit": 200,
  "force": false
}
```

- `accountIds`: opcional, máximo 20 y limitado al scope del actor.
- `interactionIds`: opcional, máximo 200; permite reevaluar una selección concreta.
- `limit`: 1–200, default 200.
- `force=false` omite casos que ya tienen assessment; `force=true` los recalcula con la política actual.
- Solo procesa interacciones inbound en estado `new`, `pending`, `drafted` o `escalated`.

Antes de evaluar, el endpoint reconcilia los hilos que ya tienen un mensaje saliente posterior. Respuesta: `{ data: { interactions, reconciledTeamResponses, evaluated, drafted, escalated, autoReplyCandidates, queuedAutoReplies, queueSkippedCapacity, quarantined }, meta: { externalWrites: false, localWrites, outboundSendsDisabled, autoReplyDispatchMode, queuedAutoReplies, queueSkippedCapacity, autoReplyMaxPending } }`. `reconciledTeamResponses` indica cuántos casos quedaron **Respondidos por el equipo** en esa ejecución. `queuedAutoReplies` informa inserciones realmente persistidas, no solo candidatas. Si la cola alcanza `SAC_FLOW_AUTO_REPLY_MAX_PENDING`, las nuevas candidatas se contabilizan en `queueSkippedCapacity`, permanecen como casos locales y no se envían. La comprobación e inserción del cupo ocurren dentro de la misma sección crítica/transacción; dos instancias no pueden consumir el último cupo a la vez, y una repetición idempotente se reconoce antes de evaluar capacidad. En live exige `Idempotency-Key`. En `shadow`, una candidata segura se conserva como borrador. En `live`, si ambos cortacorrientes permiten mutaciones, la evaluación crea una entrega `pending`; el worker la despacha después usando la misma clave idempotente.

### `POST /api/sync/live`

Lectura en vivo de una cuenta: `{ "accountId": "account-01", "surface": "conversations" | "comments" }`. Requiere `sync.run`. Lee en Metricool solo esa superficie de esa cuenta, con los canales ya conocidos (sin detectar plataformas) y probando primero el proveedor que entregó datos la última vez; guarda lo nuevo, reconcilia respuestas de esa cuenta y evalúa el protocolo SAC de lo nuevo, igual que la sincronización completa. Solo procesa mensajes de las últimas 6 horas (lo anterior lo cubre la sincronización completa del worker) y, si no entró nada nuevo, no reconcilia ni relee la base: una lectura sin novedades tarda lo que tarda Metricool en responder. No usa ni espera el candado de `POST /api/sync`, no exige `Idempotency-Key` (la ingesta es idempotente) y no deja un run en el historial. Corre como mucho una vez cada 10 s por cuenta y superficie aunque la pidan varias personas: dentro de ese lapso, o si ya hay una en curso, responde `skipped: true` con `reason: "recent" | "in_progress"` y `lastAt`. Si no trajo nada nuevo, no avanza la revisión de la bandeja.

Respuesta: `{ data: { skipped, created, replied, errors, checkedAt }, meta: { externalWrites: false } }`. Gestión DMs/comentarios la llama cada 15 s mientras la vista está abierta y visible, y también al pulsar **Actualizar cuenta**.

### `POST /api/sync`

Lee y normaliza DMs/comentarios, deduplica por `(accountId, type, externalId)`, persiste los nuevos items y ejecuta obligatoriamente `sac-v1` antes de registrar el run. El protocolo crea borradores seguros o deriva revisión humana; el sync no envía respuestas a Metricool.

```json
{
  "accountIds": ["account-01"],
  "limit": 5000,
  "since": "2026-08-11T00:00:00.000Z"
}
```

- `accountIds`: opcional, máximo 20; default todas las activas. El worker programado no envía lista y cubre todo el portafolio activo.

En live, cuando el actor tiene alcance a todas las marcas, antes de leer la bandeja la API consulta el catálogo de Metricool (`SAC_FLOW_METRICOOL_AUTO_LINK`, activo por defecto): vincula las marcas nuevas con canales legibles, salvo las de `SAC_FLOW_METRICOOL_EXCLUDED_BLOG_IDS` o ya vinculadas aunque estén desactivadas, y desactiva las marcas de ejemplo del seed sin referencia (esto último también se hace al arrancar la API en live, sin depender del catálogo). Lo registra en el `auditTrail` del run como "Catálogo Metricool" y "Marcas de ejemplo". Si se envió `accountIds`, se quitan las cuentas de ejemplo retiradas (en este ciclo o antes) y se agregan las recién vinculadas. Un fallo del catálogo no detiene la sincronización.
- `limit`: opcional, entero 1–5000. Si se omite, SAC Flow conserva todas las interacciones que entregue la API; cuando se envía funciona como cortafuegos explícito por superficie.
- `since`: fecha ISO opcional.

Respuesta:

```ts
{
  data: {
    run: WorkflowRun;
    newInteractions: Interaction[];
  };
  meta: { demoMode: boolean; mode: "demo" | "live"; externalWrites: false };
}
```

En demo genera dos items ficticios estables por cuenta seleccionada, de modo que una segunda solicitud distinta prueba deduplicación real en vez de inflar el histórico. En live consulta conversaciones, comentarios y reseñas por marca, sigue `page.next` dentro del mismo origen autorizado y deduplica el resultado persistido. Los comentarios de Instagram usan `INSTAGRAM`; para DMs se prueba primero el proveedor configurado y, sólo si falla o viene vacío, el alias alternativo entre `INSTAGRAMBUSINESS` e `INSTAGRAM`. La interacción conserva el proveedor que realmente entregó el mensaje para responder por la misma ruta. Cuando un mensaje entrante tiene un mensaje saliente posterior en el mismo hilo, se reconcilia localmente como `replied`, registra `respondedAt`, elimina cualquier borrador obsoleto y queda fuera de los pendientes del protocolo; la interfaz lo presenta como **Respondido por el equipo**, no como respuesta automática. Un nuevo mensaje entrante posterior vuelve a quedar pendiente. Un **saludo automático** de la cuenta (respuesta instantánea de Meta, mensaje de ausencia o bot) no cierra el caso: cuenta como tal un mensaje saliente cuyo texto la cuenta ya mandó igual en al menos 3 conversaciones y que llegó dentro de los 60 segundos posteriores al mensaje del cliente; se busca la siguiente respuesta real. Si una persona devolvió el caso a pendiente a mano (por ejemplo, con el motivo `reopened`), las respuestas de la cuenta anteriores a ese momento ya no lo cierran, aunque después se guarde un borrador. Un fallo parcial se refleja en `run.status`, `totals.errors` y `auditTrail`; no elimina datos previos. `totals.drafted` y `totals.escalated` reflejan la ejecución local del protocolo.

En live requiere `Idempotency-Key`. Solo se ejecuta una sincronización por proceso API a la vez; otra solicitud concurrente recibe `409 SYNC_IN_PROGRESS` y puede reintentarse después sin perder el estado previo.

### `POST /api/interactions/:id/reply`

```json
{
  "text": "Respuesta revisada por el equipo.",
  "mode": "draft",
  "approvedByHuman": false,
  "confidence": 0.91,
  "expectedVersion": 1
}
```

Reglas de body:

- `text`: 1–1000 caracteres.
- `mode`: `draft` o `send`.
- `approvedByHuman`: default `false`.
- `confidence`: opcional 0–1; si falta, se usa la interacción.
- `expectedVersion`: entero ≥ 1 obligatorio; un valor antiguo devuelve `409 INTERACTION_VERSION_CONFLICT` sin guardar cambios.
- `followUp`: default `false`. Con `mode: "send"` y `approvedByHuman: true`, permite mandar otro mensaje en un **DM ya respondido** (`status: "replied"`), como en un chat: va a la misma conversación, crea una entrega nueva y deja ese texto como `responseText`. No aplica a comentarios (una respuesta por comentario) ni a casos `resolved` (hay que reabrirlos); sin `followUp` un caso respondido sigue respondiendo `409 CASE_ALREADY_CLOSED`. Una entrega en curso o incierta del caso o de la cuenta sigue bloqueando el envío.

Comportamiento:

- Solo admite interacciones `inbound`.
- `draft` guarda localmente y no llama a Metricool.
- Sentimiento negativo, categoría sensible o confianza bajo el umbral requieren `approvedByHuman=true` para `send`.
- En live, un envío no aprobado solo procede si auto-respuesta está activa, la cuenta está allowlisted, el workflow está publicado y el assessment recalculado justo antes de enviar conserva `recommendedRoute=auto_reply`. Conocimiento, ventana, confianza, riesgo y horario deben seguir válidos; no basta con una evaluación antigua.
- En demo, `send` se registra como simulación y no contacta a Metricool.
- En live, DMs usan conversaciones y comentarios usan post-comments en Metricool.
- En live, `mode: "send"` requiere `Idempotency-Key`, salvo que el cortacorriente bloquee el envío antes de cualquier llamada externa.
- Antes de contactar al proveedor se crea una entrega durable. Solo puede existir una entrega `pending`, `sending` o `uncertain` por interacción.
- Un rechazo HTTP 4xx inequívoco queda `failed`. Un timeout, 5xx o excepción ambigua queda `uncertain` y nunca se reintenta automáticamente. En ambos casos, el texto se conserva como borrador local para revisión o conciliación.
- Si `SAC_FLOW_DISABLE_OUTBOUND_SENDS=true`, cualquier `send` responde `423 OUTBOUND_SENDS_DISABLED`; `draft` sigue permitido.
- En live, un envío aprobado por una persona exige `SAC_FLOW_ENABLE_MANUAL_REPLIES=true` o que las mutaciones generales de Metricool estén habilitadas. Si no, responde `423 MANUAL_REPLIES_DISABLED`. La excepción manual no habilita nodos Metricool ni el dispatcher automático.
- Un envío manual aprobado no se bloquea localmente por antigüedad: la API crea la entrega e intenta enviarla a Metricool. Metricool/Meta conservan la autoridad final y un rechazo inequívoco queda registrado como entrega `failed`. La auto-respuesta sí exige que el assessment mantenga una ventana elegible.

Respuesta: `{ data: Interaction, meta: { demoMode, mode, delivery, deliveryId? } }`, donde `delivery` es `draft_saved`, `demo_simulated` o `sent`.

El assessment automático usa `createdAt` del item normalizado para decidir si deriva a revisión humana. En un envío manual, Metricool conserva la autoridad final y puede rechazar la operación por antigüedad, políticas o estado externo.

### Entregas de respuestas

| Método | Ruta | Rol mínimo | Resultado |
|---|---|---|---|
| `GET` | `/api/deliveries?interactionId=&status=` | `agent` | Hasta 500 entregas del scope de marcas, ordenadas por creación descendente |
| `GET` | `/api/deliveries/:id` | `agent` | Estado, versión, intentos, timestamps y errores sanitizados |
| `POST` | `/api/deliveries/:id/reconcile` | `supervisor` | Concilia exclusivamente una entrega `uncertain` |

Estados: `pending`, `sending`, `sent`, `failed`, `uncertain`, `cancelled`, `demo_simulated`. Una entrega `pending` puede incluir `nextAttemptAt`: significa que Metricool respondió `429` de forma explícita y no puede volver a reservarse antes de esa fecha. El worker usa ese valor como cooldown para toda la cuenta sin detener otras marcas. Solo puede existir una entrega `sending` por cuenta; una entrega `uncertain` activa un breaker durable que bloquea nuevos envíos de esa cuenta hasta que un supervisor la concilie. La conciliación recibe `{ outcome: "sent" | "failed" | "cancelled", expectedVersion, note }`; `note` exige 10–2000 caracteres. Confirmar `sent` actualiza el caso como respondido. Las otras salidas conservan el caso sin afirmar que Metricool recibió el mensaje. Toda conciliación agrega auditoría `delivery_reconciled`.

Errores específicos: `DELIVERY_IN_PROGRESS`, `DELIVERY_ALREADY_ACTIVE`, `DELIVERY_DEFERRED`, `DELIVERY_UNCERTAIN`, `DELIVERY_RECONCILIATION_REQUIRED`, `ACCOUNT_DELIVERY_RECONCILIATION_REQUIRED`, `DELIVERY_NOT_RETRYABLE`, `DELIVERY_NOT_RECONCILABLE` y `DELIVERY_RECONCILE_CONFLICT`.

### `PATCH /api/interactions/:id/status`

```json
{
  "status": "resolved",
  "reasonCode": "answered",
  "reasonNote": "Caso cerrado desde la bandeja SAC.",
  "expectedVersion": 3
}
```

Reglas:

- `status`: `pending`, `escalated` o `resolved`.
- `reasonCode`: obligatorio y debe pertenecer al catálogo del estado.
- `reasonNote`: opcional, 2–500 caracteres; obligatorio cuando el motivo es `other`.

El endpoint actualiza el estado local, conserva `statusReason` con código, etiqueta, nota, fecha y actor, agrega auditoría `status_changed` y no llama a Metricool. La UI lo usa para resolver o escalar con razones reportables, y para **Reabrir caso**: `status: "pending"` con `reasonCode: "reopened"` sobre el último mensaje del cliente de un caso cerrado (respondido o resuelto). Desde ese momento el caso admite borrador y respuesta, y la sincronización no lo vuelve a cerrar por respuestas de la cuenta anteriores a la reapertura. Requiere `inbox.triage`.

### `GET /api/status-reasons`

Devuelve los catálogos permitidos para `pending`, `escalated` y `resolved`. Requiere rol `viewer` o superior. La UI consume este endpoint para evitar duplicar reglas operativas en el navegador.

### `PUT /api/interactions/:id/assignment`

Coordina ownership del caso y requiere rol `agent` o superior.

```json
{ "action": "claim", "expectedVersion": 3 }
```

- `claim`: asigna el caso al usuario de la sesión/gateway. Si pertenece a otra persona, devuelve `409 INTERACTION_ALREADY_ASSIGNED`.
- `release`: libera un caso. Un agente solo puede liberar uno asignado a sí mismo; supervisor/admin pueden liberar cualquiera.
- `assign`: requiere supervisor/admin y recibe además `userId` y `displayName` para transferirlo a otra persona.
- Todas las variantes requieren `expectedVersion` y respetan el scope de marca.
- Registra auditoría `assigned`/`unassigned` y no escribe en Metricool.

### `POST /api/interactions/:id/notes`

Agrega una nota visible solo dentro de SAC Flow. Requiere rol `agent` o superior y acceso a la marca.

```json
{
  "text": "Cliente solicita seguimiento del pedido.",
  "expectedVersion": 4
}
```

La nota admite 1–2000 caracteres, registra autor/fecha, aumenta `version` y agrega un evento `note_added` cuya auditoría no repite el texto. Nunca se envía a Metricool. El límite defensivo es 500 notas por caso.

### `GET /api/export/xlsx`

Genera el libro desde las interacciones guardadas por Nodes. Acepta los mismos filtros que `/api/interactions` (`from`, `to`, `brandId`, `accountId`, `channel`, `type`, `status`…) y aplica el alcance de marcas del actor; sin filtros exporta todo el historial. El nombre del archivo refleja la marca y el rango (`sac-flow-<brandId>-<desde>_<hasta>.xlsx`). En la web, **Exportar** (Bandeja SAC y Resumen SAC) abre un diálogo con período (mes pasado por defecto, este mes, últimos 30 días, rango personalizado o todo el historial; límites de mes en la zona horaria del navegador) y marca. Los períodos anteriores a la primera sincronización pueden estar incompletos: Metricool solo entrega lo que aún tiene en su bandeja y no permite consultar rangos pasados.

Headers:

```http
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="sac-flow-YYYY-MM-DD.xlsx"
Cache-Control: no-store
```

Hojas:

- `Interacciones`: una fila por item, 19 columnas, responsable y recuento de notas, autofiltro y fechas formateadas. El contenido de las notas internas no se exporta.
- `Resumen`: totales generales y recuentos por marca.

El endpoint actual no recibe filtros de query, pero sí respeta el scope de marca del actor. Techlab debe aplicar límites, auditoría y expiración si mueve los archivos a object storage.

## Versiones, validación y publicación del workflow

| Método | Ruta | Rol mínimo | Resultado |
|---|---|---|---|
| `GET` | `/api/workflow/versions` | `viewer` | Historial descendente de hasta 50 snapshots |
| `POST` | `/api/workflow/validate` | `viewer` | Errores/warnings de grafo y guardrails |
| `POST` | `/api/workflow/publish` | `admin` | Publica la versión borrador actual |
| `POST` | `/api/workflow/rollback` | `admin` | Crea un borrador nuevo desde un snapshot anterior |

Cada `PUT /api/workflow` incrementa `version` y conserva `publishedVersion`. El autoenvío no automatizado por un humano solo es elegible cuando ambas versiones coinciden. Publicar falla con `WORKFLOW_INVALID` si existe un ciclo, conexión huérfana, nodo/ruta obligatoria faltante, allowlist insegura o ausencia de revisión humana obligatoria.

```json
POST /api/workflow/publish
{ "changeNote": "UAT de cuenta piloto aprobado", "confirmAutoReply": false }

POST /api/workflow/rollback
{ "version": 2, "changeNote": "Restaurar configuración estable" }
```

## Ejecuciones y reintentos

| Método | Ruta | Rol mínimo | Resultado |
|---|---|---|---|
| `GET` | `/api/executions?kind=sync&status=failed&page=1&pageSize=25` | `viewer` | Lista paginada y filtrada dentro del scope de marcas |
| `GET` | `/api/executions/:id` | `viewer` | Totales, versión, cuentas y audit trail |
| `POST` | `/api/executions/:id/retry` | `agent` | Nueva ejecución con `retryOf` |

En live, el reintento exige `Idempotency-Key`. La sincronización reutiliza el pipeline real y conserva aislamiento por cuenta/proveedor. La simulación se ejecuta con la versión actual; ejecutar exactamente el snapshot histórico es una mejora P1 documentada.

## Operación de la cola durable

| Método | Ruta | Rol mínimo | Resultado |
|---|---|---|---|
| `GET` | `/api/jobs?status={status}` | `supervisor` | Lista hasta 250 jobs recientes por estado: `queued`, `running`, `retry`, `succeeded` o `dead` |
| `POST` | `/api/jobs/:id/retry` | `admin` | Reencola manualmente un job `dead` o `retry` |

El worker reclama jobs en PostgreSQL con lease y `FOR UPDATE SKIP LOCKED`, recupera leases vencidos y aplica backoff exponencial hasta el estado terminal `dead`. JSON y PostgreSQL ordenan el listado por creación descendente y aplican el mismo límite defensivo. Automation Studio consulta `dead` y `retry` desde `Ejecuciones`: supervisor puede inspeccionar y administrador puede confirmar un reintento. Su probe no público escucha `GET /health` en `SAC_FLOW_WORKER_HEALTH_PORT` (por defecto `8788`) y solo responde `200` después de inicializar el repositorio; Compose lo usa para declarar el proceso saludable. En live, el reintento manual exige `Idempotency-Key`.

## Auditoría de seguridad

`GET /api/security/audit` requiere `admin` y devuelve checks `pass|warning|fail`, score, readiness y remediaciones. No incluye claves, token Metricool, `userId`, `blogId`, texto de mensajes ni PII.

## Códigos de error conocidos

| HTTP | `code` | Cuándo |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Query/body/params/header inválidos |
| 400 | `UNKNOWN_ACCOUNTS` | Cuenta inexistente/inactiva o allowlist inválida |
| 400 | `INVALID_DATE_RANGE` | `from > to` |
| 400 | `INVALID_WORKFLOW_GRAPH` | Edge referencia nodo inexistente |
| 401 | `ACTOR_CONTEXT_REQUIRED` | Falta contexto `X-SAC-*` requerido por gateway |
| 403 | `FORBIDDEN` | Rol insuficiente o marca fuera del scope permitido |
| 409 | `BRAND_ALREADY_EXISTS` | Ya existe una marca con ese id |
| 409 | `ACCOUNT_ALREADY_EXISTS` | Ya existe una cuenta con ese id |
| 409 | `ACCOUNT_HANDLE_ALREADY_EXISTS` | Ya existe una cuenta con ese handle |
| 404 | `ACCOUNT_NOT_FOUND` | ID de cuenta no existe |
| 404 | `INTERACTION_NOT_FOUND` | ID de interacción no existe |
| 404 | `EXECUTION_NOT_FOUND` | ID de ejecución no existe |
| 404 | `WORKFLOW_VERSION_NOT_FOUND` | Versión solicitada no existe |
| 404 | `NOT_FOUND` | Ruta inexistente |
| 409 | `JOB_NOT_RETRYABLE` | Job inexistente o fuera de estado `dead`/`retry` |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Key reutilizada con payload diferente |
| 409 | `IDEMPOTENCY_IN_PROGRESS` | La misma operación idempotente todavía está en curso |
| 409 | `SYNC_IN_PROGRESS` | Ya existe una sincronización de bandeja en curso |
| 409 | `INTERACTION_VERSION_CONFLICT` | El caso cambió desde la versión enviada |
| 409 | `INTERACTION_ALREADY_ASSIGNED` | Otro agente ya tomó el caso |
| 409 | `INTERACTION_NOT_ASSIGNED` | Se intentó liberar un caso sin responsable |
| 409 | `INTERNAL_NOTE_LIMIT_REACHED` | El caso alcanzó el límite defensivo de notas |
| 409 | `AUTO_REPLY_CONFIRMATION_REQUIRED` | Activación live sin confirmación/allowlist |
| 409 | `WORKFLOW_INVALID` | Publicación bloqueada por errores de validación |
| 409 | `INVALID_DIRECTION` | Intento de responder un item saliente |
| 409 | `CASE_ALREADY_CLOSED` | El caso ya fue respondido o resuelto (también al intentar guardar un borrador sobre él) |
| 403 | `HUMAN_APPROVAL_REQUIRED` | La clave interna de servicio intentó enviar con `approvedByHuman: true` |
| 403 | `ADMIN_REQUIRED` | Un cambio, publicación o vuelta a una versión anterior del flujo activa o amplía el envío automático (lo enciende, suma cuentas o baja la confianza mínima) sin ser admin |
| 403 | `HTTPS_REQUIRED` | Mutación recibida por HTTP detrás del proxy con `SAC_FLOW_FORCE_HTTPS` (las lecturas GET/HEAD se redirigen con 301) |
| 403 | `CROSS_SITE_WEBHOOK` | Webhook disparado desde otro sitio (`Sec-Fetch-Site: cross-site`) |
| 409 | `BRAND_NOT_FOUND` | Marca asociada ya no existe |
| 409 | `HUMAN_REVIEW_REQUIRED` | Caso sensible sin aprobación humana |
| 409 | `SEND_NOT_ALLOWED` | Live sin aprobación ni auto-send autorizado |
| 409 | `ACCOUNT_DELIVERY_RECONCILIATION_REQUIRED` | Breaker activo por una entrega incierta de la misma cuenta |
| 423 | `OUTBOUND_SENDS_DISABLED` | Cortacorriente de envíos activo; solo borradores |
| 423 | `MANUAL_REPLIES_DISABLED` | Respuestas reales aprobadas por una persona desactivadas en el entorno |
| 423 | `METRICOOL_MUTATIONS_DISABLED` | Mutaciones Metricool bloqueadas durante desarrollo/UAT |
| 428 | `IDEMPOTENCY_KEY_REQUIRED` | Operación live sin key idempotente |
| 422 | `ACCOUNT_NOT_CONFIGURED` | Faltan `userId`/`blogId` para la cuenta |
| 422 | `METRICOOL_RECIPIENT_MISSING` | DM histórico sin `recipient`; requiere resincronización |
| 400 | `INVALID_STATUS_REASON` | El motivo no corresponde al estado solicitado |
| 400 | `STATUS_REASON_NOTE_REQUIRED` | El motivo `other` requiere nota |
| 403 | `ORIGIN_NOT_ALLOWED` | Mutación originada en un sitio no autorizado |
| 403 | `MASTER_ADMIN_REQUIRED` | Acción solo de admin principal (`SAC_FLOW_AUTH_ADMIN_EMAILS`): ocultar o mostrar clientes, dar el rol Admin, editar roles |
| 409 | `BRAND_INACTIVE` | La marca está oculta (integración METRIQ, carga manual) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | La carga manual no llegó como archivo `.xlsx` |
| 422 | `MANUAL_RECORDS_FORMAT_INVALID` | El Excel de la carga manual no se pudo leer o no tiene las columnas de la planilla BD SAC |
| 429 | `RATE_LIMITED` | Límite de solicitudes excedido |
| 429 | `DELIVERY_DEFERRED` | Entrega esperando su `nextAttemptAt` |
| 429 | `METRICOOL_RATE_LIMITED` | 429 explícito; entrega durable reprogramada según `Retry-After` |
| 429 | `METRICOOL_RATE_LIMIT_RETRIES_EXHAUSTED` | Cinco intentos 429 agotados; requiere revisión |
| 502 | `METRICOOL_ERROR` | Metricool rechaza la operación |
| 503 | `METRICOOL_NOT_CONFIGURED` | Live sin cliente/configuración disponible |
| 500 | `INTERNAL_ERROR` | Error no controlado |

## Contrato Metricool detrás de la API

El navegador nunca llama estos endpoints. El adaptador servidor usa la base `https://app.metricool.com/api`, cabecera `X-Mc-Auth`, query `userId`/`blogId` y:

- `GET /v2/inbox/conversations` con `provider` para DMs;
- `GET /v2/inbox/post-comments` con `provider` para comentarios;
- `POST /v2/inbox/conversations` con `conversationId`, `provider`, `recipient` y `text`;
- `POST /v2/inbox/post-comments` con `objectId`, `provider` y `text`.

El normalizador expande `Conversation.messages[]` y `PostCommentsThread.root/comments[]`. El formato externo pertenece a Metricool y puede evolucionar; el modelo `Interaction` es la frontera estable de SAC Flow. La evidencia, fecha y límites verificados están en [METRICOOL_API_VERIFICATION.md](./METRICOOL_API_VERIFICATION.md).

## Cambios necesarios en Techlab

Antes de declarar v1:

- agregar autenticación y autorización por tenant/marca;
- reemplazar cabeceras temporales `X-SAC-*` por sesión OIDC/BFF validada;
- versionar ruta o publicar OpenAPI generado y pruebas de contrato;
- conservar idempotencia obligatoria para envíos y validar sus garantías contra PostgreSQL real;
- propagar `X-Request-Id` desde gateway hacia workers/trazas sin incluir PII;
- separar readiness de liveness;
- migrar la referencia local `userId`/`blogId` a PostgreSQL/secret manager con auditoría administrativa;
- cubrir el guard local 24 h/7 días con pruebas de reloj/bordes y monitorear rechazos adicionales del proveedor;
- usar PostgreSQL administrado y validar la tabla durable de idempotencia/auditoría bajo fallos reales;
- limitar y auditar exportaciones;
- decidir política de paginación/cursor para volumen real.
