/**
 * Bandeja en vivo: el registro de cambios por revisión, la ruta que entrega solo los
 * contactos que cambiaron y los avisos por Server-Sent Events.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { InboxChangeLog } from "../../server/inbox-live.js";

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

async function makeApp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-live-"));
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

async function revision(app: SacFlowApp): Promise<string> {
  return (await app.inject({ method: "GET", url: "/api/inbox/revision", headers: actor("agent") })).json().data.revision;
}

async function firstContact(app: SacFlowApp) {
  const contacts = (await app.inject({ method: "GET", url: "/api/inbox/contacts?page=1&pageSize=50", headers: actor("agent") })).json().data;
  return (contacts as Array<{ contactKey: string; brandId: string; replyTarget?: { id: string; version: number } }>)
    .find((item) => item.replyTarget)!;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Registro de cambios de la bandeja", () => {
  it("entrega los ids cambiados desde una revisión y pide recarga completa cuando corresponde", () => {
    const log = new InboxChangeLog();
    const start = log.revision();
    log.record(["a", "b"]);
    log.bump();
    log.record(["b", "c"]);
    const after = log.bump();
    expect(log.changesSince(start)).toEqual({ revision: after, full: false, interactionIds: ["a", "b", "c"] });
    expect(log.changesSince(after)).toEqual({ revision: after, full: false, interactionIds: [] });
    // Revisión de otro arranque: no se sabe qué cambió.
    expect(log.changesSince("otro-0").full).toBe(true);
    log.record("all");
    log.bump();
    expect(log.changesSince(after).full).toBe(true);
    log.close();
  });
});

describe("GET /api/inbox/changes", () => {
  it("devuelve solo el contacto que cambió", async () => {
    const app = await makeApp();
    const contact = await firstContact(app);
    const since = await revision(app);
    const note = await app.inject({
      method: "POST",
      url: `/api/interactions/${contact.replyTarget!.id}/notes`,
      headers: actor("agent"),
      payload: { text: "Revisar stock", expectedVersion: contact.replyTarget!.version },
    });
    expect(note.statusCode).toBe(200);

    const changes = await app.inject({ method: "GET", url: `/api/inbox/changes?since=${encodeURIComponent(since)}`, headers: actor("agent") });
    expect(changes.statusCode).toBe(200);
    const data = changes.json().data;
    expect(data.full).toBe(false);
    expect(data.revision).not.toBe(since);
    expect(data.contacts.map((item: { contactKey: string }) => item.contactKey)).toEqual([contact.contactKey]);
    // Desde la revisión nueva ya no hay nada pendiente.
    const none = (await app.inject({ method: "GET", url: `/api/inbox/changes?since=${encodeURIComponent(data.revision)}`, headers: actor("agent") })).json().data;
    expect(none).toMatchObject({ full: false, contacts: [] });
  });

  it("no entrega contactos de marcas fuera del alcance", async () => {
    const app = await makeApp();
    const contact = await firstContact(app);
    const since = await revision(app);
    await app.inject({
      method: "POST",
      url: `/api/interactions/${contact.replyTarget!.id}/notes`,
      headers: actor("agent"),
      payload: { text: "Nota", expectedVersion: contact.replyTarget!.version },
    });
    const otherBrand = contact.brandId === "brand-01" ? "brand-02" : "brand-01";
    const scoped = (await app.inject({
      method: "GET",
      url: `/api/inbox/changes?since=${encodeURIComponent(since)}`,
      headers: actor("agent", otherBrand),
    })).json().data;
    expect(scoped.contacts).toEqual([]);
  });

  it("un cambio de marcas o flujo pide recarga completa", async () => {
    const app = await makeApp();
    const since = await revision(app);
    const update = await app.inject({ method: "PUT", url: "/api/workflow", headers: actor("admin"), payload: { pollIntervalMinutes: 10 } });
    expect(update.statusCode).toBe(200);
    const data = (await app.inject({ method: "GET", url: `/api/inbox/changes?since=${encodeURIComponent(since)}`, headers: actor("agent") })).json().data;
    expect(data.full).toBe(true);
  });
});

describe("GET /api/inbox/stream", () => {
  it("avisa la revisión al conectar y cada vez que cambia", async () => {
    const app = await makeApp();
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/inbox/stream`, { headers: actor("agent"), signal: controller.signal });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const nextEvent = async () => {
      let text = "";
      while (!text.includes("\n\n")) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      return text;
    };
    const first = await nextEvent();
    expect(first).toContain("event: revision");
    const initial = JSON.parse(first.split("data: ")[1]!.split("\n")[0]!).revision as string;

    const contact = await firstContact(app);
    await app.inject({
      method: "POST",
      url: `/api/interactions/${contact.replyTarget!.id}/notes`,
      headers: actor("agent"),
      payload: { text: "Aviso en vivo", expectedVersion: contact.replyTarget!.version },
    });
    let next = "";
    // Las lecturas previas (contactos) no avanzan la revisión; la nota sí.
    for (let attempt = 0; attempt < 5 && !next.includes("event: revision"); attempt += 1) next = await nextEvent();
    const updated = JSON.parse(next.split("data: ")[1]!.split("\n")[0]!).revision as string;
    expect(updated).not.toBe(initial);
    controller.abort();
  });

  it("exige sesión", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-live-auth-"));
    directories.push(directory);
    const app = await buildApp({ config: loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
      SAC_FLOW_AUTH_MODE: "google",
      GOOGLE_OAUTH_CLIENT_ID: "cliente.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "secreto",
      SAC_FLOW_AUTH_ALLOWED_DOMAINS: "demo.test",
    }, directory) });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/inbox/stream" });
    expect(response.statusCode).toBe(401);
  });
});
