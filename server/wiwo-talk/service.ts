/**
 * WiWO Talk en wiwo.sac: conexiones por subcuenta de HighLevel, lectura de sus chats de WhatsApp
 * y respuestas manuales. Cómo llegan los mensajes:
 *
 * - Webhook: un workflow de la subcuenta (disparador "Customer Replied") avisa a
 *   `/api/webhooks/wiwo-talk/:id?key=…`. El aviso solo dice "hay algo nuevo de este contacto": la
 *   API lee la conversación por la API de HighLevel, así no depende de cómo venga armado el aviso.
 * - Conciliación: cada pocos minutos se leen las conversaciones con actividad reciente, por si se
 *   perdió un aviso, y entran también las respuestas del bot y de las personas en WiWO Talk.
 *
 * Todo entra con el mismo camino que los demás WhatsApp (id externo estable, nunca duplica) y la
 * primera lectura de una conexión llega como historial, salvo el último mensaje reciente de cada
 * cliente, que queda como caso.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { CredentialVault } from "../credential-vault.js";
import type { SacFlowRepository } from "../repository-contract.js";
import type { Brand, Interaction, WiwoTalkConnection } from "../types.js";
import { buildWhatsAppInteraction, historyMessageIds } from "../whatsapp/ingest.js";
import {
  baseMime,
  mediaKey,
  mediaKindFor,
  WHATSAPP_MEDIA_MAX_BYTES,
  type WhatsAppMediaKind,
  type WhatsAppMediaRef,
} from "../whatsapp/media.js";
import type { NormalizedWhatsAppMessage } from "../whatsapp/messages.js";
import {
  isWhatsAppMessage,
  WiwoTalkClient,
  WiwoTalkError,
  type FetchLike,
  type WiwoTalkConversation,
  type WiwoTalkMessage,
} from "./client.js";

export const WIWO_TALK_WEBHOOK_PREFIX = "/api/webhooks/wiwo-talk/";
/** Conversaciones que lee cada conciliación y la primera lectura de una conexión. */
const RECONCILE_CONVERSATIONS = 25;
const INITIAL_CONVERSATIONS = 60;
const MESSAGES_PER_CONVERSATION = 50;
/** Varios avisos del mismo contacto seguidos se leen una sola vez. */
const WEBHOOK_DEBOUNCE_MS = 1_500;
const MEDIA_TIMEOUT_MS = 15_000;
/** Hosts desde donde HighLevel sirve los adjuntos. Nada más se descarga. */
const MEDIA_HOSTS = [
  "storage.googleapis.com",
  "firebasestorage.googleapis.com",
  ".leadconnectorhq.com",
  ".msgsndr.com",
  ".filesafe.space",
];

export class WiwoTalkServiceError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "WiwoTalkServiceError";
  }
}

interface Secrets {
  token: string;
  webhookSecret: string;
}

/** Lo que ve un admin principal. El token nunca sale de la API; el secreto del webhook sí, para configurarlo. */
export interface WiwoTalkConnectionView {
  id: string;
  brandId: string;
  label: string;
  locationId: string;
  locationName?: string;
  tokenHint: string;
  status: WiwoTalkConnection["status"];
  lastError?: string;
  lastErrorAt?: string;
  lastSyncAt?: string;
  lastWebhookAt?: string;
  webhookPath: string;
  webhookSecret: string;
}

/** Guarda los mensajes como interacciones (repositorio + protocolo SAC + respuestas del equipo). */
export type WiwoTalkIngest = (brand: Brand, interactions: Interaction[]) => Promise<{ created: number; duplicates: number }>;

export interface WiwoTalkServiceOptions {
  repository: SacFlowRepository;
  vault: CredentialVault;
  ingest: WiwoTalkIngest;
  demoMode: boolean;
  fetchImpl?: FetchLike;
  log?: (event: string, detail: Record<string, unknown>) => void;
  now?: () => number;
}

