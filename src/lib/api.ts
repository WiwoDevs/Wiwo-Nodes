import { formatMinutes } from "./duration";
import type {
  BrandAccount,
  BrandAdminInput,
  BrandPerformance,
  AutomationSettings,
  DashboardKpi,
  EnvironmentCheck,
  IntegrationStatus,
  Interaction,
  InteractionAuditEntry,
  InteractionContentContext,
  InteractionPostContext,
  ManualPostSummary,
  ReplyDelivery,
  InteractionDetail,
  StatusReasonCatalog,
  InteractionPriority,
  InteractionStatus,
  SocialPlatform,
  SessionActor,
  AccessRole,
  AccessControlListing,
  UserAccessView,
  ProjectRequirement,
  SacAutomationAssessment,
  BrandWorkbook,
  BrandQaWorkbook,
  BrandResource,
  BrandResourceKind,
  ConversationMessage,
  InboxSyncStatus,
  SacMonthlyReport,
  ReportTriage,
  NoiseSignal,
} from "../types";

export type RunResult = {
  executionId: string;
  status: "success" | "partial" | "failed";
  processed: number;
  newInteractions: number;
  autoReplied: number;
  escalated: number;
  durationMs: number;
  demoMode?: boolean;
  kind?: "simulation" | "sync";
  workflowVersion?: number;
  startedAt?: string;
  finishedAt?: string;
  retryOf?: string;
  auditTrail?: Array<{
    id: string;
    node: string;
    status: "success" | "skipped" | "warning" | "failed";
    detail: string;
    count?: number;
    at: string;
  }>;
};

export type SacProtocolResult = {
  evaluated: number;
  reconciledTeamResponses: number;
  drafted: number;
  escalated: number;
  autoReplyCandidates: number;
  queuedAutoReplies: number;
  queueSkippedCapacity: number;
  quarantined: number;
};

type ApiBrand = {
  id: string;
  name: string;
  color: string;
  active: boolean;
  sacPolicy?: {
    enabled: boolean;
    approvedAnswers: Array<{ id: string; intent: string }>;
  };
  workbook?: BrandWorkbook;
  qaWorkbook?: BrandQaWorkbook;
  resources?: BrandResource[];
  account: {
    id: string;
    name: string;
    handle: string;
    channels: SocialPlatform[];
    /** Redes que se usan hoy en SAC; ausente si nunca se marcó. */
    sacChannels?: SocialPlatform[];
    active: boolean;
    metricoolConfigured: boolean;
    metricool?: {
      referenceStored: boolean;
      tokenConfigured: boolean;
      liveReady: boolean;
      source: "none" | "stored" | "env" | "fallback";
      configurationLocked: boolean;
      instagramProvider: "INSTAGRAMBUSINESS" | "INSTAGRAM";
    };
  };
};

type ApiInteraction = {
  id: string;
  externalId: string;
  brandId: string;
  brandName?: string;
  accountId: string;
  accountHandle?: string;
  channel: SocialPlatform;
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
  assignedTo?: { userId: string; displayName: string };
  internalNotes?: InteractionDetail["internalNotes"];
  responseText?: string;
  automation?: SacAutomationAssessment;
  statusReason?: InteractionDetail["statusReason"];
  audit?: InteractionAuditEntry[];
  contactKey?: string;
  postContext?: InteractionPostContext;
  contentContext?: InteractionContentContext;
  reportTriage?: ReportTriage;
  noise?: NoiseSignal;
};

type ApiInboxContact = {
  contactKey: string;
  brandId: string;
  accountId: string;
  channel: SocialPlatform;
  customerName: string;
  customerHandle: string;
  /** Foto de perfil guardada por wiwo.sac (/api/media/image/:key), cuando Metricool la trae. */
  customerAvatarUrl?: string;
  replyTarget?: ApiInteraction;
  /** Sin caso pendiente y con la cuenta como último en escribir: el último mensaje del cliente. */
  latestInboundId?: string;
  latestInboundAt?: string;
  latest: {
    id: string;
    text: string;
    direction: "inbound" | "outbound";
    createdAt: string;
    type: "dm" | "comment" | "review";
    status: ApiInteraction["status"];
    postContext?: InteractionPostContext;
    contentContext?: InteractionContentContext;
  };
  messageCount: number;
  pendingCount: number;
  dmCount: number;
  commentCount: number;
  reviewCount: number;
  threadCount: number;
  assignmentConflict: boolean;
  noiseCount?: number;
};

type ApiInboxPost = {
  postKey: string;
  brandId: string;
  accountId: string;
  channel: SocialPlatform;
  postContext: InteractionPostContext;
  publishedAt?: string;
  latestCommentAt: string;
  sortAt: string;
  sortSource: "published_at" | "latest_comment_at";
  commentCount: number;
  pendingCount: number;
  teamReplyCount: number;
  participantCount: number;
  latestComment: ApiInteraction;
  replyTarget?: ApiInteraction;
  noisePendingCount?: number;
};

type ApiReplyDelivery = ReplyDelivery & {
  brandId: string;
  accountId: string;
  bodyText: string;
  idempotencyKey: string;
  requestId: string;
};

type ApiConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  text: string;
  createdAt: string;
  channel: SocialPlatform;
  type: "dm" | "comment" | "review";
  status: string;
  contentContext?: InteractionContentContext;
  postContext?: InteractionPostContext;
};

type ApiStats = {
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
  medianResponseMinutes: number | null;
  responseSampleSize: number;
  byBrand: Array<{
    brandId: string;
    brandName: string;
    total: number;
    dms: number;
    comments: number;
    reviews: number;
    pending: number;
    replied: number;
    medianResponseMinutes: number | null;
    averageResponseMinutes: number | null;
    responseSampleSize: number;
  }>;
};

export type ApiWorkflowNode = {
  id: string;
  type: "schedule" | "metricool" | "normalize" | "deduplicate" | "classify" | "guardrail" | "reply" | "excel" | "escalate";
  label: string;
  enabled: boolean;
  position: { x: number; y: number };
  config: Record<string, string | number | boolean | string[]>;
};

export type ApiWorkflowConnectorType = "smoothstep" | "bezier" | "straight";

export type ApiWorkflowEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  connectorType?: ApiWorkflowConnectorType;
};

export type ApiWorkflow = {
  id: string;
  name: string;
  enabled: boolean;
  version: number;
  publishedVersion: number;
  publishedAt?: string;
  publishedBy?: string;
  pollIntervalMinutes: number;
  autoReplyEnabled: boolean;
  autoReplyAccountIds: string[];
  minimumConfidence: number;
  requireHumanFor: string[];
  businessHoursOnly: boolean;
  nodes: ApiWorkflowNode[];
  edges: ApiWorkflowEdge[];
};

export type WorkflowValidation = {
  valid: boolean;
  checkedAt: string;
  errors: number;
  warnings: number;
  issues: Array<{ code: string; severity: "error" | "warning"; message: string; nodeId?: string; edgeId?: string }>;
};

export type OperationalData = {
  actor: SessionActor;
  accounts: BrandAccount[];
  interactions: Interaction[];
  kpis: DashboardKpi[];
  brandPerformance: BrandPerformance[];
  recentInteractions: Interaction[];
  automationSettings: AutomationSettings;
  workflow: ApiWorkflow;
  statusReasons: StatusReasonCatalog;
  integrations: IntegrationStatus[];
  environmentChecks: EnvironmentCheck[];
  requirements: ProjectRequirement[];
  inboxSync: InboxSyncStatus;
};

export type InboxData = {
  accounts: BrandAccount[];
  interactions: Interaction[];
  kpis: DashboardKpi[];
  brandPerformance: BrandPerformance[];
  workflow: ApiWorkflow;
  automationSettings: AutomationSettings;
  inboxSync: InboxSyncStatus;
  loadedAt: string;
};

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");

