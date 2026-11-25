/**
 * Adaptador de WhatsApp del lado del worker. El worker solo conoce esta interfaz: hoy la
 * implementa Baileys (WhatsApp Web, no oficial, vinculado por QR o código); mañana puede
 * implementarla la API oficial de Meta (Cloud API) sin tocar la API ni el frontend, porque los
 * dos entregan lo mismo: estados del número, mensajes normalizados y envíos con id.
 */
import type { WhatsAppLineStatus } from "../types.js";
import type { NormalizedWhatsAppMessage } from "./messages.js";
import type { WhatsAppHistoryMode } from "./ingest.js";

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
  onMessages(messages: NormalizedWhatsAppMessage[], history?: WhatsAppHistoryMode): void;
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
  sendText(chatId: string, text: string, options: SendTextOptions): Promise<{ messageId: string }>;
  /**
   * Pide al teléfono hasta `count` mensajes anteriores a `anchor` en un chat. La respuesta llega
   * después por `onMessages(..., "on_demand")`, si WhatsApp la entrega.
   */
  fetchHistory(chatId: string, anchor: HistoryAnchor, count: number): Promise<void>;
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