function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Ids que trae el aviso del workflow (acepta los nombres de HighLevel y los del workflow). */
export function webhookTarget(body: unknown): { contactId?: string; conversationId?: string } {
  if (!body || typeof body !== "object") return {};
  const record = body as Record<string, unknown>;
  const contact = record.contact && typeof record.contact === "object" ? record.contact as Record<string, unknown> : {};
  const contactId = asText(record.contactId) ?? asText(record.contact_id) ?? asText(contact.id);
  const conversationId = asText(record.conversationId) ?? asText(record.conversation_id);
  const valid = (value: string | undefined) => (value && /^[A-Za-z0-9_-]{6,64}$/.test(value) ? value : undefined);
  return {
    ...(valid(contactId) ? { contactId: valid(contactId) } : {}),
    ...(valid(conversationId) ? { conversationId: valid(conversationId) } : {}),
  };
}

function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return MEDIA_HOSTS.some((allowed) => (allowed.startsWith(".") ? host.endsWith(allowed) : host === allowed));
  } catch {
    return false;
  }
}

const KIND_LABEL: Record<WhatsAppMediaKind, string> = {
  image: "[Imagen]",
  video: "[Video]",
  audio: "[Audio]",
  sticker: "[Sticker]",
  document: "[Documento]",
};

function customerNameOf(conversation: WiwoTalkConversation | undefined): string {
  return conversation?.fullName ?? conversation?.contactName ?? conversation?.phone ?? "Contacto de WhatsApp";
}

export class WiwoTalkService {
  private readonly running = new Map<string, Promise<unknown>>();
  private readonly pendingWebhooks = new Map<string, NodeJS.Timeout>();
  private schedulerTimer?: NodeJS.Timeout;