export async function openApiSession(apiKey: string): Promise<void> {
  const response = await fetch(`${API_BASE}/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (!response.ok) await throwApiError(response);
}

export type AuthProvider = "google" | "dev";
export type AuthConfig = { enabled: boolean; provider: AuthProvider | null; requiredPermission: string };

/** Indica si este entorno exige inicio de sesión (Google o prueba local). */
export async function loadAuthConfig(): Promise<AuthConfig> {
  const response = await fetch(`${API_BASE}/auth/config`);
  // Solo un servidor sin esta ruta (404) significa "sin inicio de sesión". Cualquier otro
  // error (502 del proxy, 500, red) NO debe abrir la app en modo local: se informa y se reintenta.
  if (response.status === 404) return { enabled: false, provider: null, requiredPermission: "sac" };
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: AuthConfig };
  return payload.data;
}

/** URL que inicia el flujo OAuth de Google en el servidor (redirección de página completa). */
export const GOOGLE_SIGN_IN_URL = `${API_BASE}/auth/google/start`;

/** Modo de prueba local: canjea correo y contraseña ficticios por la cookie de sesión. */
export async function openDevSession(email: string, password: string): Promise<SessionActor & { email: string }> {
  const response = await fetch(`${API_BASE}/auth/dev-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim(), password }),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: SessionActor & { email: string } };
  return payload.data;
}

/** Devuelve el actor de la sesión vigente, o null si no hay sesión válida. */
export async function loadCurrentActor(): Promise<SessionActor | null> {
  const response = await fetch(`${API_BASE}/me`);
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: SessionActor };
  return payload.data;
}

export async function closeSession(): Promise<void> {
  await fetch(`${API_BASE}/auth/session`, { method: "DELETE" }).catch(() => undefined);
}

async function throwApiError(response: Response): Promise<never> {
  let message = `La API respondió HTTP ${response.status}`;
  try {
    const payload = await response.json();
    if (typeof payload?.error?.message === "string") {
      message = payload.error.message;
    }
  } catch {
    // La respuesta puede no ser JSON; conservamos el mensaje HTTP seguro.
  }
  throw new Error(message);
}

