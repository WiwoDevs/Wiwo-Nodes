/**
 * Modo de prueba local del inicio de sesión (SAC_FLOW_AUTH_MODE=dev): correo y contraseña
 * contra usuarios ficticios, mismo contrato de cookie y roles que el inicio de sesión con Google.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

const USERS = {
  users: [
    { email: "admin@demo.test", password: "clave-admin-de-prueba", name: "Admin Demo", permissions: ["admin"] },
    { email: "agente@demo.test", password: "clave-agente-de-prueba", name: "Agente Demo", permissions: ["sac"] },
    { email: "otro@demo.test", password: "clave-otro-de-prueba", name: "Sin Permiso", permissions: ["reporting"] },
  ],
};

async function makeApp(): Promise<{ app: SacFlowApp; usersFile: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-dev-auth-"));
  directories.push(directory);
  const usersFile = path.join(directory, "dev-users.json");
  await writeFile(usersFile, JSON.stringify(USERS));
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_AUTH_MODE: "dev",
    SAC_FLOW_DEV_AUTH_USERS_FILE: usersFile,
  }, directory);
  const app = await buildApp({ config });
  apps.push(app);
  return { app, usersFile };
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const value = header?.split(";", 1)[0];
  if (!value) throw new Error("La respuesta no emitió cookie de sesión.");
  return value;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Inicio de sesión de prueba local", () => {
  it("expone el proveedor dev y no exige la clave del sitio", async () => {
    const { app } = await makeApp();
    const config = await app.inject({ method: "GET", url: "/api/auth/config" });
    expect(config.json().data).toMatchObject({ enabled: true, provider: "dev" });
    expect(app.sacFlow.config.security.requireApiKey).toBe(false);
    const health = await app.inject({ method: "GET", url: "/api/health" });
    expect(health.json().security.identity).toBe("dev");
  });

  it("inicia sesión con correo y contraseña y resuelve el actor desde la cookie", async () => {
    const { app } = await makeApp();
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/dev-session",
      payload: { email: "Agente@Demo.test", password: "clave-agente-de-prueba" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().data).toMatchObject({ email: "agente@demo.test", displayName: "Agente Demo", role: "agent" });
    expect(String(login.headers["set-cookie"])).toContain("HttpOnly");

    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: sessionCookie(login.headers["set-cookie"]) } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data).toMatchObject({ userId: "dev:agente@demo.test", role: "agent", source: "dev", email: "agente@demo.test" });
  });

  it("rechaza una contraseña incorrecta sin revelar si el correo existe", async () => {
    const { app } = await makeApp();
    const wrong = await app.inject({ method: "POST", url: "/api/auth/dev-session", payload: { email: "agente@demo.test", password: "otra" } });
    const unknown = await app.inject({ method: "POST", url: "/api/auth/dev-session", payload: { email: "nadie@demo.test", password: "otra" } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().error.message).toBe(unknown.json().error.message);
  });

  it("niega el acceso a una cuenta sin el permiso requerido", async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: "POST", url: "/api/auth/dev-session", payload: { email: "otro@demo.test", password: "clave-otro-de-prueba" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("PERMISSION_REQUIRED");
  });

  it("corta la sesión cuando el usuario se quita del archivo", async () => {
    const { app, usersFile } = await makeApp();
    const login = await app.inject({ method: "POST", url: "/api/auth/dev-session", payload: { email: "agente@demo.test", password: "clave-agente-de-prueba" } });
    const cookie = sessionCookie(login.headers["set-cookie"]);
    await writeFile(usersFile, JSON.stringify({ users: USERS.users.filter((user) => user.email !== "agente@demo.test") }));
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie } });
    expect(me.statusCode).toBe(403);
  });

  it("rechaza una cookie alterada y exige sesión en rutas protegidas", async () => {
    const { app } = await makeApp();
    const noSession = await app.inject({ method: "GET", url: "/api/me" });
    expect(noSession.statusCode).toBe(401);
    const forged = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: "wiwo_nodes_session=eyJlbWFpbCI6ImFkbWluQGRlbW8udGVzdCJ9.firma-falsa" } });
    expect(forged.statusCode).toBe(401);
  });

  it("no puede activarse en producción", () => {
    expect(() => loadConfig({
      NODE_ENV: "production",
      METRICOOL_MODE: "demo",
      SAC_FLOW_AUTH_MODE: "dev",
    })).toThrow(/solo para pruebas locales/);
  });
});
