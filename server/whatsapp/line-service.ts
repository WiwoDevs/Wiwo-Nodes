/**
 * Números de WhatsApp del lado de la API. La API no habla con WhatsApp: guarda lo que pidió un
 * admin principal (vincular o desvincular) y el último estado que informó el worker. El QR y el
 * código de vinculación viven solo en memoria, porque vencen en segundos y abren la cuenta a
 * quien los escanee.
 *
 * En modo demo no hay worker ni conexión real: el servicio simula el ciclo (QR de muestra que no
 * vincula nada, conexión a los pocos segundos) para poder probar la pantalla y la bandeja.
 */
import { randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type { SacFlowRepository } from "../repository-contract.js";
import type { WhatsAppLine, WhatsAppLineStatus } from "../types.js";
import { digitsOnlyPhone } from "./messages.js";

/** Sin noticias del worker en este plazo, la pantalla lo muestra desconectado. */
const WORKER_ONLINE_MS = 30_000;
/** WhatsApp renueva el QR cada ~20 s; uno más viejo que esto ya no sirve. */
const QR_TTL_MS = 60_000;
const PAIRING_CODE_TTL_MS = 3 * 60_000;
/** En demo, segundos entre pedir la vinculación y quedar "conectado". */
const DEMO_LINK_DELAY_MS = 8_000;
export const DEMO_QR_PAYLOAD = "wiwo.sac · demostración · este código no vincula ningún teléfono";

export type LinkMethod = "qr" | "code";

export interface WhatsAppLineStateReport {
  generation: number;
  status: WhatsAppLineStatus;
  /** Texto del QR que entrega WhatsApp (la API lo dibuja). */
  qr?: string;
  pairingCode?: string;
  phoneNumber?: string;
  displayName?: string;
  error?: string;
}

interface LiveState {
  status?: WhatsAppLineStatus;
  qrDataUrl?: string;
  qrAt?: number;
  pairingCode?: string;
  pairingCodeAt?: number;
  demoConnectAt?: number;
}

/** Lo que ve un admin principal: incluye el QR o el código mientras están vigentes. */
export interface AdminWhatsAppLine extends Omit<WhatsAppLine, "pairingPhone"> {
  linkMethod: LinkMethod;
  qrDataUrl?: string;
  pairingCode?: string;
}

/** Lo que ve cualquier persona de la bandeja: solo si el número está conectado. */
export interface PublicWhatsAppLine {
  id: string;
  brandId: string;
  label: string;
  status: WhatsAppLineStatus;
  phoneNumber?: string;
  displayName?: string;
}

/** Lo que el worker necesita para decidir qué conectar. */
export interface WorkerWhatsAppLine {
  id: string;
  brandId: string;
  desiredState: WhatsAppLine["desiredState"];
  generation: number;
  /** Último estado guardado: al reiniciar, el worker no reabre solo un número desvinculado. */
  status: WhatsAppLineStatus;
  pairingPhone?: string;
  /** Pedirle al teléfono el historial completo al vincular. */
  importHistory: boolean;
}

/** Pedido de "Cargar anteriores": mensajes más viejos que `anchor` en un chat. */
export interface WhatsAppHistoryRequest {
  lineId: string;
  chatId: string;
  /** Mensaje más antiguo que ya tiene wiwo.sac en ese chat (WhatsApp entrega los anteriores). */
  anchor: { messageId: string; fromMe: boolean; timestamp: string };
  count: number;
}

/**
 * Órdenes rápidas para un chat abierto en wiwo.sac: marcar leído (tics azules), seguir si el
 * cliente está escribiendo y mostrarle "escribiendo…" mientras alguien del equipo redacta.
 */
export type WhatsAppChatCommand =
  | { kind: "read"; lineId: string; chatId: string; messageIds: string[] }
  | { kind: "watch"; lineId: string; chatId: string }
  | { kind: "typing"; lineId: string; chatId: string; state: WhatsAppTypingState };

export type WhatsAppTypingState = "composing" | "paused";
/** Lo que el cliente está haciendo en el chat, según WhatsApp. */
export type WhatsAppPresenceState = "composing" | "recording";

/** Un mismo chat no se vuelve a pedir antes de esto (el teléfono tarda en responder). */
const HISTORY_REQUEST_COOLDOWN_MS = 20_000;
/** "Escribiendo…" del cliente caduca si WhatsApp no lo renueva (lo hace cada pocos segundos). */
const PRESENCE_TTL_MS = 8_000;
/** Se vuelve a suscribir a la presencia de un chat abierto como mucho cada tanto. */
const WATCH_COOLDOWN_MS = 60_000;
/** "Escribiendo…" del equipo: una señal por chat cada tanto, aunque se escriba sin parar. */
const TYPING_COOLDOWN_MS = 4_000;

export class WhatsAppLineError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
    this.name = "WhatsAppLineError";
  }
}