function makeIdempotencyKey(prefix: string): string {
  const entropy = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${entropy}`;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) await throwApiError(response);
  return response.json() as Promise<T>;
}

type ApiHealth = {
  mode: "demo" | "live";
  demoMode: boolean;
  metricool: { configured: boolean; accountOverrides: number; fallbackAccountActive: boolean };
  operations: {
    outboundSendsDisabled: boolean;
    externalNodesDisabled: boolean;
    metricoolMutationsDisabled: boolean;
    manualRepliesEnabled: boolean;
    autoReplyDispatchMode: "shadow" | "live";
    autoReplyMaxPending: number;
  };
  persistence: { ready: boolean; driver: "json" | "postgres" };
};

type ApiReadiness = {
  status: "ready" | "not_ready";
  checks: {
    repository: { status: "ok" | "failed"; driver: "json" | "postgres"; brands?: number; interactions?: number };
    metricool?: { status: "ok" | "warning"; configured: boolean };
    replyOutbox?: { status: "ok" | "saturated"; pending: number; maxPending: number };
    inboxSync?: {
      enabled: boolean;
      intervalMinutes: number;
      lastRunAt?: string;
      lastRunStatus?: "success" | "partial" | "failed" | "never";
    };
  };
};

function mapInboxSyncStatus(
  readiness: ApiReadiness,
  fallback?: Pick<ApiWorkflow, "enabled" | "pollIntervalMinutes">,
): InboxSyncStatus | undefined {
  const inboxSync = readiness.checks.inboxSync;
  if (!inboxSync && !fallback) return undefined;
  return {
    enabled: inboxSync?.enabled ?? fallback?.enabled ?? false,
    intervalMinutes: Math.max(5, inboxSync?.intervalMinutes ?? fallback?.pollIntervalMinutes ?? 5),
    lastRunAt: inboxSync?.lastRunAt,
    lastRunStatus: inboxSync?.lastRunStatus,
  };
}

function mapSystemStatus(
  health: ApiHealth,
  readiness: ApiReadiness,
  accounts: BrandAccount[],
  workflow: ApiWorkflow,
): Pick<OperationalData, "integrations" | "environmentChecks" | "requirements"> {
  const checked = `Comprobado ${new Intl.DateTimeFormat("es-CL", { timeStyle: "short" }).format(new Date())}`;
  const metricoolReady = health.metricool.configured && accounts.some((account) => account.metricoolLiveReady);
  const protectedDevelopment = health.operations.outboundSendsDisabled
    && health.operations.externalNodesDisabled
    && health.operations.metricoolMutationsDisabled;
  return {
    integrations: [
      {
        id: "metricool-api", kind: "metricool", name: "Metricool API",
        description: "Origen de DMs, comentarios y respuestas de las cuentas SAC.",
        status: metricoolReady ? "ready" : "needs_action",
        statusLabel: metricoolReady ? "Conectada" : "Sin conexión live",
        detail: health.demoMode ? "La API opera con datos ficticios; no se contacta Metricool." : metricoolReady ? "Token configurado en el servidor y cuentas vinculadas." : health.metricool.configured ? "Token presente; falta completar o validar referencias de cuenta." : "Falta configurar el token en el servidor.",
        lastCheckedLabel: checked,
      },
      {
        id: "excel-export", kind: "excel", name: "Exportación Excel",
        description: "Archivo consolidado con detalle y resumen por marca.",
        status: readiness.status === "ready" ? "ready" : "offline",
        statusLabel: readiness.status === "ready" ? "Disponible" : "No disponible",
        detail: "La exportación se genera exclusivamente en el backend.", lastCheckedLabel: checked,
      },
    ],
    // Solo lo que sirve para operar: la API, la base de datos y, si el envío automático está
    // armado, su cola. Las filas de la puesta en marcha (frontend, worker) se retiraron.
    environmentChecks: [
      { id: "api", kind: "api", label: "Servidor", value: readiness.status === "ready" ? "En línea" : "Sin respuesta", status: readiness.status === "ready" ? "ready" : "offline", detail: readiness.status === "ready" ? "Responde correctamente." : "La comprobación del servidor falló." },
      { id: "database", kind: "database", label: "Base de datos", value: health.persistence.driver === "postgres" ? "PostgreSQL" : "JSON local", status: readiness.checks.repository.status === "ok" ? "ready" : "offline", detail: `${readiness.checks.repository.brands ?? 0} marcas y ${readiness.checks.repository.interactions ?? 0} interacciones guardadas.` },
      ...(health.operations.autoReplyDispatchMode !== "live" ? [] : [{
        id: "reply-outbox",
        kind: "worker",
        label: "Cola de respuestas SAC",
        value: `${readiness.checks.replyOutbox?.pending ?? 0}/${readiness.checks.replyOutbox?.maxPending ?? health.operations.autoReplyMaxPending}`,
        status: readiness.checks.replyOutbox?.status === "saturated" ? "needs_action" : "ready",
        detail: readiness.checks.replyOutbox?.status === "saturated"
          ? "Capacidad alcanzada: las nuevas candidatas quedan retenidas para revisión y no se envían."
          : "La cola durable conserva margen para nuevas auto-respuestas.",
      } satisfies EnvironmentCheck]),
    ],
    requirements: [
      { id: "metricool-plan", label: "Token Metricool y plan con API", description: "Se requiere Advanced o Custom antes de conectar datos reales.", complete: health.metricool.configured },
      { id: "account-map", label: "Mapa de cuentas", description: `${accounts.length} cuentas registradas; cada una necesita una referencia Metricool válida.`, complete: accounts.length > 0 && accounts.every((account) => account.metricoolSource !== "none") },
      { id: "response-rules", label: "Workflow SAC publicado", description: "Las reglas deben validarse y publicarse antes de activar el scheduler.", complete: workflow.version === workflow.publishedVersion },
      { id: "auto-reply-dispatch", label: "Despacho automático autorizado", description: "Debe pasar de sombra a live únicamente durante un UAT supervisado y con allowlist limitada.", complete: health.operations.autoReplyDispatchMode === "live" },
      { id: "excel-schema", label: "Esquema de exportación", description: "Incluye DMs, comentarios, estado, respuesta y resumen.", complete: readiness.status === "ready" },
    ],
  };
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("es-CL") ?? "")
    .join("") || "SF";
}

function relativeTimeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "sin fecha";
  const diffMinutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (diffMinutes < 1) return "ahora";
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 48) return `hace ${diffHours} h`;
  // Hasta un mes, siempre relativo (igual en DMs y comentarios); después, la fecha.
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 31) return `hace ${diffDays} días`;
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium" }).format(new Date(timestamp));
}

function mapRawStatus(
  status: ApiInteraction["status"],
  audit: InteractionAuditEntry[] = [],
): InteractionStatus {
  if (status === "replied") {
    const sentAutomatically = audit.some((entry) =>
      entry.action === "reply_sent" && entry.actor === "workflow");
    return sentAutomatically ? "automated" : "answered_by_team";
  }
  if (status === "resolved") return "resolved";
  if (status === "drafted") return "needs_review";
  if (status === "escalated") return "needs_review";
  return "pending";
}

function mapStatus(interaction: ApiInteraction): InteractionStatus {
  return mapRawStatus(interaction.status, interaction.audit);
}

function mapPriority(interaction: ApiInteraction): InteractionPriority {
  if (interaction.automation?.risk === "critical" || interaction.sentiment === "negative" || interaction.category === "reclamo") return "urgent";
  if (interaction.automation?.effectiveRoute === "human_review") return "high";
  if (interaction.confidence < 0.82 || interaction.status === "drafted") return "high";
  return "normal";
}

function mapAccounts(
  brands: ApiBrand[],
  stats: ApiStats,
  workflow: ApiWorkflow,
  inboxSync: InboxSyncStatus,
): BrandAccount[] {
  const byBrand = new Map(stats.byBrand.map((brand) => [brand.brandId, brand]));
  const allowed = new Set(workflow.autoReplyAccountIds);
  const lastSyncAt = inboxSync.lastRunAt;
  const lastSyncLabel = lastSyncAt
    ? `${relativeTimeLabel(lastSyncAt)} (${inboxSync.lastRunStatus === "failed" ? "fallida" : inboxSync.lastRunStatus === "partial" ? "parcial" : "confirmada"})`
    : inboxSync.enabled
      ? "aún no confirmada"
      : "programación desactivada";
  const syncDelaySeconds = lastSyncAt && Number.isFinite(Date.parse(lastSyncAt))
    ? Math.max(0, Math.floor((Date.now() - Date.parse(lastSyncAt)) / 1_000))
    : 0;

  return brands.map((brand) => {
    const brandStats = byBrand.get(brand.id);
    const state = brand.account.metricool ?? {
      referenceStored: brand.account.metricoolConfigured,
      tokenConfigured: brand.account.metricoolConfigured,
      liveReady: brand.account.metricoolConfigured,
      source: brand.account.metricoolConfigured ? "stored" as const : "none" as const,
      configurationLocked: false,
      instagramProvider: "INSTAGRAMBUSINESS" as const,
    };
    const hasReference = state.referenceStored || state.source === "env" || state.source === "fallback";
    const configured = state.liveReady;
    const health = !brand.active || !brand.account.active
      ? "disconnected"
      : configured
        ? "healthy"
        : hasReference
          ? "attention"
          : "disconnected";
    const healthDetail = configured
      ? "Cuenta lista para modo conectado"
      : hasReference
        ? state.tokenConfigured
          ? "Referencia guardada; habilitar modo live para operar"
          : "Referencia guardada; falta token Metricool autorizado"
        : "Falta conectar userId y blogId de Metricool";
    const sourceLabel = state.source === "env"
      ? "variables de entorno"
      : state.source === "fallback"
        ? "fallback servidor"
        : state.source === "stored"
          ? "backend"
          : "sin fuente";

    return {
      id: brand.account.id,
      brandId: brand.id,
      brandColor: brand.color,
      brandActive: brand.active,
      accountActive: brand.account.active,
      accountHandle: brand.account.handle,
      name: brand.name,
      initials: initials(brand.name),
      category: configured ? "Metricool listo" : hasReference ? "Referencia Metricool guardada" : "Pendiente de conexión",
      manager: "Sin asignar",
      metricoolBlogId: hasReference ? `oculto · ${sourceLabel}` : "pendiente",
      metricoolReferenceStored: state.referenceStored,
      metricoolTokenConfigured: state.tokenConfigured,
      metricoolLiveReady: state.liveReady,
      metricoolSource: state.source,
      metricoolConfigurationLocked: state.configurationLocked,
      metricoolInstagramProvider: state.instagramProvider,
      health,
      healthDetail,
      lastSyncAt,
      lastSyncLabel,
      syncDelaySeconds,
      interactions30d: brandStats?.total ?? 0,
      unread: brandStats?.pending ?? 0,
      automationEnabled: workflow.autoReplyEnabled && allowed.has(brand.account.id),
      workbook: brand.workbook,
      qaWorkbook: brand.qaWorkbook,
      resources: brand.resources ?? [],
      // Incluye redes marcadas que aún no están conectadas (se muestran como pendientes).
      sacChannels: brand.account.sacChannels,
      channels: brand.account.channels.map((channel) => ({
        platform: channel,
        username: brand.account.handle,
        externalId: `${brand.account.id}-${channel}`,
        status: health === "disconnected" ? "disconnected" : configured ? "connected" : "degraded",
        lastSyncAt,
      })),
    };
  });
}

function mapInboxContacts(contacts: ApiInboxContact[], brands: ApiBrand[]): Interaction[] {
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));

  return contacts.map((contact) => {
    const replyTarget = contact.replyTarget;
    const brand = brandById.get(contact.brandId);
    const brandName = brand?.name ?? contact.brandId;
    const rawStatus = replyTarget?.status ?? contact.latest.status;
    // El caso que se abre es siempre un mensaje del cliente cuando lo hay: el pendiente o, si
    // la cuenta escribió al último, el último del cliente (para seguir la conversación).
    const followUpId = !replyTarget ? contact.latestInboundId : undefined;
    return {
      id: replyTarget?.id ?? followUpId ?? contact.latest.id,
      version: replyTarget?.version,
      contactKey: contact.contactKey,
      accountId: contact.accountId,
      brandId: contact.brandId,
      brandName,
      brandInitials: initials(brandName),
      customerName: contact.customerName,
      customerHandle: contact.customerHandle,
      ...(contact.customerAvatarUrl ? { customerAvatarUrl: contact.customerAvatarUrl } : {}),
      platform: contact.channel,
      kind: replyTarget?.type ?? contact.latest.type,
      direction: replyTarget?.direction ?? (followUpId ? "inbound" : contact.latest.direction),
      preview: contact.latest.text,
      receivedAt: contact.latest.createdAt,
      latestInboundAt: contact.latestInboundAt,
      receivedAtLabel: relativeTimeLabel(contact.latest.createdAt),
      status: replyTarget ? mapStatus(replyTarget) : mapRawStatus(contact.latest.status),
      priority: replyTarget ? mapPriority(replyTarget) : "normal",
      sentiment: replyTarget?.sentiment ?? "neutral",
      assignee: replyTarget?.assignedTo?.displayName,
      assignedTo: replyTarget?.assignedTo,
      responseText: replyTarget?.responseText,
      automation: replyTarget?.automation,
      postContext: replyTarget?.postContext ?? contact.latest.postContext,
      contentContext: contact.latest.contentContext,
      noise: replyTarget?.noise,
      conversationSummary: {
        messageCount: contact.messageCount,
        pendingCount: contact.pendingCount,
        dmCount: contact.dmCount,
        commentCount: contact.commentCount,
        reviewCount: contact.reviewCount,
        threadCount: contact.threadCount,
        assignmentConflict: contact.assignmentConflict,
        latestDirection: contact.latest.direction,
        latestKind: contact.latest.type,
        latestStatus: mapRawStatus(contact.latest.status),
        hasReplyTarget: Boolean(replyTarget),
        noiseCount: contact.noiseCount ?? 0,
      },
      responseSummary: replyTarget?.responseText
        || (rawStatus === "escalated"
          ? "Derivado para revisión humana."
          : rawStatus === "replied" && (replyTarget?.direction ?? contact.latest.direction) === "inbound"
            ? "Respuesta de la cuenta detectada en Metricool."
            : undefined),
    };
  }).sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
}

function mapRawInteractions(interactions: ApiInteraction[], brandName: string): Interaction[] {
  return interactions.map((interaction) => ({
    id: interaction.id,
    version: interaction.version,
    contactKey: interaction.contactKey,
    accountId: interaction.accountId,
    brandName: interaction.brandName ?? brandName,
    brandInitials: initials(interaction.brandName ?? brandName),
    customerName: interaction.customerName,
    customerHandle: interaction.customerHandle,
    platform: interaction.channel,
    kind: interaction.type,
    direction: interaction.direction,
    preview: interaction.text,
    receivedAt: interaction.createdAt,
    receivedAtLabel: relativeTimeLabel(interaction.createdAt),
    status: mapStatus(interaction),
    priority: mapPriority(interaction),
    sentiment: interaction.sentiment,
    assignee: interaction.assignedTo?.displayName,
    assignedTo: interaction.assignedTo,
    responseText: interaction.responseText,
    automation: interaction.automation,
    postContext: interaction.postContext,
    contentContext: interaction.contentContext,
    responseSummary: interaction.responseText,
    noise: interaction.noise,
  })).sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
}

function mapInteractionDetail(
  interaction: ApiInteraction,
  brands: ApiBrand[],
  deliveries: ApiReplyDelivery[] = [],
  conversationHistory: ConversationMessage[] = [],
): InteractionDetail {
  const brand = brands.find((item) => item.id === interaction.brandId);
  const brandName = interaction.brandName ?? brand?.name ?? interaction.brandId;
  return {
    id: interaction.id,
    version: interaction.version,
    contactKey: interaction.contactKey,
    externalId: interaction.externalId,
    accountId: interaction.accountId,
    brandId: interaction.brandId,
    brandName,
    brandInitials: initials(brandName),
    customerName: interaction.customerName,
    customerHandle: interaction.customerHandle,
    platform: interaction.channel,
    kind: interaction.type,
    direction: interaction.direction,
    preview: interaction.text,
    receivedAt: interaction.createdAt,
    receivedAtLabel: relativeTimeLabel(interaction.createdAt),
    status: mapStatus(interaction),
    rawStatus: interaction.status,
    reportTriage: interaction.reportTriage,
    priority: mapPriority(interaction),
    sentiment: interaction.sentiment,
    source: interaction.source,
    text: interaction.text,
    category: interaction.category,
    confidence: interaction.confidence,
    responseText: interaction.responseText,
    automation: interaction.automation,
    postContext: interaction.postContext,
    contentContext: interaction.contentContext,
    assignee: interaction.assignedTo?.displayName,
    assignedTo: interaction.assignedTo,
    internalNotes: interaction.internalNotes ?? [],
    statusReason: interaction.statusReason,
    responseSummary: interaction.responseText
      || (interaction.status === "escalated"
        ? "Derivado para revisión humana."
        : interaction.status === "replied" && interaction.direction === "inbound"
          ? "Respuesta de la cuenta detectada en Metricool."
          : undefined),
    audit: interaction.audit ?? [],
    deliveries,
    conversationHistory,
  };
}

function mapKpis(stats: ApiStats): DashboardKpi[] {
  return [
    {
      id: "interactions",
      label: "Interacciones registradas",
      value: new Intl.NumberFormat("es-CL").format(stats.total),
      detail: `${stats.dms} DMs · ${stats.comments} comentarios · ${stats.reviews} reseñas`,
      change: "",
      trend: "neutral",
    },
    {
      id: "pending",
      // Todo el historial: incluye lo que ya salió del plazo de Meta. El Inicio y la Bandeja
      // cuentan solo lo que sigue en plazo, por eso las cifras se nombran distinto.
      label: "Pendientes (todo el historial)",
      value: new Intl.NumberFormat("es-CL").format(stats.pending),
      detail: `Incluye los fuera de plazo · ${new Intl.NumberFormat("es-CL").format(stats.escalated)} en revisión humana`,
      change: "",
      trend: stats.pending ? "down" : "neutral",
    },
    {
      id: "automation",
      // El envío automático está apagado: lo que se mide es cuánto respondió el equipo.
      label: "Respondidas por el equipo",
      value: stats.total ? `${stats.responseRate}%` : "Sin datos",
      detail: "Mensajes con respuesta registrada sobre el total",
      change: "",
      trend: "neutral",
    },
    {
      id: "response_time",
      // Mediana y no promedio: la cola de hilos que tardan días distorsiona el promedio
      // muy por encima de lo que espera un cliente típico.
      label: "Tiempo habitual de respuesta",
      value: formatMinutes(stats.medianResponseMinutes),
      detail: stats.medianResponseMinutes === null
        ? "Aún no hay casos respondidos"
        : `Mediana · promedio ${formatMinutes(stats.averageResponseMinutes)}`,
      change: "",
      trend: "neutral",
    },
  ];
}

function mapBrandPerformance(brands: ApiBrand[], stats: ApiStats): BrandPerformance[] {
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  return stats.byBrand.map((brand) => {
    const account = brandById.get(brand.brandId)?.account;
    return {
      accountId: account?.id ?? brand.brandId,
      brandId: brand.brandId,
      brandName: brand.brandName,
      handle: account?.handle ?? brand.brandId,
      initials: initials(brand.brandName),
      totalInteractions: brand.total,
      directMessages: brand.dms,
      comments: brand.comments,
      reviews: brand.reviews,
      pending: brand.pending,
      automaticResponseRate: brand.total ? Math.round((brand.replied / brand.total) * 100) : 0,
      medianResponseMinutes: brand.medianResponseMinutes,
      responseSampleSize: brand.responseSampleSize,
      // Sin histórico almacenado no hay con qué comparar: mostrar 0% simularía una medición.
      changePercent: null,
    };
  });
}

function mapAutomationSettings(workflow: ApiWorkflow): AutomationSettings {
  return {
    automaticRepliesEnabled: workflow.autoReplyEnabled,
    humanReviewForSensitiveCases: workflow.requireHumanFor.length > 0,
    pauseOnNegativeSentiment: true,
    confidenceThreshold: Math.round(workflow.minimumConfidence * 100),
    pollingIntervalMinutes: Math.max(5, workflow.pollIntervalMinutes),
  };
}

/** Máximo de páginas de la bandeja pedidas en paralelo: con miles de contactos no se satura la API. */
const PAGE_FETCH_CONCURRENCY = 4;

/** Ejecuta tareas con a lo sumo `limit` en curso a la vez, conservando el orden de resultados. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Contactos por página al descargar la bandeja completa (máximo del API: 1000). */
const CONTACTS_PAGE_SIZE = 1000;

async function fetchAllInboxContacts(init?: RequestInit): Promise<ApiInboxContact[]> {
  const first = await fetchJson<{
    data: ApiInboxContact[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`/inbox/contacts?page=1&pageSize=${CONTACTS_PAGE_SIZE}`, init);
  if (first.pagination.totalPages <= 1) return first.data;
  const pages = Array.from({ length: first.pagination.totalPages - 1 }, (_, index) => index + 2);
  const remaining = await mapWithConcurrency(pages, PAGE_FETCH_CONCURRENCY, (page) =>
    fetchJson<{ data: ApiInboxContact[] }>(`/inbox/contacts?page=${page}&pageSize=${CONTACTS_PAGE_SIZE}`, init));
  return [first.data, ...remaining.map((response) => response.data)].flat();
}

async function fetchAllInboxPosts(accountId: string, init?: RequestInit): Promise<ApiInboxPost[]> {
  const query = `accountId=${encodeURIComponent(accountId)}&pendingOnly=false&pageSize=200`;
  const first = await fetchJson<{
    data: ApiInboxPost[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`/inbox/posts?${query}&page=1`, init);
  if (first.pagination.totalPages <= 1) return first.data;
  const pages = Array.from({ length: first.pagination.totalPages - 1 }, (_, index) => index + 2);
  const remaining = await mapWithConcurrency(pages, PAGE_FETCH_CONCURRENCY, (page) =>
    fetchJson<{ data: ApiInboxPost[] }>(`/inbox/posts?${query}&page=${page}`, init));
  return [first.data, ...remaining.map((response) => response.data)].flat();
}

async function fetchAllPostComments(postKey: string, init?: RequestInit): Promise<ApiInteraction[]> {
  const path = `/inbox/posts/${encodeURIComponent(postKey)}/comments?pendingOnly=true&pageSize=200`;
  const first = await fetchJson<{
    data: ApiInteraction[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`${path}&page=1`, init);
  if (first.pagination.totalPages <= 1) return first.data;
  const pages = Array.from({ length: first.pagination.totalPages - 1 }, (_, index) => index + 2);
  const remaining = await mapWithConcurrency(pages, PAGE_FETCH_CONCURRENCY, (page) =>
    fetchJson<{ data: ApiInteraction[] }>(`${path}&page=${page}`, init));
  return [first.data, ...remaining.map((response) => response.data)].flat();
}

export async function loadManualAccountPosts(accountId: string, brandName: string): Promise<ManualPostSummary[]> {
  const posts = await fetchAllInboxPosts(accountId, { cache: "no-store" });
  return posts.map((post) => ({
    postKey: post.postKey,
    accountId: post.accountId,
    platform: post.channel,
    postContext: post.postContext,
    publishedAt: post.publishedAt,
    latestCommentAt: post.latestCommentAt,
    sortAt: post.sortAt,
    sortSource: post.sortSource,
    commentCount: post.commentCount,
    pendingCount: post.pendingCount,
    teamReplyCount: post.teamReplyCount,
    participantCount: post.participantCount,
    latestComment: mapRawInteractions([post.latestComment], brandName)[0]!,
    replyTarget: post.replyTarget
      ? mapRawInteractions([post.replyTarget], brandName)[0]
      : undefined,
    noisePendingCount: post.noisePendingCount ?? 0,
  })).sort((left, right) =>
    Date.parse(right.sortAt) - Date.parse(left.sortAt)
    || Date.parse(right.latestCommentAt) - Date.parse(left.latestCommentAt)
    || right.postKey.localeCompare(left.postKey));
}

export async function loadManualPostComments(postKey: string, brandName: string): Promise<Interaction[]> {
  const interactions = await fetchAllPostComments(postKey, { cache: "no-store" });
  // Primero lo que hay que responder (más antiguo primero); el posible spam, al final.
  return mapRawInteractions(interactions, brandName).sort((left, right) =>
    Number(Boolean(left.noise)) - Number(Boolean(right.noise))
    || Date.parse(left.receivedAt) - Date.parse(right.receivedAt)
    || left.id.localeCompare(right.id));
}

/** Revisión de la bandeja en el servidor; cambia solo cuando hubo una escritura. */
export async function loadInboxRevision(): Promise<string> {
  const response = await fetch(`${API_BASE}/inbox/revision`);
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: { revision: string } };
  return payload.data.revision;
}

/** Marcas de la última carga: los cambios en vivo traen contactos que se muestran con ellas. */
let lastApiBrands: ApiBrand[] = [];

export type InboxChanges = { revision: string; full: boolean; interactions: Interaction[] };

/** Contactos de la bandeja que cambiaron desde una revisión (`full`: hay que recargar todo). */
export async function loadInboxChanges(since: string): Promise<InboxChanges> {
  const response = await fetchJson<{ data: { revision: string; full: boolean; contacts: ApiInboxContact[] } }>(
    `/inbox/changes?since=${encodeURIComponent(since)}`,
    { cache: "no-store" },
  );
  return {
    revision: response.data.revision,
    full: response.data.full,
    interactions: mapInboxContacts(response.data.contacts, lastApiBrands),
  };
}

/** URL de los avisos en vivo de la bandeja (Server-Sent Events). */
export const INBOX_STREAM_URL = `${API_BASE}/inbox/stream`;

export async function loadInboxData(): Promise<InboxData> {
  const noStore: RequestInit = { cache: "no-store" };
  const activityFrom = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const [brandsResponse, contacts, statsResponse, activity30dResponse, workflowResponse, readiness] = await Promise.all([
    fetchJson<{ data: ApiBrand[] }>("/brands", noStore),
    fetchAllInboxContacts(noStore),
    fetchJson<{ data: ApiStats }>("/stats/summary", noStore),
    fetchJson<{ data: ApiStats }>(`/stats/summary?from=${encodeURIComponent(activityFrom)}`, noStore),
    fetchJson<{ data: ApiWorkflow }>("/workflow", noStore),
    fetchJson<ApiReadiness>("/ready", noStore),
  ]);
  lastApiBrands = brandsResponse.data;
  const inboxSync = mapInboxSyncStatus(readiness, workflowResponse.data) ?? {
    enabled: workflowResponse.data.enabled,
    intervalMinutes: workflowResponse.data.pollIntervalMinutes,
  };
  return {
    accounts: mapAccounts(brandsResponse.data, activity30dResponse.data, workflowResponse.data, inboxSync),
    interactions: mapInboxContacts(contacts, brandsResponse.data),
    kpis: mapKpis(statsResponse.data),
    brandPerformance: mapBrandPerformance(brandsResponse.data, statsResponse.data),
    workflow: workflowResponse.data,
    automationSettings: mapAutomationSettings(workflowResponse.data),
    inboxSync,
    loadedAt: new Date().toISOString(),
  };
}

export async function loadOperationalData(): Promise<OperationalData> {
  const activityFrom = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
  const [actorResponse, brandsResponse, contacts, statsResponse, activity30dResponse, workflowResponse, statusReasonsResponse, health, readiness] = await Promise.all([
    fetchJson<{ data: SessionActor }>("/me"),
    fetchJson<{ data: ApiBrand[] }>("/brands"),
    fetchAllInboxContacts(),
    fetchJson<{ data: ApiStats }>("/stats/summary"),
    fetchJson<{ data: ApiStats }>(`/stats/summary?from=${encodeURIComponent(activityFrom)}`),
    fetchJson<{ data: ApiWorkflow }>("/workflow"),
    fetchJson<{ data: StatusReasonCatalog }>("/status-reasons"),
    fetchJson<ApiHealth>("/health"),
    fetchJson<ApiReadiness>("/ready"),
  ]);
  lastApiBrands = brandsResponse.data;

  const inboxSync = mapInboxSyncStatus(readiness, workflowResponse.data) ?? {
    enabled: workflowResponse.data.enabled,
    intervalMinutes: workflowResponse.data.pollIntervalMinutes,
  };
  const accounts = mapAccounts(brandsResponse.data, activity30dResponse.data, workflowResponse.data, inboxSync);
  const interactions = mapInboxContacts(contacts, brandsResponse.data);
  const systemStatus = mapSystemStatus(health, readiness, accounts, workflowResponse.data);
  return {
    actor: actorResponse.data,
    accounts,
    interactions,
    kpis: mapKpis(statsResponse.data),
    brandPerformance: mapBrandPerformance(brandsResponse.data, statsResponse.data),
    recentInteractions: interactions.slice(0, 5),
    automationSettings: mapAutomationSettings(workflowResponse.data),
    workflow: workflowResponse.data,
    statusReasons: statusReasonsResponse.data,
    inboxSync,
    ...systemStatus,
  };
}

export async function loadInteractionDetail(interactionId: string): Promise<InteractionDetail> {
  const [brandsResponse, detailResponse, deliveriesResponse, conversationResponse] = await Promise.all([
    fetchJson<{ data: ApiBrand[] }>("/brands"),
    fetchJson<{ data: ApiInteraction }>(`/interactions/${encodeURIComponent(interactionId)}`),
    fetchJson<{ data: ApiReplyDelivery[] }>(`/deliveries?interactionId=${encodeURIComponent(interactionId)}`),
    fetchJson<{ data: ApiConversationMessage[]; meta?: { contactKey?: string } }>(`/interactions/${encodeURIComponent(interactionId)}/conversation?scope=contact`),
  ]);
  const conversationHistory = conversationResponse.data.map((message) => ({
    id: message.id,
    direction: message.direction,
    text: message.text,
    createdAt: message.createdAt,
    platform: message.channel,
    kind: message.type,
    status: message.status,
    contentContext: message.contentContext,
    postContext: message.postContext,
  }));
  // La persona del caso viaja con su historial: así la vista en vivo reconoce que un cambio en
  // esa conversación (p. ej. la respuesta del chatbot) es del chat abierto y lo refresca, aunque
  // la fila de la lista haya pasado a apuntar a otro mensaje.
  return mapInteractionDetail(
    { ...detailResponse.data, contactKey: detailResponse.data.contactKey ?? conversationResponse.meta?.contactKey },
    brandsResponse.data,
    deliveriesResponse.data,
    conversationHistory,
  );
}

function mapApiRun(value: unknown, newInteractionsOverride?: unknown): RunResult {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const totals =
    record.totals && typeof record.totals === "object"
      ? (record.totals as Record<string, unknown>)
      : {};
  const startedAt = typeof record.startedAt === "string" ? Date.parse(record.startedAt) : Number.NaN;
  const finishedAt = typeof record.finishedAt === "string" ? Date.parse(record.finishedAt) : Number.NaN;
  const explicitNewCount = Array.isArray(newInteractionsOverride)
    ? newInteractionsOverride.length
    : asNumber(newInteractionsOverride, asNumber(totals.created));

  return {
    executionId:
      typeof record.executionId === "string"
        ? record.executionId
        : typeof record.id === "string"
          ? record.id
          : `run-${Date.now()}`,
    status:
      record.status === "partial" || record.status === "failed" ? record.status : "success",
    processed: asNumber(record.processed, asNumber(totals.fetched)),
    newInteractions: asNumber(record.newInteractions, explicitNewCount),
    autoReplied: asNumber(record.autoReplied, asNumber(totals.replied)),
    escalated: asNumber(record.escalated, asNumber(totals.escalated)),
    durationMs: asNumber(
      record.durationMs,
      Number.isFinite(startedAt) && Number.isFinite(finishedAt)
        ? Math.max(0, finishedAt - startedAt)
        : 0,
    ),
    demoMode: record.demoMode === true,
    kind: record.kind === "sync" ? "sync" : "simulation",
    workflowVersion: asNumber(record.workflowVersion, 1),
    startedAt: typeof record.startedAt === "string" ? record.startedAt : undefined,
    finishedAt: typeof record.finishedAt === "string" ? record.finishedAt : undefined,
    retryOf: typeof record.retryOf === "string" ? record.retryOf : undefined,
    auditTrail: Array.isArray(record.auditTrail) ? record.auditTrail as RunResult["auditTrail"] : undefined,
  };
}

export async function listExecutions(): Promise<RunResult[]> {
  const response = await fetchJson<{ data: unknown[] }>("/executions?pageSize=100");
  return response.data.map((item) => mapApiRun(item));
}

export async function retryExecution(executionId: string): Promise<RunResult> {
  const response = await fetch(`${API_BASE}/executions/${encodeURIComponent(executionId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": makeIdempotencyKey("execution-retry") },
    body: "{}",
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  const data = payload.data?.run ? payload.data.run : payload.data;
  return mapApiRun(data);
}

export async function validateCurrentWorkflow(): Promise<WorkflowValidation> {
  const response = await fetch(`${API_BASE}/workflow/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  return payload.data as WorkflowValidation;
}

export async function saveWorkflowGraph(workflow: ApiWorkflow): Promise<ApiWorkflow> {
  const response = await fetch(`${API_BASE}/workflow`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nodes: workflow.nodes, edges: workflow.edges }),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  return payload.data as ApiWorkflow;
}

export async function runWorkflow(): Promise<RunResult> {
  const response = await fetch(`${API_BASE}/workflow/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": makeIdempotencyKey("workflow-run"),
    },
    body: JSON.stringify({}),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  return mapApiRun(payload.data ?? payload);
}

export async function syncMetricool(accountIds?: string[]): Promise<RunResult> {
  const response = await fetch(`${API_BASE}/sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": makeIdempotencyKey("manual-sync"),
    },
    body: JSON.stringify(accountIds?.length ? { accountIds } : {}),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  const data = payload.data ?? payload;
  return mapApiRun(data.run ?? data, data.newInteractions);
}

export interface LiveSyncResult {
  skipped: boolean;
  created: number;
  replied?: number;
  errors?: number;
  checkedAt?: string;
  lastAt?: string;
}

/**
 * Lectura en vivo de la cuenta abierta (DMs o comentarios): rápida, sin esperar la
 * sincronización completa. El servidor la limita a una cada 10 s por cuenta.
 */
export async function liveSyncAccount(accountId: string, surface: "conversations" | "comments"): Promise<LiveSyncResult> {
  const response = await fetch(`${API_BASE}/sync/live`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ accountId, surface }),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: LiveSyncResult };
  return payload.data;
}

export async function evaluateSacProtocol(interactionIds?: string[]): Promise<SacProtocolResult> {
  const total: SacProtocolResult = {
    evaluated: 0,
    reconciledTeamResponses: 0,
    drafted: 0,
    escalated: 0,
    autoReplyCandidates: 0,
    queuedAutoReplies: 0,
    queueSkippedCapacity: 0,
    quarantined: 0,
  };
  const maxBatches = interactionIds?.length ? 1 : 25;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const response = await fetch(`${API_BASE}/sac/protocol/evaluate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": makeIdempotencyKey(`sac-protocol-${batch}`),
      },
      body: JSON.stringify(interactionIds?.length ? { interactionIds, force: true } : { limit: 200 }),
    });
    if (!response.ok) await throwApiError(response);
    const payload = await response.json();
    const current = payload.data as SacProtocolResult;
    total.evaluated += current.evaluated;
    total.reconciledTeamResponses += current.reconciledTeamResponses ?? 0;
    total.drafted += current.drafted;
    total.escalated += current.escalated;
    total.autoReplyCandidates += current.autoReplyCandidates;
    total.queuedAutoReplies += current.queuedAutoReplies ?? 0;
    total.queueSkippedCapacity += current.queueSkippedCapacity ?? 0;
    total.quarantined += current.quarantined;
    if (interactionIds?.length || current.evaluated < 200) break;
  }
  return total;
}

