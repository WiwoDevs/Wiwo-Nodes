/**
 * Rutas de WhatsApp. Tres superficies:
 *
 * - `/api/whatsapp/lines…` — números de WhatsApp: crear, vincular por QR o código, desvincular y
 *   quitar. Solo admins principales (SAC_FLOW_AUTH_ADMIN_EMAILS): vincular un número le da a
 *   wiwo.sac acceso a todos sus chats.
 * - `/api/whatsapp/status` — si cada número está conectado, para cualquier persona de la bandeja.
 * - `/api/internal/whatsapp/…` — el worker (server/whatsapp-worker.ts), autenticado con
 *   `SAC_FLOW_WHATSAPP_WORKER_KEY`. Nunca pasa por la sesión de una persona.
 *
 * Responder no tiene ruta propia: usa `POST /api/interactions/:id/reply` como cualquier DM. Para
 * WhatsApp esa ruta deja la entrega en cola y el worker la envía con su ritmo humano.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "./api-error.js";
import type { AppConfig } from "./config.js";
import { actorCan, type Permission } from "./permissions.js";
import type { SacFlowRepository } from "./repository-contract.js";
import type { ActorContext, Brand, WhatsAppLine } from "./types.js";
import { WHATSAPP_LINE_STATUSES } from "./types.js";
import type { NormalizedWhatsAppMessage } from "./whatsapp/messages.js";
import { WhatsAppLineError, type WhatsAppLineService } from "./whatsapp/line-service.js";
import { applyWhatsAppUpdate, buildSentWhatsAppInteraction, whatsappExternalId, type WhatsAppHistoryMode } from "./whatsapp/ingest.js";
import {
  baseMime,
  isMediaKey,
  mediaKey,
  mediaKindFor,
  safeFileName,
  WHATSAPP_MEDIA_MAX_BYTES,
  type WhatsAppMediaRef,
} from "./whatsapp/media.js";
import type { WhatsAppMessageUpdate } from "./whatsapp/messages.js";
import type { WiwoTalkService } from "./wiwo-talk/service.js";
import type { Interaction } from "./types.js";

export const WHATSAPP_WORKER_PREFIX = "/api/internal/whatsapp/";
export const WHATSAPP_WORKER_KEY_HEADER = "x-whatsapp-worker-key";
/** Tiempo que el worker tiene para mostrar "escribiendo…" y enviar antes de que la entrega quede incierta. */
export const WHATSAPP_DELIVERY_LEASE_MS = 2 * 60_000;
/** Una respuesta que no pudo salir en 24 h falla: no se envía fuera de contexto. */
export const WHATSAPP_QUEUE_MAX_AGE_MS = 24 * 60 * 60_000;

export function isWhatsAppWorkerPath(url: string): boolean {
  return (url.split("?", 1)[0] || "/").startsWith(WHATSAPP_WORKER_PREFIX);
}

export type WhatsAppMode = "demo" | "live" | "disabled";

export function whatsappMode(config: AppConfig): WhatsAppMode {
  if (config.demoMode) return "demo";
  // Con la clave del worker configurada WhatsApp está en vivo; cada persona lo tiene activado o
  // no según su ajuste en la base (Usuarios y roles).
  return config.whatsapp.workerKey ? "live" : "disabled";
}

export interface WhatsAppRouteDeps {
  config: AppConfig;
  repository: SacFlowRepository;
  lines: WhatsAppLineService;
  requireActor: (request: FastifyRequest) => ActorContext;
  requirePermission: (request: FastifyRequest, permission: Permission) => ActorContext;
  isMasterAdmin: (actor: ActorContext) => boolean;
  /** Conexiones de WiWO Talk: sus chats también son WhatsApp (leído, estado para la bandeja). */
  wiwoTalk?: WiwoTalkService;
  /** Guarda los mensajes como interacciones (repositorio + protocolo SAC + respuestas del equipo). */
  ingest: (
    line: WhatsAppLine,
    brand: Brand,
    messages: NormalizedWhatsAppMessage[],
    history?: WhatsAppHistoryMode,
  ) => Promise<{ created: number; duplicates: number; history?: number }>;
}

/** Mensajes que se piden al teléfono por cada "Cargar anteriores". */
const HISTORY_PAGE_SIZE = 50;

const lineParams = z.object({ id: z.string().uuid() }).strict();
const linkMethod = z.enum(["qr", "code"]);
const createLineBody = z.object({
  brandId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(80),
  method: linkMethod.default("qr"),
  phoneNumber: z.string().trim().max(32).optional(),
  importHistory: z.boolean().default(false),
}).strict();
const linkBody = z.object({
  method: linkMethod.default("qr"),
  phoneNumber: z.string().trim().max(32).optional(),
  importHistory: z.boolean().optional(),
}).strict();
const historyBody = z.object({
  interactionId: z.string().trim().min(1).max(120),
}).strict();
const typingBody = z.object({
  interactionId: z.string().trim().min(1).max(120),
  state: z.enum(["composing", "paused"]),
}).strict();
const presenceQuery = z.object({ interactionId: z.string().trim().min(1).max(120) }).strict();
const workerPresenceBody = z.object({
  chatId: z.string().trim().min(3).max(200).regex(/^[^@\s]+@(s\.whatsapp\.net|lid)$/),
  state: z.enum(["composing", "recording", "paused"]),
}).strict();
const demoMessageBody = z.object({
  text: z.string().trim().min(1).max(1_000).optional(),
}).strict().default({});

