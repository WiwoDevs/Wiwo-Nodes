/**
 * IA en modo sombra: adaptador de proveedores (DeepSeek vía BytePlus ModelArk y Claude),
 * enmascarado de datos personales, clasificador, escritura en `aiTriage` sin tocar lo manual,
 * escalado "solo hacia arriba" y rutas de estado/concordancia. Nada de esto llama a la red:
 * el proveedor y fetch son falsos y todos los textos son ficticios.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifierPayload, classifyInteractions, ClassifierError } from "../../server/ai-classifier.js";
import {
  AiProviderError,
  BYTEPLUS_DEFAULT_BASE_URL,
  BYTEPLUS_DEFAULT_MODEL,
  createAiProvider,
  createBytePlusProvider,
  type AiJsonRequest,
  type AiProvider,
} from "../../server/ai-provider.js";
import { redactPersonalData } from "../../server/ai-redaction.js";
import { applicableApprovedAnswers, draftAiReply, fillName, unverifiedFacts } from "../../server/ai-reply-draft.js";
import { buildAiAgreement, needsShadowTriage, runShadowTriage } from "../../server/ai-shadow-triage.js";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { JsonRepository } from "../../server/repository.js";
import { isSensitiveCase } from "../../server/reply-window.js";
import { evaluateSacInteraction } from "../../server/sac-automation.js";
import { esMensajeGestionado } from "../../server/sac-report.js";
import { requiresHumanReview } from "../../server/safety-policy.js";
import { createDemoStore } from "../../server/seed.js";
import type { AiTriage, Interaction } from "../../server/types.js";

const FAKE_KEY = "test-byteplus-key-not-real";
const directories: string[] = [];
const apps: SacFlowApp[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function interaction(text: string, overrides: Partial<Interaction> = {}): Interaction {
  return {
    id: `ai-${Math.random().toString(36).slice(2)}`,
    externalId: `external-${Math.random()}`,
    brandId: "brand-01",
    accountId: "account-01",
    channel: "instagram",
    type: "dm",
    direction: "inbound",
    customerName: "Ana Ficticia",
    customerHandle: "@ana.ficticia",
    text,
    category: "sin_clasificar",
    sentiment: "neutral",
    confidence: 0,
    status: "new",
    source: "demo",
    version: 1,
    createdAt: "2026-08-13T13:55:00.000Z",
    updatedAt: "2026-08-13T13:55:00.000Z",
    internalNotes: [],
    audit: [],
    ...overrides,
  };
}

function aiTriage(overrides: Partial<AiTriage> = {}): AiTriage {
  return {
    categoria: "consulta_general",
    tonalidad: "neutral",
    esCasoSac: true,
    requiereDerivacion: false,
    sensible: false,
    confianza: 0.9,
    clasificadoEn: "2026-08-13T14:00:00.000Z",
    proveedor: "byteplus",
    modelo: BYTEPLUS_DEFAULT_MODEL,
    promptVersion: "sac-triage-v2",
    ...overrides,
  };
}

/** Proveedor falso: clasifica cada id recibido y registra lo que se le envió. */
function fakeProvider(decide: (item: { id: string; texto: string }) => Partial<Record<string, unknown>> = () => ({})) {
  const requests: AiJsonRequest[] = [];
  const provider: AiProvider = {
    name: "byteplus",
    model: BYTEPLUS_DEFAULT_MODEL,
    async completeJson(request) {
      requests.push(request);
      const items = JSON.parse(request.user.slice(request.user.indexOf("\n\n") + 2)) as Array<{ id: string; texto: string }>;
      return {
        model: BYTEPLUS_DEFAULT_MODEL,
        usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
        json: {
          results: items.map((item) => ({
            id: item.id,
            categoria: "consulta_general",
            tonalidad: "neutral",
            esCasoSac: true,
            requiereDerivacion: false,
            sensible: false,
            motivoSensible: "ninguno",
            ruido: "ninguno",
            confianza: 0.8,
            ...decide(item),
          })),
        },
      };
    },
  };
  return { provider, requests };
}

