/**
 * La superficie de integración usa una clave estática en vez de la sesión de usuario.
 * Estas pruebas fijan sus límites: solo lectura, solo su prefijo, y sin efecto sobre el
 * resto de la API.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { IdentityError, type IdentityService } from "../../server/identity.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];
const SERVICE_KEY = "clave-de-integracion-para-pruebas-1234";

/** Identidad que rechaza todo: así se ve que la integración no depende de ella. */
function denyingAuth(): IdentityService {
  return {
    config: {
      enabled: true,
      cookieName: "wiwo_nodes_session",
      sessionTtlMs: 1_000,
      allowedDomains: [],
      postLoginRedirect: "/",
      requiredPermission: "sac",
      adminPermission: "admin",
      defaultRole: "agent",
      tenantId: "wiwo",
    },
    async resolveActor() {
      throw new IdentityError(401, "SESSION_INVALID", "Sin sesión.");
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
    SAC_FLOW_AUTH_MODE: "google",
    GOOGLE_OAUTH_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "secreto-de-prueba",
    ...(options.serviceKey === undefined ? {} : { SAC_FLOW_SERVICE_API_KEY: options.serviceKey }),
  }, directory);
  const app = await buildApp({ config, identity: denyingAuth() });
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

describe("Integración METRIQ: reporte, totales, Excel y frescura", () => {
  const headers = { authorization: `Bearer ${SERVICE_KEY}` };
  const thisMonth = () => new Date().toISOString().slice(0, 7);

  it("acepta dos claves a la vez para rotarla sin cortes", async () => {
    const otra = "segunda-clave-de-integracion-para-rotar-5678";
    const app = await makeApp({ serviceKey: `${SERVICE_KEY},${otra}` });
    for (const key of [SERVICE_KEY, otra]) {
      const response = await app.inject({ method: "GET", url: "/api/integrations/sac-brands", headers: { "x-api-key": key } });
      expect(response.statusCode).toBe(200);
    }
  });

  it("informa desde cuándo hay datos de cada marca y la última sincronización", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const payload = (await app.inject({ method: "GET", url: "/api/integrations/sac-brands", headers })).json();
    expect(payload.data[0]).toMatchObject({ brandKey: expect.any(String), datosDesde: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
    expect(payload.meta).toHaveProperty("lastSyncAt");
    expect(payload.meta).toHaveProperty("generatedAt");
  });

  it("las filas traen solo casos SAC y cuentan el ruido aparte", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const casos = (await app.inject({ method: "GET", url: "/api/integrations/sac-rows?brandId=brand-01", headers })).json();
    const todo = (await app.inject({ method: "GET", url: "/api/integrations/sac-rows?brandId=brand-01&incluirRuido=true", headers })).json();
    expect(todo.data.rows.length).toBe(casos.data.rows.length + casos.meta.droppedNoise);
    expect(todo.meta.droppedNoise).toBe(0);
  });

  it("entrega el reporte del mes con las cifras de Reportes y sin datos de clientes", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({ method: "GET", url: `/api/integrations/sac-report?month=${thisMonth()}&brandId=brand-01`, headers });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.brands).toHaveLength(1);
    expect(data.brands[0].figures).toMatchObject({
      casosSac: expect.any(Number),
      volumenBruto: expect.any(Number),
      clasificacion: { manual: expect.any(Number), ia: expect.any(Number), reglas: expect.any(Number) },
    });
    expect(response.body).not.toContain("@cliente_");
  });

  it("entrega totales por mes y valida el rango", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const month = thisMonth();
    const response = await app.inject({ method: "GET", url: `/api/integrations/sac-totals?from=${month}&to=${month}&brandId=brand-01`, headers });
    expect(response.statusCode).toBe(200);
    const months = response.json().data[0].months;
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ monthKey: month, recibidos: expect.any(Number), casosSac: expect.any(Number), ruido: expect.any(Number) });
    const tooLong = await app.inject({ method: "GET", url: "/api/integrations/sac-totals?from=2024-01&to=2026-12", headers });
    expect(tooLong.statusCode).toBe(400);
  });

  it("descarga el Excel del mes", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({ method: "GET", url: `/api/integrations/sac-export?month=${thisMonth()}&brandId=brand-01`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("spreadsheetml");
    expect(response.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });

  it("responde 404 para una marca inexistente", async () => {
    const app = await makeApp({ serviceKey: SERVICE_KEY });
    const response = await app.inject({ method: "GET", url: `/api/integrations/sac-report?month=${thisMonth()}&brandId=no-existe`, headers });
    expect(response.statusCode).toBe(404);
  });
});
