/**
 * Normaliza mensajes de WhatsApp Web (forma de Baileys) a un formato neutro que el worker le
 * entrega a la API. No importa Baileys: recibe solo la forma mínima, así se prueba sin conexión
 * y un adaptador futuro (API oficial de Meta) puede entregar lo mismo.
 *
 * Solo entran chats uno a uno con personas: grupos, estados, listas de difusión, canales y bots
 * se ignoran. Reacciones, ediciones, borrados y mensajes técnicos tampoco son casos.
 */
import type { InteractionContentKind, WhatsAppDeliveryState } from "../types.js";
import { baseMime, mediaKindFor, safeFileName, type WhatsAppMediaKind, type WhatsAppMediaRef } from "./media.js";

/** Mensaje normalizado que el worker envía a `POST /api/internal/whatsapp/lines/:id/messages`. */
export interface NormalizedWhatsAppMessage {
  messageId: string;
  /** Chat al que se responde: el JID con número si se conoce, si no el identificador privado (LID). */
  chatId: string;
  /** Número de la persona en formato internacional (+56…), cuando WhatsApp lo entrega. */
  phoneNumber?: string;
  fromMe: boolean;
  /** ISO 8601. */
  timestamp: string;
  /** Nombre de perfil que muestra WhatsApp (solo mensajes entrantes). */
  pushName?: string;
  text: string;
  kind: Extract<InteractionContentKind, "text" | "attachment" | "unsupported">;
  /** Archivo ya subido a la API (el worker lo descarga y lo sube antes de entregar el mensaje). */
  media?: WhatsAppMediaRef;
  /** Texto del mensaje al que responde (cita), recortado. */
  quotedText?: string;
}

/**
 * Cambio sobre un mensaje ya conocido: confirmación de entrega (tics), reacción, edición o
 * borrado. `messageId` es el mensaje afectado, no el del aviso.
 */
export type WhatsAppMessageUpdate =
  | { type: "receipt"; messageId: string; status: Exclude<WhatsAppDeliveryState, "sent">; at: string }
  | { type: "reaction"; messageId: string; emoji: string; fromMe: boolean; at: string }
  | { type: "edit"; messageId: string; text: string; at: string }
  | { type: "delete"; messageId: string; at: string };

/** Archivo de un mensaje que el worker debe descargar (antes de pedirlo a WhatsApp). */
export interface MediaDescriptor {
  kind: WhatsAppMediaKind;
  mimeType: string;
  fileName?: string;
  /** Tamaño que anuncia WhatsApp; permite descartar lo grande sin descargarlo. */
  declaredSize?: number;
}

/** Forma mínima de un mensaje de Baileys (WAMessage) que se usa aquí. */
export interface BaileysLikeMessage {
  key?: {
    remoteJid?: string | null;
    remoteJidAlt?: string | null;
    fromMe?: boolean | null;
    id?: string | null;
    participant?: string | null;
  } | null;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string | { toNumber(): number } | null;
  pushName?: string | null;
}

const PERSON_SERVERS = new Set(["s.whatsapp.net", "c.us", "lid"]);

function jidParts(jid: string): { user: string; server: string } | undefined {
  const at = jid.lastIndexOf("@");
  if (at <= 0) return undefined;
  // "56911112222:12@s.whatsapp.net" → el sufijo es el dispositivo; el chat es el usuario.
  const user = jid.slice(0, at).split(":")[0]!;
  const server = jid.slice(at + 1).toLowerCase();
  return user ? { user, server } : undefined;
}

/** JID de una persona sin sufijo de dispositivo, o undefined si no es un chat uno a uno. */
export function personJid(jid: string | null | undefined): string | undefined {
  if (!jid) return undefined;
  const parts = jidParts(jid.trim());
  if (!parts || !PERSON_SERVERS.has(parts.server)) return undefined;
  const server = parts.server === "c.us" ? "s.whatsapp.net" : parts.server;
  return `${parts.user}@${server}`;
}

/** "+56911112222" desde un JID con número; undefined para LID u otros. */
export function phoneFromJid(jid: string | undefined): string | undefined {
  if (!jid) return undefined;
  const parts = jidParts(jid);
  if (!parts || parts.server !== "s.whatsapp.net" || !/^\d{6,15}$/.test(parts.user)) return undefined;
  return `+${parts.user}`;
}