describe("Enmascarado de datos personales", () => {
  it("reemplaza correo, enlaces, usuarios, RUT, tarjetas y teléfonos por marcadores", () => {
    const text = "Soy @juanito_99, mi correo es juan.perez@correo.cl, RUT 12.345.678-5, "
      + "fono +56 9 8765 4321, tarjeta 4111 1111 1111 1111 y el link https://tienda.cl/pedido/123";
    const redacted = redactPersonalData(text);
    expect(redacted).toContain("[USUARIO]");
    expect(redacted).toContain("[EMAIL]");
    expect(redacted).toContain("[RUT]");
    expect(redacted).toContain("[TELEFONO]");
    expect(redacted).toContain("[TARJETA]");
    expect(redacted).toContain("[URL]");
    for (const leaked of ["juanito_99", "juan.perez", "12.345.678", "8765", "4111", "tienda.cl"]) {
      expect(redacted).not.toContain(leaked);
    }
  });

  it("deja intacto el texto sin datos personales", () => {
    expect(redactPersonalData("¿Tienen la talla 38 en negro? 😍")).toBe("¿Tienen la talla 38 en negro? 😍");
  });
});

describe("Proveedor BytePlus ModelArk (DeepSeek)", () => {
  const request: AiJsonRequest = {
    system: "Sistema",
    user: "Usuario",
    schemaName: "prueba",
    jsonSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    maxTokens: 500,
  };

  function provider(fetchImpl: (url: string, init: RequestInit) => Promise<Response>) {
    return createBytePlusProvider({ apiKey: FAKE_KEY, model: BYTEPLUS_DEFAULT_MODEL, baseUrl: BYTEPLUS_DEFAULT_BASE_URL, timeoutMs: 5_000, fetchImpl });
  }

  it("llama a chat/completions compatible con OpenAI con json_schema estricto y sin razonamiento", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      model: BYTEPLUS_DEFAULT_MODEL,
      choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } },
    }), { status: 200 }));
    const result = await provider(fetchImpl).completeJson(request);

    expect(result).toEqual({ json: { ok: true }, model: BYTEPLUS_DEFAULT_MODEL, usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 } });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://ark.ap-southeast.bytepluses.com/api/v3/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${FAKE_KEY}`);
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: BYTEPLUS_DEFAULT_MODEL,
      max_tokens: 500,
      response_format: { type: "json_schema", json_schema: { name: "prueba", strict: true } },
      thinking: { type: "disabled" },
    });
    expect(body.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
  });

  it("traduce los errores sin filtrar la clave ni el mensaje del proveedor", async () => {
    const cases: Array<[number, string]> = [[401, "auth"], [429, "rate_limited"], [500, "http"]];
    for (const [status, code] of cases) {
      const fetchImpl = async () => new Response(JSON.stringify({ error: { code: "SomeCode", message: `eco ${FAKE_KEY} texto cliente` } }), { status });
      const error = await provider(fetchImpl).completeJson(request).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AiProviderError);
      expect((error as AiProviderError).code).toBe(code);
      expect((error as Error).message).not.toContain(FAKE_KEY);
      expect((error as Error).message).not.toContain("texto cliente");
    }
  });

  it("rechaza respuestas truncadas o que no son JSON", async () => {
    const truncated = async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{\"a\":" } }] }), { status: 200 });
    const notJson = async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "hola" } }] }), { status: 200 });
    await expect(provider(truncated).completeJson(request)).rejects.toMatchObject({ code: "invalid_output" });
    await expect(provider(notJson).completeJson(request)).rejects.toMatchObject({ code: "invalid_output" });
  });
});