export async function saveMetricoolAccountCredentials(
  accountId: string,
  credentials: {
    userId: string;
    blogId: string;
    instagramProvider: "INSTAGRAMBUSINESS" | "INSTAGRAM";
  },
): Promise<void> {
  const response = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/metricool`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  if (!response.ok) await throwApiError(response);
}

export async function disconnectMetricoolAccount(accountId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/accounts/${encodeURIComponent(accountId)}/metricool`, {
    method: "DELETE",
  });
  if (!response.ok) await throwApiError(response);
}

export async function connectBrandWorkbook(brandId: string, spreadsheetUrl: string): Promise<BrandWorkbook> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/workbook`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spreadsheetUrl }),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  return payload.data as BrandWorkbook;
}

export async function downloadBrandWorkbook(brandId: string, brandName: string): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/workbook/export`);
  if (!response.ok) await throwApiError(response);
  const blob = await response.blob();
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${brandName.toLocaleLowerCase("es-CL").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || brandId}-registros.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

export async function connectBrandQaWorkbook(brandId: string, spreadsheetUrl: string): Promise<BrandQaWorkbook> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/qa-workbook`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spreadsheetUrl }),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  return payload.data as BrandQaWorkbook;
}

export async function downloadBrandQaTemplate(brandId: string, brandName: string): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/qa-workbook/template`);
  if (!response.ok) await throwApiError(response);
  const blob = await response.blob();
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${brandName.toLocaleLowerCase("es-CL").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || brandId}-qa-aprobado.xlsx`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

export async function addBrandResource(
  brandId: string,
  input: { name: string; url: string; kind: BrandResourceKind },
): Promise<BrandResource> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/resources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  return payload.data as BrandResource;
}

export async function removeBrandResource(brandId: string, resourceId: string): Promise<void> {
  const response = await fetch(
    `${API_BASE}/brands/${encodeURIComponent(brandId)}/resources/${encodeURIComponent(resourceId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) await throwApiError(response);
}

