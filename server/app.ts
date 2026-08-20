import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import cors from "@fastify/cors";
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from "fastify";
import { ZodError } from "zod";
import { loadConfig, resolveMetricoolAccount, type AppConfig } from "./config.js";
import { buildInteractionsWorkbook } from "./excel-export.js";
import { buildBrandWorkbookExport, inspectBrandWorkbook } from "./brand-workbook.js";
import { buildBrandQaTemplate, inspectBrandQaWorkbook } from "./brand-qa-workbook.js";
import {
  MetricoolClient,
  MetricoolRequestError,
  type MetricoolGateway,
} from "./metricool-client.js";
import { createRepository } from "./repository-factory.js";
import type { SacFlowRepository } from "./repository-contract.js";
import {
  ensureMandatoryHumanReviewCategories,
  requiresHumanReview,
} from "./safety-policy.js";
import {
  INTERACTION_STATUS_REASON_CATALOG,
  statusReasonFor,
} from "./status-policy.js";
import {
  accountMetricoolUpdateSchema,
  accountParamsSchema,
  apiSessionSchema,
  brandCreateSchema,
  brandParamsSchema,
  brandQaWorkbookUpdateSchema,
  brandResourceCreateSchema,
  brandResourceParamsSchema,
  brandUpdateSchema,
  brandWorkbookUpdateSchema,
  executionListQuerySchema,
  executionParamsSchema,
  idempotencyKeySchema,
  inboxContactListQuerySchema,
  inboxPostCommentsQuerySchema,
  inboxPostListQuerySchema,
  inboxPostParamsSchema,
  interactionAssignmentSchema,
  interactionConversationQuerySchema,
  interactionDraftDeleteSchema,
  interactionFiltersSchema,
  interactionListQuerySchema,
  interactionNoteCreateSchema,
  interactionParamsSchema,
  interactionStatusUpdateSchema,
  jobListQuerySchema,
  jobParamsSchema,
  replySchema,
  replyDeliveryListQuerySchema,
  replyDeliveryParamsSchema,
  replyDeliveryReconcileSchema,
  sacProtocolRunSchema,
  syncSchema,
  workflowPublishSchema,
  workflowRollbackSchema,
  workflowRunSchema,
  workflowUpdateSchema,
} from "./schemas.js";
import type {
  ActorContext,
  ActorRole,
  Brand,
  Channel,
  ConversationMessage,
  DataStore,
  Interaction,
  InteractionFilters,
  MetricoolAccountReference,
  MetricoolInboxProvider,
  PublicBrand,
  PublicMetricoolAccountState,
  RunAuditStep,
  StoredIdempotencyRecord,
  WorkflowRun,
  WorkflowVersion,
} from "./types.js";
import {
  metricoolInboxSurfacesForChannel,
  metricoolProviderForChannel,
  metricoolProviderForSurface,
  type MetricoolInboxSurface,
} from "./types.js";
import {
  createDemoSyncInteractions,
  normalizeMetricoolComments,
  normalizeMetricoolConnectedChannels,
  normalizeMetricoolConversations,
  normalizeMetricoolReviews,
  simulateWorkflow,
} from "./workflow-service.js";
import { validateWorkflow } from "./workflow-validation.js";
import { buildSecurityAudit } from "./security-audit.js";
import {
  conversationKey,
  detectConversationResponses,
  evaluateSacInteraction,
  processSacInteractions,
  reconcileConversationResponses,
} from "./sac-automation.js";
import { queueEligibleAutoReplies } from "./auto-reply-outbox.js";
import { registerAutomationRoutes } from "./automation-routes.js";
import { AutomationServiceError } from "./automation-service.js";
import {
  contactKeyFor,
  groupInboxContacts,
  groupInboxPosts,
  interactionsForInboxPost,
  interactionsForContact,
  pendingCommentsForInboxPost,
  publicInboxInteraction,
  publicPostContext,
} from "./inbox-contacts.js";

class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export interface BuildAppOptions {
  config?: AppConfig;
  repository?: SacFlowRepository;
  metricoolClient?: MetricoolGateway;
  logger?: FastifyServerOptions["logger"];
  serveFrontend?: boolean;
}

export interface SacFlowApp extends FastifyInstance {
  sacFlow: {
    config: AppConfig;
    repository: SacFlowRepository;
  };
}

function apiMeta(config: AppConfig): { demoMode: boolean; mode: "demo" | "live" } {
  return { demoMode: config.demoMode, mode: config.mode };
}

function metricoolAccountState(
  config: AppConfig,
  accountId: string,
  stored?: MetricoolAccountReference,
): PublicMetricoolAccountState {
  const storedConfigured = Boolean(stored?.userId && stored?.blogId);
  const envConfigured = Boolean(config.metricool.accounts[accountId]);
  const fallbackConfigured = Boolean(config.metricool.fallbackAccount && config.metricool.allowFallbackAccount);
  const source = envConfigured
    ? "env"
    : storedConfigured
      ? "stored"
      : fallbackConfigured
        ? "fallback"
        : "none";
  const effectiveReferenceConfigured = source !== "none";
  const effectiveReference = resolveMetricoolAccount(config, accountId, stored);

  return {
    referenceStored: storedConfigured,
    tokenConfigured: Boolean(config.metricool.token),
    liveReady: !config.demoMode && Boolean(config.metricool.token) && effectiveReferenceConfigured,
    source,
    configurationLocked: source === "env" || source === "fallback",
    instagramProvider: effectiveReference?.instagramProvider || "INSTAGRAMBUSINESS",
  };
}

function publicAccountMetricoolDetail(
  config: AppConfig,
  brand: Brand,
) {
  const state = metricoolAccountState(
    config,
    brand.account.id,
    brand.account.metricool,
  );
  return {
    accountId: brand.account.id,
    brandId: brand.id,
    brandName: brand.name,
    accountName: brand.account.name,
    accountHandle: brand.account.handle,
    active: brand.active && brand.account.active,
    metricoolConfigured: state.liveReady,
    metricool: state,
  };
}

function publicBrand(config: AppConfig, brand: Brand): PublicBrand {
  const { metricool, ...account } = brand.account;
  const state = metricoolAccountState(
    config,
    account.id,
    metricool,
  );
  return {
    ...brand,
    account: {
      ...account,
      metricoolConfigured: state.liveReady,
      metricool: state,
    },
  };
}

function safeTokenEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function headerString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function extractApiKey(headers: Record<string, unknown>): string | undefined {
  const explicit = headerString(headers["x-api-key"])?.trim();
  if (explicit) return explicit;
  const authorization = headerString(headers.authorization)?.trim();
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || undefined;
}

const API_SESSION_COOKIE = "sac_flow_session";
const API_SESSION_TTL_SECONDS = 8 * 60 * 60;