describe("Configuración de IA", () => {
  it("queda apagada por defecto, con DeepSeek en BytePlus como proveedor y ninguna marca autorizada", () => {
    const config = loadConfig({ METRICOOL_MODE: "demo" });
    expect(config.ai).toMatchObject({
      enabled: false,
      provider: "byteplus",
      model: BYTEPLUS_DEFAULT_MODEL,
      baseUrl: BYTEPLUS_DEFAULT_BASE_URL,
      brandIds: [],
    });
    expect(createAiProvider(config.ai)).toEqual({ ready: false, reason: "disabled" });
  });

  it("encendida sin clave no arma proveedor; con clave sí", () => {
    const sinClave = loadConfig({ METRICOOL_MODE: "demo", SAC_FLOW_AI_ENABLED: "true" });
    expect(createAiProvider(sinClave.ai)).toEqual({ ready: false, reason: "missing_api_key" });
    const conClave = loadConfig({ METRICOOL_MODE: "demo", SAC_FLOW_AI_ENABLED: "true", BYTEPLUS_API_KEY: FAKE_KEY, SAC_FLOW_AI_BRAND_IDS: "*" });
    const state = createAiProvider(conClave.ai);
    expect(state.ready && state.provider.name).toBe("byteplus");
    expect(conClave.ai.brandIds).toBe("all");
  });
});

describe("Clasificador", () => {
  it("envía solo id, texto enmascarado, canal y tipo: nunca nombre ni usuario del cliente", async () => {
    const item = interaction("Hola, escríbanme a ana@correo.cl o al 987654321 por mi pedido");
    expect(classifierPayload(item)).toEqual({
      id: item.id,
      texto: "Hola, escríbanme a [EMAIL] o al [TELEFONO] por mi pedido",
      canal: "instagram",
      tipo: "dm",
    });
    const { provider, requests } = fakeProvider();
    await classifyInteractions([item], { provider });
    expect(requests[0]!.user).not.toContain("Ana Ficticia");
    expect(requests[0]!.user).not.toContain("ana.ficticia");
    expect(requests[0]!.user).not.toContain("ana@correo.cl");
  });

  it("ignora ids ajenos al lote, fuerza la coherencia y conserva el motivo sensible", async () => {
    const item = interaction("Me cobraron dos veces, voy a ir al SERNAC");
    const provider: AiProvider = {
      name: "byteplus",
      model: BYTEPLUS_DEFAULT_MODEL,
      async completeJson() {
        return {
          model: BYTEPLUS_DEFAULT_MODEL,
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
          json: {
            results: [
              { id: item.id, categoria: "pago_facturacion", tonalidad: "negative", esCasoSac: false, requiereDerivacion: true, sensible: true, motivoSensible: "legal", ruido: "ninguno", confianza: 1.4 },
              { id: "otro-caso", categoria: "reclamo", tonalidad: "negative", esCasoSac: true, requiereDerivacion: false, sensible: false, motivoSensible: "ninguno", ruido: "ninguno", confianza: 0.5 },
            ],
          },
        };
      },
    };
    const outcomes = await classifyInteractions([item], { provider });
    expect(outcomes).toEqual([{
      id: item.id,
      categoria: "pago_facturacion",
      tonalidad: "negative",
      esCasoSac: false,
      requiereDerivacion: false,
      sensible: true,
      motivoSensible: "legal",
      ruido: "ninguno",
      confianza: 1,
    }]);
  });

  it("falla con ClassifierError si la respuesta no calza con el esquema", async () => {
    const provider: AiProvider = {
      name: "byteplus",
      model: BYTEPLUS_DEFAULT_MODEL,
      completeJson: async () => ({ model: "x", usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }, json: { results: [{ id: "x" }] } }),
    };
    await expect(classifyInteractions([interaction("hola")], { provider })).rejects.toBeInstanceOf(ClassifierError);
  });
});