  constructor(private readonly options: WiwoTalkServiceOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private log(event: string, detail: Record<string, unknown>): void {
    this.options.log?.(event, detail);
  }

  private secretsOf(connection: WiwoTalkConnection): Secrets {
    const data = this.options.vault.decrypt(connection.encryptedSecrets);
    const token = asText(data.token);
    const webhookSecret = asText(data.webhookSecret);
    if (!token || !webhookSecret) throw new WiwoTalkServiceError(500, "WIWO_TALK_SECRETS_INVALID", "Las claves guardadas de la conexión no se pueden leer.");
    return { token, webhookSecret };
  }

  private clientFor(connection: WiwoTalkConnection): WiwoTalkClient {
    return new WiwoTalkClient(this.secretsOf(connection).token, this.options.fetchImpl);
  }

  view(connection: WiwoTalkConnection): WiwoTalkConnectionView {
    return {
      id: connection.id,
      brandId: connection.brandId,
      label: connection.label,
      locationId: connection.locationId,
      ...(connection.locationName ? { locationName: connection.locationName } : {}),
      tokenHint: connection.tokenHint,
      status: connection.status,
      ...(connection.lastError ? { lastError: connection.lastError } : {}),
      ...(connection.lastErrorAt ? { lastErrorAt: connection.lastErrorAt } : {}),
      ...(connection.lastSyncAt ? { lastSyncAt: connection.lastSyncAt } : {}),
      ...(connection.lastWebhookAt ? { lastWebhookAt: connection.lastWebhookAt } : {}),
      webhookPath: `${WIWO_TALK_WEBHOOK_PREFIX}${connection.id}`,
      webhookSecret: this.secretsOf(connection).webhookSecret,
    };
  }

  async list(): Promise<WiwoTalkConnection[]> {
    return this.options.repository.listWiwoTalkConnections();
  }

  async find(id: string): Promise<WiwoTalkConnection | undefined> {
    return (await this.list()).find((connection) => connection.id === id);
  }

  private async require(id: string): Promise<WiwoTalkConnection> {
    const connection = await this.find(id);
    if (!connection) throw new WiwoTalkServiceError(404, "WIWO_TALK_CONNECTION_NOT_FOUND", "La conexión de WiWO Talk no existe.");
    return connection;
  }

  /** Comprueba token y subcuenta contra HighLevel (en demo no hay red: se acepta). */
  private async verify(token: string, locationId: string): Promise<{ name?: string }> {
    if (this.options.demoMode) return { name: "Subcuenta de prueba" };
    try {
      return await new WiwoTalkClient(token, this.options.fetchImpl).getLocation(locationId);
    } catch (error) {
      if (error instanceof WiwoTalkError) throw new WiwoTalkServiceError(error.status === 0 ? 502 : 422, error.code, error.message);
      throw error;
    }
  }

  private async save(connection: WiwoTalkConnection): Promise<WiwoTalkConnection> {
    try {
      return await this.options.repository.saveWiwoTalkConnection(connection);
    } catch (error) {
      if (error instanceof Error && error.message === "WIWO_TALK_LOCATION_TAKEN") {
        throw new WiwoTalkServiceError(409, "WIWO_TALK_LOCATION_TAKEN", "Esa subcuenta ya está conectada.");
      }
      throw error;
    }
  }

  async create(input: { brandId: string; label: string; locationId: string; token: string; createdBy: string }): Promise<WiwoTalkConnection> {
    const location = await this.verify(input.token, input.locationId);
    const at = new Date(this.now()).toISOString();
    const connection = await this.save({
      id: randomUUID(),
      brandId: input.brandId,
      label: input.label,
      locationId: input.locationId,
      ...(location.name ? { locationName: location.name } : {}),
      encryptedSecrets: this.options.vault.encrypt({
        token: input.token,
        webhookSecret: randomBytes(24).toString("base64url"),
      }),
      tokenHint: input.token.slice(-4),
      status: "active",
      createdBy: input.createdBy,
      createdAt: at,
      updatedAt: at,
    });
    this.log("wiwo_talk_connection_created", { connectionId: connection.id });
    // La primera lectura corre de fondo: trae los chats recientes como historial.
    if (!this.options.demoMode) void this.syncNow(connection.id).catch(() => undefined);
    return connection;
  }

  /** Cambia el token (rotación). El secreto del webhook se mantiene. */
  async replaceToken(id: string, token: string): Promise<WiwoTalkConnection> {
    const connection = await this.require(id);
    const location = await this.verify(token, connection.locationId);
    const secrets = this.secretsOf(connection);
    return this.save({
      ...connection,
      ...(location.name ? { locationName: location.name } : {}),
      encryptedSecrets: this.options.vault.encrypt({ token, webhookSecret: secrets.webhookSecret }),
      tokenHint: token.slice(-4),
      status: connection.status === "paused" ? "paused" : "active",
      lastError: undefined,
      lastErrorAt: undefined,
      updatedAt: new Date(this.now()).toISOString(),
    });
  }

  /** Nuevo secreto para el webhook (si se filtró la URL): hay que actualizar el workflow. */
  async rotateWebhookSecret(id: string): Promise<WiwoTalkConnection> {
    const connection = await this.require(id);
    const secrets = this.secretsOf(connection);
    return this.save({
      ...connection,
      encryptedSecrets: this.options.vault.encrypt({ token: secrets.token, webhookSecret: randomBytes(24).toString("base64url") }),
      updatedAt: new Date(this.now()).toISOString(),
    });
  }

  async setPaused(id: string, paused: boolean): Promise<WiwoTalkConnection> {
    const connection = await this.require(id);
    return this.save({ ...connection, status: paused ? "paused" : "active", updatedAt: new Date(this.now()).toISOString() });
  }

  /** Quita la conexión y sus claves. Los mensajes ya traídos se conservan como historial. */
  async remove(id: string): Promise<void> {
    await this.require(id);
    await this.options.repository.deleteWiwoTalkConnection(id);
    this.log("wiwo_talk_connection_removed", { connectionId: id });
  }

  /** Aviso del workflow. Devuelve false si la clave no corresponde (sin decir por qué). */
  async acceptWebhook(id: string, key: string | undefined, body: unknown): Promise<boolean> {
    const connection = await this.find(id);
    if (!connection || !key || !secretsEqual(key, this.secretsOf(connection).webhookSecret)) return false;
    if (connection.status === "paused") return true;
    const target = webhookTarget(body);
    await this.save({ ...connection, lastWebhookAt: new Date(this.now()).toISOString() }).catch(() => undefined);
    const debounceKey = `${id}\u0000${target.contactId ?? target.conversationId ?? "*"}`;
    clearTimeout(this.pendingWebhooks.get(debounceKey));
    this.pendingWebhooks.set(debounceKey, setTimeout(() => {
      this.pendingWebhooks.delete(debounceKey);
      const run = target.contactId || target.conversationId
        ? this.syncConversation(id, target)
        : this.syncNow(id);
      void run.catch(() => undefined);
    }, WEBHOOK_DEBOUNCE_MS));
    return true;
  }

  /** Una sola lectura a la vez por conexión: la siguiente espera a que termine la anterior. */
  private exclusive<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.running.get(id) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.running.set(id, next.catch(() => undefined));
    return next;
  }

