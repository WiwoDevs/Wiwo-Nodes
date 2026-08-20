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
  ProjectRequirement,
  SacAutomationAssessment,
  BrandWorkbook,
  BrandQaWorkbook,
  BrandResource,
  BrandResourceKind,
  ConversationMessage,
  InboxSyncStatus,
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
};

type ApiInboxContact = {
  contactKey: string;
  brandId: string;
  accountId: string;
  channel: SocialPlatform;
  customerName: string;
  customerHandle: string;
  replyTarget?: ApiInteraction;
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
        detail: health.demoMode ? "La API opera con datos ficticios; no se contacta Metricool." : health.metricool.configured ? "Token presente; falta completar o validar referencias de cuenta." : "Falta configurar el token en el servidor.",
        lastCheckedLabel: checked,
      },
      {
        id: "excel-export", kind: "excel", name: "Exportación Excel",
        description: "Archivo consolidado con detalle y resumen por marca.",
        status: readiness.status === "ready" ? "ready" : "offline",
        statusLabel: readiness.status === "ready" ? "Disponible" : "No disponible",
        detail: "La exportación se genera exclusivamente en el backend.", lastCheckedLabel: checked,
      },
      {
        id: "automation-engine", kind: "automation", name: "Motor de automatización",
        description: "Workflows visuales, webhooks, transformaciones y ejecución auditable.",
        status: readiness.status === "ready" ? "ready" : "offline",
        statusLabel: readiness.status === "ready" ? "Disponible" : "No disponible",
        detail: protectedDevelopment ? "Egress y mutaciones externas bloqueados por el protocolo de desarrollo." : "Hay capacidades externas habilitadas; revisa las políticas del entorno.",
        lastCheckedLabel: checked,
      },
      {
        id: "persistence", kind: "storage", name: "Persistencia",
        description: "Conserva configuraciones, deduplicación e historial de ejecución.",
        status: readiness.checks.repository.status === "ok" ? "ready" : "offline",
        statusLabel: readiness.checks.repository.status === "ok" ? "Operativa" : "Sin conexión",
        detail: `Repositorio ${health.persistence.driver === "postgres" ? "PostgreSQL" : "JSON local"}.`, lastCheckedLabel: checked,
      },
    ],
    environmentChecks: [
      { id: "frontend", kind: "frontend", label: "Aplicación web", value: "Vite + React", status: "ready", detail: "La interfaz cargó correctamente desde el entorno actual." },
      { id: "api", kind: "api", label: "API de aplicación", value: "Fastify", status: readiness.status === "ready" ? "ready" : "offline", detail: readiness.status === "ready" ? "Health y readiness respondieron correctamente." : "La comprobación de readiness falló." },
      {
        id: "worker",
        kind: "worker",
        label: "Worker durable",
        value: health.persistence.driver === "postgres"
          ? `PostgreSQL · ${health.operations.autoReplyDispatchMode === "live" ? "live" : "sombra"}`
          : "Pendiente",
        status: "needs_action",
        detail: health.operations.autoReplyDispatchMode === "live"
          ? "El despacho automático está armado; comprueba el heartbeat del worker y ambos cortacorrientes antes del UAT."
          : "Modo sombra: clasifica y mide candidatas, pero el worker no contacta Metricool.",
      },
      {
        id: "reply-outbox",
        kind: "worker",
        label: "Cola de respuestas SAC",
        value: `${readiness.checks.replyOutbox?.pending ?? 0}/${readiness.checks.replyOutbox?.maxPending ?? health.operations.autoReplyMaxPending}`,
        status: readiness.checks.replyOutbox?.status === "saturated" ? "needs_action" : "ready",
        detail: readiness.checks.replyOutbox?.status === "saturated"
          ? "Capacidad alcanzada: las nuevas candidatas quedan retenidas para revisión y no se envían."
          : "La cola durable conserva margen para nuevas auto-respuestas.",
      },
      { id: "database", kind: "database", label: "Base de datos", value: health.persistence.driver === "postgres" ? "PostgreSQL" : "JSON local", status: readiness.checks.repository.status === "ok" ? "ready" : "offline", detail: `${readiness.checks.repository.brands ?? 0} marcas y ${readiness.checks.repository.interactions ?? 0} interacciones accesibles.` },
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

function initials(value: string): string {
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
  return new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
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
    return {
      id: replyTarget?.id ?? contact.latest.id,
      version: replyTarget?.version,
      contactKey: contact.contactKey,
      accountId: contact.accountId,
      brandName,
      brandInitials: initials(brandName),
      customerName: contact.customerName,
      customerHandle: contact.customerHandle,
      platform: contact.channel,
      kind: replyTarget?.type ?? contact.latest.type,
      direction: replyTarget?.direction ?? contact.latest.direction,
      preview: contact.latest.text,
      receivedAt: contact.latest.createdAt,
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
  const protocolCoverage = stats.automationScope
    ? Math.round((stats.automationEvaluated / stats.automationScope) * 1000) / 10
    : 0;
  return [
    {
      id: "interactions",
      label: "Interacciones registradas",
      value: new Intl.NumberFormat("es-CL").format(stats.total),
      detail: `${stats.dms} DMs · ${stats.comments} comentarios · ${stats.reviews} reseñas`,
      change: "Dato servidor",
      trend: "neutral",
    },
    {
      id: "pending",
      label: "Pendientes de respuesta",
      value: new Intl.NumberFormat("es-CL").format(stats.pending),
      detail: `${stats.escalated} derivadas a revisión`,
      change: "Dato servidor",
      trend: stats.pending ? "down" : "neutral",
    },
    {
      id: "automation",
      label: "Cobertura del protocolo",
      value: `${protocolCoverage}%`,
      detail: `${stats.autoReplyCandidates} candidatas · ${stats.knowledgeBlocked} bloqueadas por conocimiento`,
      change: "Dato servidor",
      trend: "neutral",
    },
    {
      id: "response_time",
      label: "Tiempo medio de respuesta",
      value: stats.averageResponseMinutes === null ? "Sin datos" : `${stats.averageResponseMinutes} min`,
      detail: `${stats.responseRate}% de interacciones respondidas`,
      change: "Dato servidor",
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
      brandName: brand.brandName,
      handle: account?.handle ?? brand.brandId,
      initials: initials(brand.brandName),
      totalInteractions: brand.total,
      directMessages: brand.dms,
      comments: brand.comments,
      reviews: brand.reviews,
      pending: brand.pending,
      automaticResponseRate: brand.total ? Math.round((brand.replied / brand.total) * 100) : 0,
      averageResponseMinutes: stats.averageResponseMinutes ?? 0,
      changePercent: 0,
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

async function fetchAllInboxContacts(init?: RequestInit): Promise<ApiInboxContact[]> {
  const first = await fetchJson<{
    data: ApiInboxContact[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>("/inbox/contacts?page=1&pageSize=200", init);
  if (first.pagination.totalPages <= 1) return first.data;
  const remaining = await Promise.all(
    Array.from({ length: first.pagination.totalPages - 1 }, (_, index) => index + 2).map((page) =>
      fetchJson<{ data: ApiInboxContact[] }>(`/inbox/contacts?page=${page}&pageSize=200`, init),
    ),
  );
  return [first.data, ...remaining.map((response) => response.data)].flat();
}

async function fetchAllInboxPosts(accountId: string, init?: RequestInit): Promise<ApiInboxPost[]> {
  const query = `accountId=${encodeURIComponent(accountId)}&pendingOnly=false&pageSize=200`;
  const first = await fetchJson<{
    data: ApiInboxPost[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`/inbox/posts?${query}&page=1`, init);
  if (first.pagination.totalPages <= 1) return first.data;
  const remaining = await Promise.all(
    Array.from({ length: first.pagination.totalPages - 1 }, (_, index) => index + 2).map((page) =>
      fetchJson<{ data: ApiInboxPost[] }>(`/inbox/posts?${query}&page=${page}`, init),
    ),
  );
  return [first.data, ...remaining.map((response) => response.data)].flat();
}

async function fetchAllPostComments(postKey: string, init?: RequestInit): Promise<ApiInteraction[]> {
  const path = `/inbox/posts/${encodeURIComponent(postKey)}/comments?pendingOnly=true&pageSize=200`;
  const first = await fetchJson<{
    data: ApiInteraction[];
    pagination: { page: number; pageSize: number; total: number; totalPages: number };
  }>(`${path}&page=1`, init);
  if (first.pagination.totalPages <= 1) return first.data;
  const remaining = await Promise.all(
    Array.from({ length: first.pagination.totalPages - 1 }, (_, index) => index + 2).map((page) =>
      fetchJson<{ data: ApiInteraction[] }>(`${path}&page=${page}`, init),
    ),
  );
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
  })).sort((left, right) =>
    Date.parse(right.sortAt) - Date.parse(left.sortAt)
    || Date.parse(right.latestCommentAt) - Date.parse(left.latestCommentAt)
    || right.postKey.localeCompare(left.postKey));
}

export async function loadManualPostComments(postKey: string, brandName: string): Promise<Interaction[]> {
  const interactions = await fetchAllPostComments(postKey, { cache: "no-store" });
  return mapRawInteractions(interactions, brandName).sort((left, right) =>
    Date.parse(left.receivedAt) - Date.parse(right.receivedAt)
    || left.id.localeCompare(right.id));
}

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
    fetchJson<{ data: ApiConversationMessage[] }>(`/interactions/${encodeURIComponent(interactionId)}/conversation?scope=contact`),
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
  return mapInteractionDetail(detailResponse.data, brandsResponse.data, deliveriesResponse.data, conversationHistory);
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

export async function deactivateBrand(brandId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/brands/${encodeURIComponent(brandId)}`, {
    method: "DELETE",
  });
  if (!response.ok) await throwApiError(response);
}

export async function saveInteractionReply(
  interactionId: string,
  text: string,
  mode: "draft" | "send" = "draft",
  expectedVersion = 1,
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

export async function downloadExport() {
  const response = await fetch(`${API_BASE}/export/xlsx`);
  if (!response.ok) throw new Error("No se pudo generar el Excel");
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `sac-flow-${new Date().toISOString().slice(0, 10)}.xlsx`;
  anchor.click();
  URL.revokeObjectURL(href);
}
