/**
 * Endurecimiento tras la revisión de seguridad: respuesta duplicada, cupo de solicitudes,
 * HTTPS detrás del proxy, sondas mínimas sin sesión, envío automático solo por admin,
 * clave de servicio sin aprobación humana, vínculo único con Metricool y webhooks cross-site.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

function actor(role: "agent" | "supervisor" | "admin", brandIds = "*") {
  return {
    "x-sac-user-id": `user-${role}`,
    "x-sac-user-name": `Usuario ${role}`,
    "x-sac-tenant-id": "tenant-test",
    "x-sac-role": role,
    "x-sac-brand-ids": brandIds,
  };
}

async function makeApp(env: Record<string, string> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-hardening-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
    ...env,
  }, directory);
  const app = await buildApp({ config });
  apps.push(app);
  return app;
}

/** Configuración con inicio de sesión Google (sin cliente real: las rutas que se prueban no lo usan). */
const GOOGLE_ENV = {
  SAC_FLOW_TRUST_ACTOR_HEADERS: "false",
  SAC_FLOW_AUTH_MODE: "google",
  GOOGLE_OAUTH_CLIENT_ID: "cliente.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "secreto",
  SAC_FLOW_AUTH_ALLOWED_DOMAINS: "demo.test",
};

async function firstInbound(app: SacFlowApp) {
  const store = await app.sacFlow.repository.snapshot();
  return store.interactions.find((item) => item.direction === "inbound" && ["new", "pending"].includes(item.status))!;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Endurecimiento de seguridad", () => {
  it("no deja guardar un borrador sobre un caso ya respondido (evita una segunda respuesta)", async () => {
    const app = await makeApp();
    const interaction = await firstInbound(app);
    await app.sacFlow.repository.updateInteraction(interaction.id, (item) => { item.status = "replied"; });
    const current = (await app.sacFlow.repository.findInteraction(interaction.id))!;
    const draft = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction.id}/reply`,
      headers: actor("agent"),
      payload: { text: "Hola de nuevo", mode: "draft", approvedByHuman: true, expectedVersion: current.version },
    });
    expect(draft.statusCode).toBe(409);
    expect(draft.json().error.code).toBe("CASE_ALREADY_CLOSED");
  });

  it("el cupo de solicitudes no se reinicia con claves inventadas", async () => {
    const app = await makeApp({ SAC_FLOW_RATE_LIMIT_ENABLED: "true", SAC_FLOW_RATE_LIMIT_MAX: "3" });
    const codes: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await app.inject({ method: "GET", url: "/api/brands", headers: { ...actor("agent"), "x-api-key": `inventada-${index}` } });
      codes.push(response.statusCode);
    }
    expect(codes.at(-1)).toBe(429);
  });

  it("detrás del proxy redirige HTTP a HTTPS y envía HSTS por HTTPS", async () => {
    const app = await makeApp({ SAC_FLOW_FORCE_HTTPS: "true", SAC_FLOW_SECURITY_HEADERS: "true" });
    const plain = await app.inject({ method: "GET", url: "/api/brands?x=1", headers: { ...actor("agent"), host: "nodes.example.test", "x-forwarded-for": "203.0.113.7" } });
    expect(plain.statusCode).toBe(301);
    expect(plain.headers.location).toBe("https://nodes.example.test/api/brands?x=1");
    const post = await app.inject({ method: "POST", url: "/api/sync", headers: { ...actor("agent"), "x-forwarded-for": "203.0.113.7" }, payload: {} });
    expect(post.statusCode).toBe(403);
    expect(post.json().error.code).toBe("HTTPS_REQUIRED");

    const secure = await app.inject({ method: "GET", url: "/api/brands", headers: { ...actor("agent"), "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https" } });
    expect(secure.statusCode).toBe(200);
    expect(secure.headers["strict-transport-security"]).toBe("max-age=15552000");
    // Las sondas internas (sin proxy) siguen por HTTP.
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });

  it("las sondas solo dan el estado a quien llega por internet sin sesión", async () => {
    const app = await makeApp(GOOGLE_ENV);
    const outside = await app.inject({ method: "GET", url: "/api/health", headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(outside.statusCode).toBe(200);
    expect(Object.keys(outside.json()).sort()).toEqual(["service", "status", "timestamp"]);
    const outsideReady = await app.inject({ method: "GET", url: "/api/ready", headers: { "x-forwarded-for": "203.0.113.7" } });
    expect(outsideReady.json().checks).toBeUndefined();
    expect(outsideReady.json().status).toBeTruthy();

    const internal = await app.inject({ method: "GET", url: "/api/ready" });
    expect(internal.json().checks.repository).toBeTruthy();
  });

  it("solo un admin puede volver a una versión del flujo con el envío automático encendido", async () => {
    const app = await makeApp();
    const enable = await app.inject({ method: "PUT", url: "/api/workflow", headers: actor("admin"), payload: { autoReplyEnabled: true, confirmAutoReply: true } });
    expect(enable.statusCode).toBe(200);
    const enabledVersion = enable.json().data.version as number;
    expect((await app.inject({ method: "PUT", url: "/api/workflow", headers: actor("admin"), payload: { autoReplyEnabled: false } })).statusCode).toBe(200);

    // Supervisor con permiso de publicar: el bloqueo viene de la regla del envío automático.
    const grant = await app.inject({ method: "PUT", url: "/api/admin/roles/supervisor", headers: actor("admin"), payload: { permissions: ["workflow.edit", "workflow.publish"] } });
    expect(grant.statusCode).toBe(200);
    const rollback = await app.inject({ method: "POST", url: "/api/workflow/rollback", headers: actor("supervisor"), payload: { version: enabledVersion } });
    expect(rollback.statusCode).toBe(403);
    expect(rollback.json().error.code).toBe("ADMIN_REQUIRED");
    const asAdmin = await app.inject({ method: "POST", url: "/api/workflow/rollback", headers: actor("admin"), payload: { version: enabledVersion } });
    expect(asAdmin.statusCode).toBe(200);
  });

  it("una marca de Metricool no se vincula a dos cuentas y vincular exige ver todas las marcas", async () => {
    const app = await makeApp();
    const brands = (await app.sacFlow.repository.snapshotCatalog()).brands;
    const [first, second] = brands;
    const link = (accountId: string, headers: Record<string, string>) => app.inject({
      method: "PUT",
      url: `/api/accounts/${accountId}/metricool`,
      headers,
      payload: { userId: "u-prueba", blogId: "999001" },
    });
    expect((await link(first!.account.id, actor("admin"))).statusCode).toBe(200);
    const duplicate = await link(second!.account.id, actor("admin"));
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("METRICOOL_BRAND_ALREADY_LINKED");
    const scoped = await link(second!.account.id, actor("admin", second!.id));
    expect(scoped.statusCode).toBe(403);
  });

  it("un webhook no se dispara desde otro sitio", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/api/webhooks/cualquiera", headers: { ...actor("admin"), "sec-fetch-site": "cross-site" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("CROSS_SITE_WEBHOOK");
  });

  it("la clave interna de servicio no puede declarar aprobación humana", async () => {
    const app = await makeApp({ ...GOOGLE_ENV, SAC_FLOW_API_KEY: "clave-de-servicio-de-pruebas-con-32-caracteres-o-mas" });
    const interaction = await firstInbound(app);
    const response = await app.inject({
      method: "POST",
      url: `/api/interactions/${interaction.id}/reply`,
      headers: { "x-api-key": "clave-de-servicio-de-pruebas-con-32-caracteres-o-mas", "idempotency-key": "servicio-aprobacion-1" },
      payload: { text: "Respuesta", mode: "send", approvedByHuman: true, expectedVersion: interaction.version },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("HUMAN_APPROVAL_REQUIRED");
  });
});
