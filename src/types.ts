export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "x"
  | "tiktok"
  | "youtube"
  | "linkedin"
  | "google_business";

export interface SessionActor {
  userId: string;
  displayName: string;
  tenantId: string;
  role: "viewer" | "agent" | "supervisor" | "admin";
  brandIds: string[] | "all";
}

export type ChannelConnectionStatus =
  | "connected"
  | "degraded"
  | "disconnected";

export type AccountHealth = "healthy" | "attention" | "disconnected";
export type MetricoolConfigurationSource = "none" | "stored" | "env" | "fallback";
export type MetricoolInstagramProvider = "INSTAGRAMBUSINESS" | "INSTAGRAM";

export interface ChannelConnection {
  platform: SocialPlatform;
  username: string;
  externalId: string;
  status: ChannelConnectionStatus;
  lastSyncAt?: string;
}

export interface BrandAccount {
  id: string;
  brandId?: string;
  brandColor?: string;
  brandActive?: boolean;
  accountActive?: boolean;
  accountHandle?: string;
  name: string;
  initials: string;
  category: string;
  manager: string;
  metricoolBlogId: string;
  metricoolReferenceStored: boolean;
  metricoolTokenConfigured: boolean;
  metricoolLiveReady: boolean;
  metricoolSource: MetricoolConfigurationSource;
  metricoolConfigurationLocked: boolean;
  metricoolInstagramProvider: MetricoolInstagramProvider;
  health: AccountHealth;
  healthDetail: string;
  lastSyncAt?: string;
  lastSyncLabel: string;
  syncDelaySeconds: number;
  interactions30d: number;
  unread: number;
  automationEnabled: boolean;
  workbook?: BrandWorkbook;
  qaWorkbook?: BrandQaWorkbook;
  resources: BrandResource[];
  channels: ChannelConnection[];
}

export interface BrandWorkbook {
  source: "google_sheets";
  spreadsheetUrl: string;
  title: string;
  recordsSheet: string;
  criteriaSheet?: string;
  dashboardSheet?: string;
  headerRow: number;
  headers: string[];
  dataRows: number;
  schemaHash: string;
  connectedAt: string;
}

