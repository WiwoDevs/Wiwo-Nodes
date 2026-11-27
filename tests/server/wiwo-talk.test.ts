/**
 * WiWO Talk (HighLevel) con la API simulada: conexión con claves cifradas en la base, primera
 * lectura como historial, aviso del webhook, respuesta manual y rechazo explícito. Todos los
 * datos son ficticios (prefijo +00, ids inventados).
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { webhookTarget } from "../../server/wiwo-talk/service.js";
import { isWhatsAppMessage } from "../../server/wiwo-talk/client.js";

const directories: string[] = [];
const apps: SacFlowApp[] = [];
const API_KEY = "clave-api-de-prueba-wiwo-talk";
const TOKEN = "pit-00000000-test-0000-0000-ficticio000001";
const LOCATION = "LOCficticia0001";

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

interface FakeCall { method: string; url: URL; headers: Record<string, string>; body?: unknown }

/** HighLevel simulado: responde según la ruta y registra cada llamada. */
function fakeHighLevel() {
  const calls: FakeCall[] = [];
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const state = {
    sendStatus: 200,
    messages: [
      // Del más nuevo al más antiguo, como la API.
      { id: "msg-4", direction: "inbound", messageType: "TYPE_WHATSAPP", body: "¿Tienen el MG ZS en stock?", dateAdded: iso(60 * 60_000), contactId: "contact-1", conversationId: "conv-1" },
      { id: "msg-3", direction: "outbound", messageType: "TYPE_WHATSAPP", body: "¡Hola! Soy el asistente de MG.", dateAdded: iso(3 * 24 * 60 * 60_000), source: "workflow" },
      { id: "msg-2", direction: "inbound", messageType: "TYPE_WHATSAPP", body: "Hola", dateAdded: iso(3 * 24 * 60 * 60_000 + 60_000) },
      { id: "msg-sms", direction: "inbound", messageType: "TYPE_SMS", body: "SMS que no es WhatsApp", dateAdded: iso(4 * 24 * 60 * 60_000) },
    ] as Array<Record<string, unknown>>,
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([key, value]) => [key.toLowerCase(), value]));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
    const method = init?.method ?? "GET";
    calls.push({ method, url, headers, ...(body !== undefined ? { body } : {}) });
    if (headers.authorization !== `Bearer ${TOKEN}`) return json({ message: "Unauthorized" }, 401);
    if (url.pathname === `/locations/${LOCATION}`) return json({ location: { id: LOCATION, name: "Subcuenta ficticia" } });
    if (url.pathname === "/conversations/search") {
      return json({
        conversations: [{ id: "conv-1", contactId: "contact-1", fullName: "Cliente Ficticio", phone: "+0011112222", lastMessageDate: now - 60 * 60_000 }],
        total: 1,
      });
    }
    if (url.pathname === "/conversations/conv-1/messages") {
      return json({ messages: { messages: state.messages, nextPage: false, lastMessageId: "msg-2" } });
    }
    if (url.pathname === "/conversations/messages" && method === "POST") {
      if (state.sendStatus !== 200) return json({ message: "Outside 24h window" }, state.sendStatus);
      return json({ conversationId: "conv-1", messageId: "msg-out-1" });
    }
    if (url.pathname === "/conversations/conv-1" && method === "PUT") return json({ success: true });
    return json({ message: "Not found" }, 404);
  };
  return { calls, state, fetchImpl };
}

async function liveApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-wiwo-talk-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "live",
    METRICOOL_API_TOKEN: "token-de-prueba-nunca-registrado",
    METRICOOL_ACCOUNTS_JSON: JSON.stringify({ "account-01": { userId: "user-1", blogId: "blog-1" } }),
    SAC_FLOW_API_KEY: API_KEY,
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-credential-key-with-32-characters",
    SAC_FLOW_DISABLE_OUTBOUND_SENDS: "true",
    SAC_FLOW_ENABLE_MANUAL_REPLIES: "false",
    SAC_FLOW_WIWO_TALK_SYNC_MINUTES: "0",
  }, directory);
  const highLevel = fakeHighLevel();
  const app = await buildApp({ config, wiwoTalkFetch: highLevel.fetchImpl });
  apps.push(app);
  return { app, person: { "x-api-key": API_KEY }, highLevel, storeFile: path.join(directory, "store.json") };
}

async function connect(app: SacFlowApp, person: Record<string, string>) {
  const created = await app.inject({
    method: "POST",
    url: "/api/wiwo-talk/connections",
    headers: person,
    payload: { brandId: "brand-01", label: "WhatsApp MG", locationId: LOCATION, token: TOKEN },
  });
  expect(created.statusCode).toBe(201);
  return created.json().meta.connectionId as string;
}