  private async recordError(id: string, error: unknown): Promise<void> {
    const code = error instanceof WiwoTalkError || error instanceof WiwoTalkServiceError ? error.code : "WIWO_TALK_SYNC_FAILED";
    this.log("wiwo_talk_sync_failed", { connectionId: id, code });
    const connection = await this.find(id);
    if (!connection) return;
    const at = new Date(this.now()).toISOString();
    await this.save({
      ...connection,
      // Un token vencido o sin permisos deja la conexión en error; un corte pasajero, no.
      status: connection.status === "paused" ? "paused"
        : ["WIWO_TALK_TOKEN_INVALID", "WIWO_TALK_SCOPE_MISSING", "WIWO_TALK_NOT_FOUND"].includes(code) ? "error" : connection.status,
      lastError: code,
      lastErrorAt: at,
      updatedAt: at,
    }).catch(() => undefined);
  }

  /** Lee las conversaciones con actividad reciente (conciliación o primera lectura). */
  async syncNow(id: string): Promise<{ conversations: number; created: number }> {
    return this.exclusive(id, async () => {
      const connection = await this.require(id);
      if (this.options.demoMode) return { conversations: 0, created: 0 };
      try {
        const brand = await this.brandOf(connection);
        const initial = !connection.syncCursor;
        const client = this.clientFor(connection);
        const conversations = await client.searchConversations(connection.locationId, {
          limit: initial ? INITIAL_CONVERSATIONS : RECONCILE_CONVERSATIONS,
        });
        const cursorMs = connection.syncCursor ? Date.parse(connection.syncCursor) : 0;
        let newest = cursorMs;
        let created = 0;
        let read = 0;
        for (const conversation of conversations) {
          // Sin actividad desde la última conciliación: no hace falta leerla.
          if (conversation.lastMessageDate !== undefined && conversation.lastMessageDate <= cursorMs) continue;
          const result = await this.ingestConversation(client, connection, brand, conversation, initial);
          created += result.created;
          read += 1;
          newest = Math.max(newest, conversation.lastMessageDate ?? result.newestMs);
        }
        const fresh = await this.require(id);
        const at = new Date(this.now()).toISOString();
        await this.save({
          ...fresh,
          status: fresh.status === "paused" ? "paused" : "active",
          lastError: undefined,
          lastErrorAt: undefined,
          lastSyncAt: at,
          // La primera lectura deja el cursor aunque no hubiera mensajes: lo siguiente ya es en vivo.
          syncCursor: new Date(Math.max(newest, initial ? this.now() - 60_000 : cursorMs)).toISOString(),
          updatedAt: at,
        });
        this.log("wiwo_talk_synced", { connectionId: id, conversations: read, created });
        return { conversations: read, created };
      } catch (error) {
        await this.recordError(id, error);
        throw error;
      }
    });
  }

  /** Lee la conversación de un contacto (aviso del webhook). */
  async syncConversation(id: string, target: { contactId?: string; conversationId?: string }): Promise<number> {
    return this.exclusive(id, async () => {
      const connection = await this.require(id);
      if (this.options.demoMode || connection.status === "paused") return 0;
      try {
        const brand = await this.brandOf(connection);
        const client = this.clientFor(connection);
        const conversations = await client.searchConversations(connection.locationId, {
          ...(target.contactId ? { contactId: target.contactId } : {}),
          limit: target.contactId ? 5 : RECONCILE_CONVERSATIONS,
        });
        const matching = conversations.filter((conversation) =>
          (!target.conversationId || conversation.id === target.conversationId)
          && (!target.contactId || conversation.contactId === target.contactId));
        let created = 0;
        for (const conversation of matching.slice(0, 3)) {
          created += (await this.ingestConversation(client, connection, brand, conversation, !connection.syncCursor)).created;
        }
        return created;
      } catch (error) {
        await this.recordError(id, error);
        throw error;
      }
    });
  }