export interface BrandQaWorkbook {
  source: "google_sheets";
  spreadsheetUrl: string;
  title: string;
  sheetName: string;
  headerRow: number;
  headers: string[];
  dataRows: number;
  approvedRows: number;
  schemaHash: string;
  connectedAt: string;
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

export interface BrandAdminInput {
  brandId?: string;
  accountId?: string;
  name: string;
  accountName?: string;
  accountHandle: string;
  color: string;
  channels: SocialPlatform[];
  active?: boolean;
  accountActive?: boolean;
}

export type InteractionKind = "dm" | "comment" | "review";

export type InteractionStatus =
  | "pending"
  | "automated"
  | "answered_by_team"
  | "needs_review"
  | "resolved";

export type InteractionPriority = "normal" | "high" | "urgent";

export type InteractionSentiment = "positive" | "neutral" | "negative";

export type InteractionContentKind =
  | "text"
  | "story_reply"
  | "story_mention"
  | "reaction"
  | "attachment"
  | "unsupported"
  | "deleted"
  | "unavailable";

export interface InteractionContentContext {
  kind: InteractionContentKind;
  mediaUrls?: string[];
  permalink?: string;
}

export interface InteractionPostContext {
  postId: string;
  caption?: string;
  thumbnailUrl?: string;
  permalink?: string;
  publishedAt?: string;
}

export interface InteractionConversationSummary {
  messageCount: number;
  pendingCount: number;
  dmCount: number;
  commentCount: number;
  reviewCount: number;
  threadCount: number;
  assignmentConflict: boolean;
  latestDirection: "inbound" | "outbound";
  latestKind: InteractionKind;
  latestStatus: InteractionStatus;
  hasReplyTarget: boolean;
}

export type SacAutomationRoute = "auto_reply" | "draft" | "human_review" | "quarantine" | "ignore";

export interface SacAutomationAssessment {
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
  recommendedRoute: SacAutomationRoute;
  effectiveRoute: SacAutomationRoute;
  reasonCodes: string[];
  proposal?: { text: string; templateId: string; sourceIds: string[] };
}

export interface Interaction {
  id: string;
  version?: number;
  contactKey?: string;
  accountId: string;
  brandName: string;
  brandInitials: string;
  customerName: string;
  customerHandle: string;
  platform: SocialPlatform;
  kind: InteractionKind;
  direction: "inbound" | "outbound";
  preview: string;
  receivedAt: string;
  receivedAtLabel: string;
  status: InteractionStatus;
  priority: InteractionPriority;
  sentiment: InteractionSentiment;
  assignee?: string;
  assignedTo?: { userId: string; displayName: string };
  responseText?: string;
  responseSummary?: string;
  automation?: SacAutomationAssessment;
  conversationSummary?: InteractionConversationSummary;
  postContext?: InteractionPostContext;
  contentContext?: InteractionContentContext;
}

export interface ManualPostSummary {
  postKey: string;
  accountId: string;
  platform: SocialPlatform;
  postContext: InteractionPostContext;
  publishedAt?: string;
  latestCommentAt: string;
  sortAt: string;
  sortSource: "published_at" | "latest_comment_at";
  commentCount: number;
  pendingCount: number;
  teamReplyCount: number;
  participantCount: number;
  latestComment: Interaction;
  replyTarget?: Interaction;
}

export type InteractionAuditAction =
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

export interface InteractionAuditEntry {
  id: string;
  at: string;
  action: InteractionAuditAction;
  actor: "system" | "workflow" | "agent";
  detail: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface InteractionStatusReason {
  code: string;
  label: string;
  note?: string;
  changedAt: string;
  changedBy: { userId: string; displayName: string };
}

export type ReplyDeliveryStatus = "pending" | "sending" | "sent" | "failed" | "uncertain" | "cancelled" | "demo_simulated";

export interface ReplyDelivery {
  id: string;
  interactionId: string;
  status: ReplyDeliveryStatus;
  version: number;
  attemptCount: number;
  approvedByHuman: boolean;
  createdAt: string;
  updatedAt: string;
  lastAttemptAt?: string;
  nextAttemptAt?: string;
  sentAt?: string;
  errorCode?: string;
  reconciledAt?: string;
  reconciliationNote?: string;
}

interface StatusReasonOption {
  code: string;
  label: string;
  noteRequired?: boolean;
}

export type StatusReasonCatalog = Record<"pending" | "escalated" | "resolved", StatusReasonOption[]>;

export interface InteractionDetail extends Interaction {
  version: number;
  externalId: string;
  rawStatus: string;
  direction: "inbound" | "outbound";
  source: "demo" | "metricool";
  text: string;
  category: string;
  confidence: number;
  responseText?: string;
  automation?: SacAutomationAssessment;
  internalNotes: Array<{
    id: string;
    authorId: string;
    authorName: string;
    text: string;
    createdAt: string;
  }>;
  statusReason?: InteractionStatusReason;
  audit: InteractionAuditEntry[];
  deliveries: ReplyDelivery[];
  conversationHistory: ConversationMessage[];
}

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  createdAt: string;
  platform: SocialPlatform;
  kind: InteractionKind;
  status: string;
  contentContext?: InteractionContentContext;
  postContext?: InteractionPostContext;
}

export type DashboardKpiId =
  | "interactions"
  | "pending"
  | "automation"
  | "response_time";

export interface DashboardKpi {
  id: DashboardKpiId;
  label: string;
  value: string;
  detail: string;
  change: string;
  trend: "up" | "down" | "neutral";
}

export interface BrandPerformance {
  accountId: string;
  brandName: string;
  handle: string;
  initials: string;
  totalInteractions: number;
  directMessages: number;
  comments: number;
  reviews: number;
  pending: number;
  automaticResponseRate: number;
  averageResponseMinutes: number;
  changePercent: number;
}

export type IntegrationKind =
  | "metricool"
  | "excel"
  | "automation"
  | "storage";

export type ServiceStatus = "ready" | "needs_action" | "offline";

export interface IntegrationStatus {
  id: string;
  kind: IntegrationKind;
  name: string;
  description: string;
  status: ServiceStatus;
  statusLabel: string;
  detail: string;
  lastCheckedLabel: string;
}

export type EnvironmentKind = "frontend" | "api" | "worker" | "database";

export interface EnvironmentCheck {
  id: string;
  kind: EnvironmentKind;
  label: string;
  value: string;
  status: ServiceStatus;
  detail: string;
}

export interface AutomationSettings {
  automaticRepliesEnabled: boolean;
  humanReviewForSensitiveCases: boolean;
  pauseOnNegativeSentiment: boolean;
  confidenceThreshold: number;
  pollingIntervalMinutes: number;
}

export type InboxSyncRunStatus = "success" | "partial" | "failed" | "never";

export interface InboxSyncStatus {
  enabled: boolean;
  intervalMinutes: number;
  lastRunAt?: string;
  lastRunStatus?: InboxSyncRunStatus;
}

export interface ProjectRequirement {
  id: string;
  label: string;
  description: string;
  complete: boolean;
}