/** Deja solo dígitos de un número escrito por una persona (para vincular con código). */
export function digitsOnlyPhone(value: string): string | undefined {
  const digits = value.replace(/\D/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : undefined;
}

function timestampIso(value: BaileysLikeMessage["messageTimestamp"], fallback: Date): string {
  let seconds: number | undefined;
  if (typeof value === "number") seconds = value;
  else if (typeof value === "string") seconds = Number(value);
  else if (value && typeof value === "object" && typeof value.toNumber === "function") seconds = value.toNumber();
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return fallback.toISOString();
  return new Date(seconds * 1_000).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringOf(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Envoltorios que WhatsApp usa para mensajes temporales, de una sola vista o con documento. */
const WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
  "documentWithCaptionMessage",
];

function unwrap(message: Record<string, unknown>): Record<string, unknown> {
  let current = message;
  for (let depth = 0; depth < 4; depth += 1) {
    const wrapper = WRAPPERS.map((key) => asRecord(asRecord(current[key])?.message)).find(Boolean);
    if (!wrapper) break;
    current = wrapper;
  }
  return current;
}

const MEDIA: Array<[key: string, label: string]> = [
  ["imageMessage", "Imagen"],
  ["videoMessage", "Video"],
  ["documentMessage", "Documento"],
  ["audioMessage", "Audio"],
  ["stickerMessage", "Sticker"],
  ["locationMessage", "Ubicación"],
  ["liveLocationMessage", "Ubicación en tiempo real"],
  ["contactMessage", "Contacto"],
  ["contactsArrayMessage", "Contactos"],
  ["pollCreationMessage", "Encuesta"],
  ["pollCreationMessageV3", "Encuesta"],
];

/** Mensajes que no son una persona escribiendo: no abren casos. */
const IGNORED = new Set([
  "reactionMessage",
  "protocolMessage",
  "senderKeyDistributionMessage",
  "pollUpdateMessage",
  "editedMessage",
  "keepInChatMessage",
  "pinInChatMessage",
  "encReactionMessage",
]);

function contentOf(message: Record<string, unknown>): Pick<NormalizedWhatsAppMessage, "text" | "kind"> | undefined {
  const inner = unwrap(message);
  const keys = Object.keys(inner).filter((key) => key !== "messageContextInfo");
  if (!keys.length || keys.every((key) => IGNORED.has(key))) return undefined;

  const plain = stringOf(inner, "conversation") ?? stringOf(asRecord(inner.extendedTextMessage), "text");
  if (plain) return { text: plain, kind: "text" };

  const choice = stringOf(asRecord(inner.buttonsResponseMessage), "selectedDisplayText")
    ?? stringOf(asRecord(inner.templateButtonReplyMessage), "selectedDisplayText")
    ?? stringOf(asRecord(inner.listResponseMessage), "title");
  if (choice) return { text: choice, kind: "text" };

  for (const [key, label] of MEDIA) {
    const media = asRecord(inner[key]);
    if (!media) continue;
    const caption = stringOf(media, "caption");
    return { text: caption ? `[${label}] ${caption}` : `[${label}]`, kind: "attachment" };
  }
  return { text: "[Mensaje no compatible]", kind: "unsupported" };
}

const DOWNLOADABLE: Array<[key: string, sticker: boolean]> = [
  ["imageMessage", false],
  ["videoMessage", false],
  ["audioMessage", false],
  ["stickerMessage", true],
  ["documentMessage", false],
];

function numberOf(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) return Number(value);
  if (value && typeof value === "object" && typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return (value as { toNumber(): number }).toNumber();
  }
  return undefined;
}

/** El archivo del mensaje, si es de un tipo aceptado; si no, el mensaje queda solo con su etiqueta. */
export function mediaDescriptor(message: Record<string, unknown> | null | undefined): MediaDescriptor | undefined {
  if (!message) return undefined;
  const inner = unwrap(message);
  for (const [key, sticker] of DOWNLOADABLE) {
    const media = asRecord(inner[key]);
    if (!media) continue;
    const mimeType = baseMime(stringOf(media, "mimetype"));
    const kind = mediaKindFor(mimeType, sticker);
    if (!kind) return undefined;
    const declared = numberOf(media.fileLength);
    const fileName = safeFileName(stringOf(media, "fileName"));
    return {
      kind,
      mimeType,
      ...(fileName ? { fileName } : {}),
      ...(declared && Number.isFinite(declared) ? { declaredSize: declared } : {}),
    };
  }
  return undefined;
}

/** Texto del mensaje citado (si responde a otro), recortado a 300 caracteres. */
function quotedTextOf(message: Record<string, unknown>): string | undefined {
  const inner = unwrap(message);
  for (const value of Object.values(inner)) {
    const contextInfo = asRecord(asRecord(value)?.contextInfo);
    const quoted = asRecord(contextInfo?.quotedMessage);
    if (!quoted) continue;
    const content = contentOf(quoted);
    if (content?.text) return content.text.slice(0, 300);
  }
  return undefined;
}

/**
 * Reacciones, ediciones y borrados que llegan como mensajes. Devuelve undefined para todo lo
 * demás (los mensajes normales se normalizan con `normalizeBaileysMessage`).
 */
export function normalizeBaileysUpdate(raw: BaileysLikeMessage, now = new Date()): WhatsAppMessageUpdate | undefined {
  if (!raw.message || !personJid(raw.key?.remoteJid)) return undefined;
  const inner = unwrap(raw.message);
  const at = timestampIso(raw.messageTimestamp, now);
  const reaction = asRecord(inner.reactionMessage);
  if (reaction) {
    const target = stringOf(asRecord(reaction.key), "id");
    if (!target) return undefined;
    const emoji = typeof reaction.text === "string" ? reaction.text.slice(0, 16) : "";
    return { type: "reaction", messageId: target, emoji, fromMe: raw.key?.fromMe === true, at };
  }
  const protocol = asRecord(inner.protocolMessage) ?? asRecord(asRecord(asRecord(inner.editedMessage)?.message)?.protocolMessage);
  if (protocol) {
    const target = stringOf(asRecord(protocol.key), "id");
    if (!target) return undefined;
    const type = numberOf(protocol.type);
    // 0 = REVOKE (borrado para todos), 14 = MESSAGE_EDIT.
    if (type === 0) return { type: "delete", messageId: target, at };
    const edited = asRecord(protocol.editedMessage);
    if (type === 14 && edited) {
      const content = contentOf(edited);
      if (content?.text) return { type: "edit", messageId: target, text: content.text.slice(0, 4_000), at };
    }
  }
  return undefined;
}

/** Confirmación de entrega de Baileys (`messages.update`) → estado del mensaje saliente. */
export function receiptFromStatus(status: unknown): Exclude<WhatsAppDeliveryState, "sent"> | undefined {
  const value = numberOf(status);
  // proto.WebMessageInfo.Status: 3 DELIVERY_ACK, 4 READ, 5 PLAYED.
  if (value === 3) return "delivered";
  if (value === 4) return "read";
  if (value === 5) return "played";
  return undefined;
}

/**
 * Convierte un mensaje de Baileys. Devuelve undefined si no corresponde a un caso: grupo,
 * estado, difusión, canal, reacción, mensaje técnico o sin id.
 */
export function normalizeBaileysMessage(raw: BaileysLikeMessage, now = new Date()): NormalizedWhatsAppMessage | undefined {
  const key = raw.key;
  const messageId = key?.id?.trim();
  const remote = personJid(key?.remoteJid);
  if (!key || !messageId || !remote || !raw.message) return undefined;
  // Con identificador privado (LID) WhatsApp suele mandar también el número en `remoteJidAlt`:
  // se prefiere el número para que la misma persona no quede partida en dos chats.
  const alternate = personJid(key.remoteJidAlt);
  const chatId = remote.endsWith("@lid") && alternate?.endsWith("@s.whatsapp.net") ? alternate : remote;
  const content = contentOf(raw.message);
  if (!content) return undefined;
  const fromMe = key.fromMe === true;
  const pushName = !fromMe ? raw.pushName?.trim() || undefined : undefined;
  const quotedText = quotedTextOf(raw.message);
  return {
    messageId,
    chatId,
    phoneNumber: phoneFromJid(chatId) ?? phoneFromJid(alternate),
    fromMe,
    timestamp: timestampIso(raw.messageTimestamp, now),
    ...(pushName ? { pushName: pushName.slice(0, 120) } : {}),
    text: content.text.slice(0, 4_000),
    kind: content.kind,
    ...(quotedText ? { quotedText } : {}),
  };
}