describe("La señal sensible de la IA solo escala", () => {
  const now = new Date("2026-08-13T14:00:00.000Z");
  function readyStore() {
    const store = createDemoStore(now);
    store.workflow.autoReplyEnabled = true;
    store.workflow.autoReplyAccountIds = ["account-01"];
    return store;
  }

  it("un caso elegible para respuesta automática pasa a revisión humana si la IA lo marca sensible", () => {
    const store = readyStore();
    const safe = interaction("¿Cuál es el horario de atención?");
    const flagged = interaction("¿Cuál es el horario de atención?", { aiTriage: aiTriage({ sensible: true, motivoSensible: "crisis" }) });
    store.interactions.push(safe, flagged);
    const options = { evaluatedAt: now, autoSendInfrastructureReady: true, autoReplyDispatchMode: "live" as const };

    expect(evaluateSacInteraction(safe, store, options).recommendedRoute).toBe("auto_reply");
    const result = evaluateSacInteraction(flagged, store, options);
    expect(result.recommendedRoute).toBe("human_review");
    expect(result.reasonCodes).toContain("AI_SENSITIVE_SIGNAL");
    expect(result.risk).toBe("high");
    expect(requiresHumanReview(flagged, store.workflow, 0.99)).toBe(true);
    expect(isSensitiveCase(flagged)).toBe(true);
  });

  it("una IA que dice 'no sensible' no saca de revisión humana a un caso negativo", () => {
    const store = readyStore();
    const negative = interaction("Pésimo servicio, quiero un reclamo", {
      sentiment: "negative",
      aiTriage: aiTriage({ sensible: false, tonalidad: "positive" }),
    });
    store.interactions.push(negative);
    const result = evaluateSacInteraction(negative, store, { evaluatedAt: now, autoSendInfrastructureReady: true, autoReplyDispatchMode: "live" });
    expect(result.recommendedRoute).toBe("human_review");
    expect(requiresHumanReview(negative, store.workflow, 0.99)).toBe(true);
    expect(isSensitiveCase(negative)).toBe(true);
  });
});

