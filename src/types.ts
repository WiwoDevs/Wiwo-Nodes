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
  /** Rol asignado (de base o propio) y su nombre visible. */
  roleId?: string;
  roleName?: string;
  /** Permisos efectivos; ausente para Admin, que los tiene todos. */
  permissions?: import("./lib/permissions").Permission[];
  brandIds: string[] | "all";
  /** Origen de la identidad: "google" o "dev" cuando hay inicio de sesión. */
  source?: "local" | "trusted_headers" | "google" | "dev" | "service";
  /** Correo de la sesión, solo con inicio de sesión de Google o prueba local. */
  email?: string;
  /** Admin principal (SAC_FLOW_AUTH_ADMIN_EMAILS): el único que oculta o muestra clientes. */
  masterAdmin?: boolean;
}

/** Rol asignable desde "Usuarios y roles": id de un rol (de base o propio) o "none" (sin acceso). */
export type AccessRole = string;

export interface PermissionDefinition {
  key: string;
  group: string;
  label: string;
  description: string;
}

export interface RoleView {
  id: string;
  name: string;
  baseRole: "viewer" | "agent" | "supervisor";
  permissions: string[];
  builtIn: boolean;
  editable: boolean;
  customized: boolean;
  userCount: number;
  defaultPermissions?: string[];
  updatedBy?: string;
  updatedAt?: string;
}

export interface UserAccessView {
  email: string;
  name: string | null;
  effectiveRole: AccessRole;
  assignedRole?: AccessRole;
  assignedBy?: string;
  assignedAt?: string;
  serverRole: SessionActor["role"] | null;
  serverSource: "allowlist_file" | "server_admin" | "server_supervisor" | "server_allowed" | "domain" | null;
  locked: boolean;
  lastSignInAt?: string;
  isSelf: boolean;
  /** Permisos del rol, antes de los ajustes personales. */
  rolePermissions: string[];
  /** Permisos efectivos de esta persona. */
  permissions: string[];
  permissionsAdd: string[];
  permissionsRemove: string[];
  permissionsUpdatedBy?: string;
  permissionsUpdatedAt?: string;
  /** Admin principal: ve todos los clientes; no se le pueden ocultar. */
  masterAdmin?: boolean;
  /** Clientes que un admin principal le ocultó a esta persona. */
  hiddenBrandIds?: string[];
  hiddenBrandsUpdatedBy?: string;
  hiddenBrandsUpdatedAt?: string;
}

export interface UserAccessPolicy {
  authEnabled: boolean;
  allowedDomains: string[];
  defaultRole: SessionActor["role"];
}

export interface AccessControlListing {
  users: UserAccessView[];
  roles: RoleView[];
  permissions: PermissionDefinition[];
  adminOnly: string[];
  /** Permisos que solo un admin principal (SAC_FLOW_AUTH_ADMIN_EMAILS) puede otorgar. */
  masterOnlyPermissions?: string[];
  /** Quién mira: admin principal o admin asignado desde la app. */
  viewer?: { masterAdmin: boolean };
  policy: UserAccessPolicy;
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
  /** Redes de la cuenta que se usan hoy en SAC (marca «En SAC» de Clientes); ausente si nunca se marcó. */
  sacChannels?: SocialPlatform[];
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
  /** Mensajes abiertos de esta persona señalados como posible spam o ruido. */
  noiseCount?: number;
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

/** Posible spam o ruido detectado por reglas o sugerido por la IA en sombra. Solo señala. */
export interface NoiseSignal {
  kind: "repetido" | "coordinado" | "solo_menciones" | "promocional" | "ia_spam";
  label: string;
  origen: "reglas" | "ia";
  veces?: number;
}

export interface Interaction {
  id: string;
  version?: number;
  contactKey?: string;
  accountId: string;
  /** Marca (cliente), para la foto de la cuenta. */
  brandId?: string;
  brandName: string;
  brandInitials: string;
  customerName: string;
  customerHandle: string;
  /** Foto de perfil de quien escribe (copia de wiwo.sac); sin ella se muestran las iniciales. */
  customerAvatarUrl?: string;
  platform: SocialPlatform;
  kind: InteractionKind;
  direction: "inbound" | "outbound";
  preview: string;
  receivedAt: string;
  /** Último mensaje del cliente en la conversación: desde ahí corre el plazo de Meta. */
  latestInboundAt?: string;
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
  /** Posible spam o ruido del mensaje que se abre. */
  noise?: NoiseSignal;
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
  /** Comentarios abiertos señalados como posible spam o ruido. */
  noisePendingCount?: number;
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

/** Cómo cuenta el mensaje en el reporte mensual y quién lo decidió. */
export interface ReportTriage {
  esCasoSac: boolean;
  requiereDerivacion: boolean;
  source: "manual" | "ia" | "reglas";
  marcadoPor?: string;
  clasificadoEn?: string;
}

export interface InteractionDetail extends Interaction {
  version: number;
  reportTriage?: ReportTriage;
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
  /** Marca (cliente), para pedir su foto de perfil. */
  brandId: string;
  brandName: string;
  handle: string;
  initials: string;
  totalInteractions: number;
  directMessages: number;
  comments: number;
  reviews: number;
  pending: number;
  automaticResponseRate: number;
  /** Mediana propia de la marca; null cuando todavía no tiene casos respondidos. */
  medianResponseMinutes: number | null;
  responseSampleSize: number;
  /** Variación respecto del período anterior. null mientras no exista histórico comparable. */
  changePercent: number | null;
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

/** Cifras del informe SAC mensual de una marca (server/sac-report.ts → SacReportFigures). */
export interface SacReportFigures {
  brandKey: string;
  brandLabel: string;
  period: string;
  volumenBruto: number;
  mensajesGestionados: number;
  ilegibles: number;
  casosSac: number;
  derivados: number;
  respondidos: number;
  coberturaPct: number;
  canales: Record<string, number>;
  privados: number;
  publicos: number;
  motivos: Array<{ motivo: string; casos: number; pct: number }>;
  tono: { positivo: number; neutro: number; negativo: number };
  variacion?: { anterior: number; deltaPct: number; comparable: boolean; revisar?: boolean };
  advertencias: string[];
  /** Quién decidió caso o ruido en cada mensaje del mes. */
  clasificacion?: { manual: number; ia: number; reglas: number; spam?: number };
}

export interface SacReportBrand {
  brandId: string;
  brandName: string;
  accountHandle: string;
  figures: SacReportFigures;
}

export interface SacMonthlyReport {
  month: string;
  label: string;
  from: string;
  to: string;
  previous: { from: string; to: string };
  volumen: "gestionado" | "bruto";
  brands: SacReportBrand[];
  warnings: string[];
  generatedAt: string;
}

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
