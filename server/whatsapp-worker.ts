/**
 * Worker de WhatsApp: un proceso aparte de la API que mantiene la sesión de cada número
 * (WhatsApp Web vía Baileys, detrás de `WhatsAppGateway`) y habla con la API solo por sus rutas
 * internas (`/api/internal/whatsapp/*`, clave SAC_FLOW_WHATSAPP_WORKER_KEY):
 *
 * - pregunta qué números deben estar vinculados y abre, reabre o cierra sus sesiones;
 * - informa el estado (QR, código, conectado, desvinculado) para la pantalla de admins;
 * - entrega los mensajes nuevos, que la API guarda por el repositorio (la bandeja en vivo los ve);
 * - toma de la cola las respuestas aprobadas por una persona y las envía como lo haría alguien:
 *   marca como leído, muestra "escribiendo…", respeta pausas y topes por número.
 *
 * Nunca envía nada por iniciativa propia ni registra textos, números o chats en los logs.
 * Corre un solo worker por servidor: dos procesos con la misma sesión se expulsan entre sí.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { atRestKey, decryptAtRest, encryptAtRest } from "./whatsapp/at-rest.js";
import { loadConfig } from "./config.js";
import { loadLocalEnvironment } from "./load-env.js";
import { BaileysGateway } from "./whatsapp/baileys-gateway.js";
import type { WhatsAppGateway, WhatsAppSession, WhatsAppSessionState } from "./whatsapp/gateway.js";
import type { MediaDescriptor, NormalizedWhatsAppMessage, WhatsAppMessageUpdate } from "./whatsapp/messages.js";
import type { WhatsAppMediaRef } from "./whatsapp/media.js";
import type { IncomingWhatsAppMessage } from "./whatsapp/gateway.js";
import { SendPacer } from "./whatsapp/pacing.js";
import { WHATSAPP_WORKER_KEY_HEADER } from "./whatsapp-routes.js";
import type { WhatsAppChatCommand, WhatsAppHistoryRequest, WorkerWhatsAppLine } from "./whatsapp/line-service.js";
import type { WhatsAppHistoryMode } from "./whatsapp/ingest.js";

loadLocalEnvironment();
const config = loadConfig();
if (config.demoMode) {
  throw new Error("El worker de WhatsApp no corre en modo demo: la demo simula los números en la API.");
}
if (!config.whatsapp.workerKey) {
  throw new Error("Configura SAC_FLOW_WHATSAPP_WORKER_KEY (32+ caracteres), la misma en la API y en el worker.");
}
const workerKey = config.whatsapp.workerKey;
const apiUrl = (process.env.SAC_FLOW_INTERNAL_API_URL || `http://127.0.0.1:${config.port}`).replace(/\/$/, "");
const healthPort = Math.max(1, Math.min(65_535, Number(process.env.SAC_FLOW_WHATSAPP_WORKER_HEALTH_PORT || 8_789)));
const LINES_POLL_MS = 3_000;
const DELIVERY_POLL_MS = 2_000;
/** Órdenes de chats abiertos (leído, escribiendo): deben sentirse al instante. */
const CHAT_COMMANDS_POLL_MS = 1_000;
/** Si la persona deja de escribir sin enviar, el "escribiendo…" se apaga solo. */
const TYPING_AUTO_PAUSE_MS = 6_000;
const MAX_BUFFERED_MESSAGES = 2_000;
/** El historial completo al vincular puede traer miles de mensajes: se entrega por tandas. */
const MAX_BUFFERED_HISTORY = 50_000;

function log(event: string, detail: Record<string, string | number | boolean | undefined> = {}): void {
  process.stdout.write(`${JSON.stringify({ level: "info", at: new Date().toISOString(), service: "whatsapp-worker", event, ...detail })}\n`);
}

const storageKey = atRestKey(config.automation.credentialEncryptionKey);
const gateway: WhatsAppGateway = new BaileysGateway(config.whatsapp.authDir, log, storageKey);

