/**
 * Ocultar clientes (solo admin principal) y carga manual del Excel BD SAC de TikTok/LinkedIn,
 * que cuenta en Reportes y METRIQ sin convertirse en trabajo de la bandeja.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import type { GoogleOAuthClient } from "../../server/google-auth.js";
import { MANUAL_RECORDS_HEADERS } from "../../server/manual-records.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];
const SERVICE_KEY = "clave-de-integracion-de-prueba-0123456789";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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

async function makeApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-visibility-"));
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
    SAC_FLOW_AUTH_SUPERVISOR_EMAILS: "super@demo.test",
    SAC_FLOW_AUTH_ALLOWED_DOMAINS: "demo.test",
    SAC_FLOW_SERVICE_API_KEY: SERVICE_KEY,
  }, directory);
  const google = switchableGoogle();
  const app = await buildApp({ config, googleClient: google.client });
  apps.push(app);
  return { app, google };
}

function cookieFrom(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return all.find((value) => value.startsWith(`${name}=`) && !value.includes("Max-Age=0"))?.split(";", 1)[0];
}

async function signIn(context: Awaited<ReturnType<typeof makeApp>>, email: string, name: string): Promise<string> {
  context.google.current.email = email;
  context.google.current.name = name;
  const start = await context.app.inject({ method: "GET", url: "/api/auth/google/start" });
  const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
  const flow = cookieFrom(start.headers["set-cookie"], "wiwo_nodes_session_oauth");
  const callback = await context.app.inject({
    method: "GET",
    url: `/api/auth/google/callback?code=codigo&state=${state}`,
    headers: flow ? { cookie: flow } : {},
  });
  const session = cookieFrom(callback.headers["set-cookie"], "wiwo_nodes_session");
  if (!session) throw new Error(`No se pudo iniciar sesión como ${email}`);
  return session;
}

async function bdSacWorkbook(rows: ExcelJS.CellValue[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Histórico");
  sheet.addRow(MANUAL_RECORDS_HEADERS);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("ocultar clientes", () => {
  it("solo el admin principal oculta y muestra; el equipo deja de ver al cliente y su bandeja", async () => {
    const context = await makeApp();
    const { app } = context;
    const jefa = await signIn(context, "jefa@demo.test", "Jefa Principal");
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: jefa } })).json().data.masterAdmin).toBe(true);

    // Un admin asignado desde la app no puede ocultar.
    const asignado = await app.inject({
      method: "PUT", url: "/api/admin/users/role", headers: { cookie: jefa }, payload: { email: "otra@demo.test", role: "admin" },
    });
    expect(asignado.statusCode).toBe(200);
    const otra = await signIn(context, "otra@demo.test", "Otra Admin");
    expect((await app.inject({ method: "GET", url: "/api/me", headers: { cookie: otra } })).json().data.masterAdmin).toBe(false);
    const sinPermiso = await app.inject({
      method: "PUT", url: "/api/brands/brand-01/visibility", headers: { cookie: otra }, payload: { hidden: true },
    });
    expect(sinPermiso.statusCode).toBe(403);
    expect(sinPermiso.json().error.code).toBe("MASTER_ADMIN_REQUIRED");
    const porEdicion = await app.inject({ method: "PATCH", url: "/api/brands/brand-01", headers: { cookie: otra }, payload: { active: false } });
    expect(porEdicion.statusCode).toBe(403);
    const porBorrado = await app.inject({ method: "DELETE", url: "/api/brands/brand-01", headers: { cookie: otra } });
    expect(porBorrado.statusCode).toBe(403);
    // Editar otros datos (con el estado que ya tenía) sigue permitido.
    const edicion = await app.inject({
      method: "PATCH", url: "/api/brands/brand-01", headers: { cookie: otra }, payload: { name: "Marca Uno", active: true, accountActive: true },
    });
    expect(edicion.statusCode).toBe(200);

    const supervisor = await signIn(context, "super@demo.test", "Super Visora");
    const contactosAntes = (await app.inject({ method: "GET", url: "/api/inbox/contacts?pageSize=200", headers: { cookie: supervisor } })).json();
    expect(contactosAntes.data.some((contact: { brandId: string }) => contact.brandId === "brand-01")).toBe(true);

    const oculta = await app.inject({
      method: "PUT", url: "/api/brands/brand-01/visibility", headers: { cookie: jefa }, payload: { hidden: true },
    });
    expect(oculta.statusCode).toBe(200);
    expect(oculta.json()).toMatchObject({ data: { id: "brand-01", active: false }, meta: { hidden: true, externalWrites: false } });

    const marcasEquipo = (await app.inject({ method: "GET", url: "/api/brands", headers: { cookie: supervisor } })).json().data;
    expect(marcasEquipo.some((brand: { id: string }) => brand.id === "brand-01")).toBe(false);
    const marcasJefa = (await app.inject({ method: "GET", url: "/api/brands", headers: { cookie: jefa } })).json().data;
    expect(marcasJefa.find((brand: { id: string }) => brand.id === "brand-01")).toMatchObject({ active: false });
    const contactos = (await app.inject({ method: "GET", url: "/api/inbox/contacts?pageSize=200", headers: { cookie: supervisor } })).json();
    expect(contactos.data.some((contact: { brandId: string }) => contact.brandId === "brand-01")).toBe(false);
    const metriq = await app.inject({ method: "GET", url: "/api/integrations/sac-brands", headers: { authorization: `Bearer ${SERVICE_KEY}` } });
    expect(metriq.json().data.some((brand: { brandKey: string }) => brand.brandKey === "brand-01")).toBe(false);

    const visible = await app.inject({
      method: "PUT", url: "/api/brands/brand-01/visibility", headers: { cookie: jefa }, payload: { hidden: false },
    });
    expect(visible.statusCode).toBe(200);
    const deVuelta = (await app.inject({ method: "GET", url: "/api/brands", headers: { cookie: supervisor } })).json().data;
    expect(deVuelta.find((brand: { id: string }) => brand.id === "brand-01")).toMatchObject({ active: true });
  });
});

describe("carga manual de TikTok y LinkedIn", () => {
  it("revisa, guarda una sola vez y llega a Reportes y METRIQ sin entrar a la bandeja", async () => {
    const context = await makeApp();
    const { app } = context;
    const supervisor = await signIn(context, "super@demo.test", "Super Visora");
    const agente = await signIn(context, "agente@demo.test", "Agente Uno");
    const archivo = await bdSacWorkbook([
      ["14/10/2026", "Ana Pérez", "¿Tienen envíos a regiones? Necesito saber el costo", "TikTok", "Comentario", "Despachos", "Neutra", "Resuelto"],
      ["15/10/2026", "Luis Soto", "Excelente iniciativa, ¿cómo postulo a la beca?", "LinkedIn", "DM", "", "Positiva", "Pendiente"],
      ["16/10/2026", "Mara", "Hola, consulta por stock", "Instagram", "Comentario", "", "Neutra", "Resuelto"],
    ]);
    const subir = (cookie: string, dryRun: boolean) => app.inject({
      method: "POST",
      url: `/api/brands/brand-01/manual-records?dryRun=${dryRun}&archivo=bd-sac-octubre.xlsx`,
      headers: { cookie, "content-type": XLSX },
      payload: archivo,
    });

    expect((await subir(agente, true)).statusCode).toBe(403);
    const contactosDe = async () => (await app.inject({
      method: "GET", url: "/api/inbox/contacts?pageSize=200", headers: { cookie: supervisor },
    })).json() as { data: Array<{ channel: string }>; pagination: { total: number } };
    const contactosAntes = await contactosDe();
    const resumenDe = async () => (await app.inject({
      method: "GET", url: "/api/stats/summary", headers: { cookie: supervisor },
    })).json().data as { total: number; pending: number };
    const resumenAntes = await resumenDe();
    const reporteAntes = (await app.inject({ method: "GET", url: "/api/reports/sac?month=2026-10", headers: { cookie: supervisor } })).json();
    const casosAntes = reporteAntes.data.brands.find((brand: { brandId: string }) => brand.brandId === "brand-01")?.figures.casosSac ?? 0;

    const revision = await subir(supervisor, true);
    expect(revision.statusCode).toBe(200);
    expect(revision.json().data).toMatchObject({ dryRun: true, nuevas: 2, creadas: 0, otraRed: 1, porRed: { tiktok: 1, linkedin: 1 } });

    const carga = await subir(supervisor, false);
    expect(carga.json().data).toMatchObject({ dryRun: false, nuevas: 2, creadas: 2 });
    const repetida = await subir(supervisor, false);
    expect(repetida.json().data).toMatchObject({ nuevas: 0, creadas: 0, yaCargadas: 2 });

    // No es trabajo pendiente de la bandeja ni del resumen.
    const contactos = await contactosDe();
    expect(contactos.pagination.total).toBe(contactosAntes.pagination.total);
    expect(contactos.data.some((contact) => contact.channel === "linkedin")).toBe(false);
    const resumen = await resumenDe();
    expect({ total: resumen.total, pending: resumen.pending }).toEqual({ total: resumenAntes.total, pending: resumenAntes.pending });

    // Sí cuenta en el reporte del mes y en las filas que lee METRIQ.
    const reporte = (await app.inject({ method: "GET", url: "/api/reports/sac?month=2026-10", headers: { cookie: supervisor } })).json();
    const figuras = reporte.data.brands.find((brand: { brandId: string }) => brand.brandId === "brand-01").figures;
    expect(figuras.casosSac).toBe(casosAntes + 2);
    expect(figuras.canales).toMatchObject({ tt_publico: 1, linkedin_privado: 1 });
    const filas = (await app.inject({
      method: "GET",
      url: "/api/integrations/sac-rows?brandId=brand-01&from=2026-10-14&to=2026-10-15",
      headers: { authorization: `Bearer ${SERVICE_KEY}` },
    })).json().data.rows;
    expect(filas).toEqual(expect.arrayContaining([
      expect.objectContaining({ fechaComentario: "2026-10-14", plataforma: "TikTok", estado: "Resuelto", categoria: "Despachos" }),
      expect.objectContaining({ fechaComentario: "2026-10-15", plataforma: "LinkedIn", estado: "Pendiente" }),
    ]));
  });

  it("explica por qué no puede leer el archivo y entrega la plantilla", async () => {
    const context = await makeApp();
    const { app } = context;
    const supervisor = await signIn(context, "super@demo.test", "Super Visora");
    const json = await app.inject({
      method: "POST", url: "/api/brands/brand-01/manual-records", headers: { cookie: supervisor }, payload: { filas: [] },
    });
    expect(json.statusCode).toBe(415);
    const roto = await app.inject({
      method: "POST",
      url: "/api/brands/brand-01/manual-records",
      headers: { cookie: supervisor, "content-type": XLSX },
      payload: Buffer.from("no es un excel"),
    });
    expect(roto.statusCode).toBe(422);
    expect(roto.json().error.code).toBe("MANUAL_RECORDS_FORMAT_INVALID");
    const plantilla = await app.inject({ method: "GET", url: "/api/manual-records/template", headers: { cookie: supervisor } });
    expect(plantilla.statusCode).toBe(200);
    expect(plantilla.headers["content-type"]).toContain("spreadsheetml");
  });
});