function apiSessionToken(signingKey: Buffer, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({
    expiresAt: now + API_SESSION_TTL_SECONDS * 1_000,
    nonce: randomUUID(),
  })).toString("base64url");
  const signature = createHmac("sha256", signingKey).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function requestCookie(headers: Record<string, unknown>, name: string): string | undefined {
  const cookie = headerString(headers.cookie);
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

function validApiSession(headers: Record<string, unknown>, signingKey: Buffer, now = Date.now()): boolean {
  const token = requestCookie(headers, API_SESSION_COOKIE);
  const [payload, signature, ...extra] = token?.split(".") ?? [];
  if (!payload || !signature || extra.length) return false;
  const expected = createHmac("sha256", signingKey).update(payload).digest("base64url");
  if (!safeTokenEqual(signature, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { expiresAt?: unknown };
    return typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > now;
  } catch {
    return false;
  }
}

function isMutationMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function browserMutationOriginAllowed(config: AppConfig, request: FastifyRequest): boolean {
  const headers = request.headers as Record<string, unknown>;
  const fetchSite = headerString(headers["sec-fetch-site"])?.trim().toLowerCase();
  if (fetchSite === "cross-site") return false;

  const origin = headerString(headers.origin)?.trim();
  if (!origin) return true;
  if (config.security.corsOrigins === true) return true;
  const host = headerString(headers.host)?.trim().toLowerCase();
  let isSameOrigin = false;
  try {
    isSameOrigin = Boolean(host && new URL(origin).host.toLowerCase() === host);
  } catch {
    return false;
  }
  if (Array.isArray(config.security.corsOrigins)) {
    return isSameOrigin || config.security.corsOrigins.includes(origin);
  }
  return isSameOrigin;
}

const ROLE_RANK: Record<ActorRole, number> = {
  viewer: 0,
  agent: 1,
  supervisor: 2,
  admin: 3,
};

function parseBrandScope(value: string | undefined): ActorContext["brandIds"] {
  if (!value || value.trim() === "" || value.trim() === "*") return "all";
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function actorContextFromHeaders(config: AppConfig, headers: Record<string, unknown>): ActorContext {
  if (!config.security.actorContext.trustHeaders) {
    return {
      userId: "local-admin",
      displayName: "Administrador local",
      tenantId: "local",
      role: config.security.actorContext.defaultRole,
      brandIds: "all",
      source: "local",
    };
  }

  const userId = headerString(headers["x-sac-user-id"])?.trim();
  const displayName = headerString(headers["x-sac-user-name"])?.trim() || userId || "Usuario gateway";
  const tenantId = headerString(headers["x-sac-tenant-id"])?.trim();
  const roleHeader = headerString(headers["x-sac-role"])?.trim().toLowerCase();
  const role = roleHeader && roleHeader in ROLE_RANK ? roleHeader as ActorRole : undefined;
  const brandIds = parseBrandScope(headerString(headers["x-sac-brand-ids"]));

  if (config.security.actorContext.require && (!userId || !tenantId || !role)) {
    throw new ApiError(
      401,
      "ACTOR_CONTEXT_REQUIRED",
      "La API requiere contexto de usuario, tenant y rol entregado por el gateway.",
    );
  }

  return {
    userId: userId || "local-admin",
    displayName,
    tenantId: tenantId || "local",
    role: role || config.security.actorContext.defaultRole,
    brandIds,
    source: userId || tenantId || role ? "trusted_headers" : "local",
  };
}

function requestActor(config: AppConfig, request: FastifyRequest): ActorContext {
  return actorContextFromHeaders(config, request.headers as Record<string, unknown>);
}

function requireRole(config: AppConfig, request: FastifyRequest, minimumRole: ActorRole): ActorContext {
  const actor = requestActor(config, request);
  if (ROLE_RANK[actor.role] < ROLE_RANK[minimumRole]) {
    throw new ApiError(
      403,
      "FORBIDDEN",
      `Esta acción requiere rol ${minimumRole} o superior.`,
    );
  }
  return actor;
}

function interactionVersion(interaction: Interaction): number {
  return Number.isInteger(interaction.version) && interaction.version > 0 ? interaction.version : 1;
}

function assertInteractionVersion(interaction: Interaction, expectedVersion: number): void {
  const currentVersion = interactionVersion(interaction);
  if (currentVersion !== expectedVersion) {
    throw new ApiError(
      409,
      "INTERACTION_VERSION_CONFLICT",
      "El caso cambió desde que fue abierto. Recargue antes de guardar para no sobrescribir trabajo de otro agente.",
      { expectedVersion, currentVersion, updatedAt: interaction.updatedAt },
    );
  }
}

function assertPortfolioAdmin(actor: ActorContext): void {
  if (actor.brandIds !== "all") {
    throw new ApiError(403, "FORBIDDEN", "Esta acción requiere scope completo de marcas.");
  }
}

function slugify(value: string): string {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `brand-${Date.now()}`;
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function canAccessBrand(actor: ActorContext, brandId: string): boolean {
  return actor.brandIds === "all" || actor.brandIds.includes(brandId);
}

function assertBrandAccess(actor: ActorContext, brandId: string): void {
  if (!canAccessBrand(actor, brandId)) {
    throw new ApiError(403, "FORBIDDEN", "El usuario no tiene acceso a esta marca.");
  }
}

function assertAccountAccess(actor: ActorContext, brands: Brand[], accountId: string): void {
  const brand = brands.find((item) => item.account.id === accountId);
  if (!brand) throw new ApiError(400, "UNKNOWN_ACCOUNTS", "Hay cuentas inexistentes o inactivas.", { accountIds: [accountId] });
  assertBrandAccess(actor, brand.id);
}

function assertRequestedAccess(actor: ActorContext, brands: Brand[], filters: InteractionFilters): void {
  if (filters.brandId) assertBrandAccess(actor, filters.brandId);
  if (filters.accountId) assertAccountAccess(actor, brands, filters.accountId);
}

function scopedInteractionFilters(actor: ActorContext, brands: Brand[], filters: InteractionFilters): InteractionFilters {
  assertRequestedAccess(actor, brands, filters);
  if (actor.brandIds === "all" || filters.brandId || filters.accountId) return filters;
  const knownBrandIds = new Set(brands.map((brand) => brand.id));
  return {
    ...filters,
    brandIds: actor.brandIds.filter((brandId) => knownBrandIds.has(brandId)),
  };
}

function filterBrandsForActor(actor: ActorContext, brands: Brand[]): Brand[] {
  if (actor.brandIds === "all") return brands;
  return brands.filter((brand) => actor.brandIds.includes(brand.id));
}

function isProtectedApiPath(url: string): boolean {
  const routePath = url.split("?", 1)[0] || "/";
  return routePath.startsWith("/api/")
    && routePath !== "/api/session"
    && !isOperationalProbePath(routePath);
}

function isApiPath(url: string): boolean {
  const routePath = url.split("?", 1)[0] || "/";
  return routePath.startsWith("/api/");
}

function isOperationalProbePath(url: string): boolean {
  const routePath = url.split("?", 1)[0] || "/";
  return routePath === "/api/health" || routePath === "/api/ready";
}

function rateLimitKey(requestHeaders: Record<string, unknown>, requestIp: string): string {
  return extractApiKey(requestHeaders) || requestIp || "unknown";
}

function requestHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function providerResponseReference(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of ["id", "messageId", "commentId", "responseId"]) {
    const candidate = object[key];
    if (typeof candidate === "string" || typeof candidate === "number") {
      return String(candidate).slice(0, 200);
    }
  }
  return providerResponseReference(object.data);
}

function explicitProviderRejection(error: unknown): boolean {
  return error instanceof MetricoolRequestError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408;
}

function sacAutomationOptions(config: AppConfig) {
  return {
    outboundSendsDisabled: config.operations.outboundSendsDisabled,
    metricoolMutationsDisabled: config.operations.metricoolMutationsDisabled,
    autoReplyDispatchMode: config.demoMode ? "shadow" as const : config.operations.autoReplyDispatchMode,
    autoSendInfrastructureReady: true,
  };
}

function publicReplyDelivery(delivery: Awaited<ReturnType<SacFlowRepository["findReplyDelivery"]>>) {
  if (!delivery) return delivery;
  const { idempotencyKey: _idempotencyKey, ...safe } = delivery;
  return safe;
}

function publicSyncResult(result: { run: WorkflowRun; newInteractions: Interaction[] }) {
  return {
    run: result.run,
    newInteractions: result.newInteractions.length,
  };
}

function publicInteractionMutationState(interaction: Interaction | undefined) {
  if (!interaction) return interaction;
  return {
    id: interaction.id,
    status: interaction.status,
    version: interaction.version,
    updatedAt: interaction.updatedAt,
    ...(interaction.respondedAt ? { respondedAt: interaction.respondedAt } : {}),
  };
}

function sanitizeSyncResponse(response: unknown): unknown {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const envelope = response as Record<string, unknown>;
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return response;
  const data = envelope.data as Record<string, unknown>;
  if (!Array.isArray(data.newInteractions)) return response;
  return {
    ...envelope,
    data: {
      ...data,
      newInteractions: data.newInteractions.length,
    },
  };
}

function sanitizeSacProtocolResponse(response: unknown): unknown {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const envelope = response as Record<string, unknown>;
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return response;
  const { interactions: _interactions, ...data } = envelope.data as Record<string, unknown>;
  return { ...envelope, data };
}

function sanitizeReplyResponse(response: unknown): unknown {
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const envelope = response as Record<string, unknown>;
  if (!envelope.data || typeof envelope.data !== "object" || Array.isArray(envelope.data)) return response;
  const interaction = envelope.data as Partial<Interaction>;
  if (typeof interaction.id !== "string" || typeof interaction.version !== "number") return response;
  return {
    ...envelope,
    data: publicInteractionMutationState(interaction as Interaction),
  };
}

function idempotencyKey(headers: Record<string, unknown>): string | undefined {
  const raw = headers["idempotency-key"];
  if (raw === undefined) return undefined;
  if (Array.isArray(raw)) throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Use un único Idempotency-Key.");
  return idempotencyKeySchema.parse(String(raw));
}

function requireIdempotencyKey(headers: Record<string, unknown>, operation: string): string {
  const key = idempotencyKey(headers);
  if (!key) {
    throw new ApiError(
      428,
      "IDEMPOTENCY_KEY_REQUIRED",
      `${operation} requiere Idempotency-Key en modo live para evitar operaciones duplicadas.`,
    );
  }
  return key;
}

async function replayIdempotent(
  repository: SacFlowRepository,
  scope: string,
  key: string | undefined,
  hash: string,
  reply: FastifyReply,
  sanitizeResponse?: (response: unknown) => unknown,
): Promise<boolean> {
  if (!key) return false;
  const record = await repository.claimIdempotency({
    key,
    scope,
    requestHash: hash,
    statusCode: 102,
    response: null,
    createdAt: new Date().toISOString(),
  });
  if (!record) return false;
  if (record.requestHash !== hash) {
    throw new ApiError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "El Idempotency-Key ya fue usado con un payload diferente.",
    );
  }
  if (record.statusCode === 102) {
    reply.header("Retry-After", "3");
    throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "Ya hay una solicitud en curso con este Idempotency-Key.");
  }
  const response = sanitizeResponse ? sanitizeResponse(record.response) : record.response;
  if (sanitizeResponse) await repository.saveIdempotency({ ...record, response });
  reply.header("Idempotent-Replay", "true").code(record.statusCode).send(response);
  return true;
}

async function rememberIdempotent(
  repository: SacFlowRepository,
  scope: string,
  key: string | undefined,
  hash: string,
  statusCode: number,
  response: unknown,
): Promise<void> {
  if (!key) return;
  const record: StoredIdempotencyRecord = {
    key,
    scope,
    requestHash: hash,
    statusCode,
    response,
    createdAt: new Date().toISOString(),
  };
  await repository.saveIdempotency(record);
}

function selectBrands(brands: Brand[], requestedIds?: string[]): Brand[] {
  const active = brands.filter((brand) => brand.active && brand.account.active);
  if (!requestedIds?.length) return active;
  const requested = new Set(requestedIds);
  const found = active.filter((brand) => requested.has(brand.account.id));
  const foundIds = new Set(found.map((brand) => brand.account.id));
  const missing = requestedIds.filter((id) => !foundIds.has(id));
  if (missing.length) {
    throw new ApiError(400, "UNKNOWN_ACCOUNTS", "Hay cuentas inexistentes o inactivas.", { accountIds: missing });
  }
  return found;
}

function selectBrandsForActor(actor: ActorContext, brands: Brand[], requestedIds?: string[]): Brand[] {
  const selected = selectBrands(brands, requestedIds);
  if (requestedIds?.length) {
    for (const brand of selected) assertBrandAccess(actor, brand.id);
    return selected;
  }
  return filterBrandsForActor(actor, selected);
}

function auditStep(
  node: string,
  status: RunAuditStep["status"],
  detail: string,
  count?: number,
): RunAuditStep {
  return { id: randomUUID(), node, status, detail, count, at: new Date().toISOString() };
}

function selectSyncItems(
  items: Interaction[],
  limit?: number,
  since?: string,
): Interaction[] {
  const sinceTime = since ? Date.parse(since) : undefined;
  const selected = items
    .filter((item) => sinceTime === undefined || Date.parse(item.createdAt) >= sinceTime)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  return limit === undefined ? selected : selected.slice(0, limit);
}

function metricoolProviderCandidates(
  channel: Channel,
  surface: MetricoolInboxSurface,
  account: MetricoolAccountReference,
): MetricoolInboxProvider[] {
  const primary = metricoolProviderForSurface(channel, surface, account);
  if (channel !== "instagram" || surface !== "conversations") return [primary];
  const alternate: MetricoolInboxProvider = primary === "INSTAGRAM" ? "INSTAGRAMBUSINESS" : "INSTAGRAM";
  return [primary, alternate];
}

function metricoolListItemCount(payload: unknown): number {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const data = (payload as Record<string, unknown>).data;
  return Array.isArray(data) ? data.length : 0;
}

async function readMetricoolSurface(
  client: MetricoolGateway,
  account: MetricoolAccountReference,
  channel: Channel,
  surface: MetricoolInboxSurface,
): Promise<{
  payload: unknown;
  provider: MetricoolInboxProvider;
  fallbackUsed: boolean;
}> {
  const candidates = metricoolProviderCandidates(channel, surface, account);
  let firstEmpty: { payload: unknown; provider: MetricoolInboxProvider } | undefined;
  let lastError: unknown;

  for (const [index, provider] of candidates.entries()) {
    try {
      const payload = surface === "conversations"
        ? await client.listConversations(account, provider)
        : surface === "comments"
          ? await client.listPostComments(account, provider)
          : await client.listReviews(account, provider);
      if (metricoolListItemCount(payload) > 0) return { payload, provider, fallbackUsed: index > 0 };
      firstEmpty ||= { payload, provider };
    } catch (error) {
      lastError = error;
    }
  }

  if (firstEmpty) {
    return {
      ...firstEmpty,
      fallbackUsed: firstEmpty.provider !== candidates[0],
    };
  }
  throw lastError || new Error("Metricool no devolvió una respuesta utilizable.");
}

async function reconcileDetectedTeamResponses(
  repository: SacFlowRepository,
  accountIds: string[],
): Promise<number> {
  const accountScope = new Set(accountIds);
  const snapshot = await repository.snapshot();
  const detected = detectConversationResponses(snapshot.interactions, accountScope);
  if (!detected.length) return 0;
  const interactionIds = detected.map((response) => response.interactionId);
  const reconciled = await repository.mutateInteractions(interactionIds, (store) =>
    reconcileConversationResponses(store, accountScope));
  return reconciled.length;
}

function makeSyncRun(
  startedAt: string,
  demoMode: boolean,
  accountIds: string[],
  workflowVersion: number,
  totals: WorkflowRun["totals"],
  auditTrail: RunAuditStep[],
): WorkflowRun {
  return {
    id: randomUUID(),
    kind: "sync",
    startedAt,
    finishedAt: new Date().toISOString(),
    status: totals.errors ? (totals.created || totals.duplicates ? "partial" : "failed") : "success",
    workflowVersion,
    demoMode,
    accountIds,
    totals,
    auditTrail,
  };
}

interface SyncRequestBody {
  accountIds?: string[];
  limit?: number;
  since?: string;
}

async function executeSync(
  config: AppConfig,
  repository: SacFlowRepository,
  metricoolClient: MetricoolGateway | undefined,
  actor: ActorContext,
  body: SyncRequestBody,
  retryOf?: string,
): Promise<{ run: WorkflowRun; newInteractions: Interaction[] }> {
  const startedAt = new Date().toISOString();
  const store = await repository.snapshot();
  const brands = selectBrandsForActor(actor, store.brands, body.accountIds);
  const accountIds = brands.map((brand) => brand.account.id);
  const auditTrail: RunAuditStep[] = [];
  let incoming: Interaction[] = [];
  let errors = 0;

  if (config.demoMode) {
    incoming = createDemoSyncInteractions(brands, randomUUID());
    auditTrail.push(auditStep(
      "Metricool (demo)",
      "success",
      `${incoming.length} interacciones simuladas para ${brands.length} cuentas.`,
      incoming.length,
    ));
  } else {
    if (!metricoolClient) {
      throw new ApiError(503, "METRICOOL_NOT_CONFIGURED", "Metricool no está configurado para modo live.");
    }
    for (const brand of brands) {
      const credentials = resolveMetricoolAccount(config, brand.account.id, brand.account.metricool);
      if (!credentials) {
        errors += 1;
        auditTrail.push(auditStep(`Metricool · ${brand.name}`, "failed", "Faltan userId/blogId para esta cuenta."));
        continue;
      }
      let syncChannels = brand.account.channels;
      if (metricoolClient.getBrand) {
        try {
          const detected = normalizeMetricoolConnectedChannels(await metricoolClient.getBrand(credentials));
          if (detected.length) {
            syncChannels = detected;
            auditTrail.push(auditStep(
              `Plataformas · ${brand.name}`,
              "success",
              `${detected.length} plataformas conectadas detectadas en Metricool.`,
              detected.length,
            ));
          }
        } catch {
          auditTrail.push(auditStep(
            `Plataformas · ${brand.name}`,
            "warning",
            "No fue posible detectar conexiones; se usó la configuración local de la cuenta.",
          ));
        }
      }
      for (const channel of syncChannels) {
        const surfaces = metricoolInboxSurfacesForChannel(channel);
        const requests = surfaces.map((surface) =>
          readMetricoolSurface(metricoolClient, credentials, channel, surface));
        const results = await Promise.allSettled(requests);
        results.forEach((result, index) => {
          const surface = surfaces[index] as MetricoolInboxSurface;
          const label = surface === "conversations" ? "Mensajes" : surface === "comments" ? "Comentarios" : "Reseñas";
          if (result.status === "rejected") {
            errors += 1;
            auditTrail.push(auditStep(`${label} · ${brand.name} · ${channel}`, "failed", `No fue posible leer ${label.toLocaleLowerCase("es-CL")}.`));
            return;
          }
          const { payload, provider, fallbackUsed } = result.value;
          const normalized = selectSyncItems(
            surface === "conversations"
              ? normalizeMetricoolConversations(payload, brand, provider)
              : surface === "comments"
                ? normalizeMetricoolComments(payload, brand, provider)
                : normalizeMetricoolReviews(payload, brand, provider),
            body.limit,
            body.since,
          );
          incoming.push(...normalized);
          auditTrail.push(auditStep(
            `${label} · ${brand.name} · ${provider}`,
            "success",
            `${normalized.length} interacciones normalizadas${fallbackUsed ? " mediante proveedor alternativo" : ""}.`,
            normalized.length,
          ));
        });
      }
    }
  }

  const inserted = await repository.insertInteractions(incoming);
  auditTrail.push(auditStep(
    "Persistencia",
    "success",
    `${inserted.created.length} nuevas; ${inserted.duplicates} duplicadas.`,
    inserted.created.length,
  ));
  const reconciledTeamResponses = await reconcileDetectedTeamResponses(repository, accountIds);
  if (reconciledTeamResponses) {
    auditTrail.push(auditStep(
      "Respuestas del equipo",
      "success",
      `${reconciledTeamResponses} casos quedaron respondidos al detectar un mensaje saliente posterior.`,
      reconciledTeamResponses,
    ));
  }
  const createdIds = new Set(inserted.created.map((interaction) => interaction.id));
  const reconciledSnapshot = await repository.snapshot();
  const protocolIds = reconciledSnapshot.interactions
    .filter((interaction) => createdIds.has(interaction.id))
    .filter((interaction) => interaction.direction === "inbound")
    .filter((interaction) => ["new", "pending", "drafted", "escalated"].includes(interaction.status))
    .map((interaction) => interaction.id);
  const protocol = protocolIds.length
    ? await repository.mutateInteractions(protocolIds, (current) => processSacInteractions(
        current,
        protocolIds,
        sacAutomationOptions(config),
      ))
    : {
        interactions: [] as Interaction[],
        evaluated: 0,
        drafted: 0,
        escalated: 0,
        autoReplyCandidates: 0,
        queuedAutoReplies: 0,
        quarantined: 0,
      };
  const queued = protocol.queuedAutoReplies
    ? await queueEligibleAutoReplies(
        repository,
        protocol.interactions,
        { userId: actor.userId, displayName: actor.displayName },
        `sync:${retryOf || startedAt}`,
        store.workflow.publishedVersion,
        config.operations.autoReplyMaxPending,
      )
    : {
        eligible: 0,
        created: 0,
        alreadyPresent: 0,
        skippedCapacity: 0,
        pendingBefore: 0,
        maxPending: config.operations.autoReplyMaxPending,
      };
  auditTrail.push(auditStep(
    "Protocolo SAC",
    "success",
    `${protocol.evaluated} evaluadas; ${protocol.drafted} borradores; ${protocol.queuedAutoReplies} en cola; ${protocol.escalated} revisiones humanas.`,
    protocol.evaluated,
  ));
  if (queued.eligible) {
    auditTrail.push(auditStep(
      "Cola de auto-respuestas",
      queued.skippedCapacity ? "warning" : "success",
      `${queued.created} entregas encoladas; ${queued.alreadyPresent} ya estaban registradas; ${queued.skippedCapacity} retenidas por capacidad.`,
      queued.created,
    ));
  } else if (protocol.autoReplyCandidates) {
    auditTrail.push(auditStep(
      "Candidatas a auto-respuesta",
      "warning",
      `${protocol.autoReplyCandidates} candidatas quedaron en modo sombra o retenidas por los cortacorrientes operativos.`,
      protocol.autoReplyCandidates,
    ));
  }
  const run = makeSyncRun(startedAt, config.demoMode, accountIds, store.workflow.version, {
    fetched: incoming.length,
    created: inserted.created.length,
    duplicates: inserted.duplicates,
    drafted: protocol.drafted,
    replied: reconciledTeamResponses,
    escalated: protocol.escalated,
    errors,
  }, auditTrail);
  run.requestedBy = actor.userId;
  run.retryOf = retryOf;
  await repository.recordRun(run);
  const finalSnapshot = await repository.snapshot();
  return {
    run,
    newInteractions: finalSnapshot.interactions.filter((interaction) => createdIds.has(interaction.id)),
  };
}

function assertDateRange(from?: string, to?: string): void {
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new ApiError(400, "INVALID_DATE_RANGE", "La fecha 'from' no puede ser posterior a 'to'.");
  }
}

function metricLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\n/g, "\\n");
}

function labels(values: Record<string, string | boolean | number>): string {
  const entries = Object.entries(values);
  if (!entries.length) return "";
  return `{${entries.map(([key, value]) => `${key}="${metricLabel(String(value))}"`).join(",")}}`;
}

function renderMetrics(
  config: AppConfig,
  store: DataStore,
  replyQueue?: { pending: number; saturated: boolean },
): string {
  const nowMs = Date.now();
  const lines: string[] = [
    "# HELP sac_flow_up Whether the SAC Flow API can produce metrics.",
    "# TYPE sac_flow_up gauge",
    "sac_flow_up 1",
    "# HELP sac_flow_brands_total Number of configured brands by active state.",
    "# TYPE sac_flow_brands_total gauge",
  ];

  for (const active of [true, false]) {
    lines.push(`sac_flow_brands_total${labels({ active })} ${store.brands.filter((brand) => brand.active === active).length}`);
  }

  lines.push(
    "# HELP sac_flow_accounts_total Number of configured social accounts by active state.",
    "# TYPE sac_flow_accounts_total gauge",
  );
  for (const active of [true, false]) {
    lines.push(`sac_flow_accounts_total${labels({ active })} ${store.brands.filter((brand) => brand.account.active === active).length}`);
  }

  const interactionGroups = new Map<string, number>();
  for (const interaction of store.interactions) {
    const key = JSON.stringify({
      channel: interaction.channel,
      type: interaction.type,
      status: interaction.status,
      source: interaction.source,
    });
    interactionGroups.set(key, (interactionGroups.get(key) ?? 0) + 1);
  }
  lines.push(
    "# HELP sac_flow_interactions_total Number of stored interactions by channel, type, status and source.",
    "# TYPE sac_flow_interactions_total gauge",
  );
  for (const [key, count] of [...interactionGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`sac_flow_interactions_total${labels(JSON.parse(key) as Record<string, string>)} ${count}`);
  }

  const pending = store.interactions.filter((interaction) => ["new", "pending", "drafted"].includes(interaction.status)).length;
  const evaluated = store.interactions.filter((interaction) => interaction.automation);
  lines.push(
    "# HELP sac_flow_pending_interactions_total Number of interactions still needing attention.",
    "# TYPE sac_flow_pending_interactions_total gauge",
    `sac_flow_pending_interactions_total ${pending}`,
    "# HELP sac_flow_protocol_evaluated_total Number of interactions evaluated by the SAC protocol.",
    "# TYPE sac_flow_protocol_evaluated_total gauge",
    `sac_flow_protocol_evaluated_total ${evaluated.length}`,
    "# HELP sac_flow_protocol_routes_total Number of evaluated interactions by effective route.",
    "# TYPE sac_flow_protocol_routes_total gauge",
    ...["auto_reply", "draft", "human_review", "quarantine", "ignore"].map((route) =>
      `sac_flow_protocol_routes_total${labels({ route })} ${evaluated.filter((interaction) => interaction.automation?.effectiveRoute === route).length}`,
    ),
    "# HELP sac_flow_protocol_knowledge_total Number of evaluated interactions by knowledge state.",
    "# TYPE sac_flow_protocol_knowledge_total gauge",
    ...["approved", "missing", "live_source_required", "not_required"].map((status) =>
    `sac_flow_protocol_knowledge_total${labels({ status })} ${evaluated.filter((interaction) => interaction.automation?.knowledge.status === status).length}`,
    ),
    "# HELP sac_flow_reply_deliveries_total Durable reply deliveries by state.",
    "# TYPE sac_flow_reply_deliveries_total gauge",
    ...["pending", "sending", "sent", "failed", "uncertain", "cancelled", "demo_simulated"].map((status) =>
      `sac_flow_reply_deliveries_total${labels({ status })} ${store.deliveries.filter((delivery) => delivery.status === status).length}`,
    ),
    "# HELP sac_flow_reply_deliveries_deferred_total Pending deliveries waiting for provider Retry-After.",
    "# TYPE sac_flow_reply_deliveries_deferred_total gauge",
    `sac_flow_reply_deliveries_deferred_total ${store.deliveries.filter((delivery) =>
      delivery.status === "pending" && delivery.nextAttemptAt && Date.parse(delivery.nextAttemptAt) > nowMs).length}`,
    "# HELP sac_flow_reply_rate_limit_exhausted_total Deliveries stopped after exhausting provider rate-limit retries.",
    "# TYPE sac_flow_reply_rate_limit_exhausted_total gauge",
    `sac_flow_reply_rate_limit_exhausted_total ${store.deliveries.filter((delivery) =>
      delivery.errorCode === "METRICOOL_RATE_LIMIT_RETRIES_EXHAUSTED").length}`,
    "# HELP sac_flow_auto_reply_queue_pending_total Durable automatic replies waiting for dispatch.",
    "# TYPE sac_flow_auto_reply_queue_pending_total gauge",
    `sac_flow_auto_reply_queue_pending_total ${replyQueue?.pending ?? 0}`,
    "# HELP sac_flow_auto_reply_queue_max_pending Configured pending auto-reply saturation limit.",
    "# TYPE sac_flow_auto_reply_queue_max_pending gauge",
    `sac_flow_auto_reply_queue_max_pending ${config.operations.autoReplyMaxPending}`,
    "# HELP sac_flow_auto_reply_queue_saturated Whether the pending auto-reply queue reached its limit.",
    "# TYPE sac_flow_auto_reply_queue_saturated gauge",
    `sac_flow_auto_reply_queue_saturated ${replyQueue?.saturated ? 1 : 0}`,
    "# HELP sac_flow_workflow_auto_reply_enabled Whether global auto-reply is enabled.",
    "# TYPE sac_flow_workflow_auto_reply_enabled gauge",
    `sac_flow_workflow_auto_reply_enabled ${store.workflow.autoReplyEnabled ? 1 : 0}`,
    "# HELP sac_flow_workflow_allowlisted_accounts_total Number of accounts allowlisted for auto-reply.",
    "# TYPE sac_flow_workflow_allowlisted_accounts_total gauge",
    `sac_flow_workflow_allowlisted_accounts_total ${store.workflow.autoReplyAccountIds.length}`,
    "# HELP sac_flow_outbound_sends_disabled Whether outbound sends are blocked by the operational kill switch.",
    "# TYPE sac_flow_outbound_sends_disabled gauge",
    `sac_flow_outbound_sends_disabled ${config.operations.outboundSendsDisabled ? 1 : 0}`,
    "# HELP sac_flow_auto_reply_dispatch_mode Auto-reply dispatch mode (shadow or live).",
    "# TYPE sac_flow_auto_reply_dispatch_mode gauge",
    `sac_flow_auto_reply_dispatch_mode${labels({ mode: config.operations.autoReplyDispatchMode })} 1`,
    "# HELP sac_flow_automation_workflows_total Number of general automation workflows.",
    "# TYPE sac_flow_automation_workflows_total gauge",
    `sac_flow_automation_workflows_total ${store.automation.workflows.length}`,
    "# HELP sac_flow_automation_active_workflows_total Number of active general automation workflows.",
    "# TYPE sac_flow_automation_active_workflows_total gauge",
    `sac_flow_automation_active_workflows_total ${store.automation.workflows.filter((workflow) => workflow.active).length}`,
    "# HELP sac_flow_automation_executions_total Number of retained general automation executions by status.",
    "# TYPE sac_flow_automation_executions_total gauge",
    ...["success", "error", "running", "waiting", "queued", "canceled"].map((status) => `sac_flow_automation_executions_total${labels({ status })} ${store.automation.executions.filter((execution) => execution.status === status).length}`),
    "# HELP sac_flow_external_nodes_disabled Whether generic outbound HTTP nodes are disabled.",
    "# TYPE sac_flow_external_nodes_disabled gauge",
    `sac_flow_external_nodes_disabled ${config.operations.externalNodesDisabled ? 1 : 0}`,
    "# HELP sac_flow_metricool_mutations_disabled Whether general Metricool mutations are disabled.",
    "# TYPE sac_flow_metricool_mutations_disabled gauge",
    `sac_flow_metricool_mutations_disabled ${config.operations.metricoolMutationsDisabled ? 1 : 0}`,
    "# HELP sac_flow_manual_replies_enabled Whether human-approved SAC replies may be sent to Metricool.",
    "# TYPE sac_flow_manual_replies_enabled gauge",
    `sac_flow_manual_replies_enabled ${config.operations.manualRepliesEnabled ? 1 : 0}`,
    "# HELP sac_flow_mode_info Runtime mode information.",
    "# TYPE sac_flow_mode_info gauge",
    `sac_flow_mode_info${labels({ mode: config.mode, repository: config.persistence.driver })} 1`,
  );

  if (store.workflow.lastRunStatus) {
    for (const status of ["success", "partial", "failed"] as const) {
      lines.push(`sac_flow_last_run_status${labels({ status })} ${store.workflow.lastRunStatus === status ? 1 : 0}`);
    }
  }

  const syncRuns = store.runs.filter((run) => run.kind === "sync");
  lines.push(
    "# HELP sac_flow_sync_runs_total Number of persisted synchronization runs by final status.",
    "# TYPE sac_flow_sync_runs_total counter",
  );
  for (const status of ["success", "partial", "failed"] as const) {
    lines.push(`sac_flow_sync_runs_total${labels({ status })} ${syncRuns.filter((run) => run.status === status).length}`);
  }

  lines.push(
    "# HELP sac_flow_jobs_total Durable scheduler jobs by state.",
    "# TYPE sac_flow_jobs_total gauge",
  );
  for (const status of ["queued", "running", "retry", "succeeded", "dead"] as const) {
    lines.push(`sac_flow_jobs_total${labels({ status })} ${store.jobs.filter((job) => job.status === status).length}`);
  }
  lines.push(
    "# HELP sac_flow_oldest_job_state_age_seconds Age in seconds of the oldest durable job currently in an actionable failure state.",
    "# TYPE sac_flow_oldest_job_state_age_seconds gauge",
  );
  for (const status of ["retry", "dead"] as const) {
    const timestamps = store.jobs
      .filter((job) => job.status === status)
      .map((job) => Date.parse(job.updatedAt))
      .filter(Number.isFinite);
    const ageSeconds = timestamps.length ? Math.max(0, Math.floor((nowMs - Math.min(...timestamps)) / 1_000)) : 0;
    lines.push(`sac_flow_oldest_job_state_age_seconds${labels({ status })} ${ageSeconds}`);
  }
  lines.push(
    "# HELP sac_flow_jobs_overdue_total Durable queued or retry jobs whose next attempt time has elapsed.",
    "# TYPE sac_flow_jobs_overdue_total gauge",
  );
  for (const status of ["queued", "retry"] as const) {
    const overdue = store.jobs.filter((job) => {
      const nextAttemptAt = Date.parse(job.nextAttemptAt);
      return job.status === status && Number.isFinite(nextAttemptAt) && nextAttemptAt <= nowMs;
    }).length;
    lines.push(`sac_flow_jobs_overdue_total${labels({ status })} ${overdue}`);
  }
  lines.push(
    "# HELP sac_flow_sync_items_total Persisted synchronization item outcomes.",
    "# TYPE sac_flow_sync_items_total counter",
    `sac_flow_sync_items_total${labels({ outcome: "fetched" })} ${syncRuns.reduce((sum, run) => sum + run.totals.fetched, 0)}`,
    `sac_flow_sync_items_total${labels({ outcome: "created" })} ${syncRuns.reduce((sum, run) => sum + run.totals.created, 0)}`,
    `sac_flow_sync_items_total${labels({ outcome: "duplicate" })} ${syncRuns.reduce((sum, run) => sum + run.totals.duplicates, 0)}`,
    `sac_flow_sync_items_total${labels({ outcome: "error" })} ${syncRuns.reduce((sum, run) => sum + run.totals.errors, 0)}`,
  );

  const lastSuccessfulSync = syncRuns
    .filter((run) => run.status === "success")
    .map((run) => Date.parse(run.finishedAt))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
  lines.push(
    "# HELP sac_flow_last_successful_sync_timestamp_seconds Unix timestamp of the latest successful synchronization.",
    "# TYPE sac_flow_last_successful_sync_timestamp_seconds gauge",
    `sac_flow_last_successful_sync_timestamp_seconds ${lastSuccessfulSync ? Math.floor(lastSuccessfulSync / 1000) : 0}`,
  );

  const pendingTimes = store.interactions
    .filter((interaction) => ["new", "pending", "drafted", "escalated"].includes(interaction.status))
    .map((interaction) => Date.parse(interaction.createdAt))
    .filter(Number.isFinite);
  const oldestPendingAgeSeconds = pendingTimes.length
    ? Math.max(0, Math.floor((nowMs - Math.min(...pendingTimes)) / 1000))
    : 0;
  lines.push(
    "# HELP sac_flow_oldest_pending_age_seconds Age in seconds of the oldest interaction needing attention.",
    "# TYPE sac_flow_oldest_pending_age_seconds gauge",
    `sac_flow_oldest_pending_age_seconds ${oldestPendingAgeSeconds}`,
    "# HELP sac_flow_assigned_interactions_total Number of interactions currently assigned to an agent.",
    "# TYPE sac_flow_assigned_interactions_total gauge",
    `sac_flow_assigned_interactions_total ${store.interactions.filter((interaction) => interaction.assignedTo).length}`,
  );

  return `${lines.join("\n")}\n`;
}

async function registerFrontend(app: FastifyInstance, config: AppConfig): Promise<void> {
  const indexFile = path.join(config.frontendDir, "index.html");
  try {
    await access(indexFile);
  } catch {
    app.log.warn({ frontendDir: config.frontendDir }, "SERVE_FRONTEND activo, pero dist/client no existe.");
    return;
  }
  const staticModule = await import("@fastify/static");
  await app.register(staticModule.default, {
    root: config.frontendDir,
    prefix: "/",
    wildcard: false,
  });
}