  private async brandOf(connection: WiwoTalkConnection): Promise<Brand> {
    const brand = (await this.options.repository.snapshotCatalog()).brands.find((item) => item.id === connection.brandId);
    if (!brand) throw new WiwoTalkServiceError(409, "WIWO_TALK_BRAND_MISSING", "La marca de la conexión ya no existe.");
    return brand;
  }

  private async ingestConversation(
    client: WiwoTalkClient,
    connection: WiwoTalkConnection,
    brand: Brand,
    conversation: WiwoTalkConversation,
    initial: boolean,
  ): Promise<{ created: number; newestMs: number }> {
    // Cliente oculto: no se sincroniza, igual que con Metricool.
    if (!brand.active || !brand.account.active) return { created: 0, newestMs: 0 };
    const page = await client.listMessages(conversation.id, { limit: MESSAGES_PER_CONVERSATION });
    const messages = page.messages.filter(isWhatsAppMessage);
    if (!messages.length) return { created: 0, newestMs: 0 };
    const normalized = await Promise.all(messages.map((message) => this.normalize(message, conversation, brand)));
    const historyIds = initial ? historyMessageIds(normalized, "link", this.now()) : new Set<string>();
    const name = customerNameOf(conversation);
    const handle = conversation.phone ?? name;
    const interactions = normalized.map((message, index) => {
      const source = messages[index]!;
      const interaction = buildWhatsAppInteraction(message, { id: connection.id, label: connection.label }, brand, {
        history: historyIds.has(message.messageId),
      });
      interaction.customerName = name;
      interaction.customerHandle = handle;
      const reference = interaction.metricoolRef!.whatsapp!;
      reference.provider = "wiwo_talk";
      reference.talkConversationId = conversation.id;
      if (source.direction === "outbound") {
        reference.sentBy = source.userId ? "Equipo en WiWO Talk" : "Bot o automatización de WiWO Talk";
        if (source.status === "delivered" || source.status === "read") reference.status = source.status;
      }
      interaction.audit = interaction.audit.map((entry) => ({
        ...entry,
        detail: reference.history
          ? `Mensaje anterior traído de WiWO Talk («${connection.label}»): historial, no cuenta como caso.`
          : source.direction === "outbound"
            ? `Mensaje enviado desde WiWO Talk («${connection.label}»).`
            : `Mensaje recibido por WhatsApp en WiWO Talk («${connection.label}»).`,
      }));
      return interaction;
    });
    const result = await this.options.ingest(brand, interactions);
    const newestMs = Math.max(...messages.map((message) => Date.parse(message.dateAdded)));
    return { created: result.created, newestMs };
  }

  private async normalize(message: WiwoTalkMessage, conversation: WiwoTalkConversation, brand: Brand): Promise<NormalizedWhatsAppMessage> {
    const media = message.attachments?.length ? await this.copyMedia(message.attachments[0]!, brand.id) : undefined;
    const body = message.body?.trim() ?? "";
    const label = media ? KIND_LABEL[media.kind] : message.attachments?.length ? "[Archivo adjunto]" : "";
    const text = body ? (label ? `${label} ${body}` : body) : label || "[Mensaje sin texto]";
    const phone = conversation.phone && /^\+\d{6,15}$/.test(conversation.phone) ? conversation.phone : undefined;
    return {
      messageId: message.id,
      chatId: conversation.contactId,
      ...(phone ? { phoneNumber: phone } : {}),
      fromMe: message.direction === "outbound",
      timestamp: message.dateAdded,
      pushName: customerNameOf(conversation),
      text,
      kind: media || message.attachments?.length ? "attachment" : "text",
      ...(media ? { media } : {}),
    };
  }

