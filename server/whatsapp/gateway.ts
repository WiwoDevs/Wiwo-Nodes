/**
 * Adaptador de WhatsApp del lado del worker. El worker solo conoce esta interfaz: hoy la
 * implementa Baileys (WhatsApp Web, no oficial, vinculado por QR o código); mañana puede
 * implementarla la API oficial de Meta (Cloud API) sin tocar la API ni el frontend, porque los
 * dos entregan lo mismo: estados del número, mensajes normalizados y envíos con id.
 */
import type { WhatsAppLineStatus } from "../types.js";
import type { MediaDescriptor, NormalizedWhatsAppMessage, WhatsAppMessageUpdate } from "./messages.js";
import type { WhatsAppHistoryMode } from "./ingest.js";
import type { WhatsAppMediaKind } from "./media.js";

/** Mensaje recibido; si trae un archivo aceptado, `downloadMedia` lo baja de WhatsApp. */
export interface IncomingWhatsAppMessage extends NormalizedWhatsAppMessage {
  pendingMedia?: { descriptor: MediaDescriptor; download(): Promise<Buffer> };
}

/** Lo que se envía: texto, y opcionalmente un archivo y la cita a un mensaje del cliente. */
export interface OutgoingWhatsAppMessage {
  text: string;
  attachment?: { data: Buffer; mimeType: string; kind: WhatsAppMediaKind; fileName?: string };
  quote?: { messageId: string; text: string };
}

export interface WhatsAppSessionState {
  status: WhatsAppLineStatus;
  /** Texto del QR a escanear (la API lo dibuja). */
  qr?: string;
  pairingCode?: string;
  phoneNumber?: string;
  displayName?: string;
  /** Motivo legible, sin datos de clientes. */
  error?: string;
}

export interface WhatsAppSessionEvents {
  onState(state: WhatsAppSessionState): void;
  /** Mensajes nuevos, o un lote de historial antiguo si viene `history`. */
  onMessages(messages: IncomingWhatsAppMessage[], history?: WhatsAppHistoryMode): void;
  /** Tics, reacciones, ediciones y borrados sobre mensajes ya entregados. */
  onUpdates(updates: WhatsAppMessageUpdate[]): void;
  /** El cliente empezó o dejó de escribir o grabar en un chat seguido con `watchPresence`. */
  onPresence?(chatId: string, state: "composing" | "recording" | "paused"): void;
}

export interface HistoryAnchor {
  messageId: string;
  fromMe: boolean;
  /** ISO 8601. */
  timestamp: string;
}

export interface SendTextOptions {
  /** Cuánto mostrar "escribiendo…" antes de enviar. */
  typingMs: number;
  /** Mensaje del cliente que se marca como leído antes de responder. */
  markReadMessageId?: string;
}

export interface WhatsAppSession {
  /** true mientras la conexión está abierta y se puede enviar. */
  isOpen(): boolean;
  /** Envía un mensaje (texto, archivo con leyenda, cita) después de mostrar "escribiendo…". */
  send(chatId: string, message: OutgoingWhatsAppMessage, options: SendTextOptions): Promise<{ messageId: string }>;
  /**
   * Pide al teléfono hasta `count` mensajes anteriores a `anchor` en un chat. La respuesta llega
   * después por `onMessages(..., "on_demand")`, si WhatsApp la entrega.
   */
  fetchHistory(chatId: string, anchor: HistoryAnchor, count: number): Promise<void>;
  /** Marca leídos estos mensajes del cliente (tics azules). */
  markRead(chatId: string, messageIds: string[]): Promise<void>;
  /** Empieza a recibir si el cliente escribe en este chat (`onPresence`). */
  watchPresence(chatId: string): Promise<void>;
  /** Muestra al cliente "escribiendo…" o lo quita. Nunca pone el número "en línea". */
  sendTyping(chatId: string, state: "composing" | "paused"): Promise<void>;
  /** Cierra la conexión sin desvincular (el teléfono sigue mostrando el dispositivo). */
  close(): Promise<void>;
  /** Desvincula: cierra la sesión en WhatsApp y borra las credenciales guardadas. */
  logout(): Promise<void>;
}

export interface WhatsAppLineTarget {
  id: string;
  /** Solo dígitos con código de país: vincular con código en vez de QR. */
  pairingPhone?: string;
  /** Pedir el historial completo al vincular e importarlo como historial. */
  importHistory?: boolean;
}

export interface WhatsAppGateway {
  readonly name: string;
  open(line: WhatsAppLineTarget, events: WhatsAppSessionEvents): Promise<WhatsAppSession>;
  /** Borra las credenciales guardadas de un número (para vincular otro teléfono desde cero). */
  forget(lineId: string): Promise<void>;
}
