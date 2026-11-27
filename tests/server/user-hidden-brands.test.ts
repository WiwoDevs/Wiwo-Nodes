/**
 * Clientes ocultos por persona: solo un admin principal los define, y la persona deja de ver esos
 * clientes en todas las rutas (marcas, bandeja). Los admins principales siempre ven todo.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import type { GoogleOAuthClient } from "../../server/google-auth.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function cookieFrom(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return all.find((value) => value.startsWith(`${name}=`) && !value.includes("Max-Age=0"))?.split(";", 1)[0];
}

async function makeApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-hidden-brands-"));
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
    SAC_FLOW_AUTH_ADMIN_EMAILS: "jefa@demo.test,socia@demo.test",
    SAC_FLOW_AUTH_SUPERVISOR_EMAILS: "super@demo.test",
    SAC_FLOW_AUTH_ALLOWED_DOMAINS: "demo.test",
  }, directory);
  const current = { email: "", name: "" };
  let nonce = "";
  const google: GoogleOAuthClient = {
    async generateCodeVerifierAsync() {
      return { codeVerifier: "verificador", codeChallenge: "desafio" };
    },
    generateAuthUrl(options) {
      nonce = String(options.nonce);
      const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
      url.searchParams.set("state", String(options.state));
      return url.toString();
    },
    async getToken() {
      return { tokens: { id_token: "id-token" } };
    },
    async verifyIdToken() {
      return { getPayload: () => ({ sub: current.email, nonce, email: current.email, email_verified: true, name: current.name }) };
    },
  };
  const app = await buildApp({ config, googleClient: google });
  apps.push(app);
  const signIn = async (email: string, name: string) => {
    current.email = email;
    current.name = name;
    const start = await app.inject({ method: "GET", url: "/api/auth/google/start" });
    const state = new URL(String(start.headers.location)).searchParams.get("state") ?? "";
    const flow = cookieFrom(start.headers["set-cookie"], "wiwo_nodes_session_oauth");
    const callback = await app.inject({ method: "GET", url: `/api/auth/google/callback?code=codigo&state=${state}`, headers: flow ? { cookie: flow } : {} });
    const session = cookieFrom(callback.headers["set-cookie"], "wiwo_nodes_session");
    if (!session) throw new Error(`No se pudo iniciar sesión como ${email}`);
    return session;
  };
  return { app, signIn };
}

describe("clientes ocultos por persona", () => {
  it("todo admin los define y la persona deja de verlos en marcas y bandeja", async () => {
    const { app, signIn } = await makeApp();
    const jefa = await signIn("jefa@demo.test", "Jefa Principal");
    const supervisor = await signIn("super@demo.test", "Super Visora");
    await app.inject({ method: "PUT", url: "/api/admin/users/role", headers: { cookie: jefa }, payload: { email: "otra@demo.test", role: "admin" } });
    const otra = await signIn("otra@demo.test", "Otra Admin");

    const brandsOf = async (cookie: string) => (await app.inject({ method: "GET", url: "/api/brands", headers: { cookie } })).json().data
      .map((brand: { id: string }) => brand.id) as string[];
    const contactsOf = async (cookie: string) => (await app.inject({ method: "GET", url: "/api/inbox/contacts?pageSize=200", headers: { cookie } })).json().data
      .map((contact: { brandId: string }) => contact.brandId) as string[];
    expect(await brandsOf(supervisor)).toContain("brand-01");
    expect(await contactsOf(supervisor)).toContain("brand-01");

    // Un admin asignado en la app también puede (mismas funciones que el principal).
    const asignado = await app.inject({ method: "PUT", url: "/api/admin/users/hidden-brands", headers: { cookie: otra }, payload: { email: "super@demo.test", brandIds: ["brand-02"] } });
    expect(asignado.statusCode).toBe(200);
    // A un admin no se le ocultan clientes; los clientes deben existir.
    expect((await app.inject({ method: "PUT", url: "/api/admin/users/hidden-brands", headers: { cookie: jefa }, payload: { email: "otra@demo.test", brandIds: ["brand-01"] } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url: "/api/admin/users/hidden-brands", headers: { cookie: jefa }, payload: { email: "socia@demo.test", brandIds: ["brand-01"] } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PUT", url: "/api/admin/users/hidden-brands", headers: { cookie: jefa }, payload: { email: "super@demo.test", brandIds: ["no-existe"] } })).statusCode).toBe(422);

    const oculta = await app.inject({ method: "PUT", url: "/api/admin/users/hidden-brands", headers: { cookie: jefa }, payload: { email: "super@demo.test", brandIds: ["brand-01"] } });
    expect(oculta.statusCode).toBe(200);
    expect(oculta.json().data.user).toMatchObject({ email: "super@demo.test", hiddenBrandIds: ["brand-01"], hiddenBrandsUpdatedBy: "Jefa Principal" });

    expect(await brandsOf(supervisor)).not.toContain("brand-01");
    expect(await brandsOf(supervisor)).toContain("brand-02");
    expect(await contactsOf(supervisor)).not.toContain("brand-01");
    // Pedirlo directo tampoco funciona.
    expect((await app.inject({ method: "GET", url: "/api/inbox/contacts?brandId=brand-01", headers: { cookie: supervisor } })).statusCode).toBe(403);
    // Quien lo ocultó y los demás siguen viéndolo.
    expect(await brandsOf(jefa)).toContain("brand-01");

    // Un cambio de permisos no borra los clientes ocultos.
    await app.inject({ method: "PUT", url: "/api/admin/users/role", headers: { cookie: jefa }, payload: { email: "super@demo.test", role: "agent" } });
    const listing = (await app.inject({ method: "GET", url: "/api/admin/users", headers: { cookie: jefa } })).json().data;
    expect(listing.users.find((user: { email: string }) => user.email === "super@demo.test").hiddenBrandIds).toEqual(["brand-01"]);

    const todos = await app.inject({ method: "PUT", url: "/api/admin/users/hidden-brands", headers: { cookie: jefa }, payload: { email: "super@demo.test", brandIds: [] } });
    expect(todos.statusCode).toBe(200);
    expect(await brandsOf(supervisor)).toContain("brand-01");
  });
});
