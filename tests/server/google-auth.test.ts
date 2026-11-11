/**
 * Flujo completo de inicio de sesión con Google (OAuth + OIDC) a través de la API, con un
 * cliente OAuth simulado: no contacta a Google. Verifica state, nonce, correo verificado,
 * allowlist y la cookie de sesión resultante.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { createGoogleIdentity, type GoogleOAuthClient } from "../../server/google-auth.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

type Claims = { email?: string; email_verified?: boolean; name?: string; sub?: string; nonce?: string };

/** Cliente OAuth falso: recuerda el nonce pedido y devuelve los claims configurados. */
function fakeGoogle(claims: Claims) {
  let requestedNonce = "";
  const client: GoogleOAuthClient = {
    async generateCodeVerifierAsync() {
      return { codeVerifier: "verificador-de-prueba", codeChallenge: "desafio-de-prueba" };
    },
    generateAuthUrl(options) {
      requestedNonce = String(options.nonce);
      const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");
      url.searchParams.set("state", String(options.state));
      url.searchParams.set("code_challenge", String(options.code_challenge));
      return url.toString();
    },
    async getToken({ code, codeVerifier }) {
      if (code !== "codigo-valido" || codeVerifier !== "verificador-de-prueba") throw new Error("código inválido");
      return { tokens: { id_token: "id-token-de-prueba" } };
    },
    async verifyIdToken() {
      return { getPayload: () => ({ sub: "123", nonce: requestedNonce, ...claims }) };
    },
  };
  return client;
}

async function makeApp(claims: Claims, env: Record<string, string> = {}, users: unknown[] = []) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-google-"));
  directories.push(directory);
  const allowlist = path.join(directory, "allowed-users.json");
  await writeFile(allowlist, JSON.stringify({ users }));
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_AUTH_MODE: "google",
    GOOGLE_OAUTH_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "secreto-de-prueba",
    SAC_FLOW_AUTH_ALLOWED_USERS_FILE: allowlist,
    ...env,
  }, directory);
  const app = await buildApp({ config, identity: createGoogleIdentity(config.auth, fakeGoogle(claims)) });
  apps.push(app);
  return { app, allowlist };
}

function cookieFrom(setCookie: string | string[] | undefined, name: string): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const header = all.find((value) => value.startsWith(`${name}=`) && !value.includes("Max-Age=0"));
  return header?.split(";", 1)[0];
}

