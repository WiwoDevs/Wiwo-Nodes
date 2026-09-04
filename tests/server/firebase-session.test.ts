/**
 * Verifica el cableado de la identidad Firebase en la API sin contactar a Firebase:
 * se inyecta un servicio de identidad simulado que representa una allowlist ya resuelta.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { FirebaseAuthError, type FirebaseAuthService } from "../../server/firebase-auth.js";
import type { ActorContext } from "../../server/types.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

const AGENT_COOKIE = "cookie-de-agente";
const ADMIN_COOKIE = "cookie-de-admin";
const SCOPED_COOKIE = "cookie-de-agente-restringido";

function actor(overrides: Partial<ActorContext>): ActorContext {
  return {
    userId: "uid-agente",
    displayName: "Agente Uno",
    tenantId: "wiwo",
    role: "agent",
    brandIds: "all",
    source: "firebase",
    ...overrides,
  };
}

/** Identidad simulada: mapea cookies conocidas a actores, y rechaza el resto. */
function fakeAuth(): FirebaseAuthService {
  const sessions = new Map<string, ActorContext>([
    [AGENT_COOKIE, actor({})],
    [ADMIN_COOKIE, actor({ userId: "uid-admin", displayName: "Admin", role: "admin" })],
    [SCOPED_COOKIE, actor({ userId: "uid-scoped", brandIds: ["brand-01"] })],
  ]);
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
      throw new FirebaseAuthError(401, "INVALID_TOKEN", "No usado en esta prueba.");
    },
    async resolveActor(cookie) {
      const resolved = sessions.get(cookie);
      if (!resolved) throw new FirebaseAuthError(401, "SESSION_INVALID", "La sesión expiró o fue revocada.");
      return resolved;
    },
  };
}

async function makeApp(): Promise<SacFlowApp> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-auth-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_AUTH_MODE: "firebase",
    FIREBASE_SERVICE_ACCOUNT_KEY: '{"project_id":"test"}',
  }, directory);
  const app = await buildApp({ config, firebaseAuth: fakeAuth() });
  apps.push(app);
  return app;
}

function withCookie(cookie: string) {
  return { cookie: `wiwo_nodes_session=${cookie}` };
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Sesión Firebase en la API", () => {
  it("rechaza rutas protegidas sin cookie de sesión", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/api/brands" });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SESSION_REQUIRED");
  });

  it("rechaza una cookie desconocida o revocada", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/brands",
      headers: withCookie("cookie-invalida"),
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("SESSION_INVALID");
  });

  it("resuelve el actor desde la sesión y lo expone en /api/me", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: withCookie(AGENT_COOKIE),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      userId: "uid-agente",
      role: "agent",
      tenantId: "wiwo",
    });
  });

  it("ignora los headers X-SAC-* cuando la identidad viene de la sesión", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        ...withCookie(AGENT_COOKIE),
        "x-sac-role": "admin",
        "x-sac-user-id": "intruso",
        "x-sac-brand-ids": "*",
      },
    });
    expect(response.statusCode).toBe(200);
    // El rol y el usuario provienen de la cookie firmada, no de lo que envía el navegador.
    expect(response.json().data).toMatchObject({ userId: "uid-agente", role: "agent" });
  });

  it("aplica el rol de la sesión a una acción de administración", async () => {
    const app = await makeApp();
    const denied = await app.inject({
      method: "POST",
      url: "/api/brands",
      headers: withCookie(AGENT_COOKIE),
      payload: { name: "Marca Nueva", accountHandle: "@marca.nueva" },
    });
    expect(denied.statusCode).toBe(403);

    const allowed = await app.inject({
      method: "POST",
      url: "/api/brands",
      headers: withCookie(ADMIN_COOKIE),
      payload: { name: "Marca Nueva", accountHandle: "@marca.nueva" },
    });
    expect(allowed.statusCode).toBe(200);
  });

  it("respeta el alcance de marcas de la sesión", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/brands",
      headers: withCookie(SCOPED_COOKIE),
    });
    expect(response.statusCode).toBe(200);
    const brands = response.json().data as Array<{ id: string }>;
    expect(brands).toHaveLength(1);
    expect(brands[0]?.id).toBe("brand-01");
  });

  it("deja pasar los probes de infraestructura sin sesión", async () => {
    const app = await makeApp();
    for (const url of ["/api/health", "/api/ready", "/api/auth/config"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(200);
    }
  });

  it("reporta la identidad activa en /api/health", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.json().security.identity).toBe("firebase");
  });
});