export async function createBrand(input: BrandAdminInput): Promise<void> {
  const response = await fetch(`${API_BASE}/brands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(input.brandId ? { id: input.brandId } : {}),
      ...(input.accountId ? { accountId: input.accountId } : {}),
      name: input.name,
      color: input.color,
      accountName: input.accountName || input.name,
      accountHandle: input.accountHandle,
      channels: input.channels,
      active: input.active ?? true,
      accountActive: input.accountActive ?? input.active ?? true,
    }),
  });
  if (!response.ok) await throwApiError(response);
}

export async function updateBrand(brandId: string, input: BrandAdminInput): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      color: input.color,
      accountName: input.accountName || input.name,
      accountHandle: input.accountHandle,
      channels: input.channels,
      active: input.active ?? true,
      accountActive: input.accountActive ?? input.active ?? true,
    }),
  });
  if (!response.ok) await throwApiError(response);
}

/** Marca del portafolio de Metricool visible para el token del servidor. */
export interface MetricoolCatalogBrand {
  blogId: string;
  label: string;
  channels: string[];
  linkedTo?: { brandId: string; brandName: string; active?: boolean };
}

export interface MetricoolImportResult {
  created: Array<{ blogId: string; brandId: string; accountId: string; name: string }>;
  skipped: Array<{ blogId: string; reason: string }>;
}

/** Lista las marcas que el token de Metricool ve (solo lectura; requiere admin). */
export async function listMetricoolBrands(): Promise<MetricoolCatalogBrand[]> {
  const response = await fetch(`${API_BASE}/metricool/brands`);
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: MetricoolCatalogBrand[] };
  return payload.data;
}

async function accessControlRequest<T = AccessControlListing>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: T };
  return payload.data;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

/** Usuarios y roles (solo admin): personas, roles y catálogo de permisos. */
export function listUserAccess(): Promise<AccessControlListing> {
  return accessControlRequest("/admin/users");
}

/** Asigna un rol (o con null vuelve a la regla del servidor). El correo viaja en el cuerpo. */
export function setUserAccessRole(email: string, role: AccessRole | null): Promise<AccessControlListing & { user?: UserAccessView }> {
  return accessControlRequest("/admin/users/role", jsonInit("PUT", { email, role }));
}

/** Ajusta los permisos de una persona en específico; null quita sus ajustes. */
export function setUserPermissions(email: string, permissions: string[] | null): Promise<AccessControlListing & { user?: UserAccessView }> {
  return accessControlRequest("/admin/users/permissions", jsonInit("PUT", { email, permissions }));
}

/** Clientes que una persona no ve (solo admin principal); lista vacía = ve todos. */
export function setUserHiddenBrands(email: string, brandIds: string[]): Promise<AccessControlListing & { user?: UserAccessView }> {
  return accessControlRequest("/admin/users/hidden-brands", jsonInit("PUT", { email, brandIds }));
}

export function createAccessRole(input: { name: string; baseRole: "viewer" | "agent" | "supervisor"; permissions: string[] }): Promise<AccessControlListing & { roleId: string }> {
  return accessControlRequest("/admin/roles", jsonInit("POST", input));
}

export function updateAccessRole(roleId: string, input: { name?: string; permissions: string[] }): Promise<AccessControlListing> {
  return accessControlRequest(`/admin/roles/${encodeURIComponent(roleId)}`, jsonInit("PUT", input));
}

/** Borra un rol propio o restablece un rol de base a sus permisos por defecto. */
export function deleteAccessRole(roleId: string): Promise<AccessControlListing> {
  return accessControlRequest(`/admin/roles/${encodeURIComponent(roleId)}`, jsonInit("DELETE"));
}

/** Crea marcas locales a partir del catálogo de Metricool. No escribe en Metricool. */
export async function importMetricoolBrands(
  blogIds: string[],
  instagramProvider: "INSTAGRAMBUSINESS" | "INSTAGRAM",
): Promise<MetricoolImportResult> {
  const response = await fetch(`${API_BASE}/metricool/brands/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blogIds, instagramProvider }),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: MetricoolImportResult };
  return payload.data;
}

