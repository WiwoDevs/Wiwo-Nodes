/**
 * La bandeja pide muchas páginas de contactos a la vez. Solicitudes con los mismos filtros
 * deben compartir un único cálculo, y cualquier escritura exitosa debe invalidarlo.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

async function makeApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-contacts-cache-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
  }, directory);
  const app = await buildApp({ config });
  apps.push(app);
  return app;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Caché de la lista de contactos de la bandeja", () => {
  it("varias páginas simultáneas comparten un único cálculo", async () => {
    const app = await makeApp();
    const listInteractions = vi.spyOn(app.sacFlow.repository, "listInteractions");
    const responses = await Promise.all([1, 2, 3, 4, 5].map((page) =>
      app.inject({ method: "GET", url: `/api/inbox/contacts?page=${page}&pageSize=10` })));
    for (const response of responses) expect(response.statusCode).toBe(200);
    expect(listInteractions).toHaveBeenCalledTimes(1);
    const totals = new Set(responses.map((response) => response.json().pagination.total));
    expect(totals.size).toBe(1);
  });

  it("una escritura exitosa invalida el cálculo compartido", async () => {
    const app = await makeApp();
    const first = await app.inject({ method: "GET", url: "/api/inbox/contacts?page=1&pageSize=10" });
    expect(first.statusCode).toBe(200);
    const list = await app.inject({ method: "GET", url: "/api/interactions?pageSize=1" });
    const interactionId = list.json().data[0].id as string;
    const listInteractions = vi.spyOn(app.sacFlow.repository, "listInteractions");

    const cached = await app.inject({ method: "GET", url: "/api/inbox/contacts?page=1&pageSize=10" });
    expect(cached.statusCode).toBe(200);
    expect(listInteractions).toHaveBeenCalledTimes(0);

    const interaction = await app.inject({ method: "GET", url: `/api/interactions/${interactionId}` });
    expect(interaction.statusCode).toBe(200);
    const draft = await app.inject({
      method: "POST",
      url: `/api/interactions/${interactionId}/reply`,
      payload: { text: "Borrador de prueba", mode: "draft", expectedVersion: interaction.json().data.version },
    });
    expect(draft.statusCode).toBe(200);

    const fresh = await app.inject({ method: "GET", url: "/api/inbox/contacts?page=1&pageSize=10" });
    expect(fresh.statusCode).toBe(200);
    expect(listInteractions).toHaveBeenCalledTimes(1);
  });
});