describe("WiWO Talk (HighLevel simulado)", () => {
  it("guarda el token cifrado en la base y nunca lo devuelve", async () => {
    const { app, person, storeFile } = await liveApp();
    const id = await connect(app, person);
    const listed = await app.inject({ method: "GET", url: "/api/wiwo-talk/connections", headers: person });
    expect(listed.json().data.connections[0]).toMatchObject({
      id, brandId: "brand-01", locationId: LOCATION, locationName: "Subcuenta ficticia", tokenHint: TOKEN.slice(-4), status: "active",
      webhookPath: `/api/webhooks/wiwo-talk/${id}`,
    });
    expect(listed.body).not.toContain(TOKEN);
    expect(await readFile(storeFile, "utf8")).not.toContain(TOKEN);

    // Un token rechazado por HighLevel no se guarda.
    const bad = await app.inject({
      method: "POST",
      url: "/api/wiwo-talk/connections",
      headers: person,
      payload: { brandId: "brand-01", label: "Otra", locationId: "LOCficticia0002", token: "pit-token-que-no-sirve-000000" },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.code).toBe("WIWO_TALK_TOKEN_INVALID");
    // La misma subcuenta no se conecta dos veces.
    const twice = await app.inject({
      method: "POST",
      url: "/api/wiwo-talk/connections",
      headers: person,
      payload: { brandId: "brand-01", label: "Repetida", locationId: LOCATION, token: TOKEN },
    });
    expect(twice.statusCode).toBe(409);
  });

  it("la primera lectura llega como historial salvo el último mensaje reciente del cliente", async () => {
    const { app, person, highLevel } = await liveApp();
    const id = await connect(app, person);
    const synced = await app.inject({ method: "POST", url: `/api/wiwo-talk/connections/${id}/sync`, headers: person });
    expect(synced.statusCode).toBe(200);
    // Solo WhatsApp: el SMS de la misma conversación no entra.
    const rows = (await app.inject({ method: "GET", url: "/api/interactions?channel=whatsapp&pageSize=50", headers: person })).json().data as Array<{ id: string; text?: string; preview?: string; status: string; direction?: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const open = rows.filter((row) => !["resolved", "replied"].includes(row.status));
    expect(open).toHaveLength(1);
    const detail = (await app.inject({ method: "GET", url: `/api/interactions/${open[0]!.id}`, headers: person })).json().data;
    expect(detail.text).toBe("¿Tienen el MG ZS en stock?");
    expect(detail.customerName).toBe("Cliente Ficticio");
    expect(JSON.stringify(rows)).not.toContain("SMS que no es WhatsApp");
    // Cada llamada lleva el token y la cabecera Version.
    expect(highLevel.calls.every((call) => call.headers.authorization === `Bearer ${TOKEN}` && call.headers.version)).toBe(true);

    // Volver a leer no duplica nada.
    const before = rows.length;
    await app.inject({ method: "POST", url: `/api/wiwo-talk/connections/${id}/sync`, headers: person });
    const again = (await app.inject({ method: "GET", url: "/api/interactions?channel=whatsapp&pageSize=50", headers: person })).json().data;
    expect(again.length).toBe(before);
  });

  it("el webhook exige su clave y dispara la lectura del contacto", async () => {
    const { app, person, highLevel } = await liveApp();
    const id = await connect(app, person);
    const connection = (await app.inject({ method: "GET", url: "/api/wiwo-talk/connections", headers: person })).json().data.connections[0];
    // Sin sesión, con clave incorrecta: 404 como si no existiera.
    const wrong = await app.inject({ method: "POST", url: `/api/webhooks/wiwo-talk/${id}?key=incorrecta`, payload: { contact_id: "contact-1" } });
    expect(wrong.statusCode).toBe(404);
    const right = await app.inject({
      method: "POST",
      url: `/api/webhooks/wiwo-talk/${id}?key=${encodeURIComponent(connection.webhookSecret)}`,
      payload: { contact_id: "contact-1", message: { body: "x" } },
    });
    expect(right.statusCode).toBe(200);
    // La lectura corre después de una pausa corta (avisos seguidos se juntan).
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(highLevel.calls.some((call) => call.url.pathname === "/conversations/search" && call.url.searchParams.get("contactId") === "contact-1")).toBe(true);
    const rows = (await app.inject({ method: "GET", url: "/api/interactions?channel=whatsapp&pageSize=50", headers: person })).json().data;
    expect(rows.length).toBeGreaterThan(0);
    const after = (await app.inject({ method: "GET", url: "/api/wiwo-talk/connections", headers: person })).json().data.connections[0];
    expect(after.lastWebhookAt).toBeTruthy();
  });

  it("responde por HighLevel, registra el mensaje y respeta un rechazo explícito", async () => {
    const { app, person, highLevel } = await liveApp();
    const id = await connect(app, person);
    await app.inject({ method: "POST", url: `/api/wiwo-talk/connections/${id}/sync`, headers: person });
    const rows = (await app.inject({ method: "GET", url: "/api/interactions?channel=whatsapp&pageSize=50", headers: person })).json().data as Array<{ id: string; status: string; version: number }>;
    const open = rows.find((row) => !["resolved", "replied"].includes(row.status))!;

    // Adjuntos y citas no van por WiWO Talk.
    const withQuote = await app.inject({
      method: "POST",
      url: `/api/interactions/${open.id}/reply`,
      headers: { ...person, "idempotency-key": "talk-quote-1" },
      payload: { text: "Hola", mode: "send", approvedByHuman: true, expectedVersion: open.version, quote: true },
    });
    expect(withQuote.statusCode).toBe(422);

    highLevel.state.sendStatus = 422;
    const rejected = await app.inject({
      method: "POST",
      url: `/api/interactions/${open.id}/reply`,
      headers: { ...person, "idempotency-key": "talk-reply-rejected" },
      payload: { text: "Sí, tenemos stock.", mode: "send", approvedByHuman: true, expectedVersion: open.version },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json().error.code).toBe("WIWO_TALK_REJECTED");

    highLevel.state.sendStatus = 200;
    const current = (await app.inject({ method: "GET", url: `/api/interactions/${open.id}`, headers: person })).json().data;
    const sent = await app.inject({
      method: "POST",
      url: `/api/interactions/${open.id}/reply`,
      headers: { ...person, "idempotency-key": "talk-reply-ok" },
      payload: { text: "Sí, tenemos stock. ¿Te agendo una visita?", mode: "send", approvedByHuman: true, expectedVersion: current.version },
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect(sent.json().meta.delivery).toBe("sent");
    const post = highLevel.calls.filter((call) => call.method === "POST" && call.url.pathname === "/conversations/messages").at(-1);
    expect(post?.body).toEqual({ type: "WhatsApp", contactId: "contact-1", message: "Sí, tenemos stock. ¿Te agendo una visita?" });
    // El mensaje enviado queda en la conversación con quién lo envió.
    const conversation = (await app.inject({ method: "GET", url: `/api/interactions/${open.id}/conversation`, headers: person })).json();
    expect(JSON.stringify(conversation)).toContain("¿Te agendo una visita?");
    expect(JSON.stringify(conversation)).toContain("wiwo_talk");
  });

  it("con clientes marcados En SAC, solo se conectan esos", async () => {
    const { app, person } = await liveApp();
    const marcada = await app.inject({ method: "PUT", url: "/api/brands/brand-02/sac-usage", headers: person, payload: { channels: ["instagram"] } });
    expect(marcada.statusCode).toBe(200);
    const fuera = await app.inject({
      method: "POST",
      url: "/api/wiwo-talk/connections",
      headers: person,
      payload: { brandId: "brand-01", label: "Fuera de SAC", locationId: LOCATION, token: TOKEN },
    });
    expect(fuera.statusCode).toBe(422);
    expect(fuera.json().error.code).toBe("WIWO_TALK_BRAND_NOT_IN_SAC");
    const enSac = await app.inject({
      method: "POST",
      url: "/api/wiwo-talk/connections",
      headers: person,
      payload: { brandId: "brand-02", label: "Cliente En SAC", locationId: LOCATION, token: TOKEN },
    });
    expect(enSac.statusCode).toBe(201);
  });

  it("lee los ids del aviso con los nombres del workflow o de HighLevel", () => {
    expect(webhookTarget({ contact_id: "abc123XYZ" })).toEqual({ contactId: "abc123XYZ" });
    expect(webhookTarget({ contactId: "abc123XYZ", conversationId: "conv123456" })).toEqual({ contactId: "abc123XYZ", conversationId: "conv123456" });
    expect(webhookTarget({ contact: { id: "abc123XYZ" } })).toEqual({ contactId: "abc123XYZ" });
    expect(webhookTarget({ contact_id: "con espacios" })).toEqual({});
    expect(isWhatsAppMessage({ messageType: "TYPE_WHATSAPP" })).toBe(true);
    expect(isWhatsAppMessage({ messageType: "WhatsApp" })).toBe(true);
    expect(isWhatsAppMessage({ messageType: "TYPE_SMS" })).toBe(false);
  });
});
