/**
 * Cliente de la API v2 de HighLevel (WiWO Talk es HighLevel con marca blanca), con el token de
 * integración privada de una subcuenta. Solo corre en la API: el token nunca llega al navegador
 * ni a los registros. Toda llamada va a services.leadconnectorhq.com (no al dominio de la marca).
 */
import { setTimeout as delay } from "node:timers/promises";

export const WIWO_TALK_API_BASE = "https://services.leadconnectorhq.com";
/** Cabecera `Version` por grupo de endpoints, como indica la guía de integración. */
const VERSION_CONVERSATIONS = "2021-04-15";
const VERSION_DEFAULT = "2021-07-28";
const REQUEST_TIMEOUT_MS = 15_000;
/** Reintentos ante 429 (límite de 100 solicitudes cada 10 s por token y subcuenta). */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 10_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class WiwoTalkError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "WiwoTalkError";
  }
}

export interface WiwoTalkConversation {
  id: string;
  contactId: string;
  fullName?: string;
  contactName?: string;
  phone?: string;
  lastMessageType?: string;
  /** Milisegundos desde 1970 (HighLevel lo entrega como número o texto). */
  lastMessageDate?: number;
  unreadCount?: number;
}

export interface WiwoTalkMessage {
  id: string;
  conversationId?: string;
  contactId?: string;
  direction: "inbound" | "outbound";
  messageType?: string;
  body?: string;
  contentType?: string;
  attachments?: string[];
  /** ISO 8601. */
  dateAdded: string;
  status?: string;
  /** Quién lo envió: usuario de HighLevel (persona) o ninguno (bot, workflow, campaña). */
  userId?: string;
  source?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asEpochMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toConversation(raw: Record<string, unknown>): WiwoTalkConversation | undefined {
  const id = asString(raw.id);
  const contactId = asString(raw.contactId);
  if (!id || !contactId) return undefined;
  const lastMessageDate = asEpochMs(raw.lastMessageDate);
  return {
    id,
    contactId,
    ...(asString(raw.fullName) ? { fullName: asString(raw.fullName) } : {}),
    ...(asString(raw.contactName) ? { contactName: asString(raw.contactName) } : {}),
    ...(asString(raw.phone) ? { phone: asString(raw.phone) } : {}),
    ...(asString(raw.lastMessageType) ? { lastMessageType: asString(raw.lastMessageType) } : {}),
    ...(lastMessageDate !== undefined ? { lastMessageDate } : {}),
    ...(typeof raw.unreadCount === "number" ? { unreadCount: raw.unreadCount } : {}),
  };
}

function toMessage(raw: Record<string, unknown>): WiwoTalkMessage | undefined {
  const id = asString(raw.id);
  const direction = raw.direction === "inbound" || raw.direction === "outbound" ? raw.direction : undefined;
  const dateMs = asEpochMs(raw.dateAdded);
  if (!id || !direction || dateMs === undefined) return undefined;
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments.filter((item): item is string => typeof item === "string" && item.startsWith("https://"))
    : [];
  return {
    id,
    direction,
    dateAdded: new Date(dateMs).toISOString(),
    ...(asString(raw.conversationId) ? { conversationId: asString(raw.conversationId) } : {}),
    ...(asString(raw.contactId) ? { contactId: asString(raw.contactId) } : {}),
    ...(asString(raw.messageType) ? { messageType: asString(raw.messageType) } : {}),
    ...(typeof raw.body === "string" ? { body: raw.body } : {}),
    ...(asString(raw.contentType) ? { contentType: asString(raw.contentType) } : {}),
    ...(attachments.length ? { attachments } : {}),
    ...(asString(raw.status) ? { status: asString(raw.status) } : {}),
    ...(asString(raw.userId) ? { userId: asString(raw.userId) } : {}),
    ...(asString(raw.source) ? { source: asString(raw.source) } : {}),
  };
}

/** Solo WhatsApp: la subcuenta puede tener SMS, correo, llamadas o Instagram en la misma conversación. */
export function isWhatsAppMessage(message: Pick<WiwoTalkMessage, "messageType">): boolean {
  return (message.messageType ?? "").toUpperCase().replace(/^TYPE_/, "") === "WHATSAPP";
}

export class WiwoTalkClient {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<unknown> = (ms) => delay(ms),
  ) {}

