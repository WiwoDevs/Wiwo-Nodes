import type { AutomationState } from "./automation-types.js";

export const CHANNELS = [
  "instagram",
  "facebook",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "google_business",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const METRICOOL_INSTAGRAM_PROVIDERS = ["INSTAGRAMBUSINESS", "INSTAGRAM"] as const;
export type MetricoolInstagramProvider = (typeof METRICOOL_INSTAGRAM_PROVIDERS)[number];

export const METRICOOL_INBOX_PROVIDERS = [
  "INSTAGRAMBUSINESS",
  "INSTAGRAM",
  "TWITTER",
  "FACEBOOK",
  "GMB",
  "TIKTOKBUSINESS",
  "YOUTUBE",
  "LINKEDIN",
] as const;
export type MetricoolInboxProvider = (typeof METRICOOL_INBOX_PROVIDERS)[number];

export const INTERACTION_TYPES = ["dm", "comment", "review"] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

export const INTERACTION_CONTENT_KINDS = [
  "text",
  "story_reply",
  "story_mention",
  "reaction",
  "attachment",
  "unsupported",
  "deleted",
  "unavailable",
] as const;
export type InteractionContentKind = (typeof INTERACTION_CONTENT_KINDS)[number];

export interface InteractionContentContext {
  kind: InteractionContentKind;
  mediaUrls?: string[];
  permalink?: string;
  storyId?: string;
}

export const INTERACTION_STATUSES = [
  "new",
  "pending",
  "drafted",
  "replied",
  "escalated",
  "resolved",
] as const;
export type InteractionStatus = (typeof INTERACTION_STATUSES)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const SAC_AUTOMATION_ROUTES = [
  "auto_reply",
  "draft",
  "human_review",
  "quarantine",
  "ignore",
] as const;
export type SacAutomationRoute = (typeof SAC_AUTOMATION_ROUTES)[number];

export type SacKnowledgeStatus =
  | "approved"
  | "missing"
  | "live_source_required"
  | "not_required";

export interface SacApprovedAnswer {
  id: string;
  intent: string;
  answer: string;
  sourceLabel: string;
  verifiedAt: string;
  expiresAt?: string;
  channels?: Channel[];
  interactionTypes?: InteractionType[];
}

export interface BrandSacPolicy {
  enabled: boolean;
  locale: string;
  tone: string;
  timeZone: string;
  businessHours?: Partial<Record<
    "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday",
    { start: string; end: string } | null
  >>;
  approvedAnswers: SacApprovedAnswer[];
}

export interface SacAutomationAssessment {
  protocolVersion: "sac-v1";
  evaluatedAt: string;
  intent: string;
  risk: "low" | "medium" | "high" | "critical";
  classificationConfidence: number;
  knowledge: {
    status: SacKnowledgeStatus;
    sourceIds: string[];
  };
  conversation: {
    key: string;
    messageCount: number;
    inboundCount: number;
    outboundCount: number;
    continuation: boolean;
  };
  replyWindow: {
    eligible: boolean;
    expiresAt: string;
  };
  recommendedRoute: SacAutomationRoute;
  effectiveRoute: SacAutomationRoute;
  reasonCodes: string[];
  proposal?: {
    text: string;
    templateId: string;
    sourceIds: string[];
  };
}

export const ACTOR_ROLES = ["viewer", "agent", "supervisor", "admin"] as const;
export type ActorRole = (typeof ACTOR_ROLES)[number];

export interface ActorContext {
  userId: string;
  displayName: string;
  tenantId: string;
  role: ActorRole;
  brandIds: string[] | "all";
  source: "local" | "trusted_headers";
}

export interface MetricoolAccountReference {
  userId: string;
  blogId: string;
  instagramProvider?: MetricoolInstagramProvider;
}

export type MetricoolInboxSurface = "conversations" | "comments" | "reviews";

export function metricoolProviderForChannel(
  channel: Channel,
  account: MetricoolAccountReference,
): MetricoolInboxProvider {
  if (channel === "instagram") return account.instagramProvider || "INSTAGRAMBUSINESS";
  if (channel === "facebook") return "FACEBOOK";
  if (channel === "x") return "TWITTER";
  if (channel === "tiktok") return "TIKTOKBUSINESS";
  if (channel === "youtube") return "YOUTUBE";
  if (channel === "linkedin") return "LINKEDIN";
  return "GMB";
}

export function metricoolProviderForSurface(
  channel: Channel,
  surface: MetricoolInboxSurface,
  account: MetricoolAccountReference,
): MetricoolInboxProvider {
  // Metricool expone los comentarios de Instagram bajo INSTAGRAM, mientras
  // que los mensajes directos de cuentas profesionales usan INSTAGRAMBUSINESS.
  if (channel === "instagram" && surface === "comments") return "INSTAGRAM";
  return metricoolProviderForChannel(channel, account);
}

export function channelForMetricoolProvider(provider: MetricoolInboxProvider): Channel {
  if (provider === "INSTAGRAM" || provider === "INSTAGRAMBUSINESS") return "instagram";
  if (provider === "FACEBOOK") return "facebook";
  if (provider === "TWITTER") return "x";
  if (provider === "TIKTOKBUSINESS") return "tiktok";
  if (provider === "YOUTUBE") return "youtube";
  if (provider === "LINKEDIN") return "linkedin";
  return "google_business";
}

export function metricoolInboxSurfacesForChannel(channel: Channel): MetricoolInboxSurface[] {
  if (channel === "instagram" || channel === "facebook") return ["conversations", "comments"];
  if (channel === "x") return ["conversations"];
  if (channel === "google_business") return ["reviews"];
  return ["comments"];
}

export type MetricoolConfigurationSource = "none" | "stored" | "env" | "fallback";

export interface PublicMetricoolAccountState {
  referenceStored: boolean;
  tokenConfigured: boolean;
  liveReady: boolean;
  source: MetricoolConfigurationSource;
  configurationLocked: boolean;
  instagramProvider: MetricoolInstagramProvider;
}

export interface BrandAccount {
  id: string;
  brandId: string;
  name: string;
  handle: string;
  channels: Channel[];
  active: boolean;
  metricool?: MetricoolAccountReference;
}

export type BrandWorkbookField =
  | "createdAt"
  | "link"
  | "customerName"
  | "text"
  | "channel"
  | "type"
  | "category"
  | "sentiment"
  | "status";

export interface BrandWorkbookConfig {
  source: "google_sheets";
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  recordsSheet: string;
  criteriaSheet?: string;
  dashboardSheet?: string;
  headerRow: number;
  headers: string[];
  mapping: Partial<Record<BrandWorkbookField, number>>;
  dataRows: number;
  schemaHash: string;
  connectedAt: string;
  connectedBy: string;
}

export type BrandQaWorkbookField =
  | "id"
  | "question"
  | "intent"
  | "answer"
  | "category"
  | "channel"
  | "status"
  | "verifiedAt"
  | "expiresAt"
  | "sourceLabel"
  | "approvedBy";

export interface BrandQaWorkbookConfig {
  source: "google_sheets";
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  sheetName: string;
  headerRow: number;
  headers: string[];
  mapping: Partial<Record<BrandQaWorkbookField, number>>;
  dataRows: number;
  approvedRows: number;
  schemaHash: string;
  connectedAt: string;
  connectedBy: string;
}

export type BrandResourceKind = "records" | "qa" | "brand_guide" | "policy" | "asset" | "other";

export interface BrandResource {
  id: string;
  name: string;
  url: string;
  kind: BrandResourceKind;
  addedAt: string;
  addedBy: string;
}

export interface Brand {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sacPolicy?: BrandSacPolicy;
  workbook?: BrandWorkbookConfig;
  qaWorkbook?: BrandQaWorkbookConfig;
  resources?: BrandResource[];
  account: BrandAccount;
}

export interface PublicBrand extends Omit<Brand, "account"> {
  account: Omit<BrandAccount, "metricool"> & {
    metricoolConfigured: boolean;
    metricool: PublicMetricoolAccountState;
  };
}

export interface InteractionAuditEntry {
  id: string;
  at: string;
  action:
    | "ingested"
    | "classified"
    | "automation_evaluated"
    | "draft_created"
    | "draft_deleted"
    | "delivery_reconciled"
    | "reply_sent"
    | "escalated"
    | "status_changed"
    | "assigned"
    | "unassigned"
    | "note_added";
  actor: "system" | "workflow" | "agent";
  detail: string;
  metadata?: Record<string, string | number | boolean>;
}

export type ReplyDeliveryStatus =
  | "pending"
  | "sending"
  | "sent"
  | "failed"
  | "uncertain"
  | "cancelled"
  | "demo_simulated";

export interface ReplyDeliveryActor {
  userId: string;
  displayName: string;
}

export interface ReplyDelivery {
  id: string;
  interactionId: string;
  brandId: string;
  accountId: string;
  bodyText: string;
  approvedByHuman: boolean;
  requestedBy: ReplyDeliveryActor;
  idempotencyKey: string;
  requestId: string;
  status: ReplyDeliveryStatus;
  version: number;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  leaseExpiresAt?: string;
  sentAt?: string;
  providerResponseRef?: string;
  errorCode?: string;
  reconciledAt?: string;
  reconciledBy?: ReplyDeliveryActor;
  reconciliationNote?: string;
}

export interface ReplyDeliveryFilters {
  interactionId?: string;
  accountId?: string;
  brandIds?: string[];
  status?: ReplyDeliveryStatus;
  automaticOnly?: boolean;
  limit?: number;
  oldestFirst?: boolean;
}

export interface PrepareReplyDeliveryInput {
  id: string;
  interactionId: string;
  brandId: string;
  accountId: string;
  bodyText: string;
  approvedByHuman: boolean;
  requestedBy: ReplyDeliveryActor;
  idempotencyKey: string;
  requestId: string;
  createdAt: string;
}

export interface SettleReplyDeliveryInput {
  status: "sent" | "failed" | "uncertain" | "demo_simulated";
  providerResponseRef?: string;
  errorCode?: string;
  at: string;
}

export interface DeferReplyDeliveryInput {
  errorCode: string;
  nextAttemptAt: string;
  at: string;
}

export interface ReconcileReplyDeliveryInput {
  outcome: "sent" | "failed" | "cancelled";
  expectedVersion: number;
  actor: ReplyDeliveryActor;
  note: string;
  at: string;
}

export interface InteractionAssignee {
  userId: string;
  displayName: string;
}

export interface InteractionInternalNote {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface InteractionStatusReason {
  code: string;
  label: string;
  note?: string;
  changedAt: string;
  changedBy: {
    userId: string;
    displayName: string;
  };
}

export interface Interaction {
  id: string;
  externalId: string;
  brandId: string;
  accountId: string;
  channel: Channel;
  type: InteractionType;
  direction: "inbound" | "outbound";
  customerName: string;
  customerHandle: string;
  text: string;
  category: string;
  sentiment: Sentiment;
  confidence: number;
  status: InteractionStatus;
  source: "demo" | "metricool";
  version: number;
  createdAt: string;
  updatedAt: string;
  assignedTo?: InteractionAssignee;
  internalNotes: InteractionInternalNote[];
  statusReason?: InteractionStatusReason;
  automation?: SacAutomationAssessment;
  responseText?: string;
  respondedAt?: string;
  metricoolRef?: {
    provider?: MetricoolInboxProvider;
    conversationId?: string;
    recipient?: string;
    objectId?: string;
    commentId?: string;
    postId?: string;
    actorId?: string;
    threadId?: string;
    parentCommentId?: string;
    contentContext?: InteractionContentContext;
    post?: {
      id: string;
      url?: string;
      text?: string;
      mediaUrl?: string;
      publishedAt?: string;
    };
  };
  audit: InteractionAuditEntry[];
}

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  createdAt: string;
  channel: Channel;
  type: InteractionType;
  status: InteractionStatus;
  responseText?: string;
  contentContext: InteractionContentContext;
  postContext?: {
    postId: string;
    permalink?: string;
    caption?: string;
    thumbnailUrl?: string;
    publishedAt?: string;
  };
}

export interface WorkflowNode {
  id: string;
  type:
    | "schedule"
    | "metricool"
    | "normalize"
    | "deduplicate"
    | "classify"
    | "guardrail"
    | "reply"
    | "excel"
    | "escalate";
  label: string;
  enabled: boolean;
  position: { x: number; y: number };
  config: Record<string, string | number | boolean | string[]>;
}

export type WorkflowConnectorType = "smoothstep" | "bezier" | "straight";

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  connectorType?: WorkflowConnectorType;
}

