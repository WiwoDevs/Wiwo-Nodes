import { z } from "zod";
import {
  CHANNELS,
  METRICOOL_CHANNELS,
  INTERACTION_STATUSES,
  INTERACTION_TYPES,
  METRICOOL_INSTAGRAM_PROVIDERS,
  SENTIMENTS,
} from "./types.js";

const optionalDate = z.string().trim().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Debe ser una fecha ISO válida.",
).optional();

export const interactionFiltersSchema = z.object({
  brandId: z.string().trim().min(1).optional(),
  accountId: z.string().trim().min(1).optional(),
  channel: z.enum(CHANNELS).optional(),
  type: z.enum(INTERACTION_TYPES).optional(),
  status: z.enum(INTERACTION_STATUSES).optional(),
  sentiment: z.enum(SENTIMENTS).optional(),
  assignment: z.enum(["assigned", "unassigned"]).optional(),
  assigneeId: z.string().trim().min(1).max(120).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  from: optionalDate,
  to: optionalDate,
}).strict();

/** Bandeja en vivo: contactos que cambiaron desde una revisión. */
export const inboxChangesQuerySchema = z.object({
  since: z.string().trim().min(3).max(64),
}).strict();

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Integración METRIQ: reporte o Excel de un mes, de todas las marcas o de una. */
export const integrationMonthQuerySchema = z.object({
  month: z.string().trim().regex(MONTH_KEY, "month debe ser AAAA-MM."),
  brandId: z.string().trim().min(1).max(120).optional(),
  volumen: z.enum(["gestionado", "bruto"]).default("gestionado"),
}).strict();

/** Integración METRIQ: totales por mes de un rango (máximo 24 meses). */
export const integrationTotalsQuerySchema = z.object({
  from: z.string().trim().regex(MONTH_KEY, "from debe ser AAAA-MM."),
  to: z.string().trim().regex(MONTH_KEY, "to debe ser AAAA-MM."),
  brandId: z.string().trim().min(1).max(120).optional(),
}).strict().refine((value) => value.from <= value.to, { message: "El rango de meses está invertido." })
  .refine((value) => {
    const months = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7));
    return months(value.to) - months(value.from) < 24;
  }, { message: "El rango no puede superar 24 meses." });

/** Reporte mensual: mes YYYY-MM y qué cuenta como volumen. */
export const sacMonthlyReportQuerySchema = z.object({
  month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Usa el formato AAAA-MM."),
  volumen: z.enum(["gestionado", "bruto"]).default("gestionado"),
}).strict();

/** Error de la interfaz informado por el navegador (pantalla de recuperación). Sin datos de clientes. */
export const clientErrorSchema = z.object({
  message: z.string().max(500),
  name: z.string().max(80).optional(),
  stack: z.string().max(2_000).optional(),
  componentStack: z.string().max(2_000).optional(),
  view: z.string().max(60).optional(),
  path: z.string().max(200).optional(),
}).strict();

export const aiDraftBodySchema = z.object({
  /** Fuerza una sugerencia nueva aunque haya una reciente para el mismo contexto. */
  regenerate: z.boolean().optional(),
}).strict();

export const aiAgreementQuerySchema = z.object({
  month: z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Usa el formato AAAA-MM."),
  brandId: z.string().trim().min(1).max(120).optional(),
}).strict();

export const interactionListQuerySchema = interactionFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

// La web descarga toda la bandeja para Inicio y Bandeja SAC: páginas de hasta 1000 contactos
// para no hacer decenas de peticiones (cada una vuelve a leer el catálogo).
export const inboxContactListQuerySchema = interactionFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});

const queryBooleanSchema = z.union([
  z.boolean(),
  z.enum(["true", "false"]).transform((value) => value === "true"),
]);

export const inboxPostListQuerySchema = z.object({
  accountId: z.string().trim().min(1).max(100),
  channel: z.enum(CHANNELS).optional(),
  pendingOnly: queryBooleanSchema.default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
}).strict();

