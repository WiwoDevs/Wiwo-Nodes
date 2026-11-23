/**
 * Errores de la interfaz informados por la pantalla de recuperación: se registran y no se
 * guardan; sin sesión no se aceptan.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("POST /api/client-errors", () => {
  it("acepta el informe con sesión, valida el tamaño y no escribe en el almacén", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-client-errors-"));
    directories.push(directory);
    const config = loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
      SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
    }, directory);
    const app = await buildApp({ config });
    apps.push(app);
    const headers = { "x-sac-user-id": "user-agent", "x-sac-user-name": "Agente", "x-sac-tenant-id": "tenant-test", "x-sac-role": "agent", "x-sac-brand-ids": "*" };
    const before = JSON.stringify((await app.sacFlow.repository.snapshot()).interactions.length);

    const ok = await app.inject({ method: "POST", url: "/api/client-errors", headers, payload: { message: "Cannot read properties of undefined (reading 'label')", name: "TypeError", view: "interactions", path: "/" } });
    expect(ok.statusCode).toBe(204);
    const tooLong = await app.inject({ method: "POST", url: "/api/client-errors", headers, payload: { message: "x".repeat(501) } });
    expect(tooLong.statusCode).toBe(400);
    expect(JSON.stringify((await app.sacFlow.repository.snapshot()).interactions.length)).toBe(before);
  });
});
