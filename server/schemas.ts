import { z } from "zod";
import {
  CHANNELS,
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

export const interactionListQuerySchema = interactionFiltersSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const inboxContactListQuerySchema = interactionListQuerySchema;

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
  channels: z.array(z.enum(CHANNELS)).min(1).max(CHANNELS.length).default(["instagram", "facebook"]),
  accountActive: z.boolean().optional(),
}).strict();

export const brandUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  color: colorSchema.optional(),
  active: z.boolean().optional(),
  accountName: z.string().trim().min(2).max(120).optional(),
  accountHandle: handleSchema.optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).max(CHANNELS.length).optional(),
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

export const replySchema = z.object({
  text: z.string().trim().min(1).max(1_000),
  mode: z.enum(["draft", "send"]),
  approvedByHuman: z.boolean().default(false),
  confidence: z.number().min(0).max(1).optional(),
  expectedVersion: z.number().int().min(1),
}).strict();

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
