/**
 * Mensajes de WhatsApp → interacciones de la bandeja. Corre en la API (no en el worker) para que
 * cada escritura pase por los métodos del repositorio que la bandeja en vivo ya vigila.
 */
import { randomUUID } from "node:crypto";
import type { Brand, Interaction, WhatsAppDeliveryState, WhatsAppLine } from "../types.js";
import { WHATSAPP_DELIVERY_STATES } from "../types.js";
import type { NormalizedWhatsAppMessage, WhatsAppMessageUpdate } from "./messages.js";
import { whatsappMediaUrl, type WhatsAppMediaRef } from "./media.js";

/** Id externo estable: el mismo mensaje entregado dos veces nunca crea dos casos. */
export function whatsappExternalId(lineId: string, messageId: string): string {
  return `wa:${lineId}:${messageId}`;
}

function customerLabel(message: NormalizedWhatsAppMessage): string {
  return message.phoneNumber ?? "Contacto de WhatsApp";
}

/** De dónde viene un lote de mensajes antiguos: el historial al vincular o "Cargar anteriores". */
export type WhatsAppHistoryMode = "link" | "on_demand";

/** Un mensaje de cliente sin responder más reciente que esto sigue siendo trabajo, no historial. */
export const HISTORY_OPEN_CASE_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * Qué mensajes de un lote de historial quedan como historial. En el historial al vincular, el
 * último mensaje de cada chat, si es del cliente y de los últimos 7 días, queda como caso normal:
 * es alguien esperando respuesta. "Cargar anteriores" trae mensajes más viejos que los que ya
 * hay, así que ahí todo es historial.
 */
export function historyMessageIds(
  messages: NormalizedWhatsAppMessage[],
  mode: WhatsAppHistoryMode,
  now = Date.now(),
): Set<string> {
  const history = new Set(messages.map((message) => message.messageId));
  if (mode !== "link") return history;
  const latestByChat = new Map<string, NormalizedWhatsAppMessage>();
  for (const message of messages) {
    const current = latestByChat.get(message.chatId);
    if (!current || Date.parse(message.timestamp) > Date.parse(current.timestamp)) latestByChat.set(message.chatId, message);
  }
  for (const latest of latestByChat.values()) {
    if (!latest.fromMe && now - Date.parse(latest.timestamp) < HISTORY_OPEN_CASE_MS) history.delete(latest.messageId);
  }
  return history;
}

/**
 * Mensaje que wiwo.sac envió por WhatsApp, registrado como saliente apenas el worker confirma el
 * envío. Tiene el mismo id externo que su eco, así que cuando WhatsApp lo devuelve no se duplica;
 * y cada mensaje (también los que siguen en un chat ya respondido) queda en la conversación con
 * sus tics.
 */
export function buildSentWhatsAppInteraction(input: {
  inbound: Interaction;
  lineId: string;
  chatId: string;
  messageId: string;
  text: string;
  sentBy: string;
  at: string;
  attachment?: WhatsAppMediaRef;
  quotedText?: string;
}): Interaction {
  const { inbound } = input;
  return {
    id: randomUUID(),
    externalId: whatsappExternalId(input.lineId, input.messageId),
    brandId: inbound.brandId,
    accountId: inbound.accountId,
    channel: "whatsapp",
    type: "dm",
    direction: "outbound",
    customerName: inbound.customerName,
    customerHandle: inbound.customerHandle,
    text: input.text || (input.attachment ? `[${input.attachment.fileName ?? "Archivo adjunto"}]` : ""),
    category: "sin_clasificar",
    sentiment: "neutral",
    confidence: 0,
    status: "replied",
    source: "whatsapp",
    version: 1,
    createdAt: input.at,
    updatedAt: input.at,
    internalNotes: [],
    metricoolRef: {
      conversationId: input.chatId,
      recipient: input.chatId,
      actorId: input.chatId,
      contentContext: {
        kind: input.attachment ? "attachment" : "text",
        ...(input.attachment ? { mediaUrls: [whatsappMediaUrl(input.attachment.key, input.attachment.kind)] } : {}),
      },
      whatsapp: {
        lineId: input.lineId,
        chatId: input.chatId,
        messageId: input.messageId,
        status: "sent",
        sentBy: input.sentBy,
        ...(input.attachment ? { media: input.attachment } : {}),
        ...(input.quotedText ? { quotedText: input.quotedText } : {}),
      },
    },
    audit: [{
      id: randomUUID(),
      at: input.at,
      action: "reply_sent",
      actor: "agent",
      detail: `Mensaje enviado por WhatsApp desde wiwo.sac por ${input.sentBy}.`,
    }],
  };
}