export async function buildApp(options: BuildAppOptions = {}): Promise<SacFlowApp> {
  const config = options.config || loadConfig();
  const repository = options.repository || createRepository(config);
  await repository.initialize();
  await repository.recoverStaleReplyDeliveries();

  const metricoolClient = options.metricoolClient
    || (!config.demoMode && config.metricool.token
      ? new MetricoolClient({ token: config.metricool.token, baseUrl: config.metricool.baseUrl })
      : undefined);

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1_048_576,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
  }) as unknown as SacFlowApp;
  const apiSessionSigningKey = randomBytes(32);
  let syncInProgress = false;
  app.sacFlow = { config, repository };
  app.addHook("onClose", async () => {
    const closeable = repository as SacFlowRepository & { close?: () => Promise<void> | void };
    await closeable.close?.();
  });
  await app.register(cors, { origin: config.security.corsOrigins, credentials: false });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, async (_request: FastifyRequest, body: string) =>
    Object.fromEntries(new URLSearchParams(body)),
  );

  const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-Id", request.id);
    if (
      config.security.enforceOriginCheck
      && isApiPath(request.url)
      && isMutationMethod(request.method)
      && !browserMutationOriginAllowed(config, request)
    ) {
      return reply.code(403).send({
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "El origen del navegador no está autorizado para modificar SAC Flow.",
          requestId: request.id,
        },
      });
    }
    if (config.security.rateLimit.enabled && isApiPath(request.url) && !isOperationalProbePath(request.url)) {
      const now = Date.now();
      const key = rateLimitKey(request.headers as Record<string, unknown>, request.ip);
      const current = rateLimitBuckets.get(key);
      const bucket = current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + config.security.rateLimit.windowMs };
      bucket.count += 1;
      rateLimitBuckets.set(key, bucket);
      if (rateLimitBuckets.size > 10_000) {
        for (const [bucketKey, value] of rateLimitBuckets) {
          if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
        }
      }
      if (bucket.count > config.security.rateLimit.max) {
        return reply
          .header("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)))
          .code(429)
          .send({
            error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes. Intente nuevamente más tarde." },
            meta: apiMeta(config),
          });
      }
    }
    const protectedPath = isProtectedApiPath(request.url);
    if (config.security.requireApiKey && protectedPath) {
      const received = extractApiKey(request.headers as Record<string, unknown>);
      const headerAuthorized = Boolean(
        received && config.security.apiKey && safeTokenEqual(received, config.security.apiKey),
      );
      const sessionAuthorized = validApiSession(
        request.headers as Record<string, unknown>,
        apiSessionSigningKey,
      );
      if (!headerAuthorized && !sessionAuthorized) {
        return reply.code(401).send({
          error: { code: "UNAUTHORIZED", message: "Credenciales de API requeridas." },
          meta: apiMeta(config),
        });
      }
    }
    if (config.security.actorContext.require && protectedPath) {
      actorContextFromHeaders(config, request.headers as Record<string, unknown>);
    }
  });

  app.post("/api/session", async (request, reply) => {
    if (!config.security.requireApiKey || !config.security.apiKey) {
      return reply.code(204).send();
    }
    const body = apiSessionSchema.parse(request.body);
    if (!safeTokenEqual(body.apiKey, config.security.apiKey)) {
      throw new ApiError(401, "UNAUTHORIZED", "La clave de acceso no es válida.");
    }
    const forwardedProtocol = headerString((request.headers as Record<string, unknown>)["x-forwarded-proto"]);
    const secure = request.protocol === "https" || forwardedProtocol === "https";
    reply.header(
      "Set-Cookie",
      `${API_SESSION_COOKIE}=${encodeURIComponent(apiSessionToken(apiSessionSigningKey))}; Path=/api; Max-Age=${API_SESSION_TTL_SECONDS}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`,
    );
    return reply.code(204).send();
  });

  app.delete("/api/session", async (_request, reply) => {
    reply.header("Set-Cookie", `${API_SESSION_COOKIE}=; Path=/api; Max-Age=0; HttpOnly; SameSite=Strict`);
    return reply.code(204).send();
  });

  app.addHook("onSend", async (request, reply, payload) => {
    if (isProtectedApiPath(request.url)) reply.header("Cache-Control", "no-store");
    if (!config.security.securityHeaders) return payload;
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "SAMEORIGIN");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data: https:; media-src 'self' https:; font-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'",
    );
    return payload;
  });

  app.get("/api/health", async () => ({
    status: "ok",
    service: "sac-flow-api",
    timestamp: new Date().toISOString(),
    mode: config.mode,
    demoMode: config.demoMode,
    modeReason: config.modeReason,
    metricool: {
      configured: Boolean(config.metricool.token),
      accountOverrides: Object.keys(config.metricool.accounts).length,
      fallbackAccountConfigured: Boolean(config.metricool.fallbackAccount),
      fallbackAccountActive: Boolean(config.metricool.fallbackAccount && config.metricool.allowFallbackAccount),
    },
    operations: {
      outboundSendsDisabled: config.operations.outboundSendsDisabled,
      externalNodesDisabled: config.operations.externalNodesDisabled,
      metricoolMutationsDisabled: config.operations.metricoolMutationsDisabled,
      manualRepliesEnabled: config.operations.manualRepliesEnabled,
      inboxSyncEnabled: config.operations.inboxSyncEnabled,
      autoReplyDispatchMode: config.operations.autoReplyDispatchMode,
      autoReplyMaxPending: config.operations.autoReplyMaxPending,
    },
    security: {
      apiKeyRequired: config.security.requireApiKey,
      cors: config.security.corsOrigins === true ? "any" : config.security.corsOrigins === false ? "same-origin" : "allowlist",
      securityHeaders: config.security.securityHeaders,
      originCheckEnabled: config.security.enforceOriginCheck,
      rateLimitEnabled: config.security.rateLimit.enabled,
      actorContextRequired: config.security.actorContext.require,
      trustedActorHeaders: config.security.actorContext.trustHeaders,
      defaultRole: config.security.actorContext.trustHeaders ? undefined : config.security.actorContext.defaultRole,
    },
    persistence: {
      ready: true,
      driver: config.persistence.driver,
      jsonLiveAllowed: config.persistence.driver === "json" ? config.persistence.allowJsonInLive : undefined,
    },
  }));

  app.get("/api/ready", async (request, reply) => {
    try {
      const snapshot = await repository.snapshot();
      const latestSyncRun = snapshot.runs
        .filter((run) => run.kind === "sync")
        .sort((left, right) => {
          const leftAt = Date.parse(left.finishedAt || left.startedAt);
          const rightAt = Date.parse(right.finishedAt || right.startedAt);
          return rightAt - leftAt;
        })[0];
      const pendingReplyDeliveries = await repository.listReplyDeliveries({
        status: "pending",
        automaticOnly: true,
        limit: config.operations.autoReplyMaxPending,
      });
      const pendingAutoReplyCount = pendingReplyDeliveries.length;
      return {
        status: "ready",
        service: "sac-flow-api",
        timestamp: new Date().toISOString(),
        checks: {
          repository: {
            status: "ok",
            driver: config.persistence.driver,
            brands: snapshot.brands.length,
            interactions: snapshot.interactions.length,
            deliveries: snapshot.deliveries.length,
          },
          metricool: {
            status: config.demoMode || config.metricool.token ? "ok" : "warning",
            mode: config.mode,
            configured: Boolean(config.metricool.token),
          },
          inboxSync: {
            enabled: config.operations.inboxSyncEnabled,
            intervalMinutes: Math.max(5, snapshot.workflow.pollIntervalMinutes),
            lastRunAt: latestSyncRun?.finishedAt || latestSyncRun?.startedAt,
            lastRunStatus: latestSyncRun?.status ?? "never",
          },
          outboundSends: {
            status: config.operations.outboundSendsDisabled ? "disabled" : "enabled",
          },
          manualReplies: {
            status: config.operations.manualRepliesEnabled && !config.operations.outboundSendsDisabled
              ? "enabled"
              : "disabled",
          },
          replyOutbox: {
            status: pendingAutoReplyCount >= config.operations.autoReplyMaxPending
              ? "saturated"
              : "ok",
            pending: pendingAutoReplyCount,
            maxPending: config.operations.autoReplyMaxPending,
          },
          automationEgress: {
            externalNodes: config.operations.externalNodesDisabled ? "disabled" : "enabled",
            metricoolMutations: config.operations.metricoolMutationsDisabled ? "disabled" : "enabled",
          },
        },
        meta: apiMeta(config),
      };
    } catch (error) {
      request.log.error({ err: error }, "Readiness check failed");
      return reply.code(503).send({
        status: "not_ready",
        service: "sac-flow-api",
        timestamp: new Date().toISOString(),
        checks: {
          repository: {
            status: "failed",
            driver: config.persistence.driver,
          },
        },
        meta: apiMeta(config),
      });
    }
  });

  app.get("/api/metrics", async (request, reply) => {
    requireRole(config, request, "supervisor");
    const snapshot = await repository.snapshot();
    const pendingAutoReplies = (await repository.listReplyDeliveries({
      status: "pending",
      automaticOnly: true,
      limit: config.operations.autoReplyMaxPending,
    })).length;
    return reply
      .type("text/plain; version=0.0.4; charset=utf-8")
      .header("Cache-Control", "no-store")
      .send(renderMetrics(config, snapshot, {
        pending: pendingAutoReplies,
        saturated: pendingAutoReplies >= config.operations.autoReplyMaxPending,
      }));
  });

  app.get("/api/security/audit", async (request) => {
    requireRole(config, request, "admin");
    const store = await repository.snapshot();
    return { data: buildSecurityAudit(config, store), meta: apiMeta(config) };
  });

  app.get("/api/me", async (request) => {
    const actor = requireRole(config, request, "viewer");
    return {
      data: {
        userId: actor.userId,
        displayName: actor.displayName,
        tenantId: actor.tenantId,
        role: actor.role,
        brandIds: actor.brandIds,
      },
      meta: apiMeta(config),
    };
  });

  app.get("/api/status-reasons", async (request) => {
    requireRole(config, request, "viewer");
    return { data: INTERACTION_STATUS_REASON_CATALOG, meta: apiMeta(config) };
  });

  app.get("/api/brands", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const brands = await repository.listBrands((accountId, _storedConfigured, stored) =>
      metricoolAccountState(config, accountId, stored),
    );
    const visibleBrands = actor.brandIds === "all"
      ? brands
      : brands.filter((brand) => actor.brandIds.includes(brand.id));
    return { data: visibleBrands, meta: { ...apiMeta(config), count: visibleBrands.length } };
  });

  app.post("/api/brands", async (request) => {
    const actor = requireRole(config, request, "admin");
    assertPortfolioAdmin(actor);
    const body = brandCreateSchema.parse(request.body);
    const created = await repository.mutate((store) => {
      const usedBrandIds = new Set(store.brands.map((brand) => brand.id));
      const usedAccountIds = new Set(store.brands.map((brand) => brand.account.id));
      const usedHandles = new Set(store.brands.map((brand) => brand.account.handle.toLowerCase()));
      const brandId = body.id || uniqueSlug(slugify(body.name), usedBrandIds);
      const accountId = body.accountId || uniqueSlug(`${brandId}-account`, usedAccountIds);
      if (usedBrandIds.has(brandId)) {
        throw new ApiError(409, "BRAND_ALREADY_EXISTS", "Ya existe una marca con ese id.", { brandId });
      }
      if (usedAccountIds.has(accountId)) {
        throw new ApiError(409, "ACCOUNT_ALREADY_EXISTS", "Ya existe una cuenta con ese id.", { accountId });
      }
      if (usedHandles.has(body.accountHandle.toLowerCase())) {
        throw new ApiError(
          409,
          "ACCOUNT_HANDLE_ALREADY_EXISTS",
          "Ya existe una cuenta con ese handle.",
          { accountHandle: body.accountHandle },
        );
      }
      const now = new Date().toISOString();
      const brand: Brand = {
        id: brandId,
        name: body.name,
        color: body.color,
        active: body.active,
        resources: [],
        account: {
          id: accountId,
          brandId,
          name: body.accountName || body.name,
          handle: body.accountHandle,
          channels: [...new Set(body.channels)],
          active: body.accountActive ?? body.active,
        },
      };
      store.brands.push(brand);
      store.workflow.updatedAt = now;
      return brand;
    });
    return {
      data: publicBrand(config, created),
      meta: { ...apiMeta(config), created: true, externalWrites: false },
    };
  });

  app.patch("/api/brands/:brandId", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const body = brandUpdateSchema.parse(request.body);
    const updated = await repository.mutate((store) => {
      const brand = store.brands.find((item) => item.id === brandId);
      if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
      if (body.accountHandle) {
        const duplicatedHandle = store.brands.find((item) =>
          item.id !== brandId && item.account.handle.toLowerCase() === body.accountHandle!.toLowerCase()
        );
        if (duplicatedHandle) {
          throw new ApiError(
            409,
            "ACCOUNT_HANDLE_ALREADY_EXISTS",
            "Ya existe una cuenta con ese handle.",
            { accountHandle: body.accountHandle },
          );
        }
      }
      if (body.name !== undefined) brand.name = body.name;
      if (body.color !== undefined) brand.color = body.color;
      if (body.active !== undefined) brand.active = body.active;
      if (body.accountName !== undefined) brand.account.name = body.accountName;
      if (body.accountHandle !== undefined) brand.account.handle = body.accountHandle;
      if (body.channels !== undefined) brand.account.channels = [...new Set(body.channels)];
      if (body.accountActive !== undefined) brand.account.active = body.accountActive;
      store.workflow.updatedAt = new Date().toISOString();
      return brand;
    });
    return {
      data: publicBrand(config, updated),
      meta: { ...apiMeta(config), updated: true, externalWrites: false },
    };
  });

  app.delete("/api/brands/:brandId", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const updated = await repository.mutate((store) => {
      const brand = store.brands.find((item) => item.id === brandId);
      if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
      brand.active = false;
      brand.account.active = false;
      delete brand.account.metricool;
      store.workflow.autoReplyAccountIds = store.workflow.autoReplyAccountIds.filter((id) => id !== brand.account.id);
      if (store.workflow.autoReplyEnabled && store.workflow.autoReplyAccountIds.length === 0) {
        store.workflow.autoReplyEnabled = false;
      }
      store.workflow.updatedAt = new Date().toISOString();
      return brand;
    });
    return {
      data: publicBrand(config, updated),
      meta: { ...apiMeta(config), deactivated: true, autoReplyRemoved: true, externalWrites: false },
    };
  });

  app.get("/api/brands/:brandId/workbook", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const store = await repository.snapshot();
    const brand = store.brands.find((item) => item.id === brandId);
    if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
    return { data: brand.workbook ?? null, meta: { ...apiMeta(config), externalWrites: false } };
  });

  app.put("/api/brands/:brandId/workbook", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const body = brandWorkbookUpdateSchema.parse(request.body);
    const inspected = await inspectBrandWorkbook(body.spreadsheetUrl, actor).catch((error) => {
      throw new ApiError(
        422,
        "WORKBOOK_FORMAT_INVALID",
        error instanceof Error ? error.message : "No se pudo validar el libro.",
      );
    });
    const updated = await repository.mutate((store) => {
      const brand = store.brands.find((item) => item.id === brandId);
      if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
      brand.workbook = inspected;
      brand.resources = brand.resources ?? [];
      const existingResource = brand.resources.find((resource) => resource.kind === "records");
      if (existingResource) {
        existingResource.name = "Excel de registros SAC";
        existingResource.url = inspected.spreadsheetUrl;
      } else {
        brand.resources.push({
          id: randomUUID(),
          name: "Excel de registros SAC",
          url: inspected.spreadsheetUrl,
          kind: "records",
          addedAt: new Date().toISOString(),
          addedBy: actor.userId,
        });
      }
      const excelNode = store.workflow.nodes.find((node) => node.type === "excel");
      if (excelNode) {
        excelNode.config = {
          ...excelNode.config,
          source: "brand_workbook",
          formatPolicy: "strict",
          preserveTemplate: true,
        };
      }
      store.workflow.updatedAt = new Date().toISOString();
      return brand.workbook;
    });
    return {
      data: updated,
      meta: {
        ...apiMeta(config),
        validated: true,
        externalWrites: false,
        sourceRowsChanged: false,
      },
    };
  });

  app.get("/api/brands/:brandId/workbook/export", async (request, reply) => {
    const actor = requireRole(config, request, "viewer");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const store = await repository.snapshot();
    const brand = store.brands.find((item) => item.id === brandId);
    if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
    if (!brand.workbook) throw new ApiError(409, "WORKBOOK_NOT_CONFIGURED", "La marca no tiene un Excel conectado.");
    const interactions = store.interactions.filter((interaction) => interaction.brandId === brandId);
    const exported = await buildBrandWorkbookExport(brand.workbook, interactions).catch((error) => {
      throw new ApiError(
        422,
        "WORKBOOK_EXPORT_FAILED",
        error instanceof Error ? error.message : "No se pudo generar la copia.",
      );
    });
    const safeName = brand.id.replace(/[^a-z0-9-]/g, "-");
    return reply
      .header("Content-Disposition", `attachment; filename="${safeName}-registros.xlsx"`)
      .header("X-Workbook-Rows-Appended", String(exported.appended))
      .header("X-Workbook-Total-Rows", String(exported.totalRows))
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(exported.bytes);
  });

  app.get("/api/brands/:brandId/qa-workbook", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const store = await repository.snapshot();
    const brand = store.brands.find((item) => item.id === brandId);
    if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
    return { data: brand.qaWorkbook ?? null, meta: { ...apiMeta(config), externalWrites: false } };
  });

  app.put("/api/brands/:brandId/qa-workbook", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const body = brandQaWorkbookUpdateSchema.parse(request.body);
    const inspected = await inspectBrandQaWorkbook(body.spreadsheetUrl, actor).catch((error) => {
      throw new ApiError(
        422,
        "QA_WORKBOOK_FORMAT_INVALID",
        error instanceof Error ? error.message : "No se pudo validar el Excel QA.",
      );
    });
    const updated = await repository.mutate((store) => {
      const brand = store.brands.find((item) => item.id === brandId);
      if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
      brand.qaWorkbook = inspected.config;
      brand.sacPolicy = {
        enabled: brand.sacPolicy?.enabled ?? false,
        locale: brand.sacPolicy?.locale ?? "es-CL",
        tone: brand.sacPolicy?.tone ?? "claro, cercano y profesional",
        timeZone: brand.sacPolicy?.timeZone ?? "America/Santiago",
        ...(brand.sacPolicy?.businessHours ? { businessHours: brand.sacPolicy.businessHours } : {}),
        approvedAnswers: inspected.approvedAnswers,
      };
      brand.resources = brand.resources ?? [];
      const existingResource = brand.resources.find((resource) => resource.kind === "qa");
      if (existingResource) {
        existingResource.name = "Excel QA aprobado";
        existingResource.url = inspected.config.spreadsheetUrl;
      } else {
        brand.resources.push({
          id: randomUUID(),
          name: "Excel QA aprobado",
          url: inspected.config.spreadsheetUrl,
          kind: "qa",
          addedAt: new Date().toISOString(),
          addedBy: actor.userId,
        });
      }
      store.workflow.updatedAt = new Date().toISOString();
      return brand.qaWorkbook;
    });
    return {
      data: updated,
      meta: {
        ...apiMeta(config),
        approvedAnswers: inspected.approvedAnswers.length,
        sourceRowsChanged: false,
        externalWrites: false,
      },
    };
  });

  app.get("/api/brands/:brandId/qa-workbook/template", async (request, reply) => {
    const actor = requireRole(config, request, "viewer");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const store = await repository.snapshot();
    const brand = store.brands.find((item) => item.id === brandId);
    if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
    const bytes = await buildBrandQaTemplate(brand.name);
    return reply
      .header("Content-Disposition", `attachment; filename="${brand.id}-qa-aprobado.xlsx"`)
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .send(bytes);
  });

  app.get("/api/brands/:brandId/resources", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const store = await repository.snapshot();
    const brand = store.brands.find((item) => item.id === brandId);
    if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
    return { data: brand.resources ?? [], meta: { ...apiMeta(config), count: brand.resources?.length ?? 0 } };
  });

  app.post("/api/brands/:brandId/resources", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { brandId } = brandParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const body = brandResourceCreateSchema.parse(request.body);
    const created = await repository.mutate((store) => {
      const brand = store.brands.find((item) => item.id === brandId);
      if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
      brand.resources = brand.resources ?? [];
      if (brand.resources.length >= 100) throw new ApiError(409, "RESOURCE_LIMIT_REACHED", "La marca alcanzó el máximo de 100 archivos enlazados.");
      if (brand.resources.some((resource) => resource.url === body.url)) {
        throw new ApiError(409, "RESOURCE_ALREADY_EXISTS", "Este archivo ya está registrado para la marca.");
      }
      const resource = {
        id: randomUUID(),
        ...body,
        addedAt: new Date().toISOString(),
        addedBy: actor.userId,
      };
      brand.resources.push(resource);
      return resource;
    });
    return { data: created, meta: { ...apiMeta(config), created: true, externalWrites: false } };
  });

  app.delete("/api/brands/:brandId/resources/:resourceId", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { brandId, resourceId } = brandResourceParamsSchema.parse(request.params);
    assertBrandAccess(actor, brandId);
    const removed = await repository.mutate((store) => {
      const brand = store.brands.find((item) => item.id === brandId);
      if (!brand) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
      const resource = (brand.resources ?? []).find((item) => item.id === resourceId);
      if (!resource) throw new ApiError(404, "RESOURCE_NOT_FOUND", "El archivo no existe.");
      if (resource.kind === "records" || resource.kind === "qa") {
        throw new ApiError(409, "MANAGED_RESOURCE", "Desconecta el Excel correspondiente antes de retirar este archivo administrado.");
      }
      brand.resources = (brand.resources ?? []).filter((item) => item.id !== resourceId);
      return resource;
    });
    return { data: removed, meta: { ...apiMeta(config), deleted: true, externalWrites: false } };
  });

  app.get("/api/accounts/:accountId/metricool", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { accountId } = accountParamsSchema.parse(request.params);
    const brand = await repository.findBrandByAccountId(accountId);
    if (!brand) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "La cuenta no existe.");
    assertBrandAccess(actor, brand.id);
    return {
      data: publicAccountMetricoolDetail(config, brand),
      meta: apiMeta(config),
    };
  });

  app.put("/api/accounts/:accountId/metricool", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { accountId } = accountParamsSchema.parse(request.params);
    const existing = await repository.findBrandByAccountId(accountId);
    if (!existing) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "La cuenta no existe.");
    assertBrandAccess(actor, existing.id);
    const body = accountMetricoolUpdateSchema.parse(request.body);
    const updated = await repository.updateAccountMetricool(accountId, {
      userId: body.userId,
      blogId: body.blogId,
      instagramProvider: body.instagramProvider,
    });
    if (!updated) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "La cuenta no existe.");
    const detail = publicAccountMetricoolDetail(config, updated);
    return {
      data: detail,
      meta: {
        ...apiMeta(config),
        credentialsStored: true,
        externalWrites: false,
        warning: detail.metricool.configurationLocked
          ? "La referencia guardada quedó persistida, pero esta cuenta sigue resuelta por configuración de entorno/fallback."
          : undefined,
      },
    };
  });

  app.delete("/api/accounts/:accountId/metricool", async (request) => {
    const actor = requireRole(config, request, "admin");
    const { accountId } = accountParamsSchema.parse(request.params);
    const existing = await repository.findBrandByAccountId(accountId);
    if (!existing) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "La cuenta no existe.");
    assertBrandAccess(actor, existing.id);
    const updated = await repository.clearAccountMetricool(accountId);
    if (!updated) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "La cuenta no existe.");
    const detail = publicAccountMetricoolDetail(config, updated);
    return {
      data: detail,
      meta: {
        ...apiMeta(config),
        credentialsStored: false,
        autoReplyRemoved: true,
        externalWrites: false,
        warning: detail.metricool.configurationLocked
          ? "Se eliminó la referencia guardada, pero la cuenta aún puede resolverse por configuración de entorno/fallback."
          : undefined,
      },
    };
  });

  app.get("/api/inbox/contacts", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const query = inboxContactListQuerySchema.parse(request.query);
    const { page, pageSize, ...filters } = query;
    assertDateRange(filters.from, filters.to);
    const snapshot = await repository.snapshot();
    const scopedFilters = scopedInteractionFilters(actor, snapshot.brands, filters);
    const contacts = groupInboxContacts(await repository.listInteractions(scopedFilters));
    const total = contacts.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    return {
      data: contacts.slice(offset, offset + pageSize),
      pagination: { page, pageSize, total, totalPages },
      meta: apiMeta(config),
    };
  });

  app.get("/api/inbox/posts", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const query = inboxPostListQuerySchema.parse(request.query);
    const { page, pageSize, pendingOnly, ...filters } = query;
    const snapshot = await repository.snapshot();
    const scopedFilters = scopedInteractionFilters(actor, snapshot.brands, {
      ...filters,
      type: "comment",
    });
    const grouped = groupInboxPosts(await repository.listInteractions(scopedFilters));
    const posts = pendingOnly ? grouped.filter((post) => post.pendingCount > 0) : grouped;
    const total = posts.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    return {
      data: posts.slice(offset, offset + pageSize),
      pagination: { page, pageSize, total, totalPages },
      meta: {
        ...apiMeta(config),
        ordering: "newest_first",
        primarySort: "published_at",
        fallbackSort: "latest_comment_at",
        pendingOnly,
        externalWrites: false,
      },
    };
  });

  app.get("/api/inbox/posts/:postKey/comments", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { postKey } = inboxPostParamsSchema.parse(request.params);
    const { page, pageSize, pendingOnly } = inboxPostCommentsQuerySchema.parse(request.query);
    const snapshot = await repository.snapshot();
    const scopedFilters = scopedInteractionFilters(actor, snapshot.brands, { type: "comment" });
    const allComments = await repository.listInteractions(scopedFilters);
    const post = groupInboxPosts(allComments).find((item) => item.postKey === postKey);
    if (!post) throw new ApiError(404, "INBOX_POST_NOT_FOUND", "La publicación no existe o no está disponible para este usuario.");
    const exactComments = pendingOnly
      ? pendingCommentsForInboxPost(allComments, postKey)
      : interactionsForInboxPost(allComments, postKey);
    const total = exactComments.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    return {
      data: exactComments.slice(offset, offset + pageSize).map(publicInboxInteraction),
      pagination: { page, pageSize, total, totalPages },
      meta: {
        ...apiMeta(config),
        post,
        pendingOnly,
        ordering: "oldest_first",
        externalWrites: false,
      },
    };
  });

  app.get("/api/interactions", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const query = interactionListQuerySchema.parse(request.query);
    const { page, pageSize, ...filters } = query;
    assertDateRange(filters.from, filters.to);
    const snapshot = await repository.snapshot();
    const scopedFilters = scopedInteractionFilters(actor, snapshot.brands, filters);
    const interactions = await repository.listInteractions(scopedFilters);
    const total = interactions.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const offset = (page - 1) * pageSize;
    return {
      data: interactions.slice(offset, offset + pageSize).map((interaction) => ({
        ...publicInboxInteraction(interaction),
        audit: interaction.audit,
        internalNotes: interaction.internalNotes,
        postContext: publicPostContext(interaction),
      })),
      pagination: { page, pageSize, total, totalPages },
      meta: apiMeta(config),
    };
  });

  app.get("/api/interactions/:id", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { id } = interactionParamsSchema.parse(request.params);
    const interaction = await repository.findInteraction(id);
    if (!interaction) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    assertBrandAccess(actor, interaction.brandId);
    const store = await repository.snapshot();
    const brand = store.brands.find((item) => item.id === interaction.brandId);
    const publicInteraction = publicInboxInteraction(interaction);
    return {
      data: {
        ...publicInteraction,
        audit: interaction.audit,
        internalNotes: interaction.internalNotes,
        brandName: brand?.name ?? interaction.brandId,
        accountHandle: brand?.account.handle ?? interaction.accountId,
        postContext: publicPostContext(interaction),
      },
      meta: apiMeta(config),
    };
  });

  app.get("/api/interactions/:id/conversation", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { id } = interactionParamsSchema.parse(request.params);
    const { limit, scope } = interactionConversationQuerySchema.parse(request.query);
    const selected = await repository.findInteraction(id);
    if (!selected) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    assertBrandAccess(actor, selected.brandId);
    const key = conversationKey(selected);
    const store = await repository.snapshot();
    const selectedInteractions = scope === "contact"
      ? interactionsForContact(
          store.interactions.filter((item) => item.brandId === selected.brandId),
          selected,
        )
      : store.interactions.filter((item) => item.brandId === selected.brandId && conversationKey(item) === key);
    const allMessages = selectedInteractions
      .flatMap<ConversationMessage>((item) => {
        const publicItem = publicInboxInteraction(item);
        const base: ConversationMessage = {
          id: item.id,
          direction: item.direction,
          text: publicItem.text,
          createdAt: item.createdAt,
          channel: item.channel,
          type: item.type,
          status: item.status,
          contentContext: publicItem.contentContext,
          postContext: publicPostContext(item),
        };
        const sentReply = item.direction === "inbound" && item.responseText && item.respondedAt
          ? [{
              id: `${item.id}-reply`,
              direction: "outbound" as const,
              text: item.responseText,
              createdAt: item.respondedAt,
              channel: item.channel,
              type: item.type,
              status: item.status,
              contentContext: { kind: "text" as const },
              postContext: publicPostContext(item),
            }]
          : [];
        return [base, ...sentReply];
      })
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
    const messages = allMessages.slice(-limit);
    return {
      data: messages,
      meta: {
        ...apiMeta(config),
        scope,
        conversationKey: scope === "thread"
          ? createHash("sha256").update(key).digest("hex").slice(0, 16)
          : undefined,
        contactKey: scope === "contact" ? contactKeyFor(selected) : undefined,
        total: allMessages.length,
        returned: messages.length,
        hasHistory: allMessages.length > 1,
      },
    };
  });

  app.get("/api/stats/summary", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const filters = interactionFiltersSchema.parse(request.query);
    assertDateRange(filters.from, filters.to);
    const snapshot = await repository.snapshot();
    const scopedFilters = scopedInteractionFilters(actor, snapshot.brands, filters);
    return { data: await repository.stats(scopedFilters), meta: apiMeta(config) };
  });

  app.get("/api/workflow", async (request) => {
    requireRole(config, request, "viewer");
    return {
      data: await repository.getWorkflow(),
      meta: apiMeta(config),
    };
  });

  app.get("/api/workflow/versions", async (request) => {
    requireRole(config, request, "viewer");
    const store = await repository.snapshot();
    return {
      data: [...store.workflowVersions].sort((left, right) => right.version - left.version),
      meta: { ...apiMeta(config), count: store.workflowVersions.length },
    };
  });

  app.post("/api/workflow/validate", async (request) => {
    requireRole(config, request, "viewer");
    const workflow = await repository.getWorkflow();
    return { data: validateWorkflow(workflow), meta: apiMeta(config) };
  });

  app.put("/api/workflow", async (request) => {
    const parsed = workflowUpdateSchema.parse(request.body);
    const actor = requireRole(config, request, parsed.autoReplyEnabled === true ? "admin" : "supervisor");
    const { confirmAutoReply: _confirmation, ...patch } = parsed;
    if (patch.requireHumanFor) {
      patch.requireHumanFor = ensureMandatoryHumanReviewCategories(patch.requireHumanFor);
    }
    const snapshot = await repository.snapshot();
    if (patch.autoReplyAccountIds) {
      const validIds = new Set(snapshot.brands.map((brand) => brand.account.id));
      const unknown = patch.autoReplyAccountIds.filter((id) => !validIds.has(id));
      if (unknown.length) {
        throw new ApiError(400, "UNKNOWN_ACCOUNTS", "La allowlist contiene cuentas desconocidas.", { accountIds: unknown });
      }
      for (const accountId of patch.autoReplyAccountIds) assertAccountAccess(actor, snapshot.brands, accountId);
    }
    if (!config.demoMode && patch.autoReplyEnabled === true) {
      const allowlist = patch.autoReplyAccountIds || snapshot.workflow.autoReplyAccountIds;
      if (!parsed.confirmAutoReply || !allowlist.length) {
        throw new ApiError(
          409,
          "AUTO_REPLY_CONFIRMATION_REQUIRED",
          "En modo live debe confirmar el autoenvío y seleccionar al menos una cuenta.",
        );
      }
    }
    const workflow = await repository.mutate((store) => {
      const now = new Date().toISOString();
      const nextVersion = store.workflow.version + 1;
      const next = {
        ...store.workflow,
        ...patch,
        id: store.workflow.id,
        version: nextVersion,
        updatedAt: now,
      };
      store.workflow = next;
      store.workflowVersions.forEach((item) => {
        if (item.status === "draft") item.status = "archived";
      });
      const version: WorkflowVersion = {
        id: `${next.id}-v${nextVersion}`,
        workflowId: next.id,
        version: nextVersion,
        status: "draft",
        snapshot: structuredClone(next),
        createdAt: now,
        createdBy: actor.userId,
        changeNote: "Cambios guardados desde el editor.",
      };
      store.workflowVersions.unshift(version);
      store.workflowVersions = store.workflowVersions.slice(0, 50);
      return next;
    });
    const validation = validateWorkflow(workflow);
    return {
      data: workflow,
      meta: {
        ...apiMeta(config),
        validation,
        publicationRequired: workflow.version !== workflow.publishedVersion,
        warning: workflow.autoReplyEnabled
          ? "El autoenvío solo aplica a cuentas allowlisted y nunca evita los guardrails."
          : undefined,
      },
    };
  });

  app.post("/api/workflow/publish", async (request) => {
    const actor = requireRole(config, request, "admin");
    const body = workflowPublishSchema.parse(request.body ?? {});
    const current = await repository.getWorkflow();
    const validation = validateWorkflow(current);
    if (!validation.valid) {
      throw new ApiError(409, "WORKFLOW_INVALID", "El workflow tiene errores y no puede publicarse.", validation);
    }
    if (!config.demoMode && current.autoReplyEnabled && !body.confirmAutoReply) {
      throw new ApiError(409, "AUTO_REPLY_CONFIRMATION_REQUIRED", "Confirme expresamente el autoenvío antes de publicar.");
    }
    const workflow = await repository.mutate((store) => {
      const now = new Date().toISOString();
      store.workflow.publishedVersion = store.workflow.version;
      store.workflow.publishedAt = now;
      store.workflow.publishedBy = actor.userId;
      store.workflow.updatedAt = now;
      store.workflowVersions.forEach((item) => {
        if (item.status === "published") item.status = "archived";
        if (item.version === store.workflow.version) {
          item.status = "published";
          item.changeNote = body.changeNote ?? item.changeNote;
          item.snapshot = structuredClone(store.workflow);
        }
      });
      return store.workflow;
    });
    return { data: workflow, meta: { ...apiMeta(config), validation, published: true } };
  });

  app.post("/api/workflow/rollback", async (request) => {
    const actor = requireRole(config, request, "admin");
    const body = workflowRollbackSchema.parse(request.body);
    const workflow = await repository.mutate((store) => {
      const source = store.workflowVersions.find((item) => item.version === body.version);
      if (!source) throw new ApiError(404, "WORKFLOW_VERSION_NOT_FOUND", "La versión solicitada no existe.");
      const now = new Date().toISOString();
      const nextVersion = store.workflow.version + 1;
      const restored = {
        ...structuredClone(source.snapshot),
        version: nextVersion,
        publishedVersion: store.workflow.publishedVersion,
        publishedAt: store.workflow.publishedAt,
        publishedBy: store.workflow.publishedBy,
        updatedAt: now,
      };
      store.workflowVersions.forEach((item) => {
        if (item.status === "draft") item.status = "archived";
      });
      store.workflow = restored;
      store.workflowVersions.unshift({
        id: `${restored.id}-v${nextVersion}`,
        workflowId: restored.id,
        version: nextVersion,
        status: "draft",
        snapshot: structuredClone(restored),
        createdAt: now,
        createdBy: actor.userId,
        changeNote: body.changeNote ?? `Rollback preparado desde la versión ${body.version}.`,
      });
      return restored;
    });
    return {
      data: workflow,
      meta: { ...apiMeta(config), restoredFrom: body.version, publicationRequired: true, validation: validateWorkflow(workflow) },
    };
  });

  app.post("/api/workflow/run", async (request, reply) => {
    const actor = requireRole(config, request, "agent");
    const body = workflowRunSchema.parse(request.body ?? {});
    const key = idempotencyKey(request.headers as Record<string, unknown>);
    const hash = requestHash(body);
    if (await replayIdempotent(repository, "workflow-run", key, hash, reply)) return reply;
    const store = await repository.snapshot();
    const brands = selectBrandsForActor(actor, store.brands, body.accountIds);
    const run = simulateWorkflow(
      store,
      brands.map((brand) => brand.account.id),
      body.sampleSize,
      config.demoMode,
      config.operations.outboundSendsDisabled,
    );
    run.requestedBy = actor.userId;
    await repository.recordRun(run);
    const response = {
      data: run,
      meta: { ...apiMeta(config), simulated: true, externalWrites: false },
    };
    await rememberIdempotent(repository, "workflow-run", key, hash, 200, response);
    return response;
  });

  app.post("/api/sac/protocol/evaluate", async (request, reply) => {
    const actor = requireRole(config, request, "agent");
    const body = sacProtocolRunSchema.parse(request.body ?? {});
    const key = config.demoMode
      ? idempotencyKey(request.headers as Record<string, unknown>)
      : requireIdempotencyKey(request.headers as Record<string, unknown>, "La evaluación del protocolo SAC");
    const hash = requestHash(body);
    if (await replayIdempotent(
      repository,
      "sac-protocol-evaluate",
      key,
      hash,
      reply,
      sanitizeSacProtocolResponse,
    )) return reply;
    let snapshot = await repository.snapshot();
    const brands = selectBrandsForActor(actor, snapshot.brands, body.accountIds);
    const allowedAccountIds = new Set(brands.map((brand) => brand.account.id));
    const reconciledTeamResponses = await reconcileDetectedTeamResponses(repository, [...allowedAccountIds]);
    if (reconciledTeamResponses) snapshot = await repository.snapshot();
    const requestedIds = body.interactionIds ? new Set(body.interactionIds) : undefined;
    const candidates = snapshot.interactions
      .filter((interaction) => allowedAccountIds.has(interaction.accountId))
      .filter((interaction) => !requestedIds || requestedIds.has(interaction.id))
      .filter((interaction) => interaction.direction === "inbound")
      .filter((interaction) => ["new", "pending", "drafted", "escalated"].includes(interaction.status))
      .filter((interaction) => body.force || !interaction.automation)
      .slice(0, body.limit);
    if (requestedIds) {
      const visibleRequested = new Set(candidates.map((interaction) => interaction.id));
      const inaccessible = [...requestedIds].filter((id) => {
        const interaction = snapshot.interactions.find((item) => item.id === id);
        return interaction && !allowedAccountIds.has(interaction.accountId);
      });
      if (inaccessible.length) {
        throw new ApiError(403, "BRAND_ACCESS_DENIED", "Una o más interacciones no pertenecen al alcance del actor.");
      }
      if (body.force && [...requestedIds].some((id) => !visibleRequested.has(id))) {
        throw new ApiError(422, "INTERACTION_NOT_ELIGIBLE", "Una o más interacciones no pueden pasar por el protocolo SAC.");
      }
    }
    const protocol = candidates.length
      ? await repository.mutateInteractions(candidates.map((interaction) => interaction.id), (store) => processSacInteractions(
          store,
          candidates.map((interaction) => interaction.id),
          sacAutomationOptions(config),
        ))
      : {
          interactions: [] as Interaction[],
          evaluated: 0,
          drafted: 0,
          escalated: 0,
          autoReplyCandidates: 0,
          queuedAutoReplies: 0,
          quarantined: 0,
        };
    const queued = protocol.queuedAutoReplies
      ? await queueEligibleAutoReplies(
          repository,
          protocol.interactions,
          { userId: actor.userId, displayName: actor.displayName },
          `protocol:${request.id}`,
          snapshot.workflow.publishedVersion,
          config.operations.autoReplyMaxPending,
        )
      : {
          eligible: 0,
          created: 0,
          alreadyPresent: 0,
          skippedCapacity: 0,
          pendingBefore: 0,
          maxPending: config.operations.autoReplyMaxPending,
        };
    const { interactions: _interactions, ...protocolSummary } = protocol;
    const response = {
      data: {
        ...protocolSummary,
        reconciledTeamResponses,
        queuedAutoReplies: queued.created,
        queueSkippedCapacity: queued.skippedCapacity,
      },
      meta: {
        ...apiMeta(config),
        externalWrites: false,
        localWrites: protocol.evaluated > 0 || reconciledTeamResponses > 0,
        outboundSendsDisabled: config.operations.outboundSendsDisabled,
        autoReplyDispatchMode: config.operations.autoReplyDispatchMode,
        queuedAutoReplies: queued.created,
        queueSkippedCapacity: queued.skippedCapacity,
        autoReplyMaxPending: config.operations.autoReplyMaxPending,
      },
    };
    await rememberIdempotent(repository, "sac-protocol-evaluate", key, hash, 200, response);
    return response;
  });

  app.post("/api/sync", async (request, reply) => {
    const actor = requireRole(config, request, "agent");
    const body = syncSchema.parse(request.body ?? {});
    const key = config.demoMode
      ? idempotencyKey(request.headers as Record<string, unknown>)
      : requireIdempotencyKey(request.headers as Record<string, unknown>, "La sincronización");
    const hash = requestHash(body);
    if (syncInProgress) {
      throw new ApiError(
        409,
        "SYNC_IN_PROGRESS",
        "Ya hay una sincronización de la bandeja en curso. Intente nuevamente cuando finalice.",
      );
    }
    syncInProgress = true;
    try {
      if (await replayIdempotent(repository, "sync", key, hash, reply, sanitizeSyncResponse)) return reply;
      const result = await executeSync(config, repository, metricoolClient, actor, body);
      const response = {
        data: publicSyncResult(result),
        meta: { ...apiMeta(config), externalWrites: false },
      };
      await rememberIdempotent(repository, "sync", key, hash, 200, response);
      return response;
    } finally {
      syncInProgress = false;
    }
  });

  app.get("/api/executions", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const query = executionListQuerySchema.parse(request.query);
    const store = await repository.snapshot();
    const allowedAccounts = actor.brandIds === "all"
      ? undefined
      : new Set(store.brands.filter((brand) => actor.brandIds.includes(brand.id)).map((brand) => brand.account.id));
    const filtered = store.runs
      .filter((run) => !query.kind || run.kind === query.kind)
      .filter((run) => !query.status || run.status === query.status)
      .filter((run) => !allowedAccounts || run.accountIds.every((accountId) => allowedAccounts.has(accountId)));
    const start = (query.page - 1) * query.pageSize;
    return {
      data: filtered.slice(start, start + query.pageSize),
      meta: { ...apiMeta(config), page: query.page, pageSize: query.pageSize, total: filtered.length },
    };
  });

  app.get("/api/executions/:id", async (request) => {
    const actor = requireRole(config, request, "viewer");
    const { id } = executionParamsSchema.parse(request.params);
    const store = await repository.snapshot();
    const run = store.runs.find((item) => item.id === id);
    if (!run) throw new ApiError(404, "EXECUTION_NOT_FOUND", "La ejecución no existe.");
    const visibleAccounts = new Set(selectBrandsForActor(actor, store.brands).map((brand) => brand.account.id));
    if (!run.accountIds.every((accountId) => visibleAccounts.has(accountId))) {
      throw new ApiError(403, "BRAND_SCOPE_FORBIDDEN", "La ejecución contiene cuentas fuera de su alcance.");
    }
    return { data: run, meta: apiMeta(config) };
  });

  app.post("/api/executions/:id/retry", async (request, reply) => {
    const actor = requireRole(config, request, "agent");
    const { id } = executionParamsSchema.parse(request.params);
    const key = config.demoMode
      ? idempotencyKey(request.headers as Record<string, unknown>)
      : requireIdempotencyKey(request.headers as Record<string, unknown>, "El reintento");
    const hash = requestHash({ executionId: id });
    if (await replayIdempotent(
      repository,
      `execution-retry:${id}`,
      key,
      hash,
      reply,
      sanitizeSyncResponse,
    )) return reply;
    const store = await repository.snapshot();
    const previous = store.runs.find((item) => item.id === id);
    if (!previous) throw new ApiError(404, "EXECUTION_NOT_FOUND", "La ejecución no existe.");
    const brands = selectBrandsForActor(actor, store.brands, previous.accountIds);
    let data: WorkflowRun | { run: WorkflowRun; newInteractions: number };
    if (previous.kind === "simulation") {
      const run = simulateWorkflow(
        store,
        brands.map((brand) => brand.account.id),
        Math.max(1, previous.totals.fetched || 25),
        config.demoMode,
        config.operations.outboundSendsDisabled,
      );
      run.retryOf = previous.id;
      run.requestedBy = actor.userId;
      await repository.recordRun(run);
      data = run;
    } else {
      data = publicSyncResult(await executeSync(config, repository, metricoolClient, actor, {
        accountIds: previous.accountIds,
        limit: 100,
      }, previous.id));
    }
    const response = { data, meta: { ...apiMeta(config), retryOf: previous.id } };
    await rememberIdempotent(repository, `execution-retry:${id}`, key, hash, 200, response);
    return response;
  });

  app.get("/api/jobs", async (request) => {
    requireRole(config, request, "supervisor");
    const query = jobListQuerySchema.parse(request.query);
    const jobs = await repository.listJobs(query.status);
    return { data: jobs, meta: { ...apiMeta(config), count: jobs.length } };
  });

  app.post("/api/jobs/:id/retry", async (request, reply) => {
    requireRole(config, request, "admin");
    const { id } = jobParamsSchema.parse(request.params);
    const key = config.demoMode
      ? idempotencyKey(request.headers as Record<string, unknown>)
      : requireIdempotencyKey(request.headers as Record<string, unknown>, "El reintento del job");
    const hash = requestHash({ jobId: id });
    if (await replayIdempotent(repository, `job-retry:${id}`, key, hash, reply)) return reply;
    const job = await repository.retryJob(id);
    if (!job) throw new ApiError(409, "JOB_NOT_RETRYABLE", "El job no existe o no está en estado dead/retry.");
    const response = { data: job, meta: { ...apiMeta(config), requeued: true } };
    await rememberIdempotent(repository, `job-retry:${id}`, key, hash, 200, response);
    return response;
  });

  app.post("/api/interactions/:id/reply", async (request, reply) => {
    const actor = requireRole(config, request, "agent");
    const { id } = interactionParamsSchema.parse(request.params);
    const body = replySchema.parse(request.body);
    const key = !config.demoMode && body.mode === "send" && !config.operations.outboundSendsDisabled
      ? requireIdempotencyKey(request.headers as Record<string, unknown>, "El envío de respuestas")
      : idempotencyKey(request.headers as Record<string, unknown>);
    const hash = requestHash({ id, ...body });
    if (body.mode === "draft" && await replayIdempotent(
      repository,
      `reply:${id}`,
      key,
      hash,
      reply,
      sanitizeReplyResponse,
    )) return reply;
    const interaction = await repository.findInteraction(id);
    if (!interaction) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    assertBrandAccess(actor, interaction.brandId);
    assertInteractionVersion(interaction, body.expectedVersion);
    if (interaction.direction !== "inbound") {
      throw new ApiError(409, "INVALID_DIRECTION", "Solo se puede responder a interacciones entrantes.");
    }
    const answeredByDetectedTeamResponse = interaction.audit.some((entry) =>
      entry.action === "status_changed" && entry.metadata?.reason === "OUTBOUND_MESSAGE_DETECTED");
    if (body.mode === "draft" && answeredByDetectedTeamResponse) {
      throw new ApiError(409, "CASE_ALREADY_CLOSED", "La interacción ya fue respondida o cerrada.");
    }
    const store = await repository.snapshot();
    const brand = store.brands.find((item) => item.id === interaction.brandId);
    if (!brand) throw new ApiError(409, "BRAND_NOT_FOUND", "La marca asociada ya no existe.");
    const confidence = body.confidence ?? interaction.confidence;
    const sensitive = requiresHumanReview(interaction, store.workflow, confidence);
    let updatedAfterDelivery: Interaction | undefined;
    let replyDeliveryId: string | undefined;
    let replyDeliveryStatus: "sent" | "demo_simulated" | undefined;
    let liveCredentials: MetricoolAccountReference | undefined;

    if (body.mode === "send") {
      if (config.operations.outboundSendsDisabled) {
        throw new ApiError(
          423,
          "OUTBOUND_SENDS_DISABLED",
          "El cortacorriente de envíos está activo; solo se pueden guardar borradores.",
        );
      }
      if (!config.demoMode) {
        if (body.approvedByHuman && !config.operations.manualRepliesEnabled) {
          throw new ApiError(
            423,
            "MANUAL_REPLIES_DISABLED",
            "Las respuestas manuales reales están desactivadas en este entorno.",
          );
        }
        if (!body.approvedByHuman && config.operations.metricoolMutationsDisabled) {
          throw new ApiError(
            423,
            "METRICOOL_MUTATIONS_DISABLED",
            "Las mutaciones automáticas de Metricool están bloqueadas por el protocolo de desarrollo.",
          );
        }
      }
      if (["replied", "resolved"].includes(interaction.status)) {
        throw new ApiError(409, "CASE_ALREADY_CLOSED", "La interacción ya fue respondida o cerrada.");
      }
      const accountAllowlisted = store.workflow.autoReplyAccountIds.includes(interaction.accountId);
      const workflowPublished = store.workflow.version === store.workflow.publishedVersion;
      const currentAssessment = evaluateSacInteraction(interaction, store, {
        outboundSendsDisabled: false,
        autoSendInfrastructureReady: true,
      });
      const autoSendAllowed = store.workflow.autoReplyEnabled
        && accountAllowlisted
        && !sensitive
        && workflowPublished
        && ["new", "pending", "drafted"].includes(interaction.status)
        && !interaction.assignedTo
        && currentAssessment.recommendedRoute === "auto_reply";
      if (sensitive && !body.approvedByHuman) {
        throw new ApiError(
          409,
          "HUMAN_REVIEW_REQUIRED",
          "Esta interacción es sensible y requiere aprobación humana antes de enviar.",
        );
      }
      if (!config.demoMode && !body.approvedByHuman && !autoSendAllowed) {
        throw new ApiError(
          409,
          "SEND_NOT_ALLOWED",
          workflowPublished
            ? `El protocolo SAC bloqueó el autoenvío: ${currentAssessment.reasonCodes.join(", ")}.`
            : "El workflow tiene cambios sin publicar. Publíquelo o apruebe el envío manualmente.",
        );
      }

      if (!config.demoMode) {
        if (!metricoolClient) {
          throw new ApiError(503, "METRICOOL_NOT_CONFIGURED", "Metricool no está configurado para modo live.");
        }
        liveCredentials = resolveMetricoolAccount(config, brand.account.id, brand.account.metricool);
        if (!liveCredentials) {
          throw new ApiError(422, "ACCOUNT_NOT_CONFIGURED", "Faltan userId/blogId para la cuenta.");
        }
        if (interaction.type === "dm" && !interaction.metricoolRef?.recipient) {
          throw new ApiError(
            422,
            "METRICOOL_RECIPIENT_MISSING",
            "La conversación no contiene el recipient requerido por Metricool; vuelva a sincronizarla.",
          );
        }
      }

      await repository.recoverStaleReplyDeliveries();
      if (!config.demoMode) {
        const uncertainForAccount = (await repository.listReplyDeliveries({
          status: "uncertain",
          accountId: interaction.accountId,
          limit: 1,
        }))[0];
        if (uncertainForAccount) {
          const sameInteraction = uncertainForAccount.interactionId === interaction.id;
          throw new ApiError(
            409,
            sameInteraction
              ? "DELIVERY_RECONCILIATION_REQUIRED"
              : "ACCOUNT_DELIVERY_RECONCILIATION_REQUIRED",
            sameInteraction
              ? "Existe una entrega incierta para este caso; verifíquela y concíliela antes de intentar otra respuesta."
              : "La cuenta tiene una entrega incierta. Concíliela antes de enviar otra respuesta por esta cuenta.",
            {
              deliveryId: uncertainForAccount.id,
              deliveryStatus: uncertainForAccount.status,
              deliveryVersion: uncertainForAccount.version,
            },
          );
        }
      }
      const operationKey = key || `demo:${request.id}`;
      const prepared = await repository.prepareReplyDelivery({
        id: randomUUID(),
        interactionId: interaction.id,
        brandId: interaction.brandId,
        accountId: interaction.accountId,
        bodyText: body.text,
        approvedByHuman: body.approvedByHuman,
        requestedBy: { userId: actor.userId, displayName: actor.displayName },
        idempotencyKey: operationKey,
        requestId: request.id,
        createdAt: new Date().toISOString(),
      });
      const delivery = prepared.delivery;
      replyDeliveryId = delivery.id;
      if (!prepared.created && delivery.idempotencyKey !== operationKey) {
        throw new ApiError(
          409,
          delivery.status === "uncertain" ? "DELIVERY_RECONCILIATION_REQUIRED" : "DELIVERY_ALREADY_ACTIVE",
          delivery.status === "uncertain"
            ? "Existe una entrega incierta para este caso; verifíquela y concíliela antes de intentar otra respuesta."
            : "Ya existe una entrega activa para este caso.",
          { deliveryId: delivery.id, deliveryStatus: delivery.status, deliveryVersion: delivery.version },
        );
      }
      if (
        delivery.interactionId !== interaction.id
        || delivery.bodyText !== body.text
        || delivery.approvedByHuman !== body.approvedByHuman
      ) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "El Idempotency-Key ya fue usado con una entrega diferente.",
        );
      }
      if (!prepared.created) {
        if (delivery.status === "sent" || delivery.status === "demo_simulated") {
          const response = {
            data: publicInteractionMutationState(await repository.findInteraction(interaction.id)),
            meta: {
              ...apiMeta(config),
              delivery: delivery.status,
              deliveryId: delivery.id,
              idempotentReplay: true,
            },
          };
          await rememberIdempotent(repository, `reply:${id}`, key, hash, 200, response);
          return response;
        }
        if (delivery.status !== "pending") {
          const errorCode = delivery.status === "uncertain"
            ? "DELIVERY_RECONCILIATION_REQUIRED"
            : delivery.status === "sending"
              ? "DELIVERY_IN_PROGRESS"
              : "DELIVERY_NOT_RETRYABLE";
          throw new ApiError(
            409,
            errorCode,
            delivery.status === "uncertain"
              ? "No se reenviará: la entrega debe verificarse en Metricool y conciliarse manualmente."
              : delivery.status === "sending"
                ? "La entrega ya está en curso."
                : "Esta entrega ya finalizó sin envío; revise la causa antes de crear otra operación.",
            { deliveryId: delivery.id, deliveryStatus: delivery.status, deliveryVersion: delivery.version },
          );
        }
      }
      if (delivery.nextAttemptAt && Date.parse(delivery.nextAttemptAt) > Date.now()) {
        throw new ApiError(
          429,
          "DELIVERY_DEFERRED",
          "La cuenta está temporalmente en pausa por límite del proveedor.",
          { deliveryId: delivery.id, retryAt: delivery.nextAttemptAt },
        );
      }

      if (config.demoMode) {
        const settled = await repository.settleReplyDelivery(delivery.id, {
          status: "demo_simulated",
          at: new Date().toISOString(),
        });
        if (!settled?.interaction) {
          throw new ApiError(500, "DELIVERY_STATE_ERROR", "No se pudo confirmar la simulación local.");
        }
        updatedAfterDelivery = settled.interaction;
        replyDeliveryStatus = "demo_simulated";
      } else {
        const claimed = await repository.claimReplyDelivery(delivery.id, 2 * 60_000);
        if (!claimed) {
          const current = await repository.findReplyDelivery(delivery.id);
          if (current?.status === "pending" && current.nextAttemptAt && Date.parse(current.nextAttemptAt) > Date.now()) {
            throw new ApiError(
              429,
              "DELIVERY_DEFERRED",
              "La cuenta está temporalmente en pausa por límite del proveedor.",
              { deliveryId: current.id, retryAt: current.nextAttemptAt },
            );
          }
          throw new ApiError(
            409,
            "DELIVERY_IN_PROGRESS",
            "La entrega no pudo reservarse para envío.",
            { deliveryId: delivery.id },
          );
        }
      }

      if (!config.demoMode) {
        if (!metricoolClient || !liveCredentials) {
          throw new ApiError(500, "DELIVERY_STATE_ERROR", "La entrega perdió su configuración validada.");
        }
        let providerResponse: unknown;
        try {
          if (interaction.type === "dm") {
            const recipient = interaction.metricoolRef?.recipient;
            if (!recipient) throw new Error("validated recipient missing");
            providerResponse = await metricoolClient.replyToConversation(liveCredentials, {
              text: body.text,
              conversationId: interaction.metricoolRef?.conversationId || interaction.externalId,
              recipient,
              provider: interaction.metricoolRef?.provider
                || metricoolProviderForChannel(interaction.channel, liveCredentials),
            });
          } else if (interaction.type === "comment") {
            providerResponse = await metricoolClient.replyToPostComment(liveCredentials, {
              text: body.text,
              objectId: interaction.metricoolRef?.objectId
                || interaction.metricoolRef?.commentId
                || interaction.externalId,
              provider: interaction.metricoolRef?.provider
                || metricoolProviderForChannel(interaction.channel, liveCredentials),
            });
          } else {
            providerResponse = await metricoolClient.replyToReview(liveCredentials, {
              text: body.text,
              reviewId: interaction.metricoolRef?.objectId || interaction.externalId,
              provider: interaction.metricoolRef?.provider
                || metricoolProviderForChannel(interaction.channel, liveCredentials),
            });
          }
        } catch (error) {
          if (error instanceof MetricoolRequestError && error.status === 429) {
            const current = await repository.findReplyDelivery(delivery.id);
            const at = new Date();
            if ((current?.attemptCount ?? 0) >= 5) {
              await repository.settleReplyDelivery(delivery.id, {
                status: "failed",
                errorCode: "METRICOOL_RATE_LIMIT_RETRIES_EXHAUSTED",
                at: at.toISOString(),
              });
              throw new ApiError(
                429,
                "METRICOOL_RATE_LIMIT_RETRIES_EXHAUSTED",
                "La entrega agotó sus reintentos por límite del proveedor y requiere revisión.",
                { deliveryId: delivery.id },
              );
            }
            const backoffMs = Math.min(60 * 60_000, Math.max(1_000, error.retryAfterMs ?? 60_000));
            const retryAt = new Date(at.getTime() + backoffMs).toISOString();
            const deferred = await repository.deferReplyDelivery(delivery.id, {
              errorCode: "METRICOOL_HTTP_429",
              nextAttemptAt: retryAt,
              at: at.toISOString(),
            });
            if (deferred) {
              throw new ApiError(
                429,
                "METRICOOL_RATE_LIMITED",
                "Metricool aplicó un límite temporal; la entrega quedó reprogramada sin duplicarse.",
                { deliveryId: delivery.id, retryAt },
              );
            }
          }
          const deliveryStatus = explicitProviderRejection(error) ? "failed" : "uncertain";
          await repository.settleReplyDelivery(delivery.id, {
            status: deliveryStatus,
            errorCode: error instanceof MetricoolRequestError
              ? `METRICOOL_HTTP_${error.status}`
              : "METRICOOL_DELIVERY_UNKNOWN",
            at: new Date().toISOString(),
          });
          if (deliveryStatus === "uncertain") {
            throw new ApiError(
              502,
              "DELIVERY_UNCERTAIN",
              "Metricool no confirmó el resultado. No se reenviará hasta verificar y conciliar la entrega.",
              { deliveryId: delivery.id },
            );
          }
          throw error;
        }
        const settled = await repository.settleReplyDelivery(delivery.id, {
          status: "sent",
          providerResponseRef: providerResponseReference(providerResponse),
          at: new Date().toISOString(),
        });
        if (!settled?.interaction) {
          throw new ApiError(
            502,
            "DELIVERY_UNCERTAIN",
            "Metricool respondió, pero no se pudo confirmar el estado local. La entrega requiere conciliación.",
            { deliveryId: delivery.id },
          );
        }
        updatedAfterDelivery = settled.interaction;
        replyDeliveryStatus = "sent";
      }
    }

    const updated = body.mode === "send" ? updatedAfterDelivery : await repository.updateInteraction(id, (item) => {
      assertInteractionVersion(item, body.expectedVersion);
      const at = new Date().toISOString();
      item.responseText = body.text;
      item.status = "drafted";
      item.audit.push({
        id: randomUUID(),
        at,
        action: "draft_created",
        actor: body.approvedByHuman ? "agent" : "workflow",
        detail: "Borrador guardado para revisión.",
        metadata: { demoMode: config.demoMode, approvedByHuman: body.approvedByHuman },
      });
    });
    if (!updated) throw new ApiError(500, "DELIVERY_STATE_ERROR", "No se pudo persistir la respuesta.");
    const response = {
      data: publicInteractionMutationState(updated),
      meta: {
        ...apiMeta(config),
        delivery: body.mode === "draft" ? "draft_saved" : replyDeliveryStatus,
        ...(replyDeliveryId ? { deliveryId: replyDeliveryId } : {}),
      },
    };
    await rememberIdempotent(repository, `reply:${id}`, key, hash, 200, response);
    return response;
  });

  app.delete("/api/interactions/:id/draft", async (request) => {
    const actor = requireRole(config, request, "agent");
    const { id } = interactionParamsSchema.parse(request.params);
    const body = interactionDraftDeleteSchema.parse(request.body);
    const current = await repository.findInteraction(id);
    if (!current) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    assertBrandAccess(actor, current.brandId);
    const updated = await repository.updateInteraction(id, (item) => {
      assertInteractionVersion(item, body.expectedVersion);
      if (["replied", "resolved"].includes(item.status)) {
        throw new ApiError(409, "CASE_ALREADY_CLOSED", "No se puede borrar el texto de una respuesta ya enviada o resuelta.");
      }
      const at = new Date().toISOString();
      delete item.responseText;
      if (item.status === "drafted") item.status = "pending";
      item.audit.push({
        id: randomUUID(),
        at,
        action: "draft_deleted",
        actor: "agent",
        detail: "El agente borró el borrador local. El mensaje original del cliente no fue modificado.",
      });
    });
    if (!updated) throw new ApiError(500, "DRAFT_DELETE_FAILED", "No se pudo borrar el borrador.");
    return {
      data: publicInteractionMutationState(updated),
      meta: { ...apiMeta(config), deleted: true, externalWrites: false },
    };
  });

  app.get("/api/deliveries", async (request) => {
    const actor = requireRole(config, request, "agent");
    const query = replyDeliveryListQuerySchema.parse(request.query);
    const deliveries = await repository.listReplyDeliveries({
      ...query,
      brandIds: actor.brandIds === "all" ? undefined : actor.brandIds,
    });
    return { data: deliveries.map(publicReplyDelivery), meta: { ...apiMeta(config), total: deliveries.length } };
  });

  app.get("/api/deliveries/:id", async (request) => {
    const actor = requireRole(config, request, "agent");
    const { id } = replyDeliveryParamsSchema.parse(request.params);
    const delivery = await repository.findReplyDelivery(id);
    if (!delivery) throw new ApiError(404, "DELIVERY_NOT_FOUND", "La entrega no existe.");
    assertBrandAccess(actor, delivery.brandId);
    return { data: publicReplyDelivery(delivery), meta: apiMeta(config) };
  });

  app.post("/api/deliveries/:id/reconcile", async (request) => {
    const actor = requireRole(config, request, "supervisor");
    const { id } = replyDeliveryParamsSchema.parse(request.params);
    const body = replyDeliveryReconcileSchema.parse(request.body);
    const delivery = await repository.findReplyDelivery(id);
    if (!delivery) throw new ApiError(404, "DELIVERY_NOT_FOUND", "La entrega no existe.");
    assertBrandAccess(actor, delivery.brandId);
    if (delivery.status !== "uncertain") {
      throw new ApiError(409, "DELIVERY_NOT_RECONCILABLE", "Solo una entrega incierta puede conciliarse.");
    }
    if (delivery.version !== body.expectedVersion) {
      throw new ApiError(409, "VERSION_CONFLICT", "La entrega cambió; actualice la vista antes de conciliar.");
    }
    const reconciled = await repository.reconcileReplyDelivery(id, {
      outcome: body.outcome,
      expectedVersion: body.expectedVersion,
      actor: { userId: actor.userId, displayName: actor.displayName },
      note: body.note,
      at: new Date().toISOString(),
    });
    if (!reconciled) {
      throw new ApiError(409, "DELIVERY_RECONCILE_CONFLICT", "La entrega cambió durante la conciliación.");
    }
    return {
      data: {
        delivery: publicReplyDelivery(reconciled.delivery),
        interaction: publicInteractionMutationState(reconciled.interaction),
      },
      meta: apiMeta(config),
    };
  });

  app.patch("/api/interactions/:id/status", async (request) => {
    const actor = requireRole(config, request, "agent");
    const { id } = interactionParamsSchema.parse(request.params);
    const body = interactionStatusUpdateSchema.parse(request.body);
    const interaction = await repository.findInteraction(id);
    if (!interaction) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    assertBrandAccess(actor, interaction.brandId);
    const statusReason = statusReasonFor(body.status, body.reasonCode);
    if (!statusReason) {
      throw new ApiError(
        400,
        "INVALID_STATUS_REASON",
        "El motivo no pertenece al catálogo permitido para el estado seleccionado.",
        { status: body.status, allowedCodes: INTERACTION_STATUS_REASON_CATALOG[body.status].map((item) => item.code) },
      );
    }
    if (statusReason.noteRequired && !body.reasonNote) {
      throw new ApiError(400, "STATUS_REASON_NOTE_REQUIRED", "Este motivo requiere una nota explicativa.");
    }

    const updated = await repository.updateInteraction(id, (item) => {
      assertInteractionVersion(item, body.expectedVersion);
      const at = new Date().toISOString();
      item.status = body.status;
      item.statusReason = {
        code: statusReason.code,
        label: statusReason.label,
        note: body.reasonNote,
        changedAt: at,
        changedBy: { userId: actor.userId, displayName: actor.displayName },
      };
      item.audit.push({
        id: randomUUID(),
        at,
        action: "status_changed",
        actor: "agent",
        detail: body.reasonNote
          ? `${statusReason.label}: ${body.reasonNote}`
          : statusReason.label,
        metadata: { status: body.status, reasonCode: statusReason.code, actorId: actor.userId },
      });
    });
    return { data: publicInteractionMutationState(updated), meta: { ...apiMeta(config), statusChanged: true } };
  });

  app.put("/api/interactions/:id/assignment", async (request) => {
    const actor = requireRole(config, request, "agent");
    const { id } = interactionParamsSchema.parse(request.params);
    const body = interactionAssignmentSchema.parse(request.body);
    const interaction = await repository.findInteraction(id);
    if (!interaction) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    assertBrandAccess(actor, interaction.brandId);
    if (body.action === "assign" && ROLE_RANK[actor.role] < ROLE_RANK.supervisor) {
      throw new ApiError(403, "FORBIDDEN", "Asignar un caso a otra persona requiere rol supervisor.");
    }

    const updated = await repository.updateInteraction(id, (item) => {
      assertInteractionVersion(item, body.expectedVersion);
      const at = new Date().toISOString();

      if (body.action === "release") {
        if (!item.assignedTo) {
          throw new ApiError(409, "INTERACTION_NOT_ASSIGNED", "El caso no tiene una persona asignada.");
        }
        if (ROLE_RANK[actor.role] < ROLE_RANK.supervisor && item.assignedTo.userId !== actor.userId) {
          throw new ApiError(403, "FORBIDDEN", "Un agente solo puede liberar casos asignados a sí mismo.");
        }
        const previousAssigneeId = item.assignedTo.userId;
        delete item.assignedTo;
        item.audit.push({
          id: randomUUID(),
          at,
          action: "unassigned",
          actor: "agent",
          detail: `Caso liberado por ${actor.displayName}.`,
          metadata: { actorId: actor.userId, previousAssigneeId },
        });
        return;
      }

      const assignee = body.action === "claim"
        ? { userId: actor.userId, displayName: actor.displayName }
        : { userId: body.userId, displayName: body.displayName };
      if (body.action === "claim" && item.assignedTo && item.assignedTo.userId !== actor.userId) {
        throw new ApiError(
          409,
          "INTERACTION_ALREADY_ASSIGNED",
          `El caso ya está asignado a ${item.assignedTo.displayName}.`,
          { assigneeUserId: item.assignedTo.userId },
        );
      }
      item.assignedTo = assignee;
      item.audit.push({
        id: randomUUID(),
        at,
        action: "assigned",
        actor: "agent",
        detail: `Caso asignado a ${assignee.displayName} por ${actor.displayName}.`,
        metadata: { actorId: actor.userId, assigneeUserId: assignee.userId },
      });
    });
    return { data: publicInteractionMutationState(updated), meta: { ...apiMeta(config), assignmentChanged: true } };
  });

  app.post("/api/interactions/:id/notes", async (request) => {
    const actor = requireRole(config, request, "agent");
    const { id } = interactionParamsSchema.parse(request.params);
    const body = interactionNoteCreateSchema.parse(request.body);
    const interaction = await repository.findInteraction(id);
    if (!interaction) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    assertBrandAccess(actor, interaction.brandId);

    const noteId = randomUUID();
    const updated = await repository.updateInteraction(id, (item) => {
      assertInteractionVersion(item, body.expectedVersion);
      item.internalNotes = Array.isArray(item.internalNotes) ? item.internalNotes : [];
      if (item.internalNotes.length >= 500) {
        throw new ApiError(409, "INTERNAL_NOTE_LIMIT_REACHED", "El caso alcanzó el límite de notas internas.");
      }
      const at = new Date().toISOString();
      item.internalNotes.push({
        id: noteId,
        authorId: actor.userId,
        authorName: actor.displayName,
        text: body.text,
        createdAt: at,
      });
      item.audit.push({
        id: randomUUID(),
        at,
        action: "note_added",
        actor: "agent",
        detail: `Nota interna agregada por ${actor.displayName}.`,
        metadata: { actorId: actor.userId, noteId },
      });
    });
    return {
      data: publicInteractionMutationState(updated),
      meta: { ...apiMeta(config), noteCreated: true, externalWrites: false },
    };
  });

  app.get("/api/export/xlsx", async (request, reply) => {
    const actor = requireRole(config, request, "supervisor");
    const snapshot = await repository.snapshot();
    const filters = scopedInteractionFilters(actor, snapshot.brands, {});
    const workbook = await buildInteractionsWorkbook(repository, filters);
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="sac-flow-${date}.xlsx"`)
      .header("Cache-Control", "no-store")
      .send(workbook);
  });

  registerAutomationRoutes(app, {
    repository,
    config,
    requireRole: (request, role) => requireRole(config, request, role),
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "La solicitud contiene datos inválidos.",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        meta: apiMeta(config),
      });
    }
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        meta: apiMeta(config),
      });
    }
    if (error instanceof AutomationServiceError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
        meta: apiMeta(config),
      });
    }
    if (error instanceof MetricoolRequestError) {
      request.log.warn({ status: error.status, endpoint: error.endpoint }, "Metricool request failed");
      return reply.code(502).send({
        error: { code: "METRICOOL_ERROR", message: "Metricool rechazó la operación." },
        meta: apiMeta(config),
      });
    }
    request.log.error({ err: error }, "Unhandled API error");
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Ocurrió un error interno." },
      meta: apiMeta(config),
    });
  });

  if (options.serveFrontend ?? config.serveFrontend) await registerFrontend(app, config);

  app.setNotFoundHandler(async (request, reply) => {
    if ((options.serveFrontend ?? config.serveFrontend)
      && request.method === "GET"
      && !request.url.startsWith("/api/")
      && request.headers.accept?.includes("text/html")) {
      const staticReply = reply as FastifyReply & { sendFile: (filename: string) => FastifyReply };
      if (typeof staticReply.sendFile === "function") return staticReply.sendFile("index.html");
    }
    return reply.code(404).send({
      error: { code: "NOT_FOUND", message: "Ruta no encontrada." },
      meta: apiMeta(config),
    });
  });

  return app;
}