export const inboxPostCommentsQuerySchema = z.object({
  pendingOnly: queryBooleanSchema.default(true),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

export const inboxPostParamsSchema = z.object({
  postKey: z.string().trim().length(43).regex(/^[A-Za-z0-9_-]+$/),
}).strict();

const idSchema = z.string().trim().min(2).max(80).regex(
  /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
  "Use minúsculas, números y guiones; no comience ni termine con guion.",
);

const colorSchema = z.string().trim().regex(
  /^#[0-9A-Fa-f]{6}$/,
  "Use un color hexadecimal de 6 dígitos, por ejemplo #2563eb.",
);

const handleSchema = z.string().trim().min(2).max(80).regex(
  /^@?[A-Za-z0-9._-]+$/,
  "Use un handle válido, opcionalmente comenzando con @.",
).transform((value) => value.startsWith("@") ? value : `@${value}`);

export const brandParamsSchema = z.object({
  brandId: z.string().trim().min(1).max(100),
}).strict();

/** Ocultar (true) o volver a mostrar (false) un cliente. */
export const brandVisibilitySchema = z.object({
  hidden: z.boolean(),
}).strict();

/** Redes de la cuenta que se usan hoy en SAC (lista vacía: la cuenta no se usa en SAC). */
export const brandSacUsageSchema = z.object({
  channels: z.array(z.enum(METRICOOL_CHANNELS)).max(METRICOOL_CHANNELS.length),
}).strict();

const isoDay = z.string().trim().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Usa el formato AAAA-MM-DD.");

/** Mensajes recibidos del tablero de Clientes: días UTC inclusive, como Reportes (máx. 366 días). */
export const messageVolumeQuerySchema = z.object({
  from: isoDay,
  to: isoDay,
}).strict().refine((value) => value.from <= value.to, { message: "La fecha inicial no puede ser posterior a la final.", path: ["from"] })
  .refine((value) => Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) <= 365 * 86_400_000, {
    message: "El período no puede superar un año.",
    path: ["to"],
  });

/** Carga manual del Excel BD SAC: red por defecto para filas sin "Plataforma" y si solo se revisa. */
export const manualRecordsQuerySchema = z.object({
  red: z.enum(["tiktok", "linkedin"]).optional(),
  dryRun: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  archivo: z.string().trim().max(200).optional(),
}).strict();

export const brandWorkbookUpdateSchema = z.object({
  spreadsheetUrl: z.string().trim().url().max(500),
}).strict();

export const brandQaWorkbookUpdateSchema = z.object({
  spreadsheetUrl: z.string().trim().url().max(500),
}).strict();

const httpsResourceUrlSchema = z.string().trim().url().max(1_000).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "El archivo debe usar un enlace HTTPS.");

export const brandResourceCreateSchema = z.object({
  name: z.string().trim().min(2).max(160),
  url: httpsResourceUrlSchema,
  kind: z.enum(["records", "qa", "brand_guide", "policy", "asset", "other"]),
}).strict();

export const brandResourceParamsSchema = brandParamsSchema.extend({
  resourceId: z.string().uuid(),
});

export const brandCreateSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(2).max(120),
  color: colorSchema.default("#2563eb"),
  active: z.boolean().default(true),
  accountId: idSchema.optional(),
  accountName: z.string().trim().min(2).max(120).optional(),
  accountHandle: handleSchema,
  channels: z.array(z.enum(METRICOOL_CHANNELS)).min(1).max(METRICOOL_CHANNELS.length).default(["instagram", "facebook"]),
  accountActive: z.boolean().optional(),
}).strict();

export const brandUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  color: colorSchema.optional(),
  active: z.boolean().optional(),
  accountName: z.string().trim().min(2).max(120).optional(),
  accountHandle: handleSchema.optional(),
  channels: z.array(z.enum(METRICOOL_CHANNELS)).min(1).max(METRICOOL_CHANNELS.length).optional(),
  accountActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Debe enviar al menos un campo para actualizar.",
});

const nodeConfigValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
]);

const workflowNodeSchema = z.object({
  id: z.string().trim().min(1).max(100),
  type: z.enum([
    "schedule",
    "metricool",
    "normalize",
    "deduplicate",
    "classify",
    "guardrail",
    "reply",
    "excel",
    "escalate",
  ]),
  label: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
  config: z.record(z.string(), nodeConfigValueSchema),
}).strict();

const workflowEdgeSchema = z.object({
  id: z.string().trim().min(1).max(100),
  source: z.string().trim().min(1).max(100),
  target: z.string().trim().min(1).max(100),
  label: z.string().trim().max(100).optional(),
  connectorType: z.enum(["smoothstep", "bezier", "straight"]).default("smoothstep"),
}).strict();

export const workflowUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  pollIntervalMinutes: z.number().int().min(5).max(1_440).optional(),
  autoReplyEnabled: z.boolean().optional(),
  autoReplyAccountIds: z.array(z.string().trim().min(1)).max(20).optional(),
  minimumConfidence: z.number().min(0).max(1).optional(),
  requireHumanFor: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  businessHoursOnly: z.boolean().optional(),
  nodes: z.array(workflowNodeSchema).min(1).max(100).optional(),
  edges: z.array(workflowEdgeSchema).max(200).optional(),
  confirmAutoReply: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Debe enviar al menos un campo para actualizar.",
});

export const workflowRunSchema = z.object({
  accountIds: z.array(z.string().trim().min(1)).max(20).optional(),
  sampleSize: z.number().int().min(1).max(500).default(25),
}).strict().default({ sampleSize: 25 });

