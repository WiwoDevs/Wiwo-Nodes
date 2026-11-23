/**
 * Ruido y spam: detección por reglas (texto repetido, mismo texto desde varias cuentas, solo
 * etiquetas, spam promocional) más la sugerencia de la IA en sombra; su efecto en la bandeja,
 * en los comentarios por publicación y en el reporte, y el descarte en lote confirmado por una
 * persona. Todos los textos y cuentas son ficticios.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { groupInboxContacts, groupInboxPosts } from "../../server/inbox-contacts.js";
import { detectNoise, isMentionsOnly, isPromotionalSpam } from "../../server/noise-detection.js";
import { buildSacReport, esMensajeGestionado } from "../../server/sac-report.js";
import { createDemoStore } from "../../server/seed.js";
import type { AiTriage, Interaction } from "../../server/types.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

let sequence = 0;
function comment(text: string, overrides: Partial<Interaction> = {}): Interaction {
  sequence += 1;
  const handle = overrides.customerHandle ?? `@persona_${sequence}`;
  return {
    id: `ruido-${sequence}`,
    externalId: `ext-ruido-${sequence}`,
    brandId: "brand-01",
    accountId: "account-01",
    channel: "instagram",
    type: "comment",
    direction: "inbound",
    customerName: handle.replace("@", ""),
    customerHandle: handle,
    text,
    category: "sin_clasificar",
    sentiment: "neutral",
    confidence: 0,
    status: "pending",
    source: "demo",
    version: 1,
    createdAt: "2026-11-20T12:00:00.000Z",
    updatedAt: "2026-11-20T12:00:00.000Z",
    internalNotes: [],
    audit: [],
    metricoolRef: { post: { id: `post-${overrides.metricoolRef?.post?.id ?? "a"}`, text: "Publicación ficticia" } } as Interaction["metricoolRef"],
    ...overrides,
  };
}

function at(minutes: number): string {
  return new Date(Date.parse("2026-11-20T12:00:00.000Z") + minutes * 60_000).toISOString();
}

const SPAM = "Gana dinero desde casa con trading, escríbeme por DM para más info";

describe("Detección de ruido por reglas", () => {
  it("marca el mismo texto largo repetido por una cuenta, pero no un 'precio?' ni un DM insistente", () => {
    const spammer = "@promo_ficticia";
    const repeated = [0, 5, 10].map((minute, index) => comment("Miren mi perfil que tengo ofertas increíbles todos los días", {
      customerHandle: spammer,
      createdAt: at(minute),
      metricoolRef: { post: { id: `post-${index}` } } as Interaction["metricoolRef"],
    }));
    const curious = [0, 5, 10].map((minute) => comment("precio?", { customerHandle: "@curiosa", createdAt: at(minute) }));
    const insistent = [0, 5, 10].map((minute) => comment("Hola, sigo esperando respuesta sobre mi pedido número 4821", {
      customerHandle: "@clienta", type: "dm", createdAt: at(minute),
    }));
    const twice = [0, 5].map((minute) => comment("Este texto largo aparece dos veces nada más", { customerHandle: "@dos", createdAt: at(minute) }));
    const signals = detectNoise([...repeated, ...curious, ...insistent, ...twice]);

    for (const item of repeated) expect(signals.get(item.id)).toMatchObject({ kind: "repetido", origen: "reglas", veces: 3 });
    for (const item of [...curious, ...insistent, ...twice]) expect(signals.has(item.id)).toBe(false);
  });

  it("marca el mismo texto desde tres cuentas en pocas horas, no si está separado por días", () => {
    const text = "Participando con todas mis ganas en este sorteo increíble";
    const burst = ["@uno", "@dos", "@tres"].map((handle, index) => comment(text, { customerHandle: handle, createdAt: at(index * 30) }));
    const spread = ["@cuatro", "@cinco", "@seis"].map((handle, index) => comment("Otro texto largo que se repite cada varios días", {
      customerHandle: handle, createdAt: at(index * 60 * 24 * 4),
    }));
    const signals = detectNoise([...burst, ...spread]);
    for (const item of burst) expect(signals.get(item.id)).toMatchObject({ kind: "coordinado", label: "Mismo texto desde 3 cuentas" });
    for (const item of spread) expect(signals.has(item.id)).toBe(false);
  });

  it("separa etiquetas sueltas y spam promocional de los clientes reales", () => {
    expect(isMentionsOnly("@ana_ficticia @luis.ficticio 😍😍")).toBe(true);
    expect(isMentionsOnly("@ana_ficticia mira estas zapatillas")).toBe(false);
    expect(isPromotionalSpam(SPAM)).toBe(true);
    expect(isPromotionalSpam("Tu página será desactivada por infracción de normas, verifica tu cuenta aquí https://ejemplo.test/x")).toBe(true);
    expect(isPromotionalSpam("¿Me pueden responder por WhatsApp? Necesito cambiar la talla")).toBe(false);
    expect(isPromotionalSpam("@marca_ficticia cuándo llega mi premio del sorteo?")).toBe(false);

    const tags = comment("@ana_ficticia @luis.ficticio");
    const promo = comment(SPAM, { type: "dm" });
    const real = comment("Hola, ¿tienen la talla 38 en negro?");
    const signals = detectNoise([tags, promo, real]);
    expect(signals.get(tags.id)?.kind).toBe("solo_menciones");
    expect(signals.get(promo.id)?.kind).toBe("promocional");
    expect(signals.has(real.id)).toBe(false);
  });

  it("suma la sugerencia de spam de la IA en sombra, marcada como de la IA", () => {
    const aiTriage: AiTriage = {
      categoria: "no_aplica", tonalidad: "neutral", esCasoSac: false, requiereDerivacion: false, sensible: false,
      ruido: "estafa_phishing", confianza: 0.9, clasificadoEn: at(0), proveedor: "byteplus", modelo: "x", promptVersion: "sac-triage-v3",
    };
    const item = comment("Felicidades, fuiste elegida, entra al enlace de mi perfil", { aiTriage });
    expect(detectNoise([item]).get(item.id)).toMatchObject({ kind: "ia_spam", origen: "ia", label: "IA: posible estafa o suplantación" });
  });
});

describe("Ruido en la bandeja y en los comentarios por publicación", () => {
  it("abre primero el comentario real y cuenta el spam aparte", () => {
    const handle = "@mezcla";
    const spam = [0, 1, 2].map((minute) => comment(SPAM, { customerHandle: handle, createdAt: at(minute) }));
    const real = comment("Hola, ¿hacen envíos a regiones?", { customerHandle: handle, createdAt: at(-10) });
    const contacts = groupInboxContacts([...spam, real]);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.replyTarget?.id).toBe(real.id);
    expect(contacts[0]!.replyTarget?.noise).toBeUndefined();
    expect(contacts[0]!.noiseCount).toBe(3);

    const posts = groupInboxPosts([...spam, real]);
    expect(posts[0]!.noisePendingCount).toBe(3);
    expect(posts[0]!.replyTarget?.id).toBe(real.id);
  });

  it("una persona que solo manda spam queda con el aviso en su caso", () => {
    const spam = [0, 1, 2].map((minute) => comment(SPAM, { customerHandle: "@bot_ficticio", createdAt: at(minute) }));
    const contacts = groupInboxContacts(spam);
    expect(contacts[0]!.replyTarget?.noise).toMatchObject({ kind: "repetido", origen: "reglas" });
  });
});

describe("Ruido en el reporte mensual", () => {
  const store = createDemoStore(new Date("2026-11-20T12:00:00.000Z"));
  const brand = { ...store.brands[0]!, id: "brand-01" };
  const options = { from: "2026-11-01", to: "2026-11-30", previous: { from: "2026-10-01", to: "2026-10-31" }, label: "Noviembre 2026", volumen: "gestionado" as const };

  it("no cuenta el spam detectado por reglas ni las cadenas de etiquetas, salvo marca manual", () => {
    const spam = [0, 1, 2].map((minute) => comment(SPAM, { customerHandle: "@bot", createdAt: at(minute) }));
    const tags = comment("@ana_ficticia @luis.ficticio @pia.ficticia @tomas_ficticio");
    const rescued = comment(SPAM, {
      customerHandle: "@bot",
      createdAt: at(3),
      sacTriage: { categoria: "consulta_general", esCasoSac: true, requiereDerivacion: false, confianza: 1, clasificadoEn: at(4), modelo: "manual" },
    });
    const real = comment("Hola, ¿cuándo llega mi pedido? Lo compré hace una semana");
    expect(esMensajeGestionado(tags)).toBe(false);

    const figures = buildSacReport(brand, [...spam, tags, rescued, real], options);
    expect(figures.casosSac).toBe(2);
    // Tres mensajes de spam repetido más la cadena de etiquetas; el rescatado a mano no cuenta.
    expect(figures.clasificacion).toMatchObject({ manual: 1, spam: 4 });
  });
});

describe("Descartar spam en lote", () => {
  function headers(role: "agent" | "supervisor") {
    return {
      "x-sac-user-id": `user-${role}`,
      "x-sac-user-name": `Usuario ${role}`,
      "x-sac-tenant-id": "tenant-test",
      "x-sac-role": role,
      "x-sac-brand-ids": "*",
    };
  }

  async function makeApp() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-noise-"));
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

  it("cuenta primero, descarta al confirmar y deja intactos los sensibles y lo marcado a mano", async () => {
    const app = await makeApp();
    const store = await app.sacFlow.repository.snapshot();
    const brand = store.brands[0]!;
    const now = Date.now();
    const base = (minute: number, overrides: Partial<Interaction> = {}) => comment(SPAM, {
      brandId: brand.id,
      accountId: brand.account.id,
      customerHandle: "@bot_lote",
      createdAt: new Date(now - (30 - minute) * 60_000).toISOString(),
      updatedAt: new Date(now).toISOString(),
      ...overrides,
    });
    const plain = [base(0), base(1)];
    const sensitive = base(2, { sentiment: "negative" });
    const kept = base(3, {
      sacTriage: { categoria: "consulta_general", esCasoSac: true, requiereDerivacion: false, confianza: 1, clasificadoEn: new Date(now).toISOString(), modelo: "manual" },
    });
    await app.sacFlow.repository.insertInteractions([...plain, sensitive, kept]);

    const forbidden = await app.inject({ method: "POST", url: "/api/interactions/discard-noise", headers: headers("agent"), payload: { dryRun: true } });
    expect(forbidden.statusCode).toBe(403);

    const preview = await app.inject({ method: "POST", url: "/api/interactions/discard-noise", headers: headers("supervisor"), payload: { dryRun: true, accountId: brand.account.id } });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toMatchObject({ dryRun: true, discarded: 0, eligible: 2, skippedSensitive: 1, byOrigin: { reglas: 2 } });

    const done = await app.inject({ method: "POST", url: "/api/interactions/discard-noise", headers: headers("supervisor"), payload: { dryRun: false, accountId: brand.account.id } });
    expect(done.json().data).toMatchObject({ dryRun: false, discarded: 2 });
    expect(done.json().meta.externalWrites).toBe(false);

    for (const item of plain) {
      const saved = (await app.sacFlow.repository.findInteraction(item.id))!;
      expect(saved.status).toBe("resolved");
      expect(saved.statusReason?.code).toBe("spam");
      expect(saved.sacTriage).toMatchObject({ esCasoSac: false, modelo: "manual", marcadoPor: "Usuario supervisor" });
      expect(saved.audit.at(-1)?.metadata).toMatchObject({ bulk: true, noiseKind: "repetido" });
    }
    expect((await app.sacFlow.repository.findInteraction(sensitive.id))!.status).toBe("pending");
    expect((await app.sacFlow.repository.findInteraction(kept.id))!.status).toBe("pending");
  });
});
