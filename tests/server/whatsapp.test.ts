/**
 * WhatsApp (Baileys detrás de un adaptador): normalización de mensajes, ritmo de envío y el
 * recorrido completo por la API sin conexión real (el worker se simula con sus rutas internas).
 * Todos los números y nombres son ficticios.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { JsonRepository } from "../../server/repository.js";
import { normalizeBaileysMessage, personJid, phoneFromJid } from "../../server/whatsapp/messages.js";
import { SendPacer, reconnectDelayMs } from "../../server/whatsapp/pacing.js";
import { WhatsAppLineService } from "../../server/whatsapp/line-service.js";
import { WHATSAPP_WORKER_KEY_HEADER } from "../../server/whatsapp-routes.js";
import { IdentityError, type IdentityService } from "../../server/identity.js";
import type { ActorContext } from "../../server/types.js";
import { buildWhatsAppInteraction, historyMessageIds } from "../../server/whatsapp/ingest.js";
import { buildSacReport } from "../../server/sac-report.js";
import { createDemoStore } from "../../server/seed.js";

const directories: string[] = [];
const apps: SacFlowApp[] = [];
const API_KEY = "clave-api-de-prueba-whatsapp";
const WORKER_KEY = "clave-del-worker-de-whatsapp-para-pruebas-0001";
// Números ficticios (código de país 00 no existe).
const CUSTOMER_JID = "0011112222@s.whatsapp.net";
const SECOND_JID = "0033334444@s.whatsapp.net";

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-whatsapp-"));
  directories.push(directory);
  return directory;
}

describe("normalizeBaileysMessage", () => {
  const base = { key: { remoteJid: CUSTOMER_JID, id: "MSG1", fromMe: false }, messageTimestamp: 1_760_000_000, pushName: "Cliente Ficticio" };

  it("toma texto simple y extendido, con fecha y número", () => {
    const plain = normalizeBaileysMessage({ ...base, message: { conversation: "Hola" } });
    expect(plain).toMatchObject({
      messageId: "MSG1",
      chatId: CUSTOMER_JID,
      phoneNumber: "+0011112222",
      fromMe: false,
      pushName: "Cliente Ficticio",
      text: "Hola",
      kind: "text",
      timestamp: new Date(1_760_000_000_000).toISOString(),
    });
    const extended = normalizeBaileysMessage({ ...base, message: { extendedTextMessage: { text: "¿Tienen stock?" } } });
    expect(extended?.text).toBe("¿Tienen stock?");
  });

  it("describe adjuntos con su leyenda y desenvuelve mensajes temporales", () => {
    const image = normalizeBaileysMessage({ ...base, message: { imageMessage: { caption: "boleta" } } });
    expect(image).toMatchObject({ text: "[Imagen] boleta", kind: "attachment" });
    const audio = normalizeBaileysMessage({ ...base, message: { ephemeralMessage: { message: { audioMessage: {} } } } });
    expect(audio).toMatchObject({ text: "[Audio]", kind: "attachment" });
  });

  it("ignora grupos, estados, difusiones, reacciones y mensajes técnicos", () => {
    expect(normalizeBaileysMessage({ ...base, key: { ...base.key, remoteJid: "123-456@g.us" }, message: { conversation: "x" } })).toBeUndefined();
    expect(normalizeBaileysMessage({ ...base, key: { ...base.key, remoteJid: "status@broadcast" }, message: { conversation: "x" } })).toBeUndefined();
    expect(normalizeBaileysMessage({ ...base, key: { ...base.key, remoteJid: "1@newsletter" }, message: { conversation: "x" } })).toBeUndefined();
    expect(normalizeBaileysMessage({ ...base, message: { reactionMessage: { text: "👍" } } })).toBeUndefined();
    expect(normalizeBaileysMessage({ ...base, message: { protocolMessage: { type: 0 } } })).toBeUndefined();
    expect(normalizeBaileysMessage({ ...base, key: { ...base.key, id: "" }, message: { conversation: "x" } })).toBeUndefined();
  });

  it("prefiere el número cuando WhatsApp manda un identificador privado (LID)", () => {
    const message = normalizeBaileysMessage({
      ...base,
      key: { remoteJid: "987654321@lid", remoteJidAlt: "0011112222:3@s.whatsapp.net", id: "MSG2", fromMe: false },
      message: { conversation: "Hola" },
    });
    expect(message?.chatId).toBe(CUSTOMER_JID);
    expect(message?.phoneNumber).toBe("+0011112222");
  });

  it("marca los mensajes propios y no les pone nombre de perfil", () => {
    const own = normalizeBaileysMessage({ ...base, key: { ...base.key, fromMe: true }, message: { conversation: "Te ayudo" } });
    expect(own).toMatchObject({ fromMe: true });
    expect(own?.pushName).toBeUndefined();
  });

  it("normaliza JIDs y números", () => {
    expect(personJid("0011112222:12@s.whatsapp.net")).toBe(CUSTOMER_JID);
    expect(personJid("0011112222@c.us")).toBe(CUSTOMER_JID);
    expect(personJid("123@g.us")).toBeUndefined();
    expect(phoneFromJid("55@lid")).toBeUndefined();
  });
});

describe("SendPacer", () => {
  const config = {
    minGapMs: 4_000,
    maxGapMs: 12_000,
    maxPerMinute: 3,
    maxPerHour: 5,
    typingMsPerChar: 50,
    typingMinMs: 1_500,
    typingMaxMs: 8_000,
  };

  it("espera una pausa al azar entre el mínimo y el máximo", () => {
    const pacer = new SendPacer(config, () => 0.5);
    expect(pacer.isReady(0)).toBe(true);
    pacer.record(0);
    expect(pacer.isReady(7_999)).toBe(false);
    expect(pacer.readyAt(1_000)).toBe(8_000);
    expect(pacer.isReady(8_000)).toBe(true);
  });

  it("respeta los topes por minuto y por hora", () => {
    const pacer = new SendPacer({ ...config, minGapMs: 1_000, maxGapMs: 1_000 }, () => 0);
    pacer.record(0);
    pacer.record(1_000);
    pacer.record(2_000);
    expect(pacer.readyAt(3_000)).toBe(60_000);
    pacer.record(60_000);
    pacer.record(61_000);
    expect(pacer.readyAt(62_000)).toBe(3_600_000);
  });

  it("muestra 'escribiendo…' según el largo, dentro de los límites", () => {
    const pacer = new SendPacer(config, () => 0.5);
    expect(pacer.typingMs("ok")).toBe(1_500);
    expect(pacer.typingMs("x".repeat(100))).toBe(5_000);
    expect(pacer.typingMs("x".repeat(1_000))).toBe(8_000);
  });

  it("reintenta la conexión con esperas crecientes y acotadas", () => {
    expect(reconnectDelayMs(0, () => 0.5)).toBe(2_000);
    expect(reconnectDelayMs(3, () => 0.5)).toBe(16_000);
    expect(reconnectDelayMs(20, () => 0.5)).toBe(120_000);
  });
});

describe("WhatsAppLineService en demo", () => {
  it("muestra un QR de muestra y conecta solo, sin worker", async () => {
    const directory = await tempDir();
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    let now = 1_000_000;
    const service = new WhatsAppLineService(repository, { demoMode: true, now: () => now });
    const line = await service.create({ brandId: "brand-01", label: "Atención", method: "qr" }, "admin@demo.test");
    const [pending] = await service.listForAdmin();
    expect(pending).toMatchObject({ id: line.id, status: "pending_link", linkMethod: "qr" });
    expect(pending?.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    now += 9_000;
    const [connected] = await service.listForAdmin();
    expect(connected).toMatchObject({ status: "connected", displayName: "Número de demostración" });
    expect(connected?.qrDataUrl).toBeUndefined();
    const unlinked = await service.requestUnlink(line.id);
    expect(unlinked).toMatchObject({ desiredState: "unlinked", status: "unlinked" });
    await service.remove(line.id);
    expect(await service.listLines()).toEqual([]);
  });

  it("exige un número válido para vincular con código", async () => {
    const directory = await tempDir();
    const repository = new JsonRepository(path.join(directory, "store.json"));
    await repository.initialize();
    const service = new WhatsAppLineService(repository, { demoMode: true });
    await expect(service.create({ brandId: "brand-01", label: "Ventas", method: "code", phoneNumber: "abc" }, "admin"))
      .rejects.toMatchObject({ code: "WHATSAPP_PHONE_INVALID" });
    const line = await service.create({ brandId: "brand-01", label: "Ventas", method: "code", phoneNumber: "+00 1111 2222" }, "admin");
    expect(line.pairingPhone).toBe("0011112222");
    expect((await service.listForAdmin())[0]?.pairingCode).toBe("DEMO-0000");
  });
});

async function liveApp(
  extraEnv: Record<string, string> = {},
  identityFor?: (config: ReturnType<typeof loadConfig>) => IdentityService,
) {
  const directory = await tempDir();
  const config = loadConfig({
    METRICOOL_MODE: "live",
    METRICOOL_API_TOKEN: "token-de-prueba-nunca-registrado",
    // Mantiene activa la marca de ejemplo en live (si no, se retira por no tener referencia).
    METRICOOL_ACCOUNTS_JSON: JSON.stringify({ "account-01": { userId: "user-1", blogId: "blog-1" } }),
    SAC_FLOW_API_KEY: API_KEY,
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-credential-key-with-32-characters",
    // Metricool queda cerrado: WhatsApp se habilita por persona en la base, no con estas variables.
    SAC_FLOW_DISABLE_OUTBOUND_SENDS: "true",
    SAC_FLOW_ENABLE_MANUAL_REPLIES: "false",
    SAC_FLOW_WHATSAPP_WORKER_KEY: WORKER_KEY,
    ...extraEnv,
  }, directory);
  const app = await buildApp({ config, ...(identityFor ? { identity: identityFor(config) } : {}) });
  apps.push(app);
  const person = { "x-api-key": API_KEY };
  const worker = { [WHATSAPP_WORKER_KEY_HEADER]: WORKER_KEY };
  return { app, person, worker };
}

async function connectedLine(app: SacFlowApp, person: Record<string, string>, worker: Record<string, string>) {
  const created = await app.inject({
    method: "POST",
    url: "/api/whatsapp/lines",
    headers: person,
    payload: { brandId: "brand-01", label: "Atención", method: "qr" },
  });
  expect(created.statusCode).toBe(201);
  const lineId = created.json().meta.lineId as string;
  const workerLines = await app.inject({ method: "GET", url: "/api/internal/whatsapp/lines", headers: worker });
  expect(workerLines.statusCode).toBe(200);
  const generation = workerLines.json().data[0].generation as number;
  const qr = await app.inject({
    method: "POST",
    url: `/api/internal/whatsapp/lines/${lineId}/state`,
    headers: worker,
    payload: { generation, status: "pending_link", qr: "2@ficticio,qr,de,prueba" },
  });
  expect(qr.statusCode).toBe(200);
  const admin = await app.inject({ method: "GET", url: "/api/whatsapp/lines", headers: person });
  expect(admin.json().data.lines[0].qrDataUrl).toMatch(/^data:image\/png;base64,/);
  expect(admin.json().data.worker.online).toBe(true);
  const connected = await app.inject({
    method: "POST",
    url: `/api/internal/whatsapp/lines/${lineId}/state`,
    headers: worker,
    payload: { generation, status: "connected", phoneNumber: "+0099990000", displayName: "Marca Ficticia" },
  });
  expect(connected.json().data.accepted).toBe(true);
  return lineId;
}

function inbound(messageId: string, text: string, chatId = CUSTOMER_JID) {
  return {
    messageId,
    chatId,
    phoneNumber: `+${chatId.split("@")[0]}`,
    fromMe: false,
    timestamp: new Date().toISOString(),
    pushName: "Cliente Ficticio",
    text,
    kind: "text" as const,
  };
}

describe("historial antiguo de WhatsApp", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const message = (messageId: string, chatId: string, daysAgo: number, fromMe = false) => ({
    messageId, chatId, fromMe, timestamp: at(daysAgo), text: "Necesito ayuda con mi pedido", kind: "text" as const,
  });

  it("al vincular deja abierto solo el último mensaje reciente sin responder de cada chat", () => {
    const batch = [
      message("A1", CUSTOMER_JID, 40),
      message("A2", CUSTOMER_JID, 2), // último del chat, del cliente, reciente → caso
      message("B1", SECOND_JID, 3),
      message("B2", SECOND_JID, 1, true), // la marca ya respondió → todo historial
      message("C1", "0055556666@s.whatsapp.net", 30), // último, pero viejo → historial
    ];
    const history = historyMessageIds(batch, "link", now);
    expect([...history].sort()).toEqual(["A1", "B1", "B2", "C1"]);
    // "Cargar anteriores" trae lo previo a lo que ya hay: todo es historial.
    expect(historyMessageIds(batch, "on_demand", now).size).toBe(5);
  });

  it("el historial llega cerrado y no cuenta en el reporte mensual", () => {
    const store = createDemoStore(new Date(now));
    const brand = store.brands[0]!;
    const line = { id: "11111111-1111-4111-8111-111111111111", label: "Prueba" };
    const old = buildWhatsAppInteraction(message("H1", CUSTOMER_JID, 5), line, brand, { history: true });
    const fresh = buildWhatsAppInteraction(message("N1", SECOND_JID, 5), line, brand);
    expect(old).toMatchObject({ status: "resolved", statusReason: { code: "whatsapp_history" } });
    expect(old.metricoolRef?.whatsapp?.history).toBe(true);
    expect(fresh.status).toBe("new");
    const period = { from: at(10).slice(0, 10), to: at(0).slice(0, 10), label: "Prueba" };
    const withHistory = buildSacReport(brand, [old, fresh], period);
    const withoutHistory = buildSacReport(brand, [fresh], period);
    expect(withHistory.volumenBruto).toBe(withoutHistory.volumenBruto);
    expect(withHistory.volumenBruto).toBe(1);
  });
});

describe("WhatsApp por la API (worker simulado)", () => {
  it("rechaza al worker sin su clave y no abre esas rutas a la sesión de una persona", async () => {
    const { app, person } = await liveApp();
    const noKey = await app.inject({ method: "GET", url: "/api/internal/whatsapp/lines" });
    expect(noKey.statusCode).toBe(401);
    const withSiteKey = await app.inject({ method: "GET", url: "/api/internal/whatsapp/lines", headers: person });
    expect(withSiteKey.statusCode).toBe(401);
    const wrong = await app.inject({
      method: "GET",
      url: "/api/internal/whatsapp/lines",
      headers: { [WHATSAPP_WORKER_KEY_HEADER]: "x".repeat(WORKER_KEY.length) },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it("no expone las rutas del worker si el servidor no tiene su clave", async () => {
    const { app, worker } = await liveApp({ SAC_FLOW_WHATSAPP_WORKER_KEY: "" });
    const response = await app.inject({ method: "GET", url: "/api/internal/whatsapp/lines", headers: worker });
    expect(response.statusCode).toBe(404);
  });

  it("guarda los mensajes como DMs de WhatsApp sin duplicarlos y deja la respuesta en cola para el worker", async () => {
    const { app, person, worker } = await liveApp();
    const lineId = await connectedLine(app, person, worker);

    const first = await app.inject({
      method: "POST",
      url: `/api/internal/whatsapp/lines/${lineId}/messages`,
      headers: worker,
      payload: { messages: [inbound("WA-1", "Hola, ¿tienen despacho a regiones?")] },
    });
    expect(first.json().data).toMatchObject({ created: 1, duplicates: 0 });
    const again = await app.inject({
      method: "POST",
      url: `/api/internal/whatsapp/lines/${lineId}/messages`,
      headers: worker,
      payload: { messages: [inbound("WA-1", "Hola, ¿tienen despacho a regiones?")] },
    });
    expect(again.json().data).toMatchObject({ created: 0, duplicates: 1 });

    const list = await app.inject({ method: "GET", url: "/api/interactions?channel=whatsapp", headers: person });
    expect(list.statusCode).toBe(200);
    const row = list.json().data.find((item: { channel: string }) => item.channel === "whatsapp");
    expect(row).toBeTruthy();
    const detail = await app.inject({ method: "GET", url: `/api/interactions/${row.id}`, headers: person });
    const target = detail.json().data;

    // El envío automático no existe para WhatsApp.
    const automatic = await app.inject({
      method: "POST",
      url: `/api/interactions/${target.id}/reply`,
      headers: { ...person, "idempotency-key": "wa-auto-1" },
      payload: { text: "Hola", mode: "send", approvedByHuman: false, expectedVersion: target.version },
    });
    expect(automatic.statusCode).toBe(409);
    expect(automatic.json().error.code).toBe("WHATSAPP_HUMAN_ONLY");

    const sent = await app.inject({
      method: "POST",
      url: `/api/interactions/${target.id}/reply`,
      headers: { ...person, "idempotency-key": "wa-reply-1" },
      payload: { text: "¡Hola! Sí, despachamos a todo Chile.", mode: "send", approvedByHuman: true, expectedVersion: target.version },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().meta.delivery).toBe("queued");
    const deliveryId = sent.json().meta.deliveryId as string;

    // Reintento con la misma clave: no crea otra entrega.
    const replay = await app.inject({
      method: "POST",
      url: `/api/interactions/${target.id}/reply`,
      headers: { ...person, "idempotency-key": "wa-reply-1" },
      payload: { text: "¡Hola! Sí, despachamos a todo Chile.", mode: "send", approvedByHuman: true, expectedVersion: target.version },
    });
    expect(replay.json().meta).toMatchObject({ delivery: "queued", deliveryId });

    // Un número que no está listo no recibe la entrega.
    const otherLine = "00000000-0000-4000-8000-000000000000";
    const none = await app.inject({ method: "POST", url: "/api/internal/whatsapp/deliveries/claim", headers: worker, payload: { lineIds: [otherLine] } });
    expect(none.json().data).toBeNull();

    const claim = await app.inject({ method: "POST", url: "/api/internal/whatsapp/deliveries/claim", headers: worker, payload: { lineIds: [lineId] } });
    expect(claim.json().data).toMatchObject({
      deliveryId,
      lineId,
      chatId: CUSTOMER_JID,
      text: "¡Hola! Sí, despachamos a todo Chile.",
      replyToMessageId: "WA-1",
    });
    const twice = await app.inject({ method: "POST", url: "/api/internal/whatsapp/deliveries/claim", headers: worker, payload: { lineIds: [lineId] } });
    expect(twice.json().data).toBeNull();

    const result = await app.inject({
      method: "POST",
      url: `/api/internal/whatsapp/deliveries/${deliveryId}/result`,
      headers: worker,
      payload: { status: "sent", messageId: "WA-OUT-1" },
    });
    expect(result.json().data.status).toBe("sent");
    const after = await app.inject({ method: "GET", url: `/api/interactions/${target.id}`, headers: person });
    expect(after.json().data.status).toBe("replied");

    // El eco del mensaje enviado por wiwo.sac no vuelve como mensaje nuevo.
    const echo = await app.inject({
      method: "POST",
      url: `/api/internal/whatsapp/lines/${lineId}/messages`,
      headers: worker,
      payload: { messages: [{ ...inbound("WA-OUT-1", "¡Hola! Sí, despachamos a todo Chile."), fromMe: true }] },
    });
    expect(echo.json().data).toMatchObject({ created: 0, ignored: 1 });
  });

  it("WhatsApp se activa por persona en la base: activado por defecto y un admin principal lo apaga", async () => {
    const actors: Record<string, ActorContext> = {
      principal: { userId: "g:1", displayName: "Principal", tenantId: "wiwo", role: "admin", brandIds: "all", source: "google", email: "principal@demo.test" },
      agente: { userId: "g:3", displayName: "Agente", tenantId: "wiwo", role: "agent", brandIds: ["brand-01"], source: "google", email: "agente@demo.test" },
    };
    const { app, worker } = await liveApp({
      SAC_FLOW_AUTH_MODE: "google",
      GOOGLE_OAUTH_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "secreto-de-prueba",
      SAC_FLOW_AUTH_ADMIN_EMAILS: "principal@demo.test",
    }, (config) => ({
      config: config.auth,
      async resolveActor(cookie) {
        const actor = actors[cookie];
        if (!actor) throw new IdentityError(401, "SESSION_INVALID", "Sin sesión.");
        return actor;
      },
    }));
    const as = (who: string) => ({ cookie: `wiwo_nodes_session=${who}` });
    await app.sacFlow.repository.recordUserSignIn({ email: "agente@demo.test", name: "Agente", at: new Date().toISOString() });
    const lineId = await connectedLine(app, as("principal"), worker);
    await app.inject({
      method: "POST",
      url: `/api/internal/whatsapp/lines/${lineId}/messages`,
      headers: worker,
      payload: { messages: [inbound("WA-K1", "Hola")] },
    });
    const rows = (await app.inject({ method: "GET", url: "/api/interactions?pageSize=200", headers: as("agente") })).json().data as
      Array<{ id: string; channel: string; version: number }>;
    const whatsapp = rows.find((item) => item.channel === "whatsapp")!;
    const send = (key: string) => app.inject({
      method: "POST",
      url: `/api/interactions/${whatsapp.id}/reply`,
      headers: { ...as("agente"), "idempotency-key": key },
      payload: { text: "Hola, ¿en qué te ayudamos?", mode: "send", approvedByHuman: true, expectedVersion: whatsapp.version },
    });

    // Por defecto está activado.
    expect((await app.inject({ method: "GET", url: "/api/me", headers: as("agente") })).json().data.whatsappEnabled).toBe(true);
    const listing = await app.inject({ method: "GET", url: "/api/admin/users", headers: as("principal") });
    expect(listing.json().data.users.find((user: { email: string }) => user.email === "agente@demo.test").whatsappEnabled).toBe(true);

    // Un admin principal lo apaga: la persona no puede enviar por WhatsApp.
    const toggle = (enabled: boolean) => app.inject({
      method: "PUT",
      url: "/api/admin/users/whatsapp",
      headers: as("principal"),
      payload: { email: "agente@demo.test", enabled },
    });
    const off = await toggle(false);
    expect(off.statusCode).toBe(200);
    expect(off.json().data.user).toMatchObject({ whatsappEnabled: false, whatsappUpdatedBy: "Principal" });
    expect((await app.inject({ method: "GET", url: "/api/me", headers: as("agente") })).json().data.whatsappEnabled).toBe(false);
    const blocked = await send("wa-user-1");
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe("WHATSAPP_DISABLED_FOR_USER");
    // Solo un admin principal lo cambia.
    const byAgent = await app.inject({
      method: "PUT",
      url: "/api/admin/users/whatsapp",
      headers: as("agente"),
      payload: { email: "agente@demo.test", enabled: true },
    });
    expect(byAgent.statusCode).toBe(403);

    // Activado de nuevo, la respuesta queda en cola.
    expect((await toggle(true)).json().data.user.whatsappEnabled).toBe(true);
    const queued = await send("wa-user-2");
    expect(queued.statusCode).toBe(200);
    expect(queued.json().meta.delivery).toBe("queued");

    // WhatsApp habilitado no abre Metricool: sigue cerrado por sus propios interruptores.
    const { app: open, person: openPerson } = await liveApp();
    const metricool = (await open.inject({ method: "GET", url: "/api/interactions?pageSize=200", headers: openPerson })).json().data
      .find((item: { channel: string; direction: string; status: string; brandId: string }) =>
        item.channel !== "whatsapp" && item.direction === "inbound" && item.brandId === "brand-01" && ["new", "pending", "drafted"].includes(item.status));
    expect(metricool).toBeTruthy();
    const metricoolSend = await open.inject({
      method: "POST",
      url: `/api/interactions/${metricool.id}/reply`,
      headers: { ...openPerson, "idempotency-key": "mc-kill-1" },
      payload: { text: "Hola", mode: "send", approvedByHuman: true, expectedVersion: metricool.version },
    });
    expect(metricoolSend.statusCode).toBe(423);
    expect(metricoolSend.json().error.code).toBe("OUTBOUND_SENDS_DISABLED");
  });

  it("importa historial y atiende 'Cargar anteriores' una sola vez por chat", async () => {
    const { app, person, worker } = await liveApp();
    const lineId = await connectedLine(app, person, worker);
    const old = { ...inbound("OLD-1", "Mensaje de hace meses"), timestamp: new Date(Date.now() - 90 * 86_400_000).toISOString() };
    const recent = { ...inbound("OLD-2", "¿Me ayudan?"), timestamp: new Date(Date.now() - 86_400_000).toISOString() };
    const imported = await app.inject({
      method: "POST",
      url: `/api/internal/whatsapp/lines/${lineId}/messages`,
      headers: worker,
      payload: { messages: [old, recent], history: "link" },
    });
    expect(imported.json().data).toMatchObject({ created: 2, history: 1 });
    const rows = (await app.inject({ method: "GET", url: "/api/interactions?channel=whatsapp&pageSize=50", headers: person }))
      .json().data as Array<{ id: string; externalId: string; status: string }>;
    expect(rows.find((row) => row.externalId.endsWith(":OLD-1"))?.status).toBe("resolved");
    const open = rows.find((row) => row.externalId.endsWith(":OLD-2"))!;
    expect(open.status).not.toBe("resolved");

    const ask = () => app.inject({ method: "POST", url: "/api/whatsapp/history", headers: person, payload: { interactionId: open.id } });
    const first = await ask();
    expect(first.statusCode).toBe(200);
    expect(first.json().data.requested).toBe(true);
    expect((await ask()).statusCode).toBe(429);
    const queued = await app.inject({ method: "GET", url: "/api/internal/whatsapp/history-requests", headers: worker });
    expect(queued.json().data).toEqual([expect.objectContaining({
      lineId,
      chatId: CUSTOMER_JID,
      anchor: expect.objectContaining({ messageId: "OLD-1", fromMe: false }),
      count: 50,
    })]);
    const again = await app.inject({ method: "GET", url: "/api/internal/whatsapp/history-requests", headers: worker });
    expect(again.json().data).toEqual([]);
  });

  it("la opción de historial viaja al worker al vincular", async () => {
    const { app, person, worker } = await liveApp();
    const created = await app.inject({
      method: "POST",
      url: "/api/whatsapp/lines",
      headers: person,
      payload: { brandId: "brand-01", label: "Con historial", method: "qr", importHistory: true },
    });
    expect(created.statusCode).toBe(201);
    const lines = await app.inject({ method: "GET", url: "/api/internal/whatsapp/lines", headers: worker });
    expect(lines.json().data[0]).toMatchObject({ importHistory: true });
    expect(created.json().data.lines[0]).toMatchObject({ importHistory: true });
  });

  it("bloquea el mismo texto exacto a demasiados chats", async () => {
    const { app, person, worker } = await liveApp({ SAC_FLOW_WHATSAPP_REPEATED_TEXT_LIMIT: "1" });
    const lineId = await connectedLine(app, person, worker);
    await app.inject({
      method: "POST",
      url: `/api/internal/whatsapp/lines/${lineId}/messages`,
      headers: worker,
      payload: { messages: [inbound("WA-A", "Hola", CUSTOMER_JID), inbound("WA-B", "Hola", SECOND_JID)] },
    });
    const list = await app.inject({ method: "GET", url: "/api/interactions?channel=whatsapp", headers: person });
    const rows = list.json().data.filter((item: { channel: string }) => item.channel === "whatsapp");
    expect(rows).toHaveLength(2);
    const reply = async (id: string, key: string) => {
      const detail = (await app.inject({ method: "GET", url: `/api/interactions/${id}`, headers: person })).json().data;
      return app.inject({
        method: "POST",
        url: `/api/interactions/${detail.id}/reply`,
        headers: { ...person, "idempotency-key": key },
        payload: { text: "Gracias por escribirnos", mode: "send", approvedByHuman: true, expectedVersion: detail.version },
      });
    };
    expect((await reply(rows[0].id, "wa-rep-1")).statusCode).toBe(200);
    const blocked = await reply(rows[1].id, "wa-rep-2");
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe("WHATSAPP_REPEATED_TEXT");
  });

  it("solo un admin principal maneja los números; la bandeja ve el estado", async () => {
    const { app, person, worker } = await liveApp();
    await connectedLine(app, person, worker);
    const status = await app.inject({ method: "GET", url: "/api/whatsapp/status", headers: person });
    expect(status.json().data).toMatchObject({ mode: "live", lines: [{ brandId: "brand-01", status: "connected", phoneNumber: "+0099990000" }] });
    expect(status.json().data.lines[0].qrDataUrl).toBeUndefined();
  });

  it("con inicio de sesión, solo el admin principal ve y vincula números", async () => {
    const directory = await tempDir();
    const config = loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
      SAC_FLOW_AUTH_MODE: "google",
      GOOGLE_OAUTH_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "secreto-de-prueba",
      SAC_FLOW_AUTH_ADMIN_EMAILS: "principal@demo.test",
      SAC_FLOW_API_KEY: API_KEY,
    }, directory);
    const actors: Record<string, ActorContext> = {
      principal: { userId: "g:1", displayName: "Principal", tenantId: "wiwo", role: "admin", brandIds: "all", source: "google", email: "principal@demo.test" },
      asignado: { userId: "g:2", displayName: "Asignado", tenantId: "wiwo", role: "admin", brandIds: "all", source: "google", email: "asignado@demo.test" },
      agente: { userId: "g:3", displayName: "Agente", tenantId: "wiwo", role: "agent", brandIds: ["brand-01"], source: "google", email: "agente@demo.test" },
    };
    const identity: IdentityService = {
      config: config.auth,
      async resolveActor(cookie) {
        const actor = actors[cookie];
        if (!actor) throw new IdentityError(401, "SESSION_INVALID", "Sin sesión.");
        return actor;
      },
    };
    const app = await buildApp({ config, identity });
    apps.push(app);
    const as = (who: string) => ({ cookie: `wiwo_nodes_session=${who}` });

    const create = (who: string) => app.inject({
      method: "POST",
      url: "/api/whatsapp/lines",
      headers: as(who),
      payload: { brandId: "brand-01", label: "Atención", method: "qr" },
    });
    expect((await create("asignado")).json().error.code).toBe("MASTER_ADMIN_REQUIRED");
    expect((await create("agente")).statusCode).toBe(403);
    const created = await create("principal");
    expect(created.statusCode).toBe(201);
    expect(created.json().data.worker.mode).toBe("demo");
    expect((await app.inject({ method: "GET", url: "/api/whatsapp/lines", headers: as("agente") })).statusCode).toBe(403);

    // La bandeja ve el estado del número de sus marcas, sin QR.
    const status = await app.inject({ method: "GET", url: "/api/whatsapp/status", headers: as("agente") });
    expect(status.statusCode).toBe(200);
    expect(status.json().data.lines).toEqual([
      expect.objectContaining({ brandId: "brand-01", status: "pending_link" }),
    ]);
    expect(status.json().data.lines[0]).not.toHaveProperty("qrDataUrl");

    // En demo no hay worker: sus rutas no existen.
    const internal = await app.inject({ method: "GET", url: "/api/internal/whatsapp/lines", headers: { [WHATSAPP_WORKER_KEY_HEADER]: WORKER_KEY } });
    expect(internal.statusCode).toBe(404);
  });
});