export const sacProtocolRunSchema = z.object({
  accountIds: z.array(z.string().trim().min(1)).max(20).optional(),
  interactionIds: z.array(z.string().trim().min(1).max(100)).max(200).optional(),
  limit: z.number().int().min(1).max(200).default(200),
  force: z.boolean().default(false),
}).strict().default({ limit: 200, force: false });

export const workflowPublishSchema = z.object({
  changeNote: z.string().trim().min(3).max(500).optional(),
  confirmAutoReply: z.boolean().default(false),
}).strict().default({ confirmAutoReply: false });

export const workflowRollbackSchema = z.object({
  version: z.number().int().min(1),
  changeNote: z.string().trim().min(3).max(500).optional(),
}).strict();

export const executionListQuerySchema = z.object({
  kind: z.enum(["simulation", "sync"]).optional(),
  status: z.enum(["success", "partial", "failed"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const executionParamsSchema = z.object({
  id: z.string().uuid(),
}).strict();

export const jobListQuerySchema = z.object({
  status: z.enum(["queued", "running", "retry", "succeeded", "dead"]).optional(),
}).strict();

export const jobParamsSchema = z.object({
  id: z.string().uuid(),
}).strict();

export const syncSchema = z.object({
  accountIds: z.array(z.string().trim().min(1)).max(20).optional(),
  limit: z.number().int().min(1).max(5_000).optional(),
  since: optionalDate,
}).strict().default({});

/** Lectura en vivo de una cuenta: DMs o comentarios. */
export const liveSyncSchema = z.object({
  accountId: z.string().trim().min(1).max(120),
  surface: z.enum(["conversations", "comments"]),
}).strict();

export const replySchema = z.object({
  text: z.string().trim().max(1_000),
  mode: z.enum(["draft", "send"]),
  approvedByHuman: z.boolean().default(false),
  confidence: z.number().min(0).max(1).optional(),
  expectedVersion: z.number().int().min(1),
  /** Seguir escribiendo en un DM ya respondido (como en un chat). Solo con `mode: "send"`. */
  followUp: z.boolean().default(false),
  /** Solo WhatsApp: archivo subido antes con `POST /api/whatsapp/media`. */
  attachmentKey: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  /** Solo WhatsApp: citar el mensaje del cliente al responder. */
  quote: z.boolean().default(false),
}).strict().refine(
  // Sin adjunto el texto es obligatorio; con adjunto puede ir vacío (el archivo es el mensaje).
  (value) => value.text.length > 0 || Boolean(value.attachmentKey && value.mode === "send"),
  { message: "Escribe una respuesta.", path: ["text"] },
);

export const replyDeliveryParamsSchema = z.object({
  id: z.string().uuid(),
}).strict();

export const replyDeliveryListQuerySchema = z.object({
  interactionId: z.string().trim().min(1).max(100).optional(),
  status: z.enum(["pending", "sending", "sent", "failed", "uncertain", "cancelled", "demo_simulated"]).optional(),
}).strict();

export const replyDeliveryReconcileSchema = z.object({
  outcome: z.enum(["sent", "failed", "cancelled"]),
  expectedVersion: z.number().int().min(1),
  note: z.string().trim().min(10).max(2_000),
}).strict();

export const interactionStatusUpdateSchema = z.object({
  status: z.enum(["pending", "escalated", "resolved"]),
  reasonCode: z.string().trim().min(2).max(80).regex(/^[a-z0-9_]+$/),
  reasonNote: z.string().trim().min(2).max(500).optional(),
  expectedVersion: z.number().int().min(1),
}).strict();

export const interactionAssignmentSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("claim"),
    expectedVersion: z.number().int().min(1),
  }).strict(),
  z.object({
    action: z.literal("release"),
    expectedVersion: z.number().int().min(1),
  }).strict(),
  z.object({
    action: z.literal("assign"),
    expectedVersion: z.number().int().min(1),
    userId: z.string().trim().min(1).max(120),
    displayName: z.string().trim().min(1).max(120),
  }).strict(),
]);

/** Marca a mano si un mensaje es caso SAC (para el reporte). `esCasoSac: null` quita la marca manual. */
export const interactionTriageSchema = z.object({
  esCasoSac: z.boolean().nullable(),
  requiereDerivacion: z.boolean().default(false),
  expectedVersion: z.number().int().min(1),
}).strict();

/** Marca en lote las conversaciones seleccionadas en la Bandeja (todos sus mensajes entrantes). */
export const interactionBulkTriageSchema = z.object({
  contactKeys: z.array(z.string().trim().min(1).max(200)).min(1).max(200),
  esCasoSac: z.boolean(),
}).strict();

export const interactionNoteCreateSchema = z.object({
  text: z.string().trim().min(1).max(2_000),
  expectedVersion: z.number().int().min(1),
}).strict();