export class WhatsAppLineService {
  private readonly live = new Map<string, LiveState>();
  private workerSeenAt?: number;
  private historyQueue: WhatsAppHistoryRequest[] = [];
  private readonly historyRequestedAt = new Map<string, number>();
  private chatCommands: WhatsAppChatCommand[] = [];
  private readonly watchedAt = new Map<string, number>();
  private readonly typingAt = new Map<string, { state: WhatsAppTypingState; at: number }>();
  private readonly presence = new Map<string, { state: WhatsAppPresenceState; at: number }>();

  constructor(
    private readonly repository: SacFlowRepository,
    private readonly options: { demoMode: boolean; now?: () => number },
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private liveOf(id: string): LiveState {
    let state = this.live.get(id);
    if (!state) {
      state = {};
      this.live.set(id, state);
    }
    return state;
  }

  workerOnline(): boolean {
    return this.workerSeenAt !== undefined && this.now() - this.workerSeenAt < WORKER_ONLINE_MS;
  }

  workerLastSeenAt(): string | undefined {
    return this.workerSeenAt ? new Date(this.workerSeenAt).toISOString() : undefined;
  }

  async find(id: string): Promise<WhatsAppLine | undefined> {
    await this.advanceDemo();
    return (await this.repository.listWhatsAppLines()).find((line) => line.id === id);
  }

  async listLines(): Promise<WhatsAppLine[]> {
    await this.advanceDemo();
    return this.repository.listWhatsAppLines();
  }

  async listForAdmin(): Promise<AdminWhatsAppLine[]> {
    const now = this.now();
    return (await this.listLines()).map((line) => {
      const state = this.live.get(line.id);
      const { pairingPhone, ...rest } = line;
      const waiting = line.desiredState === "linked" && line.status !== "connected";
      const qrFresh = waiting && state?.qrDataUrl && state.qrAt && now - state.qrAt < QR_TTL_MS;
      const codeFresh = waiting && state?.pairingCode && state.pairingCodeAt && now - state.pairingCodeAt < PAIRING_CODE_TTL_MS;
      return {
        ...rest,
        linkMethod: pairingPhone ? "code" : "qr",
        ...(qrFresh ? { qrDataUrl: state!.qrDataUrl } : {}),
        ...(codeFresh ? { pairingCode: state!.pairingCode } : {}),
      };
    });
  }

  async listPublic(canSee: (brandId: string) => boolean): Promise<PublicWhatsAppLine[]> {
    return (await this.listLines())
      .filter((line) => canSee(line.brandId))
      .map((line) => ({
        id: line.id,
        brandId: line.brandId,
        label: line.label,
        status: line.status,
        ...(line.phoneNumber ? { phoneNumber: line.phoneNumber } : {}),
        ...(line.displayName ? { displayName: line.displayName } : {}),
      }));
  }

  async create(
    input: { brandId: string; label: string; method: LinkMethod; phoneNumber?: string; importHistory?: boolean },
    createdBy: string,
  ): Promise<WhatsAppLine> {
    const pairingPhone = this.pairingPhoneFor(input.method, input.phoneNumber);
    const at = new Date(this.now()).toISOString();
    const line: WhatsAppLine = {
      id: randomUUID(),
      brandId: input.brandId,
      label: input.label.trim(),
      desiredState: "linked",
      generation: 1,
      ...(pairingPhone ? { pairingPhone } : {}),
      ...(input.importHistory ? { importHistory: true } : {}),
      status: "pending_link",
      createdAt: at,
      createdBy,
      updatedAt: at,
    };
    const saved = await this.repository.saveWhatsAppLine(line);
    await this.startDemoLink(saved);
    return saved;
  }

  async requestLink(id: string, method: LinkMethod, phoneNumber?: string, importHistory?: boolean): Promise<WhatsAppLine> {
    const line = await this.require(id);
    if (line.desiredState === "linked" && line.status === "connected") {
      throw new WhatsAppLineError(409, "WHATSAPP_ALREADY_LINKED", "Este número ya está vinculado. Desvincúlalo antes de vincular otro teléfono.");
    }
    const pairingPhone = this.pairingPhoneFor(method, phoneNumber);
    const next: WhatsAppLine = {
      ...line,
      desiredState: "linked",
      generation: line.generation + 1,
      status: "pending_link",
      updatedAt: new Date(this.now()).toISOString(),
    };
    delete next.lastError;
    if (pairingPhone) next.pairingPhone = pairingPhone;
    else delete next.pairingPhone;
    if (importHistory !== undefined) {
      if (importHistory) next.importHistory = true;
      else delete next.importHistory;
    }
    this.live.delete(id);
    const saved = await this.repository.saveWhatsAppLine(next);
    await this.startDemoLink(saved);
    return saved;
  }

  /**
   * Pide desvincular: el worker cierra la sesión en WhatsApp (el teléfono deja de mostrar el
   * dispositivo) y borra las credenciales guardadas. Los mensajes ya recibidos se conservan.
   */
  async requestUnlink(id: string): Promise<WhatsAppLine> {
    const line = await this.require(id);
    const next: WhatsAppLine = {
      ...line,
      desiredState: "unlinked",
      generation: line.generation + 1,
      // En demo no hay sesión que cerrar; en live el worker confirma al terminar.
      status: this.options.demoMode || !this.workerOnline() ? "unlinked" : line.status,
      updatedAt: new Date(this.now()).toISOString(),
    };
    delete next.pairingPhone;
    this.live.delete(id);
    return this.repository.saveWhatsAppLine(next);
  }

  async remove(id: string): Promise<void> {
    const line = await this.require(id);
    if (line.desiredState !== "unlinked" || !["unlinked", "logged_out", "error", "pending_link"].includes(line.status)) {
      throw new WhatsAppLineError(409, "WHATSAPP_LINE_ACTIVE", "Desvincula el número antes de quitarlo.");
    }
    this.live.delete(id);
    await this.repository.deleteWhatsAppLine(id);
  }

  /** Lo que el worker debe conectar. Cada consulta cuenta como señal de vida del worker. */
  async workerLines(): Promise<WorkerWhatsAppLine[]> {
    this.workerSeenAt = this.now();
    return (await this.repository.listWhatsAppLines()).map((line) => ({
      id: line.id,
      brandId: line.brandId,
      desiredState: line.desiredState,
      generation: line.generation,
      status: line.status,
      importHistory: line.importHistory === true,
      ...(line.pairingPhone && line.desiredState === "linked" ? { pairingPhone: line.pairingPhone } : {}),
    }));
  }

  /**
   * Encola "Cargar anteriores" para un chat. Devuelve false si ese chat ya se pidió hace poco.
   * La cola vive en memoria: si la API se reinicia, se vuelve a pedir.
   */
  requestHistory(request: WhatsAppHistoryRequest): boolean {
    const key = `${request.lineId}\u0000${request.chatId}`;
    const last = this.historyRequestedAt.get(key);
    if (last !== undefined && this.now() - last < HISTORY_REQUEST_COOLDOWN_MS) return false;
    this.historyRequestedAt.set(key, this.now());
    this.historyQueue = [...this.historyQueue.filter((item) => `${item.lineId}\u0000${item.chatId}` !== key), request].slice(-100);
    return true;
  }

  /** El worker se lleva los pedidos pendientes; cada uno se entrega una sola vez. */
  takeHistoryRequests(): WhatsAppHistoryRequest[] {
    const taken = this.historyQueue;
    this.historyQueue = [];
    return taken;
  }

  /** Marca leídos en WhatsApp estos mensajes del cliente (los ve con tics azules). */
  requestRead(lineId: string, chatId: string, messageIds: string[]): void {
    if (!messageIds.length) return;
    this.pushCommand({ kind: "read", lineId, chatId, messageIds: messageIds.slice(-50) });
  }

  /** Sigue la presencia de un chat abierto (para mostrar "escribiendo…"). */
  requestWatch(lineId: string, chatId: string): void {
    const key = `${lineId}\u0000${chatId}`;
    const last = this.watchedAt.get(key);
    if (last !== undefined && this.now() - last < WATCH_COOLDOWN_MS) return;
    this.watchedAt.set(key, this.now());
    this.pushCommand({ kind: "watch", lineId, chatId });
  }

  /**
   * "Escribiendo…" del equipo hacia el cliente. Se manda una señal por chat cada pocos segundos;
   * "paused" solo si antes se mandó "composing". Devuelve si se encoló.
   */
  requestTyping(lineId: string, chatId: string, state: WhatsAppTypingState): boolean {
    const key = `${lineId}\u0000${chatId}`;
    const last = this.typingAt.get(key);
    if (state === "composing" && last?.state === "composing" && this.now() - last.at < TYPING_COOLDOWN_MS) return false;
    if (state === "paused" && last?.state !== "composing") return false;
    this.typingAt.set(key, { state, at: this.now() });
    this.pushCommand({ kind: "typing", lineId, chatId, state });
    return true;
  }

  takeChatCommands(): WhatsAppChatCommand[] {
    const taken = this.chatCommands;
    this.chatCommands = [];
    return taken;
  }

  private pushCommand(command: WhatsAppChatCommand): void {
    // Cola acotada: si el worker no la retira, lo más viejo sobra.
    this.chatCommands = [...this.chatCommands, command].slice(-200);
  }

  /** El worker informa lo que hace el cliente en un chat (solo en memoria, caduca sola). */
  reportPresence(lineId: string, chatId: string, state: WhatsAppPresenceState | "paused"): void {
    const key = `${lineId}\u0000${chatId}`;
    if (state === "paused") this.presence.delete(key);
    else this.presence.set(key, { state, at: this.now() });
    if (this.presence.size > 2_000) {
      for (const [entryKey, entry] of this.presence) {
        if (this.now() - entry.at >= PRESENCE_TTL_MS) this.presence.delete(entryKey);
      }
    }
  }

  presenceOf(lineId: string, chatId: string): WhatsAppPresenceState | null {
    const entry = this.presence.get(`${lineId}\u0000${chatId}`);
    return entry && this.now() - entry.at < PRESENCE_TTL_MS ? entry.state : null;
  }

  /**
   * Estado informado por el worker. Un informe de una generación anterior (de antes de que un
   * admin volviera a vincular o desvincular) se ignora. Solo los cambios duraderos se guardan.
   */
  async reportState(
    id: string,
    report: WhatsAppLineStateReport,
    source: "worker" | "demo" = "worker",
  ): Promise<{ accepted: boolean }> {
    if (source === "worker") this.workerSeenAt = this.now();
    const line = await this.require(id);
    if (report.generation !== line.generation) return { accepted: false };
    const state = this.liveOf(id);
    state.status = report.status;
    if (report.qr) {
      state.qrDataUrl = await QRCode.toDataURL(report.qr, { margin: 1, width: 280, errorCorrectionLevel: "M" });
      state.qrAt = this.now();
    }
    if (report.pairingCode) {
      state.pairingCode = report.pairingCode;
      state.pairingCodeAt = this.now();
    }
    if (report.status === "connected") {
      delete state.qrDataUrl;
      delete state.pairingCode;
    }
    const at = new Date(this.now()).toISOString();
    const next: WhatsAppLine = { ...line, status: report.status, updatedAt: at };
    if (report.status === "connected") {
      const phoneChanged = report.phoneNumber && report.phoneNumber !== line.phoneNumber;
      if (report.phoneNumber) next.phoneNumber = report.phoneNumber;
      if (report.displayName) next.displayName = report.displayName.slice(0, 120);
      if (!line.linkedAt || phoneChanged || line.status !== "connected") next.linkedAt = at;
      next.lastConnectedAt = at;
      delete next.pairingPhone;
      delete next.lastError;
    }
    if (report.error) next.lastError = report.error.slice(0, 300);
    if (report.status === "unlinked" || report.status === "logged_out") delete next.pairingPhone;
    const durable = next.status !== line.status
      || next.phoneNumber !== line.phoneNumber
      || next.displayName !== line.displayName
      || next.lastError !== line.lastError;
    if (durable) await this.repository.saveWhatsAppLine(next);
    return { accepted: true };
  }

  private async require(id: string): Promise<WhatsAppLine> {
    const line = (await this.repository.listWhatsAppLines()).find((item) => item.id === id);
    if (!line) throw new WhatsAppLineError(404, "WHATSAPP_LINE_NOT_FOUND", "El número de WhatsApp no existe.");
    return line;
  }

  private pairingPhoneFor(method: LinkMethod, phoneNumber?: string): string | undefined {
    if (method !== "code") return undefined;
    const digits = phoneNumber ? digitsOnlyPhone(phoneNumber) : undefined;
    if (!digits) {
      throw new WhatsAppLineError(422, "WHATSAPP_PHONE_INVALID", "Para vincular con código escribe el número con código de país, por ejemplo +56 9 1234 5678.");
    }
    return digits;
  }

  private async startDemoLink(line: WhatsAppLine): Promise<void> {
    if (!this.options.demoMode) return;
    const state = this.liveOf(line.id);
    state.status = "pending_link";
    state.demoConnectAt = this.now() + DEMO_LINK_DELAY_MS;
    if (line.pairingPhone) {
      state.pairingCode = "DEMO-0000";
      state.pairingCodeAt = this.now();
    } else {
      state.qrDataUrl = await QRCode.toDataURL(DEMO_QR_PAYLOAD, { margin: 1, width: 280, errorCorrectionLevel: "M" });
      state.qrAt = this.now();
    }
  }

  /** En demo, un número en espera queda "conectado" unos segundos después de pedirlo. */
  private async advanceDemo(): Promise<void> {
    if (!this.options.demoMode) return;
    const now = this.now();
    for (const [id, state] of this.live) {
      if (!state.demoConnectAt || state.demoConnectAt > now) continue;
      delete state.demoConnectAt;
      const line = (await this.repository.listWhatsAppLines()).find((item) => item.id === id);
      if (!line || line.desiredState !== "linked") continue;
      await this.reportState(id, {
        generation: line.generation,
        status: "connected",
        displayName: "Número de demostración",
      }, "demo");
    }
  }
}
