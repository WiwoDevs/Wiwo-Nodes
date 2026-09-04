/**
 * La superficie de integración usa una clave estática en vez de la sesión Firebase.
 * Estas pruebas fijan sus límites: solo lectura, solo su prefijo, y sin efecto sobre el
 * resto de la API.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { FirebaseAuthError, type FirebaseAuthService } from "../../server/firebase-auth.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];
const SERVICE_KEY = "clave-de-integracion-para-pruebas-1234";

/** Identidad que rechaza todo: así se ve que la integración no depende de ella. */
function denyingAuth(): FirebaseAuthService {
  return {
    config: {
      enabled: true,
      cookieName: "wiwo_nodes_session",
      sessionTtlMs: 1_000,
      allowedUsersCollection: "allowed_users",
      requiredPermission: "sac",
      adminPermission: "admin",
      defaultRole: "agent",
      tenantId: "wiwo",
    },
    async createSession() {
      throw new FirebaseAuthError(401, "INVALID_TOKEN", "No usado.");
    },
    async resolveActor() {
      throw new FirebaseAuthError(401, "SESSION_INVALID", "Sin sesión.");
    },
  };
}

async function makeApp(options: { serviceKey?: string } = {}): Promise<SacFlowApp> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-integ-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_AUTH_MODE: "firebase",
    FIREBASE_SERVICE_ACCOUNT_KEY: '{"project_id":"test"}',
    ...(options.serviceKey === undefined ? {} : { SAC_FLOW_SERVICE_API_KEY: options.serviceKey }),
  }, directory);
  const app = await buildApp({ config, firebaseAuth: denyingAuth() });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Superficie de integración", () => {
  it("rechaza la lectura sin clave de servicio", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({ method: "GET", url: "/api/integrations/sac-brands" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SERVICE_KEY_REQUIRED");
  });

  it("rechaza una clave equivocada", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/sac-brands",
      headers: { "x-api-key": "clave-incorrecta-pero-suficientemente-larga" },
    });
    expect(response.statusCode).toBe(401);
  });

  it("no abre nada cuando no hay clave configurada", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/sac-brands",
      headers: { "x-api-key": SERVICE_KEY },
    });
    expect(response.statusCode).toBe(401);
  });

  it("permite la lectura con la clave correcta aunque no exista sesión de usuario", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/sac-brands",
      headers: { "x-api-key": SERVICE_KEY },
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().data)).toBe(true);
  });

  it("devuelve filas SAC de una marca en el formato acordado", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/sac-rows?brandId=brand-01",
      headers: { "x-api-key": SERVICE_KEY },
    });
    expect(response.statusCode).toBe(200);
    const payload = response.json();
    expect(payload.data.brandKey).toBe("brand-01");
    for (const row of payload.data.rows) {
      expect(Object.keys(row).sort()).toEqual([
        "brandKey", "brandLabel", "canal", "categoria", "estado", "fechaComentario",
        "mes", "observacion", "plataforma", "reclamo", "tonalidad", "usuario",
      ]);
    }
  });

  it("rechaza un rango de fechas invertido", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/sac-rows?brandId=brand-01&from=2026-08-31&to=2026-08-01",
      headers: { "x-api-key": SERVICE_KEY },
    });
    expect(response.statusCode).toBe(400);
  });

  it("no acepta escrituras sobre el prefijo de integración", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({
      method: "POST",
      url: "/api/integrations/sac-rows",
      headers: { "x-api-key": SERVICE_KEY },
      payload: { brandId: "brand-01" },
    });
    expect(response.statusCode).toBe(405);
  });

  it("la clave de servicio no abre el resto de la API", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    for (const url of ["/api/brands", "/api/interactions", "/api/me"]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: { "x-api-key": SERVICE_KEY },
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("no expone una marca desactivada", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    await app.sacFlow.repository.mutate((store) => {
      const brand = store.brands.find((item) => item.id === "brand-01");
      if (brand) brand.active = false;
      return brand;
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/integrations/sac-rows?brandId=brand-01",
      headers: { "x-api-key": SERVICE_KEY },
    });
    expect(response.statusCode).toBe(409);
  });
});