describe("Clasificación en sombra sobre el repositorio", () => {
  async function repository() {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-ai-"));
    directories.push(directory);
    const repo = new JsonRepository(path.join(directory, "store.json"));
    await repo.initialize();
    return repo;
  }

  it("escribe solo aiTriage, en las marcas autorizadas, sin pisar lo manual ni la versión", async () => {
    const repo = await repository();
    const store = await repo.snapshot();
    const brandId = store.brands[0]!.id;
    const candidates = store.interactions.filter((item) => item.brandId === brandId && needsShadowTriage(item));
    expect(candidates.length).toBeGreaterThan(1);
    const manualId = candidates[0]!.id;
    await repo.mutateInteractions([manualId], (draft) => {
      const item = draft.interactions.find((entry) => entry.id === manualId)!;
      item.sacTriage = { categoria: "no_aplica", esCasoSac: false, requiereDerivacion: false, confianza: 1, clasificadoEn: "2026-08-01T00:00:00.000Z", modelo: "manual", marcadoPor: "Supervisora" };
    });
    const before = new Map((await repo.snapshot()).interactions.map((item) => [item.id, structuredClone(item)]));

    const { provider, requests } = fakeProvider((item) => (item.texto.length % 2 ? { sensible: true, motivoSensible: "reclamo" } : {}));
    const result = await runShadowTriage(repo, {
      provider,
      brandIds: [brandId],
      batchSize: 5,
      maxPerRun: 500,
      from: "2000-01-01T00:00:00.000Z",
    });

    expect(result.classified).toBe(candidates.length - 1);
    expect(result.failedBatches).toBe(0);
    expect(requests.every((request) => !request.user.includes(manualId))).toBe(true);
    const after = (await repo.snapshot()).interactions;
    for (const item of after) {
      const previous = before.get(item.id)!;
      expect(item.sacTriage).toEqual(previous.sacTriage);
      expect(item.category).toBe(previous.category);
      expect(item.sentiment).toBe(previous.sentiment);
      expect(item.confidence).toBe(previous.confidence);
      expect(item.status).toBe(previous.status);
      expect(item.version).toBe(previous.version);
      if (item.brandId !== brandId || item.id === manualId) expect(item.aiTriage).toBeUndefined();
    }
    const classified = after.filter((item) => item.aiTriage);
    expect(classified).toHaveLength(candidates.length - 1);
    expect(classified[0]!.aiTriage).toMatchObject({ proveedor: "byteplus", modelo: BYTEPLUS_DEFAULT_MODEL, promptVersion: "sac-triage-v3" });
    expect(classified[0]!.audit.at(-1)).toMatchObject({ action: "classified", actor: "system", metadata: { shadow: true } });

    // Reanudable: una segunda corrida no vuelve a gastar en lo ya clasificado.
    const again = await runShadowTriage(repo, { provider, brandIds: [brandId], batchSize: 5, maxPerRun: 500, from: "2000-01-01T00:00:00.000Z" });
    expect(again.candidates).toBe(0);
  });

  it("sin marcas autorizadas no envía nada al proveedor", async () => {
    const repo = await repository();
    const { provider, requests } = fakeProvider();
    const result = await runShadowTriage(repo, { provider, brandIds: [], batchSize: 5, maxPerRun: 500, from: "2000-01-01T00:00:00.000Z" });
    expect(result.candidates).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it("un lote fallido no frena a los demás ni escribe nada a medias", async () => {
    const repo = await repository();
    const brandId = (await repo.snapshot()).brands[0]!.id;
    let calls = 0;
    const { provider: base } = fakeProvider();
    const provider: AiProvider = {
      ...base,
      async completeJson(request) {
        calls += 1;
        if (calls === 1) throw new AiProviderError("BytePlus respondió con estado 500.", "http", 500);
        return base.completeJson(request);
      },
    };
    const result = await runShadowTriage(repo, { provider, brandIds: [brandId], batchSize: 2, maxPerRun: 500, from: "2000-01-01T00:00:00.000Z" });
    expect(result.failedBatches).toBe(1);
    expect(result.firstError).toContain("500");
    expect(result.classified).toBe(result.candidates - 2);
  });
});

describe("Concordancia de la IA", () => {
  it("compara contra lo manual y contra las reglas, sin contar registros de planilla", () => {
    const items = [
      interaction("Mi pedido no llega hace dos semanas", { aiTriage: aiTriage({ esCasoSac: true }) }),
      interaction("😍", { aiTriage: aiTriage({ esCasoSac: true, sensible: true }) }),
      interaction("Hola quiero saber el precio", {
        aiTriage: aiTriage({ esCasoSac: false }),
        sacTriage: { categoria: "precio", esCasoSac: true, requiereDerivacion: false, confianza: 1, clasificadoEn: "2026-08-01T00:00:00.000Z", modelo: "manual" },
      }),
      interaction("sin clasificar todavía por la ia"),
      interaction("registro histórico de planilla", { source: "planilla", aiTriage: aiTriage() }),
    ];
    const agreement = buildAiAgreement(items, esMensajeGestionado);
    expect(agreement).toMatchObject({
      inbound: 4,
      aiClassified: 3,
      aiSensitive: 1,
      vsManual: { compared: 1, agree: 0, pct: 0, aiNoiseOtherCase: 1 },
      vsRules: { compared: 2, agree: 1, pct: 50, aiCaseOtherNoise: 1 },
    });
  });
});

describe("Rutas /api/ai", () => {
  function headers(role: "agent" | "supervisor") {
    return {
      "x-sac-user-id": `user-${role}`,
      "x-sac-user-name": `Usuario ${role}`,
      "x-sac-tenant-id": "tenant-test",
      "x-sac-role": role,
      "x-sac-brand-ids": "*",
    };
  }

  async function makeApp(extra: Record<string, string> = {}) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-ai-api-"));
    directories.push(directory);
    const config = loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
      SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
      ...extra,
    }, directory);
    const app = await buildApp({ config });
    apps.push(app);
    return app;
  }

  it("informa el estado sin exponer la clave y exige permiso de métricas", async () => {
    const app = await makeApp({ SAC_FLOW_AI_ENABLED: "true", BYTEPLUS_API_KEY: FAKE_KEY, SAC_FLOW_AI_BRAND_IDS: "*" });
    const response = await app.inject({ method: "GET", url: "/api/ai/status", headers: headers("supervisor") });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(FAKE_KEY);
    expect(response.json().data).toMatchObject({
      enabled: true,
      ready: true,
      mode: "shadow",
      provider: "byteplus",
      model: BYTEPLUS_DEFAULT_MODEL,
      endpointHost: "ark.ap-southeast.bytepluses.com",
      brandScope: "all",
    });
    const forbidden = await app.inject({ method: "GET", url: "/api/ai/status", headers: headers("agent") });
    expect(forbidden.statusCode).toBe(403);
  });

  it("apagada por defecto, y la concordancia responde cifras del mes", async () => {
    const app = await makeApp();
    const status = await app.inject({ method: "GET", url: "/api/ai/status", headers: headers("supervisor") });
    expect(status.json().data).toMatchObject({ enabled: false, ready: false, reason: "disabled", authorizedBrands: [] });
    const month = new Date().toISOString().slice(0, 7);
    const agreement = await app.inject({ method: "GET", url: `/api/ai/agreement?month=${month}`, headers: headers("supervisor") });
    expect(agreement.statusCode).toBe(200);
    expect(agreement.json().data).toMatchObject({ month, aiClassified: 0, vsManual: { compared: 0, pct: null } });
    const invalid = await app.inject({ method: "GET", url: "/api/ai/agreement?month=2026-13", headers: headers("supervisor") });
    expect(invalid.statusCode).toBe(400);
  });
});

