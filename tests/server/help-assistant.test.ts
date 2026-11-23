/**
 * Asistente de ayuda (orbe): solo orienta, responde según el rol y los permisos de la sesión,
 * no lleva datos de clientes al proveedor y sin IA contesta las preguntas sugeridas con la
 * guía. Sin red: el proveedor es falso.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BYTEPLUS_DEFAULT_MODEL, type AiJsonRequest, type AiProvider } from "../../server/ai-provider.js";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import {
  askHelpAssistant,
  HELP_SUGGESTIONS,
  HelpRateLimiter,
  helpSystemPrompt,
  offlineHelpAnswer,
  type HelpActor,
} from "../../server/help-assistant.js";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS } from "../../server/permissions.js";

const apps: SacFlowApp[] = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const agent: HelpActor = { role: "agent", roleName: "Agente", permissions: DEFAULT_ROLE_PERMISSIONS.agent, masterAdmin: false };
const supervisor: HelpActor = { role: "supervisor", roleName: "Supervisor", permissions: DEFAULT_ROLE_PERMISSIONS.supervisor, masterAdmin: false };

function fakeProvider(answer = "Ve a **Bandeja SAC** y abre el caso.") {
  const requests: AiJsonRequest[] = [];
  const provider: AiProvider = {
    name: "byteplus",
    model: BYTEPLUS_DEFAULT_MODEL,
    async completeJson(request) {
      requests.push(request);
      return { model: BYTEPLUS_DEFAULT_MODEL, usage: { inputTokens: 900, outputTokens: 80, cachedInputTokens: 0 }, json: { respuesta: answer } };
    },
  };
  return { provider, requests };
}

describe("Guía y prompt del asistente", () => {
  it("le dice al modelo el rol, los permisos y la sección abierta, y que solo orienta", () => {
    const prompt = helpSystemPrompt(agent, "manual-comments");
    expect(prompt).toContain('rol "Agente"');
    expect(prompt).toContain("- Responder: SÍ");
    expect(prompt).toContain("- Exportar a Excel: no");
    expect(prompt).toContain("Ahora tiene abierta la sección: Gestión comentarios");
    expect(prompt).toContain("SOLO ORIENTA");
    expect(prompt).toContain("GUÍA DE USO DE WIWO.SAC");
  });

  it("sin IA, las preguntas sugeridas se responden según los permisos", () => {
    expect(offlineHelpAnswer(HELP_SUGGESTIONS[0], agent)).toContain("Tu rol es **Agente**");
    expect(offlineHelpAnswer(HELP_SUGGESTIONS[0], agent)).not.toContain("Exportar a Excel");
    expect(offlineHelpAnswer(HELP_SUGGESTIONS[0], supervisor)).toContain("Exportar a Excel");
    expect(offlineHelpAnswer(HELP_SUGGESTIONS[3], agent)).toContain("es de Supervisor o Admin");
    expect(offlineHelpAnswer(HELP_SUGGESTIONS[3], supervisor)).toContain("Descartar spam");
    expect(offlineHelpAnswer("¿cualquier otra cosa?", agent)).toBeUndefined();
  });

  it("enmascara datos personales que alguien pegue en la pregunta", async () => {
    const { provider, requests } = fakeProvider();
    await askHelpAssistant([{ role: "user", content: "La clienta ana@correo.cl con RUT 12.345.678-5 no recibe respuesta, ¿qué hago?" }], agent, "interactions", provider);
    expect(requests[0]!.user).not.toContain("ana@correo.cl");
    expect(requests[0]!.user).not.toContain("12.345.678");
    expect(requests[0]!.user).toContain("[EMAIL]");
  });

  it("usa texto libre con los turnos de la conversación cuando el proveedor lo ofrece", async () => {
    const seen: Array<{ system: string; messages: Array<{ role: string; content: string }> }> = [];
    const provider: AiProvider = {
      name: "byteplus",
      model: BYTEPLUS_DEFAULT_MODEL,
      completeJson: async () => { throw new Error("no debería usarse"); },
      async completeText(request) {
        seen.push(request);
        return { text: "  Respuesta en texto libre.  ", model: BYTEPLUS_DEFAULT_MODEL, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 } };
      },
    };
    const { answer } = await askHelpAssistant([
      { role: "user", content: "¿Dónde está Reportes?" },
      { role: "assistant", content: "En el menú lateral." },
      { role: "user", content: "¿Y si escribo al 987654321?" },
    ], supervisor, "reports", provider);
    expect(answer).toBe("Respuesta en texto libre.");
    expect(seen[0]!.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(seen[0]!.messages[2]!.content).toContain("[TELEFONO]");
    expect(seen[0]!.system).toContain("Ahora tiene abierta la sección: Reportes");
  });

  it("limita a 30 consultas por persona cada 10 minutos", () => {
    const limiter = new HelpRateLimiter();
    const now = Date.parse("2026-11-23T12:00:00.000Z");
    for (let index = 0; index < 30; index += 1) expect(limiter.take("ana", now)).toBe(true);
    expect(limiter.take("ana", now)).toBe(false);
    expect(limiter.take("luis", now)).toBe(true);
    expect(limiter.take("ana", now + 10 * 60_000 + 1)).toBe(true);
  });
});

describe("POST /api/help/ask", () => {
  function headers(role: "viewer" | "agent" | "admin") {
    return {
      "x-sac-user-id": `user-${role}`,
      "x-sac-user-name": `Usuario ${role}`,
      "x-sac-tenant-id": "tenant-test",
      "x-sac-role": role,
      "x-sac-brand-ids": "*",
    };
  }

  async function makeApp(extra: Record<string, string>, provider?: AiProvider) {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-help-"));
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

  const ask = (app: SacFlowApp, role: "viewer" | "agent" | "admin", content: string, view = "interactions") =>
    app.inject({ method: "POST", url: "/api/help/ask", headers: headers(role), payload: { messages: [{ role: "user", content }], view } });

  it("con IA responde con el rol de la sesión y no envía casos ni mensajes de clientes", async () => {
    const { provider, requests } = fakeProvider();
    const app = await makeApp({ SAC_FLOW_AI_ENABLED: "true", BYTEPLUS_API_KEY: "test-key-not-real" }, provider);
    const response = await ask(app, "viewer", "¿Cómo respondo un comentario?");
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ answer: "Ve a **Bandeja SAC** y abre el caso.", source: "ia" });
    expect(response.json().meta.externalWrites).toBe(false);
    expect(requests[0]!.system).toContain("- Responder: no");

    const store = await app.sacFlow.repository.snapshot();
    const sample = store.interactions.find((item) => item.direction === "inbound" && item.text.length > 20)!;
    expect(requests[0]!.system + requests[0]!.user).not.toContain(sample.text);
    expect(requests[0]!.system + requests[0]!.user).not.toContain(sample.customerHandle);

    const admin = await ask(app, "admin", "¿Puedo crear marcas?");
    expect(admin.statusCode).toBe(200);
    expect(requests[1]!.system).toContain("- Gestionar marcas: SÍ");
    expect(requests[1]!.system).toContain("Como Admin tiene además las tareas exclusivas");
  });

  it("sin IA contesta las sugeridas con la guía y explica el resto", async () => {
    const app = await makeApp({});
    const suggested = await ask(app, "agent", HELP_SUGGESTIONS[1]);
    expect(suggested.statusCode).toBe(200);
    expect(suggested.json().data.source).toBe("guia");
    expect(suggested.json().data.answer).toContain("Enviar");
    const free = await ask(app, "agent", "¿Cómo cambio mi foto de perfil?");
    expect(free.statusCode).toBe(503);
    expect(free.json().error.code).toBe("AI_NOT_AVAILABLE");
    const availability = await app.inject({ method: "GET", url: "/api/ai/availability", headers: headers("agent") });
    expect(availability.json().data.helpAssistant).toBe("guia");
  });

  it("rechaza conversaciones inválidas y corta al pasar el límite", async () => {
    const { provider } = fakeProvider();
    const app = await makeApp({ SAC_FLOW_AI_ENABLED: "true", BYTEPLUS_API_KEY: "test-key-not-real" }, provider);
    const invalid = await app.inject({
      method: "POST", url: "/api/help/ask", headers: headers("agent"),
      payload: { messages: [{ role: "assistant", content: "hola" }] },
    });
    expect(invalid.statusCode).toBe(400);
    for (let index = 0; index < 30; index += 1) expect((await ask(app, "agent", `pregunta ${index}`)).statusCode).toBe(200);
    const limited = await ask(app, "agent", "una más");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("HELP_RATE_LIMITED");
    expect(PERMISSION_KEYS.length).toBeGreaterThan(0);
  });
});