/**
 * Cola local durable de mensajes recibidos: cada lote se guarda cifrado en disco antes de
 * entregarlo a la API y se borra cuando la API lo aceptó. Si el worker o la API se caen, al
 * volver se reenvía; la API no duplica (id externo estable). Sus archivos no se descargan de
 * nuevo: un mensaje recuperado así queda con su etiqueta ("[Imagen]").
 */
type SpooledMessage = IncomingWhatsAppMessage & { spoolFile?: string };
const spoolPending = new Map<string, number>();

function spoolDir(lineId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) throw new Error("Id de número inválido.");
  return path.join(config.whatsapp.authDir, "_spool", lineId);
}

async function spoolMessages(lineId: string, messages: IncomingWhatsAppMessage[]): Promise<SpooledMessage[]> {
  try {
    const dir = spoolDir(lineId);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${Date.now()}-${randomUUID()}.enc`);
    const temporary = `${file}.tmp`;
    await writeFile(temporary, encryptAtRest(storageKey, Buffer.from(JSON.stringify(messages.map(toWire)))), { mode: 0o600 });
    await rename(temporary, file);
    spoolPending.set(file, messages.length);
    return messages.map((message) => ({ ...message, spoolFile: file }));
  } catch {
    // Sin disco disponible se sigue en memoria, como antes.
    return messages;
  }
}

async function releaseSpool(messages: SpooledMessage[]): Promise<void> {
  for (const message of messages) {
    if (!message.spoolFile) continue;
    const left = (spoolPending.get(message.spoolFile) ?? 1) - 1;
    if (left > 0) {
      spoolPending.set(message.spoolFile, left);
      continue;
    }
    spoolPending.delete(message.spoolFile);
    await unlink(message.spoolFile).catch(() => undefined);
  }
}

/** Mensajes que quedaron en disco sin entregar (worker o API caídos). */
async function recoverSpool(lineId: string): Promise<SpooledMessage[]> {
  const dir = spoolDir(lineId);
  const files = (await readdir(dir).catch(() => [] as string[])).filter((name) => name.endsWith(".enc")).sort();
  const recovered: SpooledMessage[] = [];
  for (const name of files) {
    const file = path.join(dir, name);
    try {
      const messages = JSON.parse(decryptAtRest(storageKey, await readFile(file)).toString("utf8")) as NormalizedWhatsAppMessage[];
      spoolPending.set(file, messages.length);
      recovered.push(...messages.map((message) => ({ ...message, spoolFile: file })));
    } catch {
      await unlink(file).catch(() => undefined);
    }
  }
  if (recovered.length) log("whatsapp_spool_recovered", { lineId, count: recovered.length });
  return recovered;
}

interface TrackedLine {
  generation: number;
  desiredState: WorkerWhatsAppLine["desiredState"];
  session?: WhatsAppSession;
  /** La sesión terminó sola (desvinculada, vencida, bloqueada): espera otra orden del admin. */
  ended: boolean;
  pacer: SendPacer;
  sending: boolean;
  inbox: SpooledMessage[];
  /** Historial antiguo por entregar, separado de lo nuevo para no demorarlo. */
  history: Array<{ message: NormalizedWhatsAppMessage; mode: WhatsAppHistoryMode }>;
  /** Tics, reacciones, ediciones y borrados por entregar. */
  updates: WhatsAppMessageUpdate[];
  pendingState?: WhatsAppSessionState & { generation: number };
}

const tracked = new Map<string, TrackedLine>();
let stopping = false;
let ready = false;
let lastLinesAt: string | undefined;
let lastError: string | undefined;

/** Sube a la API un archivo recibido y devuelve su referencia. */
async function uploadMedia(lineId: string, data: Buffer, descriptor: MediaDescriptor): Promise<WhatsAppMediaRef> {
  const response = await fetch(`${apiUrl}/api/internal/whatsapp/lines/${lineId}/media`, {
    method: "PUT",
    headers: {
      [WHATSAPP_WORKER_KEY_HEADER]: workerKey,
      "content-type": "application/octet-stream",
      "x-media-type": encodeURIComponent(descriptor.mimeType),
      ...(descriptor.fileName ? { "x-file-name": encodeURIComponent(descriptor.fileName) } : {}),
      ...(descriptor.kind === "sticker" ? { "x-media-sticker": "1" } : {}),
    },
    body: new Uint8Array(data),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => undefined) as { data?: WhatsAppMediaRef; error?: { code?: string } } | undefined;
  if (!response.ok || !payload?.data) throw new Error(`API ${response.status} ${payload?.error?.code ?? ""}`.trim());
  return payload.data;
}

/** Baja de la API el adjunto que hay que enviar. */
async function downloadAttachment(key: string): Promise<Buffer> {
  const response = await fetch(`${apiUrl}/api/internal/whatsapp/media/${key}`, {
    headers: { [WHATSAPP_WORKER_KEY_HEADER]: workerKey },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** El mensaje tal como lo espera la API: sin la función de descarga. */
function toWire(message: IncomingWhatsAppMessage): NormalizedWhatsAppMessage {
  const { pendingMedia: _pending, ...wire } = message;
  return wire;
}

/** Baja y sube los archivos de un lote; si uno falla, el mensaje sigue con su etiqueta. */
async function resolveMedia(lineId: string, messages: IncomingWhatsAppMessage[]): Promise<NormalizedWhatsAppMessage[]> {
  const resolved: NormalizedWhatsAppMessage[] = [];
  for (const message of messages) {
    if (!message.pendingMedia) {
      resolved.push(toWire(message));
      continue;
    }
    try {
      const data = await message.pendingMedia.download();
      const media = await uploadMedia(lineId, data, message.pendingMedia.descriptor);
      resolved.push({ ...toWire(message), media });
    } catch {
      log("whatsapp_media_skipped", { lineId });
      resolved.push(toWire(message));
    }
  }
  return resolved;
}

async function api<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/api/internal/whatsapp/${route}`, {
    method,
    headers: {
      [WHATSAPP_WORKER_KEY_HEADER]: workerKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => undefined) as { data?: T; error?: { code?: string } } | undefined;
  if (!response.ok) throw new Error(`API ${response.status} ${payload?.error?.code ?? ""}`.trim());
  return payload?.data as T;
}

function track(line: WorkerWhatsAppLine): TrackedLine {
  let entry = tracked.get(line.id);
  if (!entry) {
    entry = {
      generation: 0,
      desiredState: line.desiredState,
      ended: false,
      pacer: new SendPacer(config.whatsapp.pacing),
      sending: false,
      inbox: [],
      history: [],
      updates: [],
    };
    tracked.set(line.id, entry);
    // Lo que quedó en disco sin entregar antes de reiniciar vuelve primero a la cola.
    const created = entry;
    void recoverSpool(line.id).then((recovered) => {
      if (recovered.length) created.inbox.unshift(...recovered);
    });
  }
  return entry;
}

function queueState(lineId: string, entry: TrackedLine, state: WhatsAppSessionState): void {
  entry.pendingState = { ...state, generation: entry.generation };
  if (state.status === "logged_out" || state.status === "error") {
    entry.ended = true;
    entry.session = undefined;
  }
  void flushState(lineId, entry);
}

async function flushState(lineId: string, entry: TrackedLine): Promise<void> {
  const state = entry.pendingState;
  if (!state) return;
  try {
    await api("POST", `lines/${lineId}/state`, state);
    if (entry.pendingState === state) entry.pendingState = undefined;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "state";
  }
}

async function openSession(line: WorkerWhatsAppLine, entry: TrackedLine, fresh: boolean): Promise<void> {
  await entry.session?.close().catch(() => undefined);
  entry.session = undefined;
  if (fresh) await gateway.forget(line.id);
  entry.ended = false;
  const generation = entry.generation;
  entry.session = await gateway.open(
    {
      id: line.id,
      ...(line.pairingPhone ? { pairingPhone: line.pairingPhone } : {}),
      ...(line.importHistory ? { importHistory: true } : {}),
    },
    {
      onState: (state) => {
        if (entry.generation !== generation) return;
        queueState(line.id, entry, state);
      },
      onMessages: (messages, mode) => {
        if (entry.generation !== generation) return;
        if (mode) {
          entry.history.push(...messages.map((message) => ({ message, mode })));
          if (entry.history.length > MAX_BUFFERED_HISTORY) entry.history.splice(0, entry.history.length - MAX_BUFFERED_HISTORY);
          return;
        }
        void spoolMessages(line.id, messages).then((spooled) => {
          entry.inbox.push(...spooled);
          if (entry.inbox.length > MAX_BUFFERED_MESSAGES) entry.inbox.splice(0, entry.inbox.length - MAX_BUFFERED_MESSAGES);
        });
      },
      onPresence: (chatId, state) => {
        if (entry.generation !== generation) return;
        void api("POST", `lines/${line.id}/presence`, { chatId, state }).catch(() => undefined);
      },
      onUpdates: (updates) => {
        if (entry.generation !== generation) return;
        entry.updates.push(...updates);
        if (entry.updates.length > MAX_BUFFERED_MESSAGES) entry.updates.splice(0, entry.updates.length - MAX_BUFFERED_MESSAGES);
      },
    },
  );
}

/** Lleva cada número al estado que pidió el admin. */
async function reconcileLines(): Promise<void> {
  const lines = await api<WorkerWhatsAppLine[]>("GET", "lines");
  lastLinesAt = new Date().toISOString();
  const known = new Set(lines.map((line) => line.id));
  for (const [id, entry] of tracked) {
    if (known.has(id)) continue;
    await entry.session?.close().catch(() => undefined);
    tracked.delete(id);
  }
  for (const line of lines) {
    const firstSight = !tracked.has(line.id);
    const entry = track(line);
    const changed = entry.generation !== line.generation;
    entry.desiredState = line.desiredState;
    if (line.desiredState === "unlinked") {
      if (!changed) continue;
      entry.generation = line.generation;
      if (entry.session) await entry.session.logout().catch(() => undefined);
      else await gateway.forget(line.id);
      entry.session = undefined;
      entry.ended = true;
      queueState(line.id, entry, { status: "unlinked" });
      log("whatsapp_unlinked", { lineId: line.id });
      continue;
    }
    if (!changed && (entry.session || entry.ended)) continue;
    entry.generation = line.generation;
    if (firstSight && ["logged_out", "error", "unlinked"].includes(line.status)) {
      // Quedó desvinculado antes de reiniciar el worker: espera que un admin vuelva a vincularlo.
      entry.ended = true;
      continue;
    }
    // Al arrancar el worker se reutiliza la sesión guardada. Un pedido nuevo de vincular (otra
    // generación) parte desde cero para que salga un QR nuevo.
    await openSession(line, entry, !firstSight && changed);
    log("whatsapp_session_opened", { lineId: line.id, generation: line.generation });
  }
}

async function flushInbox(): Promise<void> {
  for (const [id, entry] of tracked) {
    void flushState(id, entry);
    while (entry.inbox.length) {
      // Lotes chicos: cada archivo se baja y se sube antes de entregar su mensaje.
      const batch = entry.inbox.slice(0, entry.inbox.some((message) => message.pendingMedia) ? 20 : 200);
      try {
        await api("POST", `lines/${id}/messages`, { messages: await resolveMedia(id, batch) });
        entry.inbox.splice(0, batch.length);
        await releaseSpool(batch);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "messages";
        break;
      }
    }
    // Tics, reacciones, ediciones y borrados: después de los mensajes que pueden afectar.
    if (!entry.inbox.length && entry.updates.length) {
      const batch = entry.updates.slice(0, 500);
      try {
        await api("POST", `lines/${id}/updates`, { updates: batch });
        entry.updates.splice(0, batch.length);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "updates";
      }
    }
    // Historial: una tanda por vuelta y por modo, para no frenar los mensajes nuevos. Sus archivos
    // no se bajan (quedan con su etiqueta): traer meses de fotos llenaría la base sin necesidad.
    if (!entry.inbox.length && entry.history.length) {
      const mode = entry.history[0]!.mode;
      const batch = entry.history.filter((item) => item.mode === mode).slice(0, 200);
      try {
        await api("POST", `lines/${id}/messages`, { messages: batch.map((item) => toWire(item.message)), history: mode });
        const sent = new Set(batch);
        entry.history = entry.history.filter((item) => !sent.has(item));
      } catch (error) {
        lastError = error instanceof Error ? error.message : "history";
      }
    }
  }
}

/** Pide al teléfono los mensajes anteriores de los chats donde alguien pulsó "Cargar anteriores". */
async function serveHistoryRequests(): Promise<void> {
  const requests = await api<WhatsAppHistoryRequest[]>("GET", "history-requests");
  for (const request of requests) {
    const session = tracked.get(request.lineId)?.session;
    if (!session?.isOpen()) continue;
    try {
      await session.fetchHistory(request.chatId, request.anchor, request.count);
      log("whatsapp_history_requested", { lineId: request.lineId, count: request.count });
    } catch {
      log("whatsapp_history_request_failed", { lineId: request.lineId });
    }
  }
}

const typingTimers = new Map<string, NodeJS.Timeout>();

/** Marca leídos, sigue la presencia y muestra "escribiendo…" en los chats abiertos en wiwo.sac. */
async function serveChatCommands(): Promise<void> {
  const commands = await api<WhatsAppChatCommand[]>("GET", "chat-commands");
  for (const command of commands) {
    const session = tracked.get(command.lineId)?.session;
    if (!session?.isOpen()) continue;
    try {
      if (command.kind === "read") await session.markRead(command.chatId, command.messageIds);
      else if (command.kind === "watch") await session.watchPresence(command.chatId);
      else {
        const key = `${command.lineId}\u0000${command.chatId}`;
        clearTimeout(typingTimers.get(key));
        typingTimers.delete(key);
        await session.sendTyping(command.chatId, command.state);
        if (command.state === "composing") {
          typingTimers.set(key, setTimeout(() => {
            typingTimers.delete(key);
            void session.sendTyping(command.chatId, "paused").catch(() => undefined);
          }, TYPING_AUTO_PAUSE_MS));
        }
      }
    } catch {
      log("whatsapp_chat_command_failed", { lineId: command.lineId, kind: command.kind });
    }
  }
}

async function chatCommandsLoop(): Promise<void> {
  while (!stopping) {
    try {
      if ([...tracked.values()].some((entry) => entry.session?.isOpen())) await serveChatCommands();
    } catch {
      // La API puede estar reiniciándose: se reintenta en el siguiente ciclo.
    }
    await delay(CHAT_COMMANDS_POLL_MS);
  }
}

interface ClaimedDelivery {
  deliveryId: string;
  lineId: string;
  chatId: string;
  text: string;
  replyToMessageId?: string;
  attachment?: WhatsAppMediaRef;
  quote?: { messageId: string; text: string };
}

/** Toma una respuesta de la cola para algún número listo y la envía con ritmo humano. */
async function dispatchOne(): Promise<void> {
  const now = Date.now();
  const readyLines = [...tracked.entries()]
    .filter(([, entry]) => entry.session?.isOpen() && !entry.sending && entry.pacer.isReady(now))
    .map(([id]) => id);
  if (!readyLines.length) return;
  const claimed = await api<ClaimedDelivery | null>("POST", "deliveries/claim", { lineIds: readyLines });
  if (!claimed) return;
  const entry = tracked.get(claimed.lineId);
  const session = entry?.session;
  if (!entry || !session) {
    await api("POST", `deliveries/${claimed.deliveryId}/result`, { status: "failed", errorCode: "WHATSAPP_NOT_CONNECTED" }).catch(() => undefined);
    return;
  }
  entry.sending = true;
  // La pausa corre desde que se toma el mensaje: aunque el envío falle, el número descansa.
  entry.pacer.record(Date.now(), { chatId: claimed.chatId, attachment: Boolean(claimed.attachment) });
  void (async () => {
    try {
      // El adjunto se baja antes de "escribir": si falla, no se tocó la conexión y es un fallo seguro.
      const attachment = claimed.attachment
        ? await downloadAttachment(claimed.attachment.key).catch(() => { throw new Error("WHATSAPP_NOT_CONNECTED"); })
        : undefined;
      const { messageId } = await session.send(claimed.chatId, {
        text: claimed.text,
        ...(attachment && claimed.attachment ? {
          attachment: {
            data: attachment,
            mimeType: claimed.attachment.mimeType,
            kind: claimed.attachment.kind,
            ...(claimed.attachment.fileName ? { fileName: claimed.attachment.fileName } : {}),
          },
        } : {}),
        ...(claimed.quote ? { quote: claimed.quote } : {}),
      }, {
        // Un archivo también "se prepara": nunca menos de lo mínimo aunque no lleve texto.
        typingMs: entry.pacer.typingMs(claimed.text),
        ...(claimed.replyToMessageId ? { markReadMessageId: claimed.replyToMessageId } : {}),
      });
      await api("POST", `deliveries/${claimed.deliveryId}/result`, { status: "sent", messageId });
      log("whatsapp_reply_sent", { lineId: claimed.lineId });
    } catch (error) {
      const notConnected = error instanceof Error && error.message === "WHATSAPP_NOT_CONNECTED";
      // Antes de escribir en la conexión es un fallo seguro; después no se sabe si llegó:
      // queda incierta y una persona la concilia (nunca se reenvía sola).
      await api("POST", `deliveries/${claimed.deliveryId}/result`, notConnected
        ? { status: "failed", errorCode: "WHATSAPP_NOT_CONNECTED" }
        : { status: "uncertain", errorCode: "WHATSAPP_SEND_UNCONFIRMED" }).catch(() => undefined);
      log("whatsapp_reply_failed", { lineId: claimed.lineId, uncertain: !notConnected });
    } finally {
      entry.sending = false;
    }
  })();
}

async function linesLoop(): Promise<void> {
  while (!stopping) {
    try {
      await reconcileLines();
      await serveHistoryRequests();
      ready = true;
      lastError = undefined;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "lines";
    }
    await delay(LINES_POLL_MS);
  }
}

async function deliveryLoop(): Promise<void> {
  while (!stopping) {
    try {
      await flushInbox();
      await dispatchOne();
    } catch (error) {
      lastError = error instanceof Error ? error.message : "dispatch";
    }
    await delay(DELIVERY_POLL_MS);
  }
}

const healthServer = createServer((request, response) => {
  if (request.method !== "GET" || request.url !== "/health") {
    response.writeHead(404).end();
    return;
  }
  const healthy = ready && !stopping;
  const lines = [...tracked.values()];
  response.writeHead(healthy ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({
    status: healthy ? "ready" : stopping ? "stopping" : "starting",
    service: "sac-flow-whatsapp-worker",
    gateway: gateway.name,
    lastLinesAt,
    lastError,
    lines: lines.length,
    connected: lines.filter((entry) => entry.session?.isOpen()).length,
    // Uso de los topes (sin datos de clientes): envíos de la última hora y del último día.
    usage: lines.map((entry) => entry.pacer.usage(Date.now())),
    pendingInbound: lines.reduce((total, entry) => total + entry.inbox.length, 0),
  }));
});

async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  log("whatsapp_worker_stopping", { signal });
  // Cerrar sin desvincular: al volver, el worker reutiliza las sesiones guardadas.
  await Promise.all([...tracked.values()].map((entry) => entry.session?.close().catch(() => undefined)));
  healthServer.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

healthServer.listen(healthPort, "127.0.0.1", () => log("whatsapp_worker_started", { healthPort, gateway: gateway.name }));
void linesLoop();
void deliveryLoop();
void chatCommandsLoop();
