/**
 * Adaptador Baileys (`@whiskeysockets/baileys`): conecta un número como dispositivo vinculado de
 * WhatsApp Web. No es una API oficial: WhatsApp puede bloquear el número y la librería puede
 * dejar de funcionar cuando WhatsApp cambia su protocolo (ver docs/WHATSAPP.md).
 *
 * Las credenciales de cada número se guardan en `<authDir>/<lineId>/` (fuera del repositorio,
 * carpeta 0700). Quien tenga esa carpeta puede leer y escribir como la marca.
 *
 * Nunca registra textos, números ni identificadores de chats.
 */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  proto,

  type AnyMessageContent,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { ILogger } from "@whiskeysockets/baileys/lib/Utils/logger.js";
import {
  mediaDescriptor,
  normalizeBaileysMessage,
  normalizeBaileysUpdate,
  phoneFromJid,
  receiptFromStatus,
  type BaileysLikeMessage,
  type WhatsAppMessageUpdate,
} from "./messages.js";
import { WHATSAPP_MEDIA_MAX_BYTES } from "./media.js";
import { useEncryptedFileAuthState } from "./encrypted-auth-state.js";
import { reconnectDelayMs } from "./pacing.js";
import type {
  IncomingWhatsAppMessage,
  OutgoingWhatsAppMessage,
  SendTextOptions,
  WhatsAppGateway,
  WhatsAppLineTarget,
  WhatsAppSession,
  WhatsAppSessionEvents,
} from "./gateway.js";

type LogFn = (event: string, detail?: Record<string, string | number | boolean | undefined>) => void;

