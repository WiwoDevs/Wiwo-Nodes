/**
 * Reportes: cifras del informe SAC mensual por marca para la sección Reportes. Solo lectura,
 * exige "Ver métricas y cola", respeta el alcance de marcas y avisa de cuentas duplicadas.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { duplicateAccountGroups, monthPeriod } from "../../server/sac-report.js";
import type { Brand } from "../../server/types.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

function actor(role: "agent" | "supervisor", brandIds = "*") {
  return {
    "x-sac-user-id": `user-${role}`,
    "x-sac-user-name": `Usuario ${role}`,
    "x-sac-tenant-id": "tenant-test",
    "x-sac-role": role,
    "x-sac-brand-ids": brandIds,
  };
}

async function makeApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-reports-"));
  directories.push(directory);
  const config = loadConfig({
    METRICOOL_MODE: "demo",
    SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
    SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
    SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
  }, directory);
  const app = await buildApp({ config });
  apps.push(app);
  return app;
}

const currentMonth = () => new Date().toISOString().slice(0, 7);

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Período mensual", () => {
  it("calcula los días del mes, la etiqueta y el mes anterior (incluido el cambio de año)", () => {
    expect(monthPeriod("2026-02")).toEqual({
      month: "2026-02",
      label: "Febrero 2026",
      from: "2026-02-01",
      to: "2026-02-28",
      previous: { from: "2026-01-01", to: "2026-01-31" },
    });
    expect(monthPeriod("2026-01").previous).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });

  it("detecta cuentas con el mismo usuario aunque la vinculación les agregue el sufijo de la marca", () => {
    const brand = (id: string, name: string, handle: string) => ({ id, name, account: { handle } }) as unknown as Brand;
    expect(duplicateAccountGroups([
      brand("flixbus", "FlixBus", "@flixbus_chile"),
      brand("flixbus-2", "FlixBus", "@flixbus_chile-flixbus-2"),
      brand("otra", "Otra", "@otra"),
    ])).toEqual([["FlixBus", "FlixBus"]]);
  });
});

describe("GET /api/reports/sac", () => {
  it("entrega las cifras del mes por marca a quien puede ver métricas", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: `/api/reports/sac?month=${currentMonth()}`, headers: actor("supervisor") });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.month).toBe(currentMonth());
    expect(data.volumen).toBe("gestionado");
    expect(data.brands.length).toBeGreaterThan(0);
    const withCases = data.brands.filter((brand: { figures: { casosSac: number } }) => brand.figures.casosSac > 0);
    expect(withCases.length).toBeGreaterThan(0);
    expect(withCases[0].figures).toMatchObject({
      casosSac: expect.any(Number),
      respondidos: expect.any(Number),
      coberturaPct: expect.any(Number),
      motivos: expect.any(Array),
      advertencias: expect.any(Array),
    });
    // Ordenadas por casos, de mayor a menor.
    const cases = data.brands.map((brand: { figures: { casosSac: number } }) => brand.figures.casosSac);
    expect(cases).toEqual([...cases].sort((left: number, right: number) => right - left));
  });

  it("respeta el alcance de marcas del actor", async () => {
    const app = await makeApp();
    const all = (await app.inject({ method: "GET", url: `/api/reports/sac?month=${currentMonth()}`, headers: actor("supervisor") })).json().data.brands;
    const onlyOne = all[0].brandId as string;
    const scoped = await app.inject({ method: "GET", url: `/api/reports/sac?month=${currentMonth()}`, headers: actor("supervisor", onlyOne) });
    expect(scoped.statusCode).toBe(200);
    expect(scoped.json().data.brands.map((brand: { brandId: string }) => brand.brandId)).toEqual([onlyOne]);
  });

  it("exige Ver métricas y valida el mes", async () => {
    const app = await makeApp();
    const agent = await app.inject({ method: "GET", url: `/api/reports/sac?month=${currentMonth()}`, headers: actor("agent") });
    expect(agent.statusCode).toBe(403);
    const invalid = await app.inject({ method: "GET", url: "/api/reports/sac?month=2026-13", headers: actor("supervisor") });
    expect(invalid.statusCode).toBe(400);
    const missing = await app.inject({ method: "GET", url: "/api/reports/sac", headers: actor("supervisor") });
    expect(missing.statusCode).toBe(400);
  });
});

describe("Marcado manual de caso o ruido", () => {
  async function inboundOpen(app: SacFlowApp) {
    const store = await app.sacFlow.repository.snapshot();
    return store.interactions.find((item) => item.direction === "inbound" && ["new", "pending"].includes(item.status))!;
  }

  it("una persona marca un mensaje como ruido, el detalle y el reporte lo reflejan, y puede volver a automático", async () => {
    const app = await makeApp();
    const interaction = await inboundOpen(app);
    const month = interaction.createdAt.slice(0, 7);
    const before = (await app.inject({ method: "GET", url: `/api/interactions/${interaction.id}`, headers: actor("agent") })).json().data;
    expect(before.reportTriage.source).not.toBe("manual");
    const reportBefore = (await app.inject({ method: "GET", url: `/api/reports/sac?month=${month}`, headers: actor("supervisor") })).json().data;
    const brandBefore = reportBefore.brands.find((brand: { brandId: string }) => brand.brandId === interaction.brandId);

    const marked = await app.inject({
      method: "PUT",
      url: `/api/interactions/${interaction.id}/triage`,
      headers: actor("agent"),
      payload: { esCasoSac: false, expectedVersion: before.version },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json().data.reportTriage).toMatchObject({ esCasoSac: false, source: "manual", marcadoPor: "Usuario agent" });

    const reportAfter = (await app.inject({ method: "GET", url: `/api/reports/sac?month=${month}`, headers: actor("supervisor") })).json().data;
    const brandAfter = reportAfter.brands.find((brand: { brandId: string }) => brand.brandId === interaction.brandId);
    expect(brandAfter.figures.clasificacion.manual).toBe((brandBefore?.figures.clasificacion.manual ?? 0) + 1);
    if (before.reportTriage.esCasoSac) expect(brandAfter.figures.casosSac).toBe(brandBefore.figures.casosSac - 1);

    const detail = (await app.inject({ method: "GET", url: `/api/interactions/${interaction.id}`, headers: actor("agent") })).json().data;
    const reset = await app.inject({
      method: "PUT",
      url: `/api/interactions/${interaction.id}/triage`,
      headers: actor("agent"),
      payload: { esCasoSac: null, expectedVersion: detail.version },
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json().data.reportTriage.source).not.toBe("manual");
  });

  it("exige el permiso de notas y estados", async () => {
    const app = await makeApp();
    const interaction = await inboundOpen(app);
    const response = await app.inject({
      method: "PUT",
      url: `/api/interactions/${interaction.id}/triage`,
      headers: { ...actor("agent"), "x-sac-role": "viewer" },
      payload: { esCasoSac: false, expectedVersion: interaction.version },
    });
    expect(response.statusCode).toBe(403);
  });

  it("marca en lote las conversaciones elegidas sin pisar una marca manual previa", async () => {
    const app = await makeApp();
    const contacts = (await app.inject({ method: "GET", url: "/api/inbox/contacts?page=1&pageSize=5", headers: actor("agent") })).json().data;
    const contact = (contacts as Array<{ contactKey: string; replyTarget?: { id: string }; latest: { id?: string } }>).find((item) => item.replyTarget)!;
    const targetId = contact.replyTarget!.id;
    const detail = (await app.inject({ method: "GET", url: `/api/interactions/${targetId}`, headers: actor("agent") })).json().data;
    // Marca manual previa como caso: el lote como ruido no la cambia.
    await app.inject({
      method: "PUT",
      url: `/api/interactions/${targetId}/triage`,
      headers: actor("agent"),
      payload: { esCasoSac: true, expectedVersion: detail.version },
    });
    const bulk = await app.inject({
      method: "POST",
      url: "/api/interactions/triage",
      headers: actor("agent"),
      payload: { contactKeys: [contact.contactKey], esCasoSac: false },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().data.contacts).toBe(1);
    const after = (await app.inject({ method: "GET", url: `/api/interactions/${targetId}`, headers: actor("agent") })).json().data;
    expect(after.reportTriage).toMatchObject({ esCasoSac: true, source: "manual" });
  });
});
