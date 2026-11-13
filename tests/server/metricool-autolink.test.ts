/**
 * Vinculación automática del catálogo de Metricool en cada sincronización live: las marcas
 * con canales legibles se vinculan solas, las de ejemplo del seed se retiran, y una marca
 * desactivada o excluida nunca vuelve a crearse. Todo con un cliente Metricool simulado.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import type { MetricoolGateway } from "../../server/metricool-client.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];
const API_KEY = "clave-de-api-de-pruebas-para-autolink-123";

const CATALOG = [
  { id: "1001", userId: "u-1", label: "Marca Real Uno", instagram: "marcarealuno", facebook: "pagina-uno" },
  { id: "1002", userId: "u-1", label: "Marca Sin Redes" },
  { id: "1003", userId: "u-1", label: "Marca Excluida", instagram: "excluida" },
];

function fakeMetricool(listBrands: () => Promise<unknown> = async () => CATALOG): MetricoolGateway {
  return {
    listBrands: vi.fn(listBrands),
    listConversations: vi.fn(async () => []),
    listPostComments: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    replyToConversation: vi.fn(async () => ({})),
    replyToPostComment: vi.fn(async () => ({})),
    replyToReview: vi.fn(async () => ({})),
  };
}

async function makeApp(env: Record<string, string> = {}, client: MetricoolGateway = fakeMetricool()) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-autolink-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "live",
    METRICOOL_API_TOKEN: "token-de-prueba-nunca-registrado",
    METRICOOL_USER_ID: "u-1",
    SAC_FLOW_API_KEY: API_KEY,
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    ...env,
  }, directory);
  const app = await buildApp({ config, metricoolClient: client });
  apps.push(app);
  return { app, client };
}

let syncCounter = 0;
async function sync(app: SacFlowApp, payload: Record<string, unknown> = {}) {
  syncCounter += 1;
  return app.inject({
    method: "POST",
    url: "/api/sync",
    headers: { "x-api-key": API_KEY, "idempotency-key": `autolink-sync-${syncCounter}` },
    payload,
  });
}

async function brands(app: SacFlowApp) {
  return (await app.sacFlow.repository.snapshot()).brands;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Vinculación automática del catálogo de Metricool", () => {
  it("vincula las marcas con canales legibles y retira las de ejemplo", async () => {
    const { app } = await makeApp();
    const response = await sync(app);
    expect(response.statusCode).toBe(200);

    const all = await brands(app);
    const real = all.find((brand) => brand.name === "Marca Real Uno");
    expect(real).toMatchObject({ active: true });
    expect(real?.account.metricool?.blogId).toBe("1001");
    expect(all.find((brand) => brand.name === "Marca Sin Redes")).toBeUndefined();
    // Las 20 marcas ficticias del seed quedan inactivas; solo sincronizan las reales.
    const active = all.filter((brand) => brand.active);
    expect(active.map((brand) => brand.name).sort()).toEqual(["Marca Excluida", "Marca Real Uno"]);

    const run = response.json().data.run;
    expect(JSON.stringify(run)).toContain("Catálogo Metricool");
  });

  it("es idempotente: una segunda sincronización no duplica marcas", async () => {
    const { app } = await makeApp();
    await sync(app);
    const before = (await brands(app)).length;
    await sync(app);
    expect((await brands(app)).length).toBe(before);
  });

  it("no reescribe el store en una sincronización sin marcas nuevas ni de ejemplo pendientes", async () => {
    const { app } = await makeApp();
    await sync(app);
    // En PostgreSQL cada mutate() reescribe todas las interacciones: un ciclo sin cambios no debe llamarlo.
    // El repositorio JSON usa mutate() internamente para todo; se cuentan solo las llamadas
    // que hace la vinculación automática.
    const repository = app.sacFlow.repository;
    let fromAutoLink = 0;
    const countFromAutoLink = () => {
      const stack = new Error().stack ?? "";
      if (stack.includes("autoLinkMetricoolCatalog") || stack.includes("linkMetricoolBrands")) fromAutoLink += 1;
    };
    const originalMutate = repository.mutate.bind(repository);
    vi.spyOn(repository, "mutate").mockImplementation(((operation: Parameters<typeof originalMutate>[0]) => {
      countFromAutoLink();
      return originalMutate(operation);
    }) as typeof repository.mutate);
    const originalCatalog = repository.mutateCatalog.bind(repository);
    vi.spyOn(repository, "mutateCatalog").mockImplementation(((operation: Parameters<typeof originalCatalog>[0]) => {
      countFromAutoLink();
      return originalCatalog(operation);
    }) as typeof repository.mutateCatalog);
    const response = await sync(app);
    expect(response.statusCode).toBe(200);
    expect(fromAutoLink).toBe(0);
  });

  it("respeta SAC_FLOW_METRICOOL_EXCLUDED_BLOG_IDS", async () => {
    const { app } = await makeApp({ SAC_FLOW_METRICOOL_EXCLUDED_BLOG_IDS: "1003" });
    await sync(app);
    expect((await brands(app)).find((brand) => brand.name === "Marca Excluida")).toBeUndefined();
  });

  it("no vuelve a crear una marca que un admin desactivó", async () => {
    const { app } = await makeApp();
    await sync(app);
    const real = (await brands(app)).find((brand) => brand.name === "Marca Real Uno")!;
    const deactivated = await app.inject({ method: "DELETE", url: `/api/brands/${real.id}`, headers: { "x-api-key": API_KEY } });
    expect(deactivated.statusCode).toBe(200);
    const count = (await brands(app)).length;

    await sync(app);
    const after = await brands(app);
    expect(after.length).toBe(count);
    const same = after.find((brand) => brand.id === real.id);
    expect(same).toMatchObject({ active: false });
    expect(same?.account.metricool?.blogId).toBe("1001");
  });

  it("no vincula nada con SAC_FLOW_METRICOOL_AUTO_LINK=false", async () => {
    const { app, client } = await makeApp({ SAC_FLOW_METRICOOL_AUTO_LINK: "false" });
    await sync(app);
    expect(client.listBrands).not.toHaveBeenCalled();
    expect((await brands(app)).find((brand) => brand.name === "Marca Real Uno")).toBeUndefined();
  });

  it("deja constancia en la auditoría cuando falta METRICOOL_USER_ID", async () => {
    const { app, client } = await makeApp({ METRICOOL_USER_ID: "" });
    const response = await sync(app);
    expect(response.statusCode).toBe(200);
    expect(client.listBrands).not.toHaveBeenCalled();
    expect(JSON.stringify(response.json().data.run)).toContain("Falta METRICOOL_USER_ID");
  });

  it("sigue sincronizando si el catálogo no responde", async () => {
    const { app } = await makeApp({}, fakeMetricool(async () => { throw new Error("Metricool caído"); }));
    const response = await sync(app);
    expect(response.statusCode).toBe(200);
    expect(JSON.stringify(response.json().data.run)).toContain("No se pudo leer el catálogo");
    // Sin catálogo no se retiran las marcas existentes.
    expect((await brands(app)).filter((brand) => brand.active).length).toBeGreaterThan(0);
  });

  it("quita del pedido explícito las marcas de ejemplo retiradas y agrega las nuevas", async () => {
    const { app } = await makeApp();
    const seedAccountIds = (await brands(app)).slice(0, 2).map((brand) => brand.account.id);
    const response = await sync(app, { accountIds: seedAccountIds });
    expect(response.statusCode).toBe(200);
    const real = (await brands(app)).find((brand) => brand.name === "Marca Real Uno")!;
    expect(response.json().data.run.accountIds).toContain(real.account.id);
    expect(response.json().data.run.accountIds).not.toContain(seedAccountIds[0]);
  });
});