/** Logger para Baileys que no escribe nada: sus registros incluyen JIDs y contenido. */
function silentLogger(): ILogger {
  const logger: ILogger = {
    level: "silent",
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
}

function disconnectCode(error: unknown): number | undefined {
  const output = (error as { output?: { statusCode?: unknown } } | undefined)?.output;
  return typeof output?.statusCode === "number" ? output.statusCode : undefined;
}

/** Ids de mensajes enviados por wiwo.sac: su eco no debe volver a la bandeja como mensaje nuevo. */
class RecentIds {
  private readonly ids = new Map<string, WAMessage["message"]>();
  constructor(private readonly max = 500) {}
  add(id: string, message: WAMessage["message"]): void {
    this.ids.set(id, message);
    while (this.ids.size > this.max) this.ids.delete(this.ids.keys().next().value!);
  }
  has(id: string): boolean {
    return this.ids.has(id);
  }
  get(id: string): WAMessage["message"] | undefined {
    return this.ids.get(id);
  }
}

export class BaileysGateway implements WhatsAppGateway {
  readonly name = "baileys";

  /** `atRestKey`: clave para cifrar la sesión en disco (ver at-rest.ts). */
  constructor(private readonly authDir: string, private readonly log: LogFn, private readonly atRestKey: Buffer) {}

  private dirFor(lineId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(lineId)) throw new Error("Id de número inválido.");
    return path.join(this.authDir, lineId);
  }

  async forget(lineId: string): Promise<void> {
    await rm(this.dirFor(lineId), { recursive: true, force: true });
  }

  async open(line: WhatsAppLineTarget, events: WhatsAppSessionEvents): Promise<WhatsAppSession> {
    const dir = this.dirFor(line.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const sent = new RecentIds();
    let socket: WASocket | undefined;
    let open = false;
    let stopped = false;
    let everOpened = false;
    let attempt = 0;
    let pairingRequested = false;
    // Si las credenciales ya estaban registradas, un corte nunca se confunde con un QR vencido.
    let registeredAtConnect = false;
    const versionInfo = await fetchLatestBaileysVersion().catch(() => undefined);

    const connect = async (): Promise<void> => {
      if (stopped) return;
      const { state, saveCreds } = await useEncryptedFileAuthState(dir, this.atRestKey);
      const registered = Boolean(state.creds.registered);
      registeredAtConnect = registered;
      events.onState({ status: registered ? "connecting" : "pending_link" });
      const current = makeWASocket({
        auth: state,
        ...(versionInfo?.version ? { version: versionInfo.version } : {}),
        // Se identifica como lo que es: aparece como "wiwo.sac" en Dispositivos vinculados.
        browser: Browsers.appropriate("wiwo.sac"),
        logger: silentLogger(),
        // No aparecer "en línea" todo el día. La sincronización de historial queda como en
        // WhatsApp Web (Baileys la necesita para aprender LID ↔ número); wiwo.sac decide abajo
        // qué guarda. El historial completo solo se pide si el admin lo eligió al vincular.
        markOnlineOnConnect: false,
        syncFullHistory: line.importHistory === true,
        generateHighQualityLinkPreview: false,
        getMessage: async (key) => (key.id ? sent.get(key.id) ?? undefined : undefined),
      });
      socket = current;
      current.ev.on("creds.update", saveCreds);

      current.ev.on("connection.update", (update) => {
        if (socket !== current) return;
        if (update.qr && !registered) {
          if (line.pairingPhone && !pairingRequested) {
            pairingRequested = true;
            current.requestPairingCode(line.pairingPhone)
              .then((code) => events.onState({ status: "pending_link", pairingCode: code }))
              .catch(() => events.onState({ status: "error", error: "WhatsApp no entregó el código de vinculación. Vuelve a intentarlo o usa el QR." }));
          } else if (!line.pairingPhone) {
            events.onState({ status: "pending_link", qr: update.qr });
          }
        }
        if (update.connection === "open") {
          open = true;
          everOpened = true;
          attempt = 0;
          const userJid = current.user?.id ? jidNormalizedUser(current.user.id) : undefined;
          events.onState({
            status: "connected",
            phoneNumber: phoneFromJid(userJid),
            displayName: current.user?.name || current.user?.verifiedName || undefined,
          });
          this.log("whatsapp_connected", { lineId: line.id });
        }
        if (update.connection === "close") {
          open = false;
          const code = disconnectCode(update.lastDisconnect?.error);
          this.log("whatsapp_connection_closed", { lineId: line.id, code });
          void handleClose(code);
        }
      });

      /**
       * Con identificador privado (LID) y sin el número al lado, se busca el número en el mapa
       * del lote o en el que guarda Baileys, para que la persona no quede partida en dos chats.
       */
      const withPhoneAlt = async (raw: BaileysLikeMessage, pnByLid?: Map<string, string>): Promise<BaileysLikeMessage> => {
        const remote = raw.key?.remoteJid;
        if (!raw.key || !remote?.endsWith("@lid") || raw.key.remoteJidAlt) return raw;
        const lid = jidNormalizedUser(remote);
        const pn = pnByLid?.get(remote) ?? pnByLid?.get(lid)
          ?? await current.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
        return pn ? { ...raw, key: { ...raw.key, remoteJidAlt: pn } } : raw;
      };

      current.ev.on("messaging-history.set", async ({ messages, syncType, lidPnMappings }) => {
        if (socket !== current) return;
        // "Cargar anteriores" siempre se guarda; el historial al vincular, solo si se pidió.
        const mode = syncType === proto.HistorySync.HistorySyncType.ON_DEMAND
          ? "on_demand" as const
          : line.importHistory ? "link" as const : undefined;
        // Solo tipo y cantidades: nunca contenido ni chats.
        this.log("whatsapp_history_event", { lineId: line.id, syncType: syncType ?? -1, received: messages.length, stored: Boolean(mode) });
        if (!mode || !messages.length) return;
        const pnByLid = new Map((lidPnMappings ?? []).map((mapping) => [mapping.lid, mapping.pn]));
        const normalized = (await Promise.all(messages.map(async (message) =>
          normalizeBaileysMessage(await withPhoneAlt(message as unknown as BaileysLikeMessage, pnByLid)))))
          .filter((message): message is NonNullable<typeof message> => Boolean(message));
        if (normalized.length) events.onMessages(normalized, mode);
        this.log("whatsapp_history_received", { lineId: line.id, mode, count: normalized.length });
      });

      /** Mensaje normalizado y, si trae un archivo aceptado y no muy grande, cómo bajarlo. */
      const incoming = async (message: WAMessage): Promise<IncomingWhatsAppMessage | undefined> => {
        const normalized = normalizeBaileysMessage(await withPhoneAlt(message as unknown as BaileysLikeMessage));
        if (!normalized) return undefined;
        const descriptor = mediaDescriptor(message.message as Record<string, unknown> | undefined);
        if (!descriptor || (descriptor.declaredSize ?? 0) > WHATSAPP_MEDIA_MAX_BYTES) return normalized;
        return {
          ...normalized,
          pendingMedia: {
            descriptor,
            download: async () => {
              const data = await downloadMediaMessage(message, "buffer", {}, {
                logger: silentLogger(),
                reuploadRequest: current.updateMediaMessage,
              });
              if (data.length > WHATSAPP_MEDIA_MAX_BYTES) throw new Error("WHATSAPP_MEDIA_TOO_LARGE");
              return data;
            },
          },
        };
      };

      current.ev.on("messages.upsert", async ({ messages, type }) => {
        if (socket !== current || (type !== "notify" && type !== "append")) return;
        const fresh = messages.filter((message) => !(message.key?.fromMe && message.key.id && sent.has(message.key.id)));
        // Reacciones, ediciones y borrados llegan como mensajes, pero cambian uno anterior.
        const updates: WhatsAppMessageUpdate[] = [];
        const plain: WAMessage[] = [];
        for (const message of fresh) {
          const update = normalizeBaileysUpdate(message as unknown as BaileysLikeMessage);
          if (update) updates.push(update);
          else plain.push(message);
        }
        if (updates.length) events.onUpdates(updates);
        const normalized = (await Promise.all(plain.map(incoming)))
          .filter((message): message is IncomingWhatsAppMessage => Boolean(message));
        if (normalized.length) events.onMessages(normalized);
      });

      // El cliente escribe o graba en un chat abierto en wiwo.sac. WhatsApp puede nombrar el chat
      // por su LID: se traduce al número, que es como wiwo.sac guarda el chat.
      current.ev.on("presence.update", async ({ id, presences }) => {
        if (socket !== current || !events.onPresence || !id || id.endsWith("@g.us")) return;
        const states = Object.values(presences ?? {}).map((entry) => entry?.lastKnownPresence);
        const state = states.includes("recording") ? "recording" as const
          : states.includes("composing") ? "composing" as const
            : "paused" as const;
        let chatId = jidNormalizedUser(id);
        if (chatId.endsWith("@lid")) {
          const pn = await current.signalRepository.lidMapping.getPNForLID(chatId).catch(() => null);
          if (pn) chatId = jidNormalizedUser(pn);
        }
        events.onPresence(chatId, state);
      });

      // Tics de los mensajes que envió la cuenta: entregado, leído, reproducido.
      current.ev.on("messages.update", (changes) => {
        if (socket !== current) return;
        const at = new Date().toISOString();
        const receipts = changes.flatMap((change): WhatsAppMessageUpdate[] => {
          const status = receiptFromStatus(change.update?.status);
          const messageId = change.key?.id;
          return change.key?.fromMe && status && messageId ? [{ type: "receipt", messageId, status, at }] : [];
        });
        if (receipts.length) events.onUpdates(receipts);
      });
    };

    const stopWith = async (status: "logged_out" | "error", error: string, wipe: boolean) => {
      stopped = true;
      if (wipe) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      events.onState({ status, error });
    };

    const handleClose = async (code: number | undefined): Promise<void> => {
      if (stopped) return;
      if (code === DisconnectReason.loggedOut) {
        // Se cerró desde el teléfono (Dispositivos vinculados) o WhatsApp expulsó la sesión.
        await stopWith("logged_out", "La sesión se cerró desde el teléfono o WhatsApp la expulsó. Vuelve a vincular el número.", true);
        return;
      }
      if (code === DisconnectReason.forbidden) {
        await stopWith("error", "WhatsApp rechazó la conexión de este número (posible bloqueo). Revisa el teléfono antes de volver a vincular.", false);
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        await stopWith("error", "Otra conexión de wiwo.sac tomó este número. Deja un solo worker de WhatsApp encendido.", false);
        return;
      }
      if (code === DisconnectReason.badSession) {
        // No se borra aquí: volver a vincular parte desde cero de todos modos.
        await stopWith("error", "La sesión guardada quedó inválida. Vuelve a vincular el número.", false);
        return;
      }
      if (!everOpened && !registeredAtConnect && code === DisconnectReason.timedOut) {
        // WhatsApp deja de generar QR tras varios minutos sin escanear: se pide de nuevo a mano.
        await stopWith("error", "El QR o el código vencieron sin usarse. Vuelve a pedir la vinculación.", true);
        return;
      }
      if (code === DisconnectReason.restartRequired) {
        // Normal justo después de escanear el QR: WhatsApp pide reconectar con las credenciales nuevas.
        await connect();
        return;
      }
      events.onState({ status: "disconnected" });
      const wait = reconnectDelayMs(attempt);
      attempt += 1;
      await delay(wait);
      await connect();
    };

    await connect();

    return {
      isOpen: () => open && !stopped,
      send: async (chatId: string, outgoing: OutgoingWhatsAppMessage, options: SendTextOptions) => {
        const current = socket;
        if (!current || !open || stopped) throw new Error("WHATSAPP_NOT_CONNECTED");
        if (options.markReadMessageId) {
          await current.readMessages([{ remoteJid: chatId, id: options.markReadMessageId, fromMe: false }]).catch(() => undefined);
        }
        const attachment = outgoing.attachment;
        // Un audio se "graba"; lo demás se "escribe".
        const presence = attachment?.kind === "audio" ? "recording" : "composing";
        await current.presenceSubscribe(chatId).catch(() => undefined);
        await current.sendPresenceUpdate(presence, chatId).catch(() => undefined);
        await delay(options.typingMs);
        await current.sendPresenceUpdate("paused", chatId).catch(() => undefined);
        const quoted = outgoing.quote
          ? { quoted: { key: { remoteJid: chatId, id: outgoing.quote.messageId, fromMe: false }, message: { conversation: outgoing.quote.text } } as WAMessage }
          : {};
        const caption = outgoing.text || undefined;
        const content: AnyMessageContent = !attachment
          ? { text: outgoing.text }
          : attachment.kind === "image"
            ? { image: attachment.data, mimetype: attachment.mimeType, ...(caption ? { caption } : {}) }
            : attachment.kind === "video"
              ? { video: attachment.data, mimetype: attachment.mimeType, ...(caption ? { caption } : {}) }
              : attachment.kind === "audio"
                ? { audio: attachment.data, mimetype: attachment.mimeType, ptt: false }
                : attachment.kind === "sticker"
                  ? { sticker: attachment.data }
                  : { document: attachment.data, mimetype: attachment.mimeType, fileName: attachment.fileName ?? "archivo", ...(caption ? { caption } : {}) };
        const result = await current.sendMessage(chatId, content, quoted);
        const messageId = result?.key?.id;
        if (!messageId) throw new Error("WHATSAPP_NO_MESSAGE_ID");
        sent.add(messageId, result.message);
        // Audio y sticker no llevan leyenda: el texto sale aparte, después de una pausa breve.
        if (attachment && (attachment.kind === "audio" || attachment.kind === "sticker") && outgoing.text) {
          await delay(1_500);
          const followUp = await current.sendMessage(chatId, { text: outgoing.text });
          if (followUp?.key?.id) sent.add(followUp.key.id, followUp.message);
        }
        return { messageId };
      },
      fetchHistory: async (chatId: string, anchor, count: number) => {
        const current = socket;
        if (!current || !open || stopped) throw new Error("WHATSAPP_NOT_CONNECTED");
        // El teléfono identifica los chats por su LID: con el número guardado se traduce, si se conoce.
        let chatJid = chatId;
        if (chatId.endsWith("@s.whatsapp.net")) {
          const lid = await current.signalRepository.lidMapping.getLIDForPN(chatId).catch(() => null);
          if (lid) chatJid = jidNormalizedUser(lid);
        }
        this.log("whatsapp_history_fetch", { lineId: line.id, addressing: chatJid.endsWith("@lid") ? "lid" : "pn" });
        await current.fetchMessageHistory(
          count,
          { remoteJid: chatJid, id: anchor.messageId, fromMe: anchor.fromMe },
          Date.parse(anchor.timestamp),
        );
      },
      markRead: async (chatId: string, messageIds: string[]) => {
        const current = socket;
        if (!current || !open || stopped || !messageIds.length) return;
        await current.readMessages(messageIds.map((id) => ({ remoteJid: chatId, id, fromMe: false })));
      },
      watchPresence: async (chatId: string) => {
        const current = socket;
        if (!current || !open || stopped) return;
        await current.presenceSubscribe(chatId).catch(() => undefined);
        if (chatId.endsWith("@s.whatsapp.net")) {
          const lid = await current.signalRepository.lidMapping.getLIDForPN(chatId).catch(() => null);
          if (lid) await current.presenceSubscribe(jidNormalizedUser(lid)).catch(() => undefined);
        }
      },
      sendTyping: async (chatId: string, state: "composing" | "paused") => {
        const current = socket;
        if (!current || !open || stopped) return;
        await current.sendPresenceUpdate(state, chatId);
      },
      close: async () => {
        stopped = true;
        open = false;
        socket?.end(undefined);
      },
      logout: async () => {
        stopped = true;
        open = false;
        await socket?.logout().catch(() => undefined);
        socket?.end(undefined);
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      },
    };
  }
}
