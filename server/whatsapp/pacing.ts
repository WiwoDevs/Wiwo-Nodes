/**
 * Ritmo de envío por número de WhatsApp. WhatsApp marca como spam a los números que contestan
 * en ráfagas o con tiempos de máquina; este pacer hace que cada número responda como una
 * persona: una pausa al azar entre mensajes, topes por minuto y por hora, y "escribiendo…"
 * durante un tiempo proporcional al largo del texto. Un mensaje que no cabe espera su turno en
 * la cola; nunca se descarta.
 */
import type { WhatsAppPacingConfig } from "../config.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export class SendPacer {
  private readonly sends: number[] = [];
  /** Envíos de las últimas 24 h (el tope diario; `sends` guarda solo la última hora). */
  private readonly daySends: number[] = [];
  private nextAllowedAt = 0;
  private lastChatId?: string;

  constructor(
    private readonly config: WhatsAppPacingConfig,
    private readonly random: () => number = Math.random,
  ) {}

  /** Momento más temprano (ms epoch) en que este número puede enviar el próximo mensaje. */
  readyAt(now: number): number {
    this.prune(now);
    let at = Math.max(now, this.nextAllowedAt);
    const lastMinute = this.sends.filter((sentAt) => sentAt > now - MINUTE_MS);
    if (lastMinute.length >= this.config.maxPerMinute) {
      at = Math.max(at, lastMinute[lastMinute.length - this.config.maxPerMinute]! + MINUTE_MS);
    }
    if (this.sends.length >= this.config.maxPerHour) {
      at = Math.max(at, this.sends[this.sends.length - this.config.maxPerHour]! + HOUR_MS);
    }
    if (this.daySends.length >= this.config.maxPerDay) {
      at = Math.max(at, this.daySends[this.daySends.length - this.config.maxPerDay]! + DAY_MS);
    }
    return at;
  }

  /** Envíos en las últimas 24 h y en la última hora (para la salud del worker). */
  usage(now: number): { lastHour: number; lastDay: number } {
    this.prune(now);
    return { lastHour: this.sends.length, lastDay: this.daySends.length };
  }

  isReady(now: number): boolean {
    return this.readyAt(now) <= now;
  }

  /** Registra un envío y fija la próxima pausa al azar entre el mínimo y el máximo. */
  /**
   * Registra un envío y fija la próxima pausa al azar entre el mínimo y el máximo, más un extra si
   * el siguiente puede ir a otro chat (se suma al pasar de chat) o si este llevaba un archivo.
   */
  record(now: number, detail: { chatId?: string; attachment?: boolean } = {}): void {
    this.sends.push(now);
    this.daySends.push(now);
    const span = Math.max(0, this.config.maxGapMs - this.config.minGapMs);
    const chatChanged = Boolean(detail.chatId && this.lastChatId && detail.chatId !== this.lastChatId);
    const extra = (chatChanged ? this.config.chatChangeExtraMs ?? 0 : 0)
      + (detail.attachment ? this.config.attachmentExtraMs ?? 0 : 0);
    this.nextAllowedAt = now + this.config.minGapMs + Math.round(this.random() * span) + extra;
    if (detail.chatId) this.lastChatId = detail.chatId;
    this.prune(now);
  }

  /** Cuánto mostrar "escribiendo…" antes de enviar: según el largo, con ±20 % de azar. */
  typingMs(text: string): number {
    const base = text.length * this.config.typingMsPerChar;
    const jittered = base * (0.8 + this.random() * 0.4);
    return Math.round(Math.min(this.config.typingMaxMs, Math.max(this.config.typingMinMs, jittered)));
  }

  private prune(now: number): void {
    while (this.sends.length && this.sends[0]! <= now - HOUR_MS) this.sends.shift();
    while (this.daySends.length && this.daySends[0]! <= now - DAY_MS) this.daySends.shift();
  }
}

/** Espera entre reintentos de conexión: 2 s, 4 s, 8 s… hasta 2 minutos, con algo de azar. */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(120_000, 2_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random() * 0.5));
}
