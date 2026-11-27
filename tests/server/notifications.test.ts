/**
 * Campana de notificaciones: qué avisa (lo nuevo de clientes) y dónde se guarda lo leído (por
 * persona en la base). Nombres y textos ficticios.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { IdentityError, type IdentityService } from "../../server/identity.js";
import type { ActorContext } from "../../server/types.js";
import { buildNotifications, notificationAge, notificationTitle } from "../../src/lib/notifications.js";
import type { Interaction } from "../../src/types.js";

const NOW = Date.parse("2026-11-25T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function row(id: string, overrides: Partial<Interaction> = {}): Interaction {
  return {
    id,
    contactKey: `contact-${id}`,
    accountId: "account-01",
    brandName: "Marca Demo",
    brandInitials: "MD",
    customerName: `Cliente ${id}`,
    customerHandle: `@cliente_${id}`,
    platform: "instagram",
    kind: "dm",
    direction: "inbound",
    preview: "Hola, ¿me ayudan?",
    receivedAt: minutesAgo(10),
    receivedAtLabel: "hace 10 min",
    status: "pending",
    priority: "normal",
    sentiment: "neutral",
    ...overrides,
  };
}

describe("buildNotifications", () => {
  it("avisa lo nuevo de clientes, ordenado del más reciente al más antiguo", () => {
    const result = buildNotifications([
      row("a", { receivedAt: minutesAgo(30) }),
      row("b", { receivedAt: minutesAgo(5), kind: "comment", platform: "facebook" }),
      row("c", { direction: "outbound" }), // el equipo respondió último
      row("d", { status: "resolved" }), // cerrado (incluye historial importado)
      row("e", { noise: { kind: "repetido", label: "Repetido", origen: "reglas" } }), // spam por reglas
      row("f", { noise: { kind: "ia_spam", label: "Posible spam", origen: "ia" } }), // la IA solo sugiere
    ], { seenAt: minutesAgo(60), now: NOW });
    expect(result.items.map((item) => item.interaction.id)).toEqual(["b", "f", "a"]);
    expect(result.unreadCount).toBe(3);
  });

  it("lo anterior a la última lectura no cuenta como no leído", () => {
    const result = buildNotifications([
      row("a", { receivedAt: minutesAgo(30) }),
      row("b", { receivedAt: minutesAgo(5), latestInboundAt: minutesAgo(5) }),
    ], { seenAt: minutesAgo(10), now: NOW });
    expect(result.items.map((item) => [item.interaction.id, item.unread])).toEqual([["b", true], ["a", false]]);
    expect(result.unreadCount).toBe(1);
  });

  it("sin lectura guardada cuenta las últimas 24 horas y respeta WhatsApp apagado", () => {
    const result = buildNotifications([
      row("viejo", { receivedAt: minutesAgo(25 * 60) }),
      row("wa", { platform: "whatsapp" }),
      row("ig"),
    ], { whatsappEnabled: false, now: NOW });
    expect(result.items.map((item) => item.interaction.id)).toEqual(["ig", "viejo"]);
    expect(result.unreadCount).toBe(1);
  });

  it("limita el panel sin dejar de contar las no leídas", () => {
    const many = Array.from({ length: 40 }, (_, index) => row(`n${index}`, { receivedAt: minutesAgo(index + 1) }));
    const result = buildNotifications(many, { seenAt: minutesAgo(600), now: NOW });
    expect(result.items).toHaveLength(30);
    expect(result.unreadCount).toBe(40);
  });

  it("titula y fecha en palabras", () => {
    expect(notificationTitle("dm")).toBe("Mensaje nuevo");
    expect(notificationTitle("comment")).toBe("Comentario nuevo");
    expect(notificationTitle("review")).toBe("Reseña nueva");
    expect(notificationAge(minutesAgo(0), NOW)).toBe("ahora");
    expect(notificationAge(minutesAgo(5), NOW)).toBe("hace 5 min");
    expect(notificationAge(minutesAgo(180), NOW)).toBe("hace 3 h");
    expect(notificationAge(minutesAgo(60 * 24 * 2), NOW)).toBe("hace 2 días");
  });
});

describe("PUT /api/me/notifications", () => {
  const apps: SacFlowApp[] = [];
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("guarda por persona hasta cuándo leyó, solo hacia adelante y nunca en el futuro", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-notifications-"));
    directories.push(directory);
    const config = loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
      SAC_FLOW_AUTH_MODE: "google",
      GOOGLE_OAUTH_CLIENT_ID: "cliente-de-prueba.apps.googleusercontent.com",
      GOOGLE_OAUTH_CLIENT_SECRET: "secreto-de-prueba",
      SAC_FLOW_API_KEY: "clave-api-de-prueba-notificaciones",
    }, directory);
    const actors: Record<string, ActorContext> = {
      ana: { userId: "g:1", displayName: "Ana", tenantId: "wiwo", role: "agent", brandIds: "all", source: "google", email: "ana@demo.test" },
      beto: { userId: "g:2", displayName: "Beto", tenantId: "wiwo", role: "agent", brandIds: "all", source: "google", email: "beto@demo.test" },
    };
    const identity: IdentityService = {
      config: config.auth,
      async resolveActor(cookie) {
        const actor = actors[cookie];
        if (!actor) throw new IdentityError(401, "SESSION_INVALID", "Sin sesión.");
        return actor;
      },
    };
    const app = await buildApp({ config, identity });
    apps.push(app);
    const as = (who: string) => ({ cookie: `wiwo_nodes_session=${who}` });
    const me = async (who: string) => (await app.inject({ method: "GET", url: "/api/me", headers: as(who) })).json().data;
    const mark = (who: string, seenAt: string) => app.inject({ method: "PUT", url: "/api/me/notifications", headers: as(who), payload: { seenAt } });

    expect((await me("ana")).notificationsSeenAt).toBeUndefined();
    const first = await mark("ana", "2026-11-25T10:00:00.000Z");
    expect(first.json().data).toEqual({ stored: true, notificationsSeenAt: "2026-11-25T10:00:00.000Z" });
    expect((await me("ana")).notificationsSeenAt).toBe("2026-11-25T10:00:00.000Z");
    // Es individual: otra persona no lo hereda.
    expect((await me("beto")).notificationsSeenAt).toBeUndefined();
    // No retrocede.
    await mark("ana", "2026-11-24T10:00:00.000Z");
    expect((await me("ana")).notificationsSeenAt).toBe("2026-11-25T10:00:00.000Z");
    // Nunca queda en el futuro.
    const future = await mark("ana", "2099-01-01T00:00:00.000Z");
    expect(Date.parse(future.json().data.notificationsSeenAt)).toBeLessThanOrEqual(Date.now());
    expect((await mark("ana", "no-es-fecha")).statusCode).toBe(400);
  });
});