describe("Recomendación de respuesta con IA", () => {
  it("completa o quita el nombre sin dejar signos sueltos", () => {
    expect(fillName("¡Hola {nombre}! Gracias por escribir.", "Ana")).toBe("¡Hola Ana! Gracias por escribir.");
    expect(fillName("¡Hola {nombre}! Gracias por escribir.", undefined)).toBe("¡Hola! Gracias por escribir.");
    expect(fillName("{nombre}, gracias por escribir.", undefined)).toBe("Gracias por escribir.");
  });

  it("advierte cifras, enlaces y cuentas que no están en el QA citado ni en el mensaje", () => {
    const sources = ["Atendemos de lunes a jueves de 09:00 a 18:00.", "Hola, mi pedido 48213 no llega"];
    expect(unverifiedFacts("Atendemos de 09:00 a 18:00 y revisamos tu pedido 48213.", sources)).toEqual([]);
    expect(unverifiedFacts("Tiene 20% de descuento, más info en https://tienda.cl o con @soporte", sources))
      .toEqual(expect.arrayContaining(["enlace https://tienda.cl", "cuenta @soporte", "número 20"]));
  });

  it("usa el QA aplicable, no envía el nombre del cliente y filtra fuentes inventadas", async () => {
    const store = createDemoStore(new Date("2026-08-13T14:00:00.000Z"));
    const brand = store.brands.find((item) => item.sacPolicy?.approvedAnswers.length)!;
    const answers = applicableApprovedAnswers(brand, interaction("x", { brandId: brand.id }));
    const item = interaction("Hola, ¿cuál es el horario? escríbanme a ana@correo.cl", { brandId: brand.id, aiTriage: aiTriage({ sensible: true }) });
    const requests: AiJsonRequest[] = [];
    const provider: AiProvider = {
      name: "byteplus",
      model: BYTEPLUS_DEFAULT_MODEL,
      async completeJson(request) {
        requests.push(request);
        return {
          model: BYTEPLUS_DEFAULT_MODEL,
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
          json: { texto: "¡Hola {nombre}! Atendemos de lunes a jueves de 09:00 a 18:00.", fuentesQa: [answers[0]!.id, "inventada"], sinRespuestaAprobada: false, requiereHumano: false, motivo: "Horario del QA." },
        };
      },
    };
    const { draft } = await draftAiReply({ brand, interaction: item, history: [], answers }, provider);
    expect(draft.texto).toBe("¡Hola Ana! Atendemos de lunes a jueves de 09:00 a 18:00.");
    expect(draft.fuentes.map((source) => source.id)).toEqual([answers[0]!.id]);
    expect(draft.sinRespuestaAprobada).toBe(false);
    expect(draft.requiereHumano).toBe(true);
    expect(draft.advertencias).toEqual([]);
    expect(requests[0]!.user).not.toContain("Ana Ficticia");
    expect(requests[0]!.user).not.toContain("ana.ficticia");
    expect(requests[0]!.user).not.toContain("ana@correo.cl");
    expect(requests[0]!.user).toContain(answers[0]!.id);
    expect(requests[0]!.user).not.toContain("{brand}");
  });
});