export async function deactivateBrand(brandId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}`, {
    method: "DELETE",
  });
  if (!response.ok) await throwApiError(response);
}

/** Oculta o vuelve a mostrar un cliente (solo admin principal). */
export async function setBrandVisibility(brandId: string, hidden: boolean): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/visibility`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ hidden }),
  });
  if (!response.ok) await throwApiError(response);
}

/** Marca qué redes de la cuenta se usan hoy en SAC (solo admin principal). Lista vacía: no se usa. */
export async function setBrandSacUsage(brandId: string, channels: SocialPlatform[]): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/sac-usage`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channels }),
  });
  if (!response.ok) await throwApiError(response);
}

/** Mensajes recibidos por día UTC, cuenta y red (tablero de Clientes; sin registros de planilla). */
export interface MessageVolumeRow {
  date: string;
  brandId: string;
  accountId: string;
  channel: SocialPlatform;
  dms: number;
  comments: number;
  reviews: number;
  total: number;
}

export async function loadMessageVolume(from: string, to: string, signal?: AbortSignal): Promise<{ from: string; to: string; rows: MessageVolumeRow[] }> {
  const params = new URLSearchParams({ from, to });
  const response = await fetch(`${API_BASE}/stats/messages?${params}`, { signal });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: { from: string; to: string; rows: MessageVolumeRow[] } };
  return payload.data;
}

export type ManualRecordsChannel = "tiktok" | "linkedin";

/** Resultado de revisar o cargar el Excel BD SAC de TikTok/LinkedIn. */
export interface ManualRecordsSummary {
  dryRun: boolean;
  hoja: string;
  leidas: number;
  nuevas: number;
  creadas: number;
  yaCargadas: number;
  yaEnNodes: number;
  repetidasEnArchivo: number;
  otraRed: number;
  invalidas: number;
  problemas: Array<{ fila: number; motivo: string }>;
  porRed: Record<ManualRecordsChannel, number>;
  porTipo: Record<"dm" | "comment", number>;
  desde?: string;
  hasta?: string;
}

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function uploadManualRecords(
  brandId: string,
  file: File,
  options: { dryRun: boolean; red?: ManualRecordsChannel },
): Promise<ManualRecordsSummary> {
  const query = new URLSearchParams({ dryRun: String(options.dryRun), archivo: file.name.slice(0, 200) });
  if (options.red) query.set("red", options.red);
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}/manual-records?${query}`, {
    method: "POST",
    headers: { "Content-Type": XLSX_CONTENT_TYPE },
    body: file,
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: ManualRecordsSummary };
  return payload.data;
}