function stateRank(state: WhatsAppDeliveryState | undefined): number {
  return state ? WHATSAPP_DELIVERY_STATES.indexOf(state) : -1;
}

/**
 * Aplica un cambio de WhatsApp a la interacción del mensaje afectado. Devuelve false si no cambió
 * nada (p. ej. un tic que ya estaba): así no se escribe ni se avisa a la bandeja en vano.
 */
export function applyWhatsAppUpdate(interaction: Interaction, update: WhatsAppMessageUpdate): boolean {
  const reference = interaction.metricoolRef?.whatsapp;
  if (!reference) return false;
  if (update.type === "receipt") {
    // Los tics solo avanzan: un "entregado" tardío no deshace un "leído".
    if (stateRank(update.status) <= stateRank(reference.status)) return false;
    reference.status = update.status;
    return true;
  }
  if (update.type === "reaction") {
    const others = (reference.reactions ?? []).filter((item) => item.fromMe !== update.fromMe);
    const next = update.emoji ? [...others, { emoji: update.emoji, fromMe: update.fromMe, at: update.at }] : others;
    if (JSON.stringify(next) === JSON.stringify(reference.reactions ?? [])) return false;
    if (next.length) reference.reactions = next;
    else delete reference.reactions;
    return true;
  }
  if (update.type === "edit") {
    if (interaction.text === update.text) return false;
    interaction.text = update.text;
    reference.editedAt = update.at;
    interaction.audit.push({
      id: randomUUID(),
      at: update.at,
      action: "note_added",
      actor: "system",
      detail: "El cliente editó este mensaje en WhatsApp.",
    });
    return true;
  }
  if (reference.deletedAt) return false;
  reference.deletedAt = update.at;
  interaction.audit.push({
    id: randomUUID(),
    at: update.at,
    action: "note_added",
    actor: "system",
    detail: "El cliente borró este mensaje para todos en WhatsApp.",
  });
  return true;
}

export function buildWhatsAppInteraction(
  message: NormalizedWhatsAppMessage,
  line: Pick<WhatsAppLine, "id" | "label">,
  brand: Pick<Brand, "id" | "account">,
  options: { history?: boolean } = {},
): Interaction {
  const createdAt = message.timestamp;
  const outbound = message.fromMe;
  const history = options.history === true;
  // Con el archivo a la vista, la etiqueta "[Imagen]" sobra: queda solo la leyenda, si hay.
  const text = message.media && message.kind === "attachment"
    ? message.text.replace(/^\[[^\]]{1,40}\]\s?/, "") || message.text
    : message.text;
  return {
    id: randomUUID(),
    externalId: whatsappExternalId(line.id, message.messageId),
    brandId: brand.id,
    accountId: brand.account.id,
    channel: "whatsapp",
    type: "dm",
    direction: outbound ? "outbound" : "inbound",
    // En un mensaje saliente el perfil es el de la marca: el contacto se nombra por su número.
    customerName: (!outbound && message.pushName) || customerLabel(message),
    customerHandle: customerLabel(message),
    text,
    category: "sin_clasificar",
    sentiment: "neutral",
    confidence: 0,
    // Un mensaje antiguo de cliente llega cerrado: es contexto de la conversación, no un caso.
    status: outbound ? "replied" : history ? "resolved" : "new",
    ...(history && !outbound ? {
      statusReason: {
        code: "whatsapp_history",
        label: "Historial importado de WhatsApp",
        changedAt: createdAt,
        changedBy: { userId: "system", displayName: "wiwo.sac" },
      },
    } : {}),
    source: "whatsapp",
    version: 1,
    createdAt,
    updatedAt: createdAt,
    internalNotes: [],
    metricoolRef: {
      conversationId: message.chatId,
      recipient: message.chatId,
      actorId: message.chatId,
      contentContext: {
        kind: message.kind,
        ...(message.media ? { mediaUrls: [whatsappMediaUrl(message.media.key, message.media.kind)] } : {}),
      },
      whatsapp: {
        lineId: line.id,
        chatId: message.chatId,
        messageId: message.messageId,
        ...(history ? { history: true as const } : {}),
        ...(message.media ? { media: message.media } : {}),
        ...(message.quotedText ? { quotedText: message.quotedText } : {}),
        ...(outbound ? { status: "sent" as const } : {}),
      },
    },
    audit: [{
      id: randomUUID(),
      at: createdAt,
      action: "ingested",
      actor: "system",
      detail: history
        ? `Mensaje antiguo importado del teléfono del número «${line.label}» (historial, no cuenta como caso).`
        : outbound
          ? `Mensaje enviado desde el teléfono del número «${line.label}».`
          : `Mensaje recibido por WhatsApp en el número «${line.label}».`,
    }],
  };
}