  /** Copia un adjunto de HighLevel a la API (hosts permitidos, 16 MB, tipos de WhatsApp). */
  private async copyMedia(url: string, brandId: string): Promise<WhatsAppMediaRef | undefined> {
    if (!isAllowedMediaUrl(url)) return undefined;
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        redirect: "error",
        signal: AbortSignal.timeout(MEDIA_TIMEOUT_MS),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > WHATSAPP_MEDIA_MAX_BYTES) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const mimeType = baseMime(response.headers.get("content-type") ?? undefined);
      const kind = mediaKindFor(mimeType);
      if (!kind) {
        await response.body?.cancel().catch(() => undefined);
        return undefined;
      }
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.length || data.length > WHATSAPP_MEDIA_MAX_BYTES) return undefined;
      const key = mediaKey(data);
      await this.options.repository.saveWhatsAppMedia({
        key,
        brandId,
        mimeType,
        kind,
        size: data.length,
        data,
        createdAt: new Date(this.now()).toISOString(),
      });
      return { key, mimeType, kind, size: data.length };
    } catch {
      return undefined;
    }
  }

  /** Envía la respuesta aprobada por una persona. Lanza WiwoTalkError si HighLevel la rechaza. */
  async sendReply(connectionId: string, contactId: string, text: string): Promise<{ messageId: string; conversationId?: string }> {
    const connection = await this.require(connectionId);
    if (connection.status === "paused") {
      throw new WiwoTalkServiceError(409, "WIWO_TALK_PAUSED", "La conexión de WiWO Talk está en pausa.");
    }
    return this.clientFor(connection).sendWhatsApp(contactId, text);
  }

  /** Deja la conversación leída también en WiWO Talk (cortesía: un fallo no se muestra). */
  async markRead(connectionId: string, conversationId: string): Promise<boolean> {
    const connection = await this.find(connectionId);
    if (!connection || connection.status !== "active" || this.options.demoMode) return false;
    try {
      await this.clientFor(connection).markConversationRead(conversationId, connection.locationId);
      return true;
    } catch {
      return false;
    }
  }

  /** Conciliación periódica de todas las conexiones activas, una tras otra. */
  startScheduler(intervalMinutes: number): void {
    if (this.options.demoMode || intervalMinutes <= 0 || this.schedulerTimer) return;
    const tick = async () => {
      for (const connection of await this.list().catch(() => [] as WiwoTalkConnection[])) {
        if (connection.status === "paused") continue;
        await this.syncNow(connection.id).catch(() => undefined);
      }
    };
    this.schedulerTimer = setInterval(() => void tick(), intervalMinutes * 60_000);
    this.schedulerTimer.unref?.();
  }

  /** Detiene la conciliación y espera las lecturas en curso (para cerrar sin escrituras a medias). */
  async stop(): Promise<void> {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = undefined;
    for (const timer of this.pendingWebhooks.values()) clearTimeout(timer);
    this.pendingWebhooks.clear();
    await Promise.allSettled([...this.running.values()]);
  }

  /** Solo demo: un mensaje ficticio por el mismo camino que uno real. */
  async simulateInbound(id: string, text?: string): Promise<{ created: number }> {
    const connection = await this.require(id);
    const brand = await this.brandOf(connection);
    const conversation: WiwoTalkConversation = { id: `demo-conv-${id.slice(0, 8)}`, contactId: `demo-contact-${id.slice(0, 8)}`, fullName: "Cliente de prueba WiWO Talk", phone: "+0055500000" };
    const message: WiwoTalkMessage = {
      id: `demo-${randomUUID()}`,
      direction: "inbound",
      messageType: "TYPE_WHATSAPP",
      body: text ?? "Hola, ¿tienen disponibilidad para una prueba de manejo?",
      dateAdded: new Date(this.now()).toISOString(),
    };
    const normalized = await this.normalize(message, conversation, brand);
    const interaction = buildWhatsAppInteraction(normalized, { id: connection.id, label: connection.label }, brand);
    interaction.customerName = customerNameOf(conversation);
    interaction.customerHandle = conversation.phone!;
    interaction.metricoolRef!.whatsapp!.provider = "wiwo_talk";
    interaction.metricoolRef!.whatsapp!.talkConversationId = conversation.id;
    const result = await this.options.ingest(brand, [interaction]);
    return { created: result.created };
  }
}