describe("Rutas de recomendación con IA", () => {
  function headers(role: "viewer" | "agent") {
    return {
      "x-sac-user-id": `user-${role}`,
      "x-sac-user-name": `Usuario ${role}`,
      "x-sac-tenant-id": "tenant-test",
      "x-sac-role": role,
      "x-sac-brand-ids": "*",
    };
  }

  async function makeApp(extra: Record<string, string>, provider?: AiProvider) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-ai-draft-"));
    directories.push(directory);
    const config = loadConfig({
      METRICOOL_MODE: "demo",
      SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
      SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
      ...extra,
    }, directory);
    const app = await buildApp({ config, ...(provider ? { aiProvider: provider } : {}) });
    apps.push(app);
    return app;
  }

  function draftProvider() {
    let calls = 0;
    const provider: AiProvider = {
      name: "byteplus",
      model: BYTEPLUS_DEFAULT_MODEL,
      async completeJson() {
        calls += 1;
        return {
          model: BYTEPLUS_DEFAULT_MODEL,
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
          json: { texto: "Gracias por escribir, lo revisamos y te respondemos por aquí.", fuentesQa: [], sinRespuestaAprobada: true, requiereHumano: false, motivo: "No hay QA para esta consulta." },
        };
      },
    };
    return { provider, calls: () => calls };
  }

  async function inboundId(app: SacFlowApp) {
    const store = await app.sacFlow.repository.snapshot();
    return store.interactions.find((item) => item.direction === "inbound" && item.text.trim())!.id;
  }

  it("genera la sugerencia, la reutiliza sin volver a cobrar y no toca el caso", async () => {
    const { provider, calls } = draftProvider();
    const app = await makeApp({ SAC_FLOW_AI_ENABLED: "true", BYTEPLUS_API_KEY: FAKE_KEY, SAC_FLOW_AI_BRAND_IDS: "*" }, provider);
    const id = await inboundId(app);
    const before = (await app.sacFlow.repository.findInteraction(id))!;

    const availability = await app.inject({ method: "GET", url: "/api/ai/availability", headers: headers("agent") });
    expect(availability.json().data).toMatchObject({ replyDrafts: true, provider: "byteplus" });
    expect(availability.json().data.accountIds).toContain(before.accountId);
    expect(availability.body).not.toContain(FAKE_KEY);

    const first = await app.inject({ method: "POST", url: `/api/interactions/${id}/ai/draft`, headers: headers("agent"), payload: {} });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toMatchObject({ sinRespuestaAprobada: true, cached: false, proveedor: "byteplus" });
    expect(first.json().meta.externalWrites).toBe(false);
    const second = await app.inject({ method: "POST", url: `/api/interactions/${id}/ai/draft`, headers: headers("agent"), payload: {} });
    expect(second.json().data.cached).toBe(true);
    const regenerated = await app.inject({ method: "POST", url: `/api/interactions/${id}/ai/draft`, headers: headers("agent"), payload: { regenerate: true } });
    expect(regenerated.json().data.cached).toBe(false);
    expect(calls()).toBe(2);

    const after = (await app.sacFlow.repository.findInteraction(id))!;
    expect(after.version).toBe(before.version);
    expect(after.status).toBe(before.status);
    expect(after.responseText).toBe(before.responseText);

    const viewer = await app.inject({ method: "POST", url: `/api/interactions/${id}/ai/draft`, headers: headers("viewer"), payload: {} });
    expect(viewer.statusCode).toBe(403);
  });

  it("no agrega lecturas del almacén: apagada no lo lee y una sugerencia en caché no relee el historial", async () => {
    // Con el repositorio JSON cada lectura recorre el archivo completo y van en fila, así que
    // las rutas de IA no deben sumar lecturas a la carga de Gestión DMs y la Bandeja.
    async function countedApp(extra: Record<string, string>, provider?: AiProvider) {
      const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-ai-reads-"));
      directories.push(directory);
      const config = loadConfig({
        METRICOOL_MODE: "demo",
        SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
        SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
        SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
        ...extra,
      }, directory);
      const repository = new JsonRepository(config.persistence.jsonFile);
      const catalogReads = vi.spyOn(repository, "snapshotCatalog");
      const listReads = vi.spyOn(repository, "listInteractions");
      const app = await buildApp({ config, repository, ...(provider ? { aiProvider: provider } : {}) });
      apps.push(app);
      catalogReads.mockClear();
      listReads.mockClear();
      return { app, catalogReads, listReads };
    }

    const off = await countedApp({});
    const offResponse = await off.app.inject({ method: "GET", url: "/api/ai/availability", headers: headers("agent") });
    expect(offResponse.json().data).toMatchObject({ replyDrafts: false, reason: "disabled" });
    expect(off.catalogReads).not.toHaveBeenCalled();

    const { provider, calls } = draftProvider();
    const on = await countedApp({ SAC_FLOW_AI_ENABLED: "true", BYTEPLUS_API_KEY: FAKE_KEY, SAC_FLOW_AI_BRAND_IDS: "*" }, provider);
    const id = await inboundId(on.app);
    await on.app.inject({ method: "GET", url: "/api/ai/availability", headers: headers("agent") });
    await on.app.inject({ method: "GET", url: "/api/ai/availability", headers: headers("agent") });
    await on.app.inject({ method: "POST", url: `/api/interactions/${id}/ai/draft`, headers: headers("agent"), payload: {} });
    await on.app.inject({ method: "POST", url: `/api/interactions/${id}/ai/draft`, headers: headers("agent"), payload: {} });
    // Una sola lectura del catálogo para todo lo anterior y un solo historial: la segunda
    // sugerencia salió de la caché sin releer nada.
    expect(on.catalogReads).toHaveBeenCalledTimes(1);
    expect(on.listReads).toHaveBeenCalledTimes(1);
    expect(calls()).toBe(1);
  });

  it("apagada responde 503 y una marca no autorizada 403, sin llamar al proveedor", async () => {
    const { provider, calls } = draftProvider();
    const off = await makeApp({});
    const offId = await inboundId(off);
    const disabled = await off.inject({ method: "POST", url: `/api/interactions/${offId}/ai/draft`, headers: headers("agent"), payload: {} });
    expect(disabled.statusCode).toBe(503);
    expect(disabled.json().error.code).toBe("AI_NOT_AVAILABLE");
    const offAvailability = await off.inject({ method: "GET", url: "/api/ai/availability", headers: headers("agent") });
    expect(offAvailability.json().data).toMatchObject({ replyDrafts: false, reason: "disabled" });

    const scoped = await makeApp({ SAC_FLOW_AI_ENABLED: "true", BYTEPLUS_API_KEY: FAKE_KEY, SAC_FLOW_AI_BRAND_IDS: "otra-marca" }, provider);
    const scopedId = await inboundId(scoped);
    const forbidden = await scoped.inject({ method: "POST", url: `/api/interactions/${scopedId}/ai/draft`, headers: headers("agent"), payload: {} });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("AI_BRAND_NOT_AUTHORIZED");
    expect(calls()).toBe(0);
  });
});