export async function downloadManualRecordsTemplate(): Promise<void> {
  const response = await fetch(`${API_BASE}/manual-records/template`);
  if (!response.ok) await throwApiError(response);
  const blob = await response.blob();
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = "plantilla-bd-sac-tiktok-linkedin.xlsx";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(anchor.href);
}

export async function saveInteractionReply(
  interactionId: string,
  text: string,
  mode: "draft" | "send" = "draft",
  expectedVersion = 1,
  options: { followUp?: boolean } = {},
): Promise<void> {
  const response = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": makeIdempotencyKey(`reply-${interactionId}`),
    },
    body: JSON.stringify({
      text,
      mode,
      approvedByHuman: mode === "send",
      expectedVersion,
      ...(mode === "send" && options.followUp ? { followUp: true } : {}),
    }),
  });
  if (!response.ok) await throwApiError(response);
}

export async function deleteInteractionDraft(interactionId: string, expectedVersion: number): Promise<void> {
  const response = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}/draft`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedVersion }),
  });
  if (!response.ok) await throwApiError(response);
}

export async function reconcileReplyDelivery(
  deliveryId: string,
  outcome: "sent" | "failed" | "cancelled",
  expectedVersion: number,
  note: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/deliveries/${encodeURIComponent(deliveryId)}/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome, expectedVersion, note }),
  });
  if (!response.ok) await throwApiError(response);
}

export type ArchiveExpiredResult = { dryRun: boolean; archived: number; eligible: number; skippedSensitive: number };

/**
 * Archiva como histórico los casos fuera de plazo (sin tocar Metricool ni casos sensibles).
 * Con dryRun solo cuenta cuántos se archivarían.
 */
export async function archiveExpiredInteractions(input: { dryRun: boolean; accountId?: string; type?: "dm" | "comment" }): Promise<ArchiveExpiredResult> {
  const response = await fetch(`${API_BASE}/interactions/archive-expired`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json() as { data: ArchiveExpiredResult };
  return payload.data;
}

export async function updateInteractionStatus(
  interactionId: string,
  status: "pending" | "escalated" | "resolved",
  reasonCode: string,
  reasonNote?: string,
  expectedVersion = 1,
): Promise<void> {
  const response = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reasonCode, ...(reasonNote ? { reasonNote } : {}), expectedVersion }),
  });
  if (!response.ok) await throwApiError(response);
}

export async function updateInteractionAssignment(
  interactionId: string,
  expectedVersion: number,
  action: "claim" | "release",
): Promise<void> {
  const response = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}/assignment`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, expectedVersion }),
  });
  if (!response.ok) await throwApiError(response);
}

