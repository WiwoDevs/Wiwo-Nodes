/**
 * Marca «En SAC» de Clientes (precarga por nombre y red, edición solo del admin principal) y el
 * conteo de mensajes recibidos del tablero de Clientes.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import type { GoogleOAuthClient } from "../../server/google-auth.js";
import { messageVolumeRows, normalizeAccountName, planSacUsageForNewAccounts, planSacUsageSeed, shouldSeedSacUsage } from "../../server/sac-usage.js";
import type { Brand, Channel, Interaction } from "../../server/types.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function brand(id: string, name: string, handle: string, channels: Channel[], active = true): Brand {
  return {
    id,
    name,
    color: "#4242FF",
    active,
    account: { id: `account-${id}`, brandId: id, name, handle, channels, active },
  };
}

describe("precarga de la marca En SAC", () => {
  it("normaliza nombres y usuarios", () => {
    expect(normalizeAccountName("COLBÚN")).toBe("colbun");
    expect(normalizeAccountName("@colbun-clientes")).toBe("colbunclientes");
    expect(normalizeAccountName("Fila cl")).toBe("filacl");
  });

  it("calza por nombre o usuario y red, y reporta lo que no calza en vez de inventarlo", () => {
    const plan = planSacUsageSeed([
      brand("b1", "COLBÚN", "@energiacolbun", ["instagram", "facebook", "x", "tiktok", "youtube", "linkedin"]),
      brand("b2", "Colbún Clientes", "@colbun-clientes", ["linkedin"]),
      brand("b3", "ankerchile", "@ankerchile", ["instagram", "facebook", "tiktok", "youtube"]),
      brand("b4", "Truecaller Espanol", "@truecaller.co", ["instagram", "facebook"]),
      brand("b5", "Primeros Pueblos", "@primerospueblos", ["instagram", "facebook"]),
      brand("b6", "Vans Colombia", "@vanscolombia", ["instagram", "facebook"], false),
      brand("b7", "Otra Marca", "@otra", ["instagram"]),
    ]);
    const byBrand = Object.fromEntries(plan.matches.map((match) => [match.brandId, match.channels.sort()]));
    expect(byBrand).toEqual({
      b1: ["facebook", "instagram", "linkedin", "tiktok", "x", "youtube"],
      b2: ["linkedin"],
      b3: ["facebook", "instagram"],
      // El TikTok de Truecaller queda marcado aunque aún no esté conectado (pendiente).
      b4: ["facebook", "instagram", "tiktok"],
      b5: ["instagram"],
    });
    expect(plan.unmatched).toContainEqual({ cliente: "Truecaller", redes: ["tiktok"], motivo: "red_no_conectada" });
    expect(plan.unmatched).toContainEqual({ cliente: "Pichara", redes: ["tiktok"], motivo: "sin_cuenta" });
    // Los clientes ocultos no se marcan.
    expect(plan.unmatched).toContainEqual({ cliente: "Vans Colombia", redes: ["instagram", "facebook"], motivo: "sin_cuenta" });
  });

  it("marca sola una cuenta de la lista que se vincula después (Pichara), sin tocar lo editado", () => {
    const pichara = brand("p1", "picharaoficial", "@picharaoficial", ["tiktok"]);
    const editada = brand("c1", "Converse", "@conversechile", ["instagram", "facebook"]);
    editada.account.sacChannels = [];
    expect(planSacUsageForNewAccounts([pichara, editada])).toEqual([
      { brandId: "p1", accountName: "picharaoficial", cliente: "Pichara", channels: ["tiktok"] },
    ]);
  });

  it("corre solo si nadie marcó nunca una cuenta (desmarcar todo no la reactiva)", () => {
    const brands = [brand("b1", "Converse", "@conversechile", ["instagram", "facebook"])];
    expect(shouldSeedSacUsage({ brands })).toBe(true);
    brands[0]!.account.sacChannels = [];
    expect(shouldSeedSacUsage({ brands })).toBe(false);
  });
});

describe("mensajes recibidos", () => {
  const base = { externalId: "x", customerName: "C", customerHandle: "@c", text: "hola", category: "consulta", sentiment: "neutral", confidence: 1, status: "pending", version: 1, updatedAt: "2026-11-01T00:00:00Z", internalNotes: [] } as const;
  const item = (id: string, patch: Partial<Interaction>): Interaction => ({
    ...base, id, brandId: "b1", accountId: "a1", channel: "instagram", type: "dm", direction: "inbound", source: "metricool", createdAt: "2026-11-03T12:00:00Z", ...patch,
  } as Interaction);

  it("cuenta entrantes por día UTC, cuenta y red, sin planilla, salientes ni clientes ocultos", () => {
    const rows = messageVolumeRows([
      item("1", {}),
      item("2", { type: "comment" }),
      item("3", { channel: "facebook" }),
      item("4", { createdAt: "2026-11-03T23:59:59Z" }),
      item("5", { createdAt: "2026-11-04T00:00:00Z" }),
      item("6", { source: "planilla" }),
      item("7", { direction: "outbound" }),
      item("8", { brandId: "oculta" }),
      item("9", { createdAt: "2026-10-31T23:59:59Z" }),
    ], new Set(["b1"]), "2026-11-01", "2026-11-03");
    expect(rows).toEqual([
      { date: "2026-11-03", brandId: "b1", accountId: "a1", channel: "instagram", dms: 2, comments: 1, reviews: 0, total: 3 },
      { date: "2026-11-03", brandId: "b1", accountId: "a1", channel: "facebook", dms: 1, comments: 0, reviews: 0, total: 1 },
    ].sort((left, right) => left.date.localeCompare(right.date) || left.accountId.localeCompare(right.accountId)));
  });
});

function switchableGoogle() {
  const current = { email: "", name: "" };
  let requestedNonce = "";
  const client: GoogleOAuthClient = {
    async generateCodeVerifierAsync() {
      return { codeVerifier: "verificador", codeChallenge: "desafio" };
    },
    generateAuthUrl(options) {
      requestedNonce = String(options.nonce);
      const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
      url.searchParams.set("state", String(options.state));
      return url.toString();
    },
    async getToken() {
      return { tokens: { id_token: "id-token" } };
    },
    async verifyIdToken() {
      return {
        getPayload: () => ({ sub: current.email, nonce: requestedNonce, email: current.email, email_verified: true, name: current.name }),
      };
    },
  };
  return { client, current };
}

function cookieFrom(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return all.find((value) => value.startsWith(`${name}=`) && !value.includes("Max-Age=0"))?.split(";", 1)[0];
}

async function makeApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-usage-"));
  directories.push(directory);
  const allowlist = path.join(directory, "allowed-users.json");
  await writeFile(allowlist, JSON.stringify({ users: [] }));
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_AUTH_MODE: "google",
    GOOGLE_OAUTH_CLIENT_ID: "cliente.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "secreto",
    SAC_FLOW_AUTH_ALLOWED_USERS_FILE: allowlist,
    SAC_FLOW_AUTH_ADMIN_EMAILS: "jefa@demo.test",
    SAC_FLOW_AUTH_ALLOWED_DOMAINS: "demo.test",
  }, directory);
  const google = switchableGoogle();
  const app = await buildApp({ config, googleClient: google.client });
  apps.push(app);
  const signIn = async (email: string, name: string) => {
    google.current.email = email;
    google.current.name = name;
    const start = await app.inject({ method: "GET", url: "/api/auth/google/start" });
    const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
    const flow = cookieFrom(start.headers["set-cookie"], "wiwo_nodes_session_oauth");
    const callback = await app.inject({
      method: "GET",
      url: `/api/auth/google/callback?code=codigo&state=${state}`,
      headers: flow ? { cookie: flow } : {},
    });
    const session = cookieFrom(callback.headers["set-cookie"], "wiwo_nodes_session");
    if (!session) throw new Error(`No se pudo iniciar sesión como ${email}`);
    return session;
  };
  return { app, signIn };
}

describe("API de la marca En SAC y del tablero de Clientes", () => {
  it("solo el admin principal marca redes conectadas; la marca no oculta nada", async () => {
    const { app, signIn } = await makeApp();
    const jefa = await signIn("jefa@demo.test", "Jefa Principal");
    await app.inject({ method: "PUT", url: "/api/admin/users/role", headers: { cookie: jefa }, payload: { email: "otra@demo.test", role: "admin" } });
    const otra = await signIn("otra@demo.test", "Otra Admin");

    const sinPermiso = await app.inject({ method: "PUT", url: "/api/brands/brand-01/sac-usage", headers: { cookie: otra }, payload: { channels: ["instagram"] } });
    expect(sinPermiso.statusCode).toBe(403);
    expect(sinPermiso.json().error.code).toBe("MASTER_ADMIN_REQUIRED");

    // Una red aún no conectada se puede marcar: queda pendiente hasta que se conecte.
    const pendiente = await app.inject({ method: "PUT", url: "/api/brands/brand-01/sac-usage", headers: { cookie: jefa }, payload: { channels: ["tiktok", "instagram"] } });
    expect(pendiente.statusCode).toBe(200);
    expect(pendiente.json().data.account.sacChannels).toEqual(["instagram", "tiktok"]);

    const marcada = await app.inject({ method: "PUT", url: "/api/brands/brand-01/sac-usage", headers: { cookie: jefa }, payload: { channels: ["instagram"] } });
    expect(marcada.statusCode).toBe(200);
    expect(marcada.json()).toMatchObject({ data: { id: "brand-01", active: true, account: { sacChannels: ["instagram"] } }, meta: { externalWrites: false } });
    const marcas = (await app.inject({ method: "GET", url: "/api/brands", headers: { cookie: otra } })).json().data;
    expect(marcas.find((item: { id: string }) => item.id === "brand-01").account.sacChannels).toEqual(["instagram"]);
    expect(marcas.find((item: { id: string }) => item.id === "brand-02").account.sacChannels).toBeUndefined();
  });

  it("entrega los mensajes recibidos del período a quien ve Clientes", async () => {
    const { app, signIn } = await makeApp();
    const jefa = await signIn("jefa@demo.test", "Jefa Principal");
    const agente = await signIn("agente@demo.test", "Agente Uno");
    const url = "/api/stats/messages?from=2000-01-01&to=2000-12-31";
    expect((await app.inject({ method: "GET", url, headers: { cookie: agente } })).statusCode).toBe(403);
    const result = await app.inject({ method: "GET", url, headers: { cookie: jefa } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ data: { from: "2000-01-01", to: "2000-12-31", rows: [] }, meta: { excludedSources: ["planilla"] } });

    const today = new Date().toISOString().slice(0, 10);
    const year = new Date(Date.now() - 360 * 86_400_000).toISOString().slice(0, 10);
    const all = (await app.inject({ method: "GET", url: `/api/stats/messages?from=${year}&to=${today}`, headers: { cookie: jefa } })).json().data.rows;
    expect(Array.isArray(all)).toBe(true);
    for (const row of all) expect(row.total).toBe(row.dms + row.comments + row.reviews);

    expect((await app.inject({ method: "GET", url: "/api/stats/messages?from=2026-02-01&to=2026-01-01", headers: { cookie: jefa } })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/stats/messages?from=2024-01-01&to=2026-01-01", headers: { cookie: jefa } })).statusCode).toBe(400);
  });
});