  private async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    options: { query?: Record<string, string | number | undefined>; body?: unknown; version?: string } = {},
  ): Promise<T> {
    const url = new URL(path, WIWO_TALK_API_BASE);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Version: options.version ?? VERSION_DEFAULT,
            Accept: "application/json",
            ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          redirect: "error",
        });
      } catch {
        throw new WiwoTalkError(0, "WIWO_TALK_UNREACHABLE", "No se pudo conectar con WiWO Talk.");
      }
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        // Sin Retry-After: si se acabó el cupo diario no tiene sentido esperar; si no, la ventana es de 10 s.
        if (response.headers.get("x-ratelimit-daily-remaining") === "0") {
          throw new WiwoTalkError(429, "WIWO_TALK_DAILY_LIMIT", "Se acabó el cupo diario de la API de WiWO Talk.");
        }
        const interval = Number(response.headers.get("x-ratelimit-interval-milliseconds")) || MAX_RATE_LIMIT_WAIT_MS;
        await this.sleep(Math.min(MAX_RATE_LIMIT_WAIT_MS, interval) * (attempt + 1) / MAX_RATE_LIMIT_RETRIES);
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new WiwoTalkError(response.status, codeFor(response.status), messageFor(response.status));
      }
      return await response.json().catch(() => ({})) as T;
    }
  }

  /** Comprueba el token y la subcuenta; devuelve su nombre. */
  async getLocation(locationId: string): Promise<{ id: string; name?: string }> {
    const payload = await this.request<{ location?: Record<string, unknown> }>("GET", `/locations/${encodeURIComponent(locationId)}`);
    const id = asString(payload.location?.id) ?? locationId;
    const name = asString(payload.location?.name);
    return { id, ...(name ? { name } : {}) };
  }

  /** Conversaciones con actividad más reciente primero. */
  async searchConversations(locationId: string, options: { contactId?: string; limit?: number } = {}): Promise<WiwoTalkConversation[]> {
    const payload = await this.request<{ conversations?: unknown[] }>("GET", "/conversations/search", {
      version: VERSION_CONVERSATIONS,
      query: {
        locationId,
        contactId: options.contactId,
        limit: options.limit ?? 20,
        sort: "desc",
        sortBy: "last_message_date",
      },
    });
    return (payload.conversations ?? [])
      .map((item) => (item && typeof item === "object" ? toConversation(item as Record<string, unknown>) : undefined))
      .filter((item): item is WiwoTalkConversation => Boolean(item));
  }

  /** Mensajes de WhatsApp de una conversación, del más nuevo al más antiguo. */
  async listMessages(conversationId: string, options: { limit?: number; lastMessageId?: string } = {}): Promise<{
    messages: WiwoTalkMessage[];
    nextPage: boolean;
    lastMessageId?: string;
  }> {
    const payload = await this.request<{ messages?: { messages?: unknown[]; nextPage?: boolean; lastMessageId?: string } }>(
      "GET",
      `/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        version: VERSION_CONVERSATIONS,
        query: { limit: options.limit ?? 50, lastMessageId: options.lastMessageId, type: "TYPE_WHATSAPP" },
      },
    );
    const page = payload.messages ?? {};
    const messages = (page.messages ?? [])
      .map((item) => (item && typeof item === "object" ? toMessage(item as Record<string, unknown>) : undefined))
      .filter((item): item is WiwoTalkMessage => Boolean(item));
    return {
      messages,
      nextPage: page.nextPage === true,
      ...(asString(page.lastMessageId) ? { lastMessageId: asString(page.lastMessageId) } : {}),
    };
  }

  /** Envía un WhatsApp de texto a un contacto. Meta exige que esté dentro de las 24 h. */
  async sendWhatsApp(contactId: string, message: string): Promise<{ messageId: string; conversationId?: string }> {
    const payload = await this.request<Record<string, unknown>>("POST", "/conversations/messages", {
      version: VERSION_CONVERSATIONS,
      body: { type: "WhatsApp", contactId, message },
    });
    const messageId = asString(payload.messageId);
    if (!messageId) throw new WiwoTalkError(502, "WIWO_TALK_SEND_UNCONFIRMED", "WiWO Talk no confirmó el envío.");
    const conversationId = asString(payload.conversationId);
    return { messageId, ...(conversationId ? { conversationId } : {}) };
  }

  /** Deja la conversación sin mensajes por leer en WiWO Talk. */
  async markConversationRead(conversationId: string, locationId: string): Promise<void> {
    await this.request("PUT", `/conversations/${encodeURIComponent(conversationId)}`, {
      version: VERSION_CONVERSATIONS,
      body: { locationId, unreadCount: 0 },
    });
  }
}

function codeFor(status: number): string {
  if (status === 401) return "WIWO_TALK_TOKEN_INVALID";
  if (status === 403) return "WIWO_TALK_SCOPE_MISSING";
  if (status === 404) return "WIWO_TALK_NOT_FOUND";
  if (status === 422 || status === 400) return "WIWO_TALK_REJECTED";
  if (status === 429) return "WIWO_TALK_RATE_LIMITED";
  return "WIWO_TALK_UNAVAILABLE";
}

function messageFor(status: number): string {
  if (status === 401) return "WiWO Talk rechazó el token: revisa que esté vigente.";
  if (status === 403) return "Al token le falta un permiso (scope) en WiWO Talk.";
  if (status === 404) return "WiWO Talk no encontró la subcuenta o la conversación.";
  if (status === 422 || status === 400) return "WiWO Talk rechazó el mensaje (por ejemplo, fuera de la ventana de 24 h de WhatsApp).";
  if (status === 429) return "WiWO Talk pidió esperar: demasiadas solicitudes.";
  return "WiWO Talk no respondió correctamente.";
}