/** Marca a mano si el mensaje es caso SAC para el reporte; `null` vuelve a la decisión automática. */
export async function setInteractionTriage(
  interactionId: string,
  expectedVersion: number,
  esCasoSac: boolean | null,
  requiereDerivacion = false,
): Promise<void> {
  const response = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}/triage`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ esCasoSac, requiereDerivacion, expectedVersion }),
  });
  if (!response.ok) await throwApiError(response);
}

export interface AiAvailability {
  /** La recomendación de respuesta con IA está encendida y esta persona puede pedirla. */
  replyDrafts: boolean;
  reason?: "disabled" | "missing_api_key" | "no_brands";
  provider?: "byteplus" | "anthropic";
  model?: string;
  /** Marcas del alcance de la persona autorizadas a usar la IA, y sus cuentas. */
  brandIds: string[];
  accountIds: string[];
  /** Asistente de ayuda: con IA, o solo con las respuestas escritas de la guía. */
  helpAssistant?: "ia" | "guia";
}

export interface HelpMessage {
  role: "user" | "assistant";
  content: string;
}

export class HelpAssistantRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "HelpAssistantRequestError";
  }
}

/** Pregunta al asistente de ayuda (solo orienta; no ejecuta acciones ni ve casos). */
export async function askHelpAssistant(
  messages: HelpMessage[],
  view: string,
  signal?: AbortSignal,
): Promise<{ answer: string; source: "ia" | "guia" }> {
  const response = await fetch(`${API_BASE}/help/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, view }),
    signal,
  });
  const payload = await response.json().catch(() => null) as
    | { data?: { answer?: unknown; source?: "ia" | "guia" }; error?: { message?: string } }
    | null;
  if (!response.ok) {
    throw new HelpAssistantRequestError(
      response.status === 401
        ? "Tu sesión no pudo validarse. Recarga la página."
        : payload?.error?.message || "No se pudo consultar al asistente.",
      response.status,
    );
  }
  if (typeof payload?.data?.answer !== "string") {
    throw new HelpAssistantRequestError("No llegó una respuesta válida. Intenta de nuevo.", response.status);
  }
  return { answer: payload.data.answer, source: payload.data.source === "guia" ? "guia" : "ia" };
}

export interface AiReplyDraft {
  texto: string;
  fuentes: Array<{ id: string; intent: string; sourceLabel: string }>;
  sinRespuestaAprobada: boolean;
  requiereHumano: boolean;
  motivo: string;
  advertencias: string[];
  proveedor: string;
  modelo: string;
  generadoEn: string;
  cached: boolean;
}

let aiAvailabilityRequest: Promise<AiAvailability> | undefined;

/** Disponibilidad de la IA; se consulta una vez por sesión del navegador. */
export function loadAiAvailability(): Promise<AiAvailability> {
  aiAvailabilityRequest ??= fetch(`${API_BASE}/ai/availability`)
    .then(async (response) => {
      if (!response.ok) await throwApiError(response);
      return ((await response.json()) as { data: AiAvailability }).data;
    })
    .catch(() => {
      aiAvailabilityRequest = undefined;
      return { replyDrafts: false, brandIds: [], accountIds: [] };
    });
  return aiAvailabilityRequest;
}

/** Pide la recomendación de respuesta con IA de un caso. No guarda ni envía nada. */
export async function requestAiReplyDraft(interactionId: string, regenerate = false): Promise<AiReplyDraft> {
  const response = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}/ai/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(regenerate ? { regenerate: true } : {}),
  });
  if (!response.ok) await throwApiError(response);
  return ((await response.json()) as { data: AiReplyDraft }).data;
}

export interface DiscardNoiseResult {
  dryRun: boolean;
  discarded: number;
  eligible: number;
  skippedSensitive: number;
  byKind: Partial<Record<NoiseSignal["kind"], number>>;
  byOrigin: Partial<Record<NoiseSignal["origen"], number>>;
}

/** Descarta como spam lo señalado (reglas y sugerencias de IA). Primero con dryRun; nunca toca Metricool. */
export async function discardNoiseInteractions(input: {
  dryRun: boolean;
  accountId?: string;
  type?: "dm" | "comment";
  postKey?: string;
  includeAi?: boolean;
}): Promise<DiscardNoiseResult> {
  const response = await fetch(`${API_BASE}/interactions/discard-noise`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) await throwApiError(response);
  return ((await response.json()) as { data: DiscardNoiseResult }).data;
}

/** Marca en lote los mensajes entrantes de las conversaciones elegidas (sin pisar marcas manuales). */
export async function markContactsTriage(contactKeys: string[], esCasoSac: boolean): Promise<{ updated: number; contacts: number }> {
  const response = await fetch(`${API_BASE}/interactions/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactKeys, esCasoSac }),
  });
  if (!response.ok) await throwApiError(response);
  return ((await response.json()) as { data: { updated: number; contacts: number } }).data;
}

export async function addInteractionInternalNote(
  interactionId: string,
  text: string,
  expectedVersion: number,
): Promise<void> {
  const response = await fetch(`${API_BASE}/interactions/${encodeURIComponent(interactionId)}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, expectedVersion }),
  });
  if (!response.ok) await throwApiError(response);
}

async function updateWorkflow(patch: Record<string, unknown>): Promise<ApiWorkflow> {
  const response = await fetch(`${API_BASE}/workflow`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!response.ok) await throwApiError(response);
  const payload = await response.json();
  return payload.data as ApiWorkflow;
}

export function setWorkflowEnabled(enabled: boolean): Promise<ApiWorkflow> {
  return updateWorkflow({ enabled });
}

export async function saveAutomationSettings(
  settings: AutomationSettings,
  autoReplyAccountIds: string[],
): Promise<void> {
  const requireHumanFor = [
    "amenaza",
    "crisis",
    "datos_personales",
    "fraude",
    "legal",
    "pago",
    "reclamo",
    "reclamo_critico",
    "salud",
    "seguridad",
  ];
  await updateWorkflow({
    autoReplyEnabled: settings.automaticRepliesEnabled,
    autoReplyAccountIds,
    confirmAutoReply: true,
    minimumConfidence: settings.confidenceThreshold / 100,
    pollIntervalMinutes: settings.pollingIntervalMinutes,
    requireHumanFor,
  });
}

export async function setAccountAutomation(
  accountId: string,
  enabled: boolean,
  workflow: ApiWorkflow,
): Promise<void> {
  const ids = new Set(workflow.autoReplyAccountIds);
  if (enabled) ids.add(accountId);
  else ids.delete(accountId);
  const autoReplyAccountIds = [...ids];
  await updateWorkflow({
    autoReplyEnabled: enabled ? true : workflow.autoReplyEnabled && autoReplyAccountIds.length > 0,
    autoReplyAccountIds,
    confirmAutoReply: true,
  });
}

/** Cifras del informe SAC del mes (AAAA-MM) para cada marca activa. */
export async function loadSacMonthlyReport(month: string, volumen: "gestionado" | "bruto" = "gestionado"): Promise<SacMonthlyReport> {
  const query = new URLSearchParams({ month, volumen });
  const response = await fetchJson<{ data: SacMonthlyReport }>(`/reports/sac?${query}`, { cache: "no-store" });
  return response.data;
}

/** Descarga el Excel de interacciones; acepta período (ISO) y marca. */
export async function downloadExport(filters: { from?: string; to?: string; brandId?: string } = {}) {
  const query = new URLSearchParams();
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.brandId) query.set("brandId", filters.brandId);
  const response = await fetch(`${API_BASE}/export/xlsx${query.size ? `?${query}` : ""}`);
  if (!response.ok) await throwApiError(response);
  const blob = await response.blob();
  // El servidor nombra el archivo con la marca y el rango; se usa ese nombre si viene.
  const disposition = response.headers.get("content-disposition") ?? "";
  const serverName = disposition.match(/filename="([^"]+)"/)?.[1];
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = serverName ?? `sac-flow-${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(href);
}
