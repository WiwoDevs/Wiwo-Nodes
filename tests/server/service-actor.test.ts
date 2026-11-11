/**
 * Con inicio de sesión activo, el worker y el despachador de respuestas siguen llamando a la
 * API con la clave del sitio. Esa clave solo abre POST /api/sync y
 * POST /api/interactions/:id/reply; todo lo demás exige la cookie de una persona.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { IdentityError, type IdentityService } from "../../server/identity.js";
import type { ActorContext } from "../../server/types.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];
const SITE_KEY = "clave-del-sitio-solo-para-pruebas-123456";
const PERSON_COOKIE = "cookie-de-persona";

const person: ActorContext = {
  userId: "google:persona",
  displayName: "Persona Demo",
  tenantId: "wiwo",
  role: "admin",
  brandIds: "all",
  source: "google",
  email: "persona@demo.test",
};

async function makeApp(): Promise<SacFlowApp> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-service-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_AUTH_MODE: "google",
    GOOGLE_OAUTH_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "secreto-de-prueba",
    SAC_FLOW_API_KEY: SITE_KEY,
  }, directory);
  const identity: IdentityService = {
    config: config.auth,
    async resolveActor(cookie) {
      if (cookie !== PERSON_COOKIE) throw new IdentityError(401, "SESSION_INVALID", "Sin sesión.");
      return person;
    },
  };
  const app = await buildApp({ config, identity });
  apps.push(app);
  return app;
}

async function firstInteraction(app: SacFlowApp): Promise<{ id: string; version: number }> {
  const list = await app.inject({
    method: "GET",
    url: "/api/interactions?pageSize=1",
    headers: { cookie: `wiwo_nodes_session=${PERSON_COOKIE}` },
  });
  expect(list.statusCode).toBe(200);
  return list.json().data[0];
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Actor de servicio con inicio de sesión activo", () => {
  it("permite al worker sincronizar con la clave del sitio y sin cookie", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { "x-api-key": SITE_KEY, "idempotency-key": "job-servicio-1" },
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.run).toBeTruthy();
  });

  it("permite al despachador responder una interacción con la clave del sitio", async () => {
    const app = await makeApp();
    const interaction = await firstInteraction(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction.id}/reply`,
      headers: { authorization: `Bearer ${SITE_KEY}`, "idempotency-key": "entrega-servicio-1" },
      payload: { text: "Borrador del servicio", mode: "draft", expectedVersion: interaction.version },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe("drafted");
  });

  it("rechaza una clave incorrecta con 401 UNAUTHORIZED, no como falta de sesión", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { "x-api-key": "otra-clave-que-no-corresponde-000000", "idempotency-key": "job-servicio-2" },
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("no abre ninguna otra ruta con la clave del sitio", async () => {
    const app = await makeApp();
    const headers = { "x-api-key": SITE_KEY };
    for (const request of [
      { method: "GET" as const, url: "/api/brands" },
      { method: "GET" as const, url: "/api/interactions" },
      { method: "GET" as const, url: "/api/me" },
      { method: "GET" as const, url: "/api/sync" },
      { method: "PUT" as const, url: "/api/interactions/cualquiera/reply" },
      { method: "DELETE" as const, url: "/api/interactions/cualquiera/reply" },
      { method: "POST" as const, url: "/api/interactions/a/b/reply" },
    ]) {
      const response = await app.inject({ ...request, headers });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(401);
      expect(response.json().error.code, `${request.method} ${request.url}`).toBe("SESSION_REQUIRED");
    }
  });

  it("sin clave, las dos rutas siguen exigiendo la sesión de una persona", async () => {
    const app = await makeApp();
    const anonymous = await app.inject({ method: "POST", url: "/api/sync", headers: { "idempotency-key": "job-servicio-3" }, payload: {} });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.code).toBe("SESSION_REQUIRED");

    const withPerson = await app.inject({
      method: "POST",
      url: "/api/sync",
      headers: { cookie: `wiwo_nodes_session=${PERSON_COOKIE}`, "idempotency-key": "job-servicio-4" },
      payload: {},
    });
    expect(withPerson.statusCode).toBe(200);
  });

  it("la auditoría de seguridad considera protegida la API con inicio de sesión", async () => {
    const app = await makeApp();
    const audit = await app.inject({ method: "GET", url: "/api/security/audit", headers: { cookie: `wiwo_nodes_session=${PERSON_COOKIE}` } });
    expect(audit.statusCode).toBe(200);
    const check = (audit.json().data.checks as Array<{ id: string; status: string }>).find((item) => item.id === "api-key");
    expect(check?.status).toBe("pass");
  });
});
