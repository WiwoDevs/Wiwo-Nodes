/**
 * Mensajes de WhatsApp → interacciones de la bandeja. Corre en la API (no en el worker) para que
 * cada escritura pase por los métodos del repositorio que la bandeja en vivo ya vigila.
 */
import { randomUUID } from "node:crypto";
import type { Brand, Interaction, WhatsAppLine } from "../types.js";
import type { NormalizedWhatsAppMessage } from "./messages.js";

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

export function buildWhatsAppInteraction(
  message: NormalizedWhatsAppMessage,
  line: Pick<WhatsAppLine, "id" | "label">,
  brand: Pick<Brand, "id" | "account">,
  options: { history?: boolean } = {},
): Interaction {
  const createdAt = message.timestamp;
  const outbound = message.fromMe;
  const history = options.history === true;
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
    text: message.text,
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
      contentContext: { kind: message.kind },
      whatsapp: {
        lineId: line.id,
        chatId: message.chatId,
        messageId: message.messageId,
        ...(history ? { history: true as const } : {}),
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
