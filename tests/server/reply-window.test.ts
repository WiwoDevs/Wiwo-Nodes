/**
 * Plazos de respuesta (Metricool/Meta: 7 días DMs, 24 horas comentarios) y archivado en lote
 * de los casos fuera de plazo: solo cuenta en dryRun, nunca toca casos sensibles, respeta el
 * alcance de marcas y exige el permiso inbox.archive_expired.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { expiredOpenInteractions, replyWindowMs } from "../../server/reply-window.js";
import { createDemoStore } from "../../server/seed.js";
import type { Interaction } from "../../server/types.js";

const DAY = 24 * 60 * 60 * 1_000;
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
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-window-"));
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

/** Envejece las interacciones abiertas de la marca indicada para dejarlas fuera de plazo. */
async function ageOpenInteractions(app: SacFlowApp, brandId: string, days: number) {
  return app.sacFlow.repository.mutate((store) => {
    const aged: Interaction[] = [];
    for (const interaction of store.interactions) {
      if (interaction.brandId !== brandId) continue;
      interaction.createdAt = new Date(Date.now() - days * DAY).toISOString();
      if (interaction.direction === "inbound" && ["new", "pending", "drafted", "escalated"].includes(interaction.status)) aged.push(interaction);
    }
    return aged.map((interaction) => ({ id: interaction.id, sentiment: interaction.sentiment, risk: interaction.automation?.risk, channel: interaction.channel, type: interaction.type }));
  });
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Plazos de respuesta", () => {
  it("7 días para DMs y 24 h para comentarios solo en Instagram y Facebook", () => {
    expect(replyWindowMs("instagram", "dm")).toBe(7 * DAY);
    expect(replyWindowMs("facebook", "comment")).toBe(DAY);
    expect(replyWindowMs("instagram", "review")).toBeUndefined();
    expect(replyWindowMs("tiktok", "dm")).toBeUndefined();
  });

  it("un DM viejo sigue en plazo si el cliente volvió a escribir en la misma conversación", () => {
    const store = createDemoStore();
    const dm = store.interactions.find((interaction) => interaction.type === "dm" && interaction.direction === "inbound" && interaction.channel === "instagram")!;
    const old = { ...dm, id: "old", status: "pending" as const, createdAt: new Date(Date.now() - 10 * DAY).toISOString() };
    const recent = { ...dm, id: "recent", status: "pending" as const, createdAt: new Date(Date.now() - DAY).toISOString() };
    expect(expiredOpenInteractions([old]).map((item) => item.id)).toEqual(["old"]);
    expect(expiredOpenInteractions([old, recent])).toEqual([]);
  });
});

describe("Archivar casos fuera de plazo", () => {
  it("cuenta en dryRun, archiva como histórico, salta los sensibles y no toca otras marcas", async () => {
    const app = await makeApp();
    const aged = await ageOpenInteractions(app, "brand-01", 30);
    const windowed = aged.filter((item) => replyWindowMs(item.channel, item.type) !== undefined);
    const sensitive = windowed.filter((item) => item.sentiment === "negative" || item.risk === "high" || item.risk === "critical");
    expect(windowed.length).toBeGreaterThan(0);
    // Acotado a la cuenta de la marca: otras marcas de la demo tienen comentarios ya vencidos.
    const accountId = (await app.sacFlow.repository.snapshotCatalog()).brands.find((brand) => brand.id === "brand-01")!.account.id;

    const preview = await app.inject({ method: "POST", url: "/api/interactions/archive-expired", headers: actor("supervisor"), payload: { dryRun: true, accountId } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toMatchObject({ dryRun: true, archived: 0, eligible: windowed.length - sensitive.length, skippedSensitive: sensitive.length });
    const stillOpen = await app.sacFlow.repository.listInteractions({ brandId: "brand-01" });
    expect(stillOpen.filter((item) => item.status === "resolved")).toHaveLength(0);

    const run = await app.inject({ method: "POST", url: "/api/interactions/archive-expired", headers: actor("supervisor"), payload: { dryRun: false, accountId } });
    expect(run.statusCode).toBe(200);
    expect(run.json().data.archived).toBe(windowed.length - sensitive.length);

    const after = await app.sacFlow.repository.listInteractions({ brandId: "brand-01" });
    const archived = after.filter((item) => item.statusReason?.code === "reply_window_expired");
    expect(archived).toHaveLength(windowed.length - sensitive.length);
    expect(archived.every((item) => item.status === "resolved" && item.audit.at(-1)?.metadata?.bulk === true)).toBe(true);
    // Los sensibles siguen abiertos para revisión humana.
    for (const item of sensitive) expect(after.find((candidate) => candidate.id === item.id)?.status).not.toBe("resolved");
    // Otras marcas (fuera del alcance pedido) no se tocan.
    const others = await app.sacFlow.repository.listInteractions({ brandId: "brand-02" });
    expect(others.some((item) => item.statusReason?.code === "reply_window_expired")).toBe(false);
  });

  it("exige el permiso y respeta el alcance de marcas", async () => {
    const app = await makeApp();
    await ageOpenInteractions(app, "brand-01", 30);
    const agent = await app.inject({ method: "POST", url: "/api/interactions/archive-expired", headers: actor("agent"), payload: { dryRun: true } });
    expect(agent.statusCode).toBe(403);
    const outOfScope = await app.inject({ method: "POST", url: "/api/interactions/archive-expired", headers: actor("supervisor", "brand-02"), payload: { dryRun: true } });
    expect(outOfScope.statusCode).toBe(200);
    expect(outOfScope.json().data.eligible + outOfScope.json().data.skippedSensitive).toBe(0);
  });

  it("los contactos de la bandeja informan el último mensaje del cliente", async () => {
    const app = await makeApp();
    const contacts = await app.inject({ method: "GET", url: "/api/inbox/contacts?page=1&pageSize=5" });
    const first = contacts.json().data[0];
    expect(typeof first.latestInboundAt).toBe("string");
  });
});