/** Recorre start → Google → callback y devuelve la respuesta del callback. */
async function signIn(app: SacFlowApp, overrides: { state?: string; code?: string; error?: string; dropFlowCookie?: boolean } = {}) {
  const start = await app.inject({ method: "GET", url: "/api/auth/google/start" });
  expect(start.statusCode).toBe(302);
  const location = new URL(String(start.headers.location));
  const flowCookie = cookieFrom(start.headers["set-cookie"], "wiwo_nodes_session_oauth");
  const query = new URLSearchParams();
  if (overrides.error) query.set("error", overrides.error);
  else {
    query.set("code", overrides.code ?? "codigo-valido");
    query.set("state", overrides.state ?? location.searchParams.get("state") ?? "");
  }
  return app.inject({
    method: "GET",
    url: `/api/auth/google/callback?${query}`,
    headers: overrides.dropFlowCookie || !flowCookie ? {} : { cookie: flowCookie },
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Inicio de sesión con Google", () => {
  it("redirige a Google con PKCE y guarda el flujo en una cookie httpOnly", async () => {
    const { app } = await makeApp({ email: "a@demo.test", email_verified: true });
    const start = await app.inject({ method: "GET", url: "/api/auth/google/start" });
    expect(start.statusCode).toBe(302);
    expect(String(start.headers.location)).toContain("code_challenge=desafio-de-prueba");
    const flow = String(start.headers["set-cookie"]);
    expect(flow).toContain("wiwo_nodes_session_oauth=");
    expect(flow).toContain("HttpOnly");
    expect(flow).toContain("Path=/api/auth/google");
  });

  it("inicia sesión a un usuario de la allowlist y lo expone en /api/me", async () => {
    const { app } = await makeApp(
      { email: "Admin@Demo.test", email_verified: true, name: "Admin Demo" },
      {},
      [{ email: "admin@demo.test", permissions: ["admin"] }],
    );
    const callback = await signIn(app);
    expect(callback.statusCode).toBe(302);
    expect(callback.headers.location).toBe("/");
    const session = cookieFrom(callback.headers["set-cookie"], "wiwo_nodes_session");
    expect(session).toBeTruthy();

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: session! } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({
      userId: "google:123",
      displayName: "Admin Demo",
      role: "admin",
      source: "google",
      email: "admin@demo.test",
    });
  });

  it("admite por dominio permitido con el rol por defecto", async () => {
    const { app } = await makeApp(
      { email: "agente@demo.test", email_verified: true },
      { SAC_FLOW_AUTH_ALLOWED_DOMAINS: "demo.test" },
    );
    const callback = await signIn(app);
    const session = cookieFrom(callback.headers["set-cookie"], "wiwo_nodes_session");
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: session! } });
    expect(me.json().data.role).toBe("agent");
  });

  it("vuelve con login_error cuando la cuenta no está autorizada", async () => {
    const { app } = await makeApp({ email: "intruso@ajeno.test", email_verified: true });
    const callback = await signIn(app);
    expect(callback.headers.location).toBe("/?login_error=ACCOUNT_NOT_ALLOWED");
    expect(cookieFrom(callback.headers["set-cookie"], "wiwo_nodes_session")).toBeUndefined();
  });

  it("rechaza un correo no verificado", async () => {
    const { app } = await makeApp({ email: "admin@demo.test", email_verified: false }, {}, [{ email: "admin@demo.test", permissions: ["admin"] }]);
    const callback = await signIn(app);
    expect(callback.headers.location).toBe("/?login_error=EMAIL_NOT_VERIFIED");
  });

  it("rechaza un state distinto o sin la cookie del flujo", async () => {
    const { app } = await makeApp({ email: "admin@demo.test", email_verified: true }, {}, [{ email: "admin@demo.test", permissions: ["admin"] }]);
    expect((await signIn(app, { state: "otro-state" })).headers.location).toBe("/?login_error=OAUTH_STATE_INVALID");
    expect((await signIn(app, { dropFlowCookie: true })).headers.location).toBe("/?login_error=OAUTH_STATE_INVALID");
  });

  it("rechaza un id_token con otro nonce", async () => {
    const { app } = await makeApp({ email: "admin@demo.test", email_verified: true, nonce: "nonce-ajeno" }, {}, [{ email: "admin@demo.test", permissions: ["admin"] }]);
    expect((await signIn(app)).headers.location).toBe("/?login_error=GOOGLE_TOKEN_INVALID");
  });

  it("informa cuando la persona cancela en Google", async () => {
    const { app } = await makeApp({ email: "admin@demo.test", email_verified: true });
    expect((await signIn(app, { error: "access_denied" })).headers.location).toBe("/?login_error=GOOGLE_CANCELLED");
  });

  it("corta la sesión cuando el usuario se quita de la allowlist", async () => {
    const { app, allowlist } = await makeApp({ email: "admin@demo.test", email_verified: true }, {}, [{ email: "admin@demo.test", permissions: ["admin"] }]);
    const session = cookieFrom((await signIn(app)).headers["set-cookie"], "wiwo_nodes_session");
    await writeFile(allowlist, JSON.stringify({ users: [] }));
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: session! } });
    expect(me.statusCode).toBe(403);
  });

  it("expone el proveedor google y no exige la clave del sitio", async () => {
    const { app } = await makeApp({}, { NODE_ENV: "production", SAC_FLOW_REQUIRE_API_KEY: "true", SAC_FLOW_API_KEY: "clave-compartida-del-sitio-de-prueba-123", SAC_FLOW_AUTH_SESSION_SECRET: "secreto-de-sesion-de-prueba-de-32-caracteres", GOOGLE_OAUTH_REDIRECT_URI: "https://nodes.example.test/api/auth/google/callback" });
    expect(app.sacFlow.config.security.requireApiKey).toBe(false);
    const config = await app.inject({ method: "GET", url: "/api/auth/config" });
    expect(config.json().data).toMatchObject({ enabled: true, provider: "google" });
  });
});

describe("Configuración del inicio de sesión con Google", () => {
  const base = { METRICOOL_MODE: "demo", SAC_FLOW_AUTH_MODE: "google" };

  it("lee las listas de correos del entorno y rechaza entradas inválidas", () => {
    const google = { ...base, GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secreto" };
    const config = loadConfig({ ...google, SAC_FLOW_AUTH_ADMIN_EMAILS: " Jefa@Demo.test , otra@demo.test,jefa@demo.test", SAC_FLOW_AUTH_ALLOWED_EMAILS: "" });
    expect(config.auth.adminEmails).toEqual(["jefa@demo.test", "otra@demo.test"]);
    expect(config.auth.allowedEmails).toEqual([]);
    expect(() => loadConfig({ ...google, SAC_FLOW_AUTH_ADMIN_EMAILS: "no-es-un-correo" })).toThrow(/Correo inválido/);
  });

  it("exige client id y secret", () => {
    expect(() => loadConfig(base)).toThrow(/GOOGLE_OAUTH_CLIENT_ID/);
  });

  it("exige secreto de sesión y redirect explícito en producción", () => {
    const google = { ...base, NODE_ENV: "production", GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "secreto" };
    expect(() => loadConfig(google)).toThrow(/GOOGLE_OAUTH_REDIRECT_URI/);
    expect(() => loadConfig({ ...google, GOOGLE_OAUTH_REDIRECT_URI: "https://nodes.example.test/api/auth/google/callback" }))
      .toThrow(/SAC_FLOW_AUTH_SESSION_SECRET/);
  });

  it("rechaza el antiguo modo firebase con una indicación clara", () => {
    expect(() => loadConfig({ METRICOOL_MODE: "demo", SAC_FLOW_AUTH_MODE: "firebase" })).toThrow(/SAC_FLOW_AUTH_MODE=google/);
  });
});