export interface Workflow {
  id: string;
  name: string;
  version: number;
  publishedVersion: number;
  publishedAt?: string;
  publishedBy?: string;
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
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  status: "draft" | "published" | "archived";
  snapshot: Workflow;
  createdAt: string;
  createdBy: string;
  changeNote?: string;
}

export interface RunAuditStep {
  id: string;
  node: string;
  status: "success" | "skipped" | "warning" | "failed";
  detail: string;
  count?: number;
  at: string;
}

export interface WorkflowRun {
  id: string;
  kind: "simulation" | "sync";
  startedAt: string;
  finishedAt: string;
  status: "success" | "partial" | "failed";
  workflowVersion: number;
  requestedBy?: string;
  retryOf?: string;
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
  auditTrail: RunAuditStep[];
}

export interface StoredIdempotencyRecord {
  key: string;
  scope: string;
  requestHash: string;
  statusCode: number;
  response: unknown;
  createdAt: string;
}

export type WorkflowJobStatus = "queued" | "running" | "retry" | "succeeded" | "dead";

export interface WorkflowJob {
  id: string;
  scheduleKey: string;
  kind: "sync" | "automation";
  workflowId?: string;
  triggerMode?: "manual" | "webhook" | "schedule" | "subworkflow" | "retry";
  input?: Array<Record<string, unknown>>;
  status: WorkflowJobStatus;
  accountIds: string[];
  limit: number;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  lockedAt?: string;
  lockedBy?: string;
  runId?: string;
  lastError?: string;
}