export const interactionDraftDeleteSchema = z.object({
  expectedVersion: z.number().int().min(1),
}).strict();

export const interactionConversationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  scope: z.enum(["thread", "contact"]).default("thread"),
}).strict();

export const accountParamsSchema = z.object({
  accountId: z.string().trim().min(1).max(100),
}).strict();

export const accountMetricoolUpdateSchema = z.object({
  userId: z.union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().trim().min(1).max(120)),
  blogId: z.union([z.string(), z.number()])
    .transform(String)
    .pipe(z.string().trim().min(1).max(120)),
  instagramProvider: z.enum(METRICOOL_INSTAGRAM_PROVIDERS).default("INSTAGRAMBUSINESS"),
}).strict();

export const interactionParamsSchema = z.object({
  id: z.string().trim().min(1).max(100),
}).strict();

export const idempotencyKeySchema = z.string().trim().min(8).max(200).regex(
  /^[A-Za-z0-9._:-]+$/,
  "Idempotency-Key contiene caracteres no permitidos.",
);
export const apiSessionSchema = z.object({
  apiKey: z.string().trim().min(16).max(512),
}).strict();

/** Parámetros con los que Google vuelve al callback de OAuth. */
export const googleCallbackQuerySchema = z.object({
  code: z.string().max(2048).optional(),
  state: z.string().max(512).optional(),
  error: z.string().max(256).optional(),
}).passthrough();

/** Inicio de sesión del modo de prueba local (SAC_FLOW_AUTH_MODE=dev). */
export const userAccessRoleSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** Rol asignado; null quita la asignación y vuelve a la regla del servidor. */
  role: z.string().trim().min(1).max(80).nullable(),
}).strict();

export const discardNoiseSchema = z.object({
  accountId: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["dm", "comment"]).optional(),
  /** Solo los comentarios abiertos de una publicación (Gestión comentarios). */
  postKey: z.string().trim().min(1).max(500).optional(),
  /** Incluir lo que solo la IA marcó como posible spam (las reglas siempre se incluyen). */
  includeAi: z.boolean().default(true),
  /** true: solo cuenta lo que se descartaría, sin escribir. */
  dryRun: z.boolean().default(true),
}).strict();

export const archiveExpiredSchema = z.object({
  accountId: z.string().trim().min(1).max(120).optional(),
  type: z.enum(["dm", "comment"]).optional(),
  /** true: solo cuenta lo que se archivaría, sin escribir. */
  dryRun: z.boolean().default(true),
}).strict();

export const userPermissionsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  /** Permisos que debe tener la persona; null quita sus ajustes y vuelve a los de su rol. */
  permissions: z.array(z.string().max(60)).max(40).nullable(),
}).strict();

/** Clientes ocultos para una persona (solo admin principal); lista vacía = ve todos. */
export const userHiddenBrandsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  brandIds: z.array(z.string().trim().min(1).max(100)).max(500),
}).strict();

/** Hasta cuándo leyó la persona sus notificaciones de la campana. */
export const notificationsSeenSchema = z.object({
  seenAt: z.string().trim().refine((value) => Number.isFinite(Date.parse(value)), "Debe ser una fecha ISO válida."),
}).strict();

/** Activa o apaga WhatsApp para una persona (solo admin principal). */
export const userWhatsAppSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  enabled: z.boolean(),
}).strict();

export const accessRoleIdParamsSchema = z.object({
  roleId: z.string().trim().min(1).max(80),
}).strict();

const rolePermissionsSchema = z.array(z.string().max(60)).max(40);

export const accessRoleCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  baseRole: z.enum(["viewer", "agent", "supervisor"]),
  permissions: rolePermissionsSchema,
}).strict();

export const accessRoleUpdateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  permissions: rolePermissionsSchema,
}).strict();

export const devPasswordSessionSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
}).strict();

/** Consulta de filas SAC para METRIQ. Las fechas son días completos, no instantes. */
export const sacRowsQuerySchema = z.object({
  brandId: z.string().trim().min(1).max(120),
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "from debe ser YYYY-MM-DD.").optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "to debe ser YYYY-MM-DD.").optional(),
  /** "true" agrega el ruido social (reacciones, menciones); por defecto solo casos SAC. */
  incluirRuido: z.enum(["true", "false"]).optional(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: "El rango de fechas está invertido.",
});

/** Alta de marcas locales desde el catálogo real de Metricool. */
export const metricoolBrandImportSchema = z.object({
  blogIds: z.array(z.string().trim().min(1).max(64)).min(1).max(100),
  instagramProvider: z.enum(METRICOOL_INSTAGRAM_PROVIDERS).default("INSTAGRAM"),
  color: colorSchema.default("#2563eb"),
  active: z.boolean().default(true),
}).strict();
