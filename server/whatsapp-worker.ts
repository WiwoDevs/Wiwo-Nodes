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
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { loadConfig } from "./config.js";
import { loadLocalEnvironment } from "./load-env.js";
import { BaileysGateway } from "./whatsapp/baileys-gateway.js";
import type { WhatsAppGateway, WhatsAppSession, WhatsAppSessionState } from "./whatsapp/gateway.js";
import type { NormalizedWhatsAppMessage } from "./whatsapp/messages.js";
import { SendPacer } from "./whatsapp/pacing.js";
import { WHATSAPP_WORKER_KEY_HEADER } from "./whatsapp-routes.js";
import type { WhatsAppHistoryRequest, WorkerWhatsAppLine } from "./whatsapp/line-service.js";
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
const MAX_BUFFERED_MESSAGES = 2_000;
/** El historial completo al vincular puede traer miles de mensajes: se entrega por tandas. */
const MAX_BUFFERED_HISTORY = 50_000;

function log(event: string, detail: Record<string, string | number | boolean | undefined> = {}): void {
  process.stdout.write(`${JSON.stringify({ level: "info", at: new Date().toISOString(), service: "whatsapp-worker", event, ...detail })}\n`);
}

const gateway: WhatsAppGateway = new BaileysGateway(config.whatsapp.authDir, log);

interface TrackedLine {
  generation: number;
  desiredState: WorkerWhatsAppLine["desiredState"];
  session?: WhatsAppSession;
  /** La sesión terminó sola (desvinculada, vencida, bloqueada): espera otra orden del admin. */
  ended: boolean;
  pacer: SendPacer;
  sending: boolean;
  inbox: NormalizedWhatsAppMessage[];
  /** Historial antiguo por entregar, separado de lo nuevo para no demorarlo. */
  history: Array<{ message: NormalizedWhatsAppMessage; mode: WhatsAppHistoryMode }>;
  pendingState?: WhatsAppSessionState & { generation: number };
}

const tracked = new Map<string, TrackedLine>();
let stopping = false;
let ready = false;
let lastLinesAt: string | undefined;
let lastError: string | undefined;

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
    };
    tracked.set(line.id, entry);
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
        entry.inbox.push(...messages);
        if (entry.inbox.length > MAX_BUFFERED_MESSAGES) entry.inbox.splice(0, entry.inbox.length - MAX_BUFFERED_MESSAGES);
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
      const batch = entry.inbox.slice(0, 200);
      try {
        await api("POST", `lines/${id}/messages`, { messages: batch });
        entry.inbox.splice(0, batch.length);
      } catch (error) {
        lastError = error instanceof Error ? error.message : "messages";
        break;
      }
    }
    // Historial: una tanda por vuelta y por modo, para no frenar los mensajes nuevos.
    if (!entry.inbox.length && entry.history.length) {
      const mode = entry.history[0]!.mode;
      const batch = entry.history.filter((item) => item.mode === mode).slice(0, 200);
      try {
        await api("POST", `lines/${id}/messages`, { messages: batch.map((item) => item.message), history: mode });
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

interface ClaimedDelivery {
  deliveryId: string;
  lineId: string;
  chatId: string;
  text: string;
  replyToMessageId?: string;
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
  entry.pacer.record(Date.now());
  void (async () => {
    try {
      const { messageId } = await session.sendText(claimed.chatId, claimed.text, {
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