export interface DataStore {
  version: 1;
  createdAt: string;
  updatedAt: string;
  brands: Brand[];
  interactions: Interaction[];
  deliveries: ReplyDelivery[];
  workflow: Workflow;
  workflowVersions: WorkflowVersion[];
  runs: WorkflowRun[];
  jobs: WorkflowJob[];
  idempotency: StoredIdempotencyRecord[];
  automation: AutomationState;
}

export interface InteractionFilters {
  brandId?: string;
  brandIds?: string[];
  accountId?: string;
  channel?: Channel;
  type?: InteractionType;
  status?: InteractionStatus;
  sentiment?: Sentiment;
  assignment?: "assigned" | "unassigned";
  assigneeId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface InteractionStats {
  generatedAt: string;
  total: number;
  dms: number;
  comments: number;
  reviews: number;
  pending: number;
  replied: number;
  escalated: number;
  automatedResponses: number;
  automationEvaluated: number;
  automationScope: number;
  autoReplyCandidates: number;
  humanReviewRequired: number;
  knowledgeBlocked: number;
  responseRate: number;
  averageResponseMinutes: number | null;
  byChannel: Record<Channel, number>;
  byStatus: Record<InteractionStatus, number>;
  byBrand: Array<{
    brandId: string;
    brandName: string;
    total: number;
    dms: number;
    comments: number;
    reviews: number;
    pending: number;
    replied: number;
  }>;
}