const stateBody = z.object({
  generation: z.number().int().min(1),
  status: z.enum(WHATSAPP_LINE_STATUSES),
  qr: z.string().min(1).max(4_000).optional(),
  pairingCode: z.string().trim().min(4).max(16).optional(),
  phoneNumber: z.string().trim().regex(/^\+\d{6,15}$/).optional(),
  displayName: z.string().trim().max(120).optional(),
  error: z.string().trim().max(300).optional(),
}).strict();
const messageSchema = z.object({
  messageId: z.string().trim().min(1).max(200),
  chatId: z.string().trim().min(3).max(200).regex(/^[^@\s]+@(s\.whatsapp\.net|lid)$/),
  phoneNumber: z.string().trim().regex(/^\+\d{6,15}$/).optional(),
  fromMe: z.boolean(),
  timestamp: z.string().refine((value) => Number.isFinite(Date.parse(value)), "Fecha inválida."),
  pushName: z.string().trim().max(120).optional(),
  text: z.string().max(4_000),
  kind: z.enum(["text", "attachment", "unsupported"]),
  media: z.object({
    key: z.string().regex(/^[0-9a-f]{64}$/),
    mimeType: z.string().min(3).max(120),
    kind: z.enum(["image", "video", "audio", "sticker", "document"]),
    size: z.number().int().min(1).max(WHATSAPP_MEDIA_MAX_BYTES),
    fileName: z.string().max(120).optional(),
  }).strict().optional(),
  quotedText: z.string().max(300).optional(),
}).strict();
const updatesBody = z.object({
  updates: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("receipt"), messageId: z.string().trim().min(1).max(200), status: z.enum(["delivered", "read", "played"]), at: z.string() }).strict(),
    z.object({ type: z.literal("reaction"), messageId: z.string().trim().min(1).max(200), emoji: z.string().max(16), fromMe: z.boolean(), at: z.string() }).strict(),
    z.object({ type: z.literal("edit"), messageId: z.string().trim().min(1).max(200), text: z.string().min(1).max(4_000), at: z.string() }).strict(),
    z.object({ type: z.literal("delete"), messageId: z.string().trim().min(1).max(200), at: z.string() }).strict(),
  ])).min(1).max(500),
}).strict();
const mediaParams = z.object({ key: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const lineMediaParams = z.object({ id: z.string().uuid() }).strict();
const uploadQuery = z.object({ interactionId: z.string().trim().min(1).max(120) }).strict();
const messagesBody = z.object({
  messages: z.array(messageSchema).min(1).max(200),
  /** Lote de historial antiguo: al vincular (`link`) o por "Cargar anteriores" (`on_demand`). */
  history: z.enum(["link", "on_demand"]).optional(),
}).strict();
const claimBody = z.object({
  lineIds: z.array(z.string().uuid()).min(1).max(50),
}).strict();
const deliveryParams = z.object({ id: z.string().uuid() }).strict();
const resultBody = z.object({
  status: z.enum(["sent", "failed", "uncertain"]),
  messageId: z.string().trim().min(1).max(200).optional(),
  errorCode: z.string().trim().regex(/^[A-Z0-9_]{3,80}$/).optional(),
}).strict();

function tokenEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function asApiError(error: unknown): never {
  if (error instanceof WhatsAppLineError) throw new ApiError(error.statusCode, error.code, error.message);
  throw error;
}

/** Nombres de ejemplo para "Simular mensaje" en demo: ficticios, sin números reales. */
const DEMO_CONTACTS = ["Camila Demo", "Tomás Demo", "Valentina Demo", "Ignacio Demo"];
const DEMO_TEXTS = [
  "Hola, ¿tienen despacho a regiones?",
  "Buenas tardes, mi pedido aún no llega. ¿Me ayudan?",
  "¿Cuál es el horario de atención de la tienda?",
  "Quiero cambiar la talla de un producto que compré ayer.",
];

export function registerWhatsAppRoutes(app: FastifyInstance, deps: WhatsAppRouteDeps): void {
  const { config, repository, lines } = deps;
  // Archivos de WhatsApp: llegan crudos (sin multipart), hasta 16 MB.
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: WHATSAPP_MEDIA_MAX_BYTES },
    async (_request: FastifyRequest, body: Buffer) => body,
  );

  /** Guarda un archivo de WhatsApp (por sha256) para una marca; valida tipo y tamaño. */
  const storeMedia = async (input: { data: unknown; mime: string | undefined; fileName: string | undefined; sticker: boolean; brandId: string }): Promise<WhatsAppMediaRef> => {
    if (!Buffer.isBuffer(input.data) || !input.data.length) {
      throw new ApiError(400, "MEDIA_REQUIRED", "Falta el archivo (envíalo como application/octet-stream).");
    }
    if (input.data.length > WHATSAPP_MEDIA_MAX_BYTES) throw new ApiError(413, "MEDIA_TOO_LARGE", "El archivo supera los 16 MB.");
    const mimeType = baseMime(input.mime);
    const kind = mediaKindFor(mimeType, input.sticker);
    if (!kind) throw new ApiError(415, "MEDIA_TYPE_NOT_ALLOWED", "Ese tipo de archivo no se acepta por WhatsApp en wiwo.sac.");
    const key = mediaKey(input.data);
    const fileName = safeFileName(input.fileName);
    await repository.saveWhatsAppMedia({
      key,
      brandId: input.brandId,
      mimeType,
      kind,
      size: input.data.length,
      ...(fileName ? { fileName } : {}),
      data: input.data,
      createdAt: new Date().toISOString(),
    });
    return { key, mimeType, kind, size: input.data.length, ...(fileName ? { fileName } : {}) };
  };
  const headerText = (request: FastifyRequest, name: string): string | undefined => {
    const value = request.headers[name];
    if (typeof value !== "string" || !value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  };

  /** Interacción de WhatsApp por id del mensaje en WhatsApp (para tics, reacciones y borrados). */
  const findByMessageId = async (accountId: string, lineId: string, messageIds: string[]): Promise<Map<string, Interaction>> => {
    const wanted = new Set(messageIds.map((messageId) => whatsappExternalId(lineId, messageId)));
    const found = new Map<string, Interaction>();
    for (const interaction of await repository.listInteractions({ accountId, channel: "whatsapp" })) {
      if (wanted.has(interaction.externalId)) found.set(interaction.metricoolRef?.whatsapp?.messageId ?? "", interaction);
    }
    return found;
  };
  const meta = () => ({ demoMode: config.demoMode, mode: config.mode, whatsappMode: whatsappMode(config) });

  const requireLineAdmin = (request: FastifyRequest): ActorContext => {
    const actor = deps.requireActor(request);
    if (!deps.isMasterAdmin(actor)) {
      throw new ApiError(403, "MASTER_ADMIN_REQUIRED", "Solo un admin principal (SAC_FLOW_AUTH_ADMIN_EMAILS) puede vincular o desvincular números de WhatsApp.");
    }
    return actor;
  };

  const activeBrand = async (brandId: string): Promise<Brand> => {
    const brand = (await repository.snapshotCatalog()).brands.find((item) => item.id === brandId);
    if (!brand || !brand.active || !brand.account.active) {
      throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe o está oculta.");
    }
    return brand;
  };

  const adminPayload = async () => {
    const brands = (await repository.snapshotCatalog()).brands;
    const names = new Map(brands.map((brand) => [brand.id, brand.name]));
    return {
      lines: (await lines.listForAdmin()).map((line) => ({ ...line, brandName: names.get(line.brandId) ?? line.brandId })),
      worker: {
        mode: whatsappMode(config),
        online: config.demoMode ? true : lines.workerOnline(),
        lastSeenAt: lines.workerLastSeenAt(),
      },
    };
  };

  // ── Números (admins principales) ───────────────────────────────────────────────────────

  app.get("/api/whatsapp/lines", async (request) => {
    requireLineAdmin(request);
    return { data: await adminPayload(), meta: meta() };
  });

  app.post("/api/whatsapp/lines", async (request, reply) => {
    const actor = requireLineAdmin(request);
    if (whatsappMode(config) === "disabled") {
      throw new ApiError(503, "WHATSAPP_DISABLED", "WhatsApp no está habilitado en este servidor: falta SAC_FLOW_WHATSAPP_WORKER_KEY.");
    }
    const body = createLineBody.parse(request.body);
    await activeBrand(body.brandId);
    const created = await lines.create(body, actor.email ?? actor.userId).catch(asApiError);
    request.log.info({ event: "whatsapp_line_created", lineId: created.id, brandId: created.brandId }, "Número de WhatsApp creado.");
    reply.code(201);
    return { data: await adminPayload(), meta: { ...meta(), lineId: created.id } };
  });

  app.post("/api/whatsapp/lines/:id/link", async (request) => {
    requireLineAdmin(request);
    if (whatsappMode(config) === "disabled") {
      throw new ApiError(503, "WHATSAPP_DISABLED", "WhatsApp no está habilitado en este servidor.");
    }
    const { id } = lineParams.parse(request.params);
    const body = linkBody.parse(request.body ?? {});
    await lines.requestLink(id, body.method, body.phoneNumber, body.importHistory).catch(asApiError);
    request.log.info({ event: "whatsapp_link_requested", lineId: id, method: body.method }, "Vinculación de WhatsApp pedida.");
    return { data: await adminPayload(), meta: meta() };
  });

  app.post("/api/whatsapp/lines/:id/unlink", async (request) => {
    requireLineAdmin(request);
    const { id } = lineParams.parse(request.params);
    await lines.requestUnlink(id).catch(asApiError);
    request.log.info({ event: "whatsapp_unlink_requested", lineId: id }, "Desvinculación de WhatsApp pedida.");
    return { data: await adminPayload(), meta: meta() };
  });

  app.delete("/api/whatsapp/lines/:id", async (request) => {
    requireLineAdmin(request);
    const { id } = lineParams.parse(request.params);
    await lines.remove(id).catch(asApiError);
    request.log.info({ event: "whatsapp_line_removed", lineId: id }, "Número de WhatsApp quitado.");
    return { data: await adminPayload(), meta: meta() };
  });

  /** Solo demo: deja un mensaje ficticio en la bandeja por el mismo camino que uno real. */
  app.post("/api/whatsapp/lines/:id/demo-message", async (request) => {
    requireLineAdmin(request);
    if (!config.demoMode) throw new ApiError(404, "NOT_FOUND", "Ruta no encontrada.");
    const { id } = lineParams.parse(request.params);
    const body = demoMessageBody.parse(request.body ?? {});
    const line = await lines.find(id);
    if (!line) throw new ApiError(404, "WHATSAPP_LINE_NOT_FOUND", "El número de WhatsApp no existe.");
    if (line.status !== "connected") throw new ApiError(409, "WHATSAPP_NOT_CONNECTED", "Vincula el número antes de simular mensajes.");
    const brand = await activeBrand(line.brandId);
    const pick = Math.floor(Math.random() * DEMO_CONTACTS.length);
    const message: NormalizedWhatsAppMessage = {
      messageId: `DEMO${Date.now().toString(36).toUpperCase()}${pick}`,
      chatId: `demo${pick + 1}@lid`,
      fromMe: false,
      timestamp: new Date().toISOString(),
      pushName: DEMO_CONTACTS[pick],
      text: body.text ?? DEMO_TEXTS[pick]!,
      kind: "text",
    };
    const result = await deps.ingest(line, brand, [message]);
    return { data: result, meta: meta() };
  });

  /**
   * "Cargar anteriores" en un chat de WhatsApp: le pide al teléfono los mensajes previos al más
   * antiguo que ya tiene wiwo.sac. Llegan en segundos como historial (no como casos), si WhatsApp
   * los entrega; el teléfono debe estar conectado a internet.
   */
  app.post("/api/whatsapp/history", async (request) => {
    const actor = deps.requireActor(request);
    const body = historyBody.parse(request.body);
    const interaction = await repository.findInteraction(body.interactionId);
    if (!interaction) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    if (actor.brandIds !== "all" && !actor.brandIds.includes(interaction.brandId)) {
      throw new ApiError(403, "FORBIDDEN", "El usuario no tiene acceso a esta marca.");
    }
    const reference = interaction.metricoolRef?.whatsapp;
    if (interaction.channel !== "whatsapp" || !reference) {
      throw new ApiError(422, "NOT_WHATSAPP", "Solo los chats de WhatsApp tienen historial en el teléfono.");
    }
    if (config.demoMode) {
      return { data: { requested: false, reason: "demo" }, meta: meta() };
    }
    if (whatsappMode(config) !== "live") throw new ApiError(503, "WHATSAPP_DISABLED", "WhatsApp no está habilitado en este servidor.");
    const line = await lines.find(reference.lineId);
    if (!line || line.desiredState !== "linked" || line.status !== "connected") {
      throw new ApiError(409, "WHATSAPP_NOT_CONNECTED", "El número de WhatsApp de este chat no está conectado.");
    }
    const chat = (await repository.listInteractions({ accountId: interaction.accountId, channel: "whatsapp" }))
      .filter((item) => item.metricoolRef?.whatsapp?.lineId === reference.lineId && item.metricoolRef.whatsapp.chatId === reference.chatId);
    const oldest = chat.reduce((current, item) => (Date.parse(item.createdAt) < Date.parse(current.createdAt) ? item : current), interaction);
    const requested = lines.requestHistory({
      lineId: reference.lineId,
      chatId: reference.chatId,
      anchor: {
        messageId: oldest.metricoolRef!.whatsapp!.messageId,
        fromMe: oldest.direction === "outbound",
        timestamp: oldest.createdAt,
      },
      count: HISTORY_PAGE_SIZE,
    });
    if (!requested) {
      throw new ApiError(429, "HISTORY_RECENTLY_REQUESTED", "Ya se pidió el historial de este chat hace unos segundos.");
    }
    request.log.info({ event: "whatsapp_history_requested", lineId: reference.lineId }, "Historial de WhatsApp pedido al teléfono.");
    return { data: { requested: true, before: oldest.createdAt }, meta: meta() };
  });

  /** El chat de WhatsApp de una interacción que la persona puede ver, o un error claro. */
  const chatOf = async (actor: ActorContext, interactionId: string) => {
    const interaction = await repository.findInteraction(interactionId);
    if (!interaction) throw new ApiError(404, "INTERACTION_NOT_FOUND", "La interacción no existe.");
    if (actor.brandIds !== "all" && !actor.brandIds.includes(interaction.brandId)) {
      throw new ApiError(403, "FORBIDDEN", "El usuario no tiene acceso a esta marca.");
    }
    const reference = interaction.metricoolRef?.whatsapp;
    if (interaction.channel !== "whatsapp" || !reference) {
      throw new ApiError(422, "NOT_WHATSAPP", "Esta acción es solo para chats de WhatsApp.");
    }
    return { interaction, reference, lineId: reference.lineId, chatId: reference.chatId };
  };

  /** El número del chat está vinculado y conectado (solo en vivo; en demo no hay teléfono). */
  const lineConnected = async (lineId: string) => {
    if (whatsappMode(config) !== "live") return false;
    const line = await lines.find(lineId);
    return Boolean(line && line.desiredState === "linked" && line.status === "connected");
  };

  /**
   * Alguien abrió el chat: lo del cliente queda leído en wiwo.sac (deja de contar como no leído)
   * y, si la persona puede responder, también en WhatsApp (el cliente ve los tics azules). Así
   * nada se marca leído en el teléfono sin que una persona lo haya abierto de verdad.
   */
  app.post("/api/whatsapp/read", async (request) => {
    const actor = deps.requireActor(request);
    const { interactionId } = historyBody.parse(request.body);
    const { interaction, reference, lineId, chatId } = await chatOf(actor, interactionId);
    const chat = (await repository.listInteractions({ accountId: interaction.accountId, channel: "whatsapp" }))
      .filter((item) => item.metricoolRef?.whatsapp?.lineId === lineId && item.metricoolRef.whatsapp.chatId === chatId);
    const unread = chat.filter((item) => item.direction === "inbound"
      && !item.metricoolRef?.whatsapp?.history && !item.metricoolRef?.whatsapp?.readAt);
    const at = new Date().toISOString();
    for (const item of unread) {
      await repository.updateMessageDetail(item.id, (target) => {
        const reference = target.metricoolRef?.whatsapp;
        if (!reference || reference.readAt) return false;
        reference.readAt = at;
        return true;
      });
    }
    const canReply = actorCan(actor, "inbox.reply") && actor.whatsappEnabled !== false;
    let remote = false;
    if (reference.provider === "wiwo_talk") {
      // WiWO Talk: la conversación queda leída también allá (sin tics hacia el cliente desde aquí).
      const conversationId = reference.talkConversationId;
      if (canReply && unread.length && conversationId && deps.wiwoTalk) remote = await deps.wiwoTalk.markRead(lineId, conversationId);
    } else if (canReply && await lineConnected(lineId)) {
      lines.requestRead(lineId, chatId, unread.map((item) => item.metricoolRef!.whatsapp!.messageId));
      lines.requestWatch(lineId, chatId);
      remote = unread.length > 0;
    }
    return { data: { read: unread.length, remote }, meta: meta() };
  });

  /** Si el cliente está escribiendo o grabando un audio en este chat ahora mismo. */
  app.get("/api/whatsapp/presence", async (request) => {
    const actor = deps.requireActor(request);
    const { interactionId } = presenceQuery.parse(request.query);
    const { lineId, chatId } = await chatOf(actor, interactionId);
    if (await lineConnected(lineId)) lines.requestWatch(lineId, chatId);
    return { data: { state: lines.presenceOf(lineId, chatId) }, meta: meta() };
  });

  /**
   * "Escribiendo…" hacia el cliente mientras alguien del equipo redacta en wiwo.sac. Nunca
   * pone el número "en línea"; el servidor limita las señales a una cada pocos segundos.
   */
  app.post("/api/whatsapp/typing", async (request) => {
    const actor = deps.requirePermission(request, "inbox.reply");
    if (actor.whatsappEnabled === false) {
      throw new ApiError(403, "WHATSAPP_DISABLED_FOR_USER", "Un admin principal te desactivó WhatsApp.");
    }
    const body = typingBody.parse(request.body);
    const { lineId, chatId } = await chatOf(actor, body.interactionId);
    const queued = await lineConnected(lineId) ? lines.requestTyping(lineId, chatId, body.state) : false;
    return { data: { queued }, meta: meta() };
  });

  /**
   * Un archivo de WhatsApp (foto, video, audio, sticker o documento). Solo para quien ve la marca;
   * los documentos se descargan (nunca se muestran en la página) y nada se interpreta como otro tipo.
   */
  app.get("/api/media/whatsapp/:key", async (request, reply) => {
    const actor = deps.requireActor(request);
    const { key } = mediaParams.parse(request.params);
    const media = await repository.getWhatsAppMedia(key);
    if (!media || (actor.brandIds !== "all" && !actor.brandIds.includes(media.brandId))) {
      throw new ApiError(404, "MEDIA_NOT_FOUND", "El archivo no existe.");
    }
    const inline = media.kind !== "document";
    const name = (media.fileName ?? `whatsapp-${key.slice(0, 12)}`).replace(/[^\w.\- ]/g, "_");
    return reply
      .header("Content-Type", media.mimeType)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${name}"`)
      .header("Cache-Control", "private, max-age=86400")
      .send(media.data);
  });

  /**
   * Adjunto para responder por WhatsApp: la persona lo sube antes de enviar (crudo, con
   * `X-Media-Type` y `X-File-Name`) y la respuesta lo referencia por su clave.
   */
  app.post("/api/whatsapp/media", { bodyLimit: WHATSAPP_MEDIA_MAX_BYTES }, async (request) => {
    const actor = deps.requirePermission(request, "inbox.reply");
    if (actor.whatsappEnabled === false) {
      throw new ApiError(403, "WHATSAPP_DISABLED_FOR_USER", "Un admin principal te desactivó WhatsApp.");
    }
    const { interactionId } = uploadQuery.parse(request.query);
    const interaction = await repository.findInteraction(interactionId);
    if (!interaction || interaction.channel !== "whatsapp") throw new ApiError(404, "INTERACTION_NOT_FOUND", "La conversación de WhatsApp no existe.");
    if (actor.brandIds !== "all" && !actor.brandIds.includes(interaction.brandId)) {
      throw new ApiError(403, "FORBIDDEN", "El usuario no tiene acceso a esta marca.");
    }
    const media = await storeMedia({
      data: request.body,
      mime: headerText(request, "x-media-type"),
      fileName: headerText(request, "x-file-name"),
      sticker: false,
      brandId: interaction.brandId,
    });
    return { data: media, meta: meta() };
  });

  // ── Estado para la bandeja (cualquier rol con sesión) ───────────────────────────────────

  app.get("/api/whatsapp/status", async (request) => {
    const actor = deps.requireActor(request);
    const visible = (brandId: string) => actor.brandIds === "all" || actor.brandIds.includes(brandId);
    return {
      data: {
        mode: whatsappMode(config),
        lines: await lines.listPublic(visible),
        // Conexiones de WiWO Talk de las marcas visibles (sin claves ni ids de la subcuenta).
        talk: deps.wiwoTalk
          ? (await deps.wiwoTalk.list())
            .filter((connection) => visible(connection.brandId))
            .map((connection) => ({ id: connection.id, brandId: connection.brandId, label: connection.label, status: connection.status }))
          : [],
      },
      meta: meta(),
    };
  });

  // ── Worker (clave interna) ──────────────────────────────────────────────────────────────

  app.addHook("onRequest", async (request, reply) => {
    if (!isWhatsAppWorkerPath(request.url)) return;
    const expected = config.whatsapp.workerKey;
    if (whatsappMode(config) !== "live" || !expected) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Ruta no encontrada." }, meta: meta() });
    }
    const received = request.headers[WHATSAPP_WORKER_KEY_HEADER];
    if (typeof received !== "string" || !tokenEqual(received, expected)) {
      return reply.code(401).send({ error: { code: "WORKER_KEY_REQUIRED", message: "Clave del worker de WhatsApp inválida o ausente." }, meta: meta() });
    }
  });

  app.get(`${WHATSAPP_WORKER_PREFIX}lines`, async () => ({ data: await lines.workerLines(), meta: meta() }));

  /** El worker sube cada archivo que recibe, antes de entregar el mensaje que lo trae. */
  app.put(`${WHATSAPP_WORKER_PREFIX}lines/:id/media`, { bodyLimit: WHATSAPP_MEDIA_MAX_BYTES }, async (request) => {
    const { id } = lineMediaParams.parse(request.params);
    const line = await lines.find(id);
    if (!line) throw new ApiError(404, "WHATSAPP_LINE_NOT_FOUND", "El número de WhatsApp no existe.");
    const media = await storeMedia({
      data: request.body,
      mime: headerText(request, "x-media-type"),
      fileName: headerText(request, "x-file-name"),
      sticker: request.headers["x-media-sticker"] === "1",
      brandId: line.brandId,
    });
    return { data: media, meta: meta() };
  });

  /** El worker baja el adjunto que debe enviar. */
  app.get(`${WHATSAPP_WORKER_PREFIX}media/:key`, async (request, reply) => {
    const { key } = mediaParams.parse(request.params);
    const media = isMediaKey(key) ? await repository.getWhatsAppMedia(key) : undefined;
    if (!media) throw new ApiError(404, "MEDIA_NOT_FOUND", "El archivo no existe.");
    return reply.header("Content-Type", "application/octet-stream").send(media.data);
  });

  /** Tics, reacciones, ediciones y borrados sobre mensajes ya guardados. */
  app.post(`${WHATSAPP_WORKER_PREFIX}lines/:id/updates`, async (request) => {
    const { id } = lineParams.parse(request.params);
    const body = updatesBody.parse(request.body);
    const line = await lines.find(id);
    if (!line) throw new ApiError(404, "WHATSAPP_LINE_NOT_FOUND", "El número de WhatsApp no existe.");
    const brand = (await repository.snapshotCatalog()).brands.find((item) => item.id === line.brandId);
    if (!brand) return { data: { applied: 0, unknown: body.updates.length }, meta: meta() };
    const targets = await findByMessageId(brand.account.id, line.id, body.updates.map((update) => update.messageId));
    let applied = 0;
    for (const update of body.updates as WhatsAppMessageUpdate[]) {
      const target = targets.get(update.messageId);
      if (!target) continue;
      if (await repository.updateMessageDetail(target.id, (interaction) => applyWhatsAppUpdate(interaction, update))) applied += 1;
    }
    return { data: { applied, unknown: body.updates.length - [...body.updates].filter((update) => targets.has(update.messageId)).length }, meta: meta() };
  });

  /** Órdenes rápidas de chats abiertos (leído, presencia, escribiendo); se entregan una vez. */
  app.get(`${WHATSAPP_WORKER_PREFIX}chat-commands`, async () => ({ data: lines.takeChatCommands(), meta: meta() }));

  /** El cliente está escribiendo, grabando o dejó de hacerlo (solo en memoria, sin texto). */
  app.post(`${WHATSAPP_WORKER_PREFIX}lines/:id/presence`, async (request) => {
    const { id } = lineParams.parse(request.params);
    const body = workerPresenceBody.parse(request.body);
    lines.reportPresence(id, body.chatId, body.state);
    return { data: { ok: true }, meta: meta() };
  });

  /** Pedidos de "Cargar anteriores" pendientes; cada uno se entrega una sola vez. */
  app.get(`${WHATSAPP_WORKER_PREFIX}history-requests`, async () => ({ data: lines.takeHistoryRequests(), meta: meta() }));

  app.post(`${WHATSAPP_WORKER_PREFIX}lines/:id/state`, async (request) => {
    const { id } = lineParams.parse(request.params);
    const body = stateBody.parse(request.body);
    const result = await lines.reportState(id, body).catch(asApiError);
    if (result.accepted && (body.status === "connected" || body.status === "logged_out" || body.status === "error")) {
      request.log.info({ event: "whatsapp_line_state", lineId: id, status: body.status }, "Estado de WhatsApp informado por el worker.");
    }
    return { data: result, meta: meta() };
  });

  app.post(`${WHATSAPP_WORKER_PREFIX}lines/:id/messages`, async (request) => {
    const { id } = lineParams.parse(request.params);
    const body = messagesBody.parse(request.body);
    const line = await lines.find(id);
    if (!line) throw new ApiError(404, "WHATSAPP_LINE_NOT_FOUND", "El número de WhatsApp no existe.");
    if (line.desiredState !== "linked") return { data: { created: 0, duplicates: 0, ignored: body.messages.length }, meta: meta() };
    const brand = (await repository.snapshotCatalog()).brands.find((item) => item.id === line.brandId);
    // Cliente oculto: no se sincroniza, igual que con Metricool.
    if (!brand || !brand.active || !brand.account.active) {
      return { data: { created: 0, duplicates: 0, ignored: body.messages.length }, meta: meta() };
    }
    // Lo que wiwo.sac envió vuelve como mensaje propio: ya está registrado como respuesta del caso.
    let messages = body.messages as NormalizedWhatsAppMessage[];
    if (messages.some((message) => message.fromMe)) {
      const sent = await repository.listReplyDeliveries({ accountId: brand.account.id, status: "sent", limit: 500 });
      const sentRefs = new Set(sent.map((delivery) => delivery.providerResponseRef).filter(Boolean));
      messages = messages.filter((message) => !message.fromMe || !sentRefs.has(`whatsapp:${message.messageId}`));
    }
    const result = messages.length ? await deps.ingest(line, brand, messages, body.history) : { created: 0, duplicates: 0 };
    return { data: { ...result, ignored: body.messages.length - messages.length }, meta: meta() };
  });

  /**
   * Entrega la próxima respuesta en cola de los números que el worker tiene listos (conectados y
   * con la pausa cumplida). La reserva con lease: si el worker se cae a mitad del envío, la
   * entrega queda incierta y exige conciliación, nunca un reenvío a ciegas.
   */
  let lastRecoveryAt = 0;
  app.post(`${WHATSAPP_WORKER_PREFIX}deliveries/claim`, async (request) => {
    const body = claimBody.parse(request.body);
    // Entregas cuyo lease venció pasan a inciertas. Una vez por minuto basta: en JSON cada
    // recuperación reescribe el archivo.
    if (Date.now() - lastRecoveryAt > 60_000) {
      lastRecoveryAt = Date.now();
      await repository.recoverStaleReplyDeliveries();
    }
    const connected = new Set((await lines.listLines())
      .filter((line) => line.desiredState === "linked" && line.status === "connected")
      .map((line) => line.id));
    const ready = new Set(body.lineIds.filter((id) => connected.has(id)));
    const pending = await repository.listReplyDeliveries({ status: "pending", oldestFirst: true, limit: 200 });
    const now = Date.now();
    for (const delivery of pending) {
      // El envío automático no existe para WhatsApp: solo salen respuestas aprobadas por una persona.
      if (!delivery.approvedByHuman) continue;
      if (delivery.nextAttemptAt && Date.parse(delivery.nextAttemptAt) > now) continue;
      const interaction = await repository.findInteraction(delivery.interactionId);
      const ref = interaction?.metricoolRef?.whatsapp;
      if (!interaction || interaction.channel !== "whatsapp" || !ref) continue;
      // Una respuesta que lleva 24 h en cola (número desconectado) ya no sale: falla con su motivo,
      // y quien la escribió decide si volver a enviarla. Nunca le llega al cliente un día tarde.
      if (now - Date.parse(delivery.createdAt) > WHATSAPP_QUEUE_MAX_AGE_MS) {
        const expired = await repository.claimReplyDelivery(delivery.id, WHATSAPP_DELIVERY_LEASE_MS);
        if (expired) {
          await repository.settleReplyDelivery(expired.id, { status: "failed", errorCode: "WHATSAPP_QUEUE_EXPIRED", at: new Date().toISOString() });
          request.log.info({ event: "whatsapp_delivery_expired", deliveryId: expired.id }, "Respuesta de WhatsApp vencida en cola.");
        }
        continue;
      }
      if (!ready.has(ref.lineId)) continue;
      const claimed = await repository.claimReplyDelivery(delivery.id, WHATSAPP_DELIVERY_LEASE_MS);
      if (!claimed) continue;
      const options = await repository.getWhatsAppDeliveryOptions(claimed.id);
      return {
        data: {
          deliveryId: claimed.id,
          lineId: ref.lineId,
          chatId: ref.chatId,
          text: claimed.bodyText,
          replyToMessageId: ref.messageId,
          leaseExpiresAt: claimed.leaseExpiresAt,
          ...(options?.attachment ? { attachment: options.attachment } : {}),
          ...(options?.quote ? { quote: options.quote } : {}),
        },
        meta: meta(),
      };
    }
    return { data: null, meta: meta() };
  });

  app.post(`${WHATSAPP_WORKER_PREFIX}deliveries/:id/result`, async (request) => {
    const { id } = deliveryParams.parse(request.params);
    const body = resultBody.parse(request.body);
    const delivery = await repository.findReplyDelivery(id);
    if (!delivery) throw new ApiError(404, "DELIVERY_NOT_FOUND", "La entrega no existe.");
    if (delivery.status !== "sending") {
      throw new ApiError(409, "DELIVERY_NOT_IN_PROGRESS", "La entrega no está en envío.", { deliveryStatus: delivery.status });
    }
    if (body.status === "sent" && !body.messageId) {
      throw new ApiError(400, "MESSAGE_ID_REQUIRED", "Un envío confirmado debe traer el id del mensaje de WhatsApp.");
    }
    const settled = await repository.settleReplyDelivery(id, {
      status: body.status,
      ...(body.messageId ? { providerResponseRef: `whatsapp:${body.messageId}` } : {}),
      ...(body.status !== "sent" ? { errorCode: body.errorCode ?? "WHATSAPP_DELIVERY_UNKNOWN" } : {}),
      at: new Date().toISOString(),
    });
    // El mensaje enviado queda como saliente propio (con sus tics). Su eco tiene el mismo id
    // externo, así que no se duplica cuando WhatsApp lo devuelve.
    if (body.status === "sent" && body.messageId) {
      const inbound = await repository.findInteraction(delivery.interactionId);
      const ref = inbound?.metricoolRef?.whatsapp;
      if (inbound && ref) {
        const options = await repository.getWhatsAppDeliveryOptions(id);
        await repository.insertInteractions([buildSentWhatsAppInteraction({
          inbound,
          lineId: ref.lineId,
          chatId: ref.chatId,
          messageId: body.messageId,
          text: delivery.bodyText,
          sentBy: delivery.requestedBy.displayName,
          at: new Date().toISOString(),
          ...(options?.attachment ? { attachment: options.attachment } : {}),
          ...(options?.quote ? { quotedText: options.quote.text } : {}),
        })]);
      }
    }
    request.log.info({ event: "whatsapp_delivery_settled", deliveryId: id, status: body.status }, "Entrega de WhatsApp registrada.");
    return { data: { status: settled?.delivery.status ?? body.status }, meta: meta() };
  });
}
