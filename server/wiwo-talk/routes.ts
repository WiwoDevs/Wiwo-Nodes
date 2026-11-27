/**
 * Rutas de WiWO Talk:
 *
 * - `/api/wiwo-talk/connections…` — conexiones por subcuenta (crear, cambiar token, pausar,
 *   sincronizar, quitar). Solo admins principales: el token da acceso a todos los chats.
 * - `/api/webhooks/wiwo-talk/:id?key=…` — aviso del workflow de la subcuenta. No usa sesión: se
 *   autentica con el secreto propio de esa conexión y responde de inmediato.
 *
 * Responder no tiene ruta propia: usa `POST /api/interactions/:id/reply` como cualquier WhatsApp.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { ApiError } from "../api-error.js";
import type { ActorContext } from "../types.js";
import { WIWO_TALK_WEBHOOK_PREFIX, WiwoTalkServiceError, type WiwoTalkService } from "./service.js";

export function isWiwoTalkWebhookPath(url: string): boolean {
  return (url.split("?", 1)[0] || "/").startsWith(WIWO_TALK_WEBHOOK_PREFIX);
}

export interface WiwoTalkRouteDeps {
  service: WiwoTalkService;
  demoMode: boolean;
  requireActor: (request: FastifyRequest) => ActorContext;
  isMasterAdmin: (actor: ActorContext) => boolean;
  brandExists: (brandId: string) => Promise<boolean>;
}

const idParams = z.object({ id: z.string().uuid() }).strict();
const locationId = z.string().trim().regex(/^[A-Za-z0-9_-]{6,64}$/, "Location ID inválido.");
// El token de integración privada se ve como "pit-…". Se acepta cualquier token sin espacios.
const token = z.string().trim().min(16).max(256).regex(/^\S+$/, "El token no puede tener espacios.");
const createBody = z.object({
  brandId: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(80),
  locationId,
  token,
}).strict();
const tokenBody = z.object({ token }).strict();
const pauseBody = z.object({ paused: z.boolean() }).strict();
const webhookQuery = z.object({ key: z.string().max(200).optional() }).passthrough();
const demoBody = z.object({ text: z.string().trim().min(1).max(1_000).optional() }).strict().default({});

function meta() {
  return { generatedAt: new Date().toISOString() };
}

function asApiError(error: unknown): never {
  if (error instanceof WiwoTalkServiceError) throw new ApiError(error.statusCode, error.code, error.message);
  throw error;
}

export function registerWiwoTalkRoutes(app: FastifyInstance, deps: WiwoTalkRouteDeps): void {
  const { service } = deps;

  const requireMaster = (request: FastifyRequest) => {
    const actor = deps.requireActor(request);
    if (!deps.isMasterAdmin(actor)) {
      throw new ApiError(403, "MASTER_ADMIN_REQUIRED", "Solo un admin principal puede administrar las conexiones de WiWO Talk.");
    }
    return actor;
  };

  const listView = async () => (await service.list()).map((connection) => service.view(connection));

  app.get("/api/wiwo-talk/connections", async (request) => {
    requireMaster(request);
    return { data: { connections: await listView(), demo: deps.demoMode }, meta: meta() };
  });

  app.post("/api/wiwo-talk/connections", async (request, reply) => {
    const actor = requireMaster(request);
    const body = createBody.parse(request.body);
    if (!(await deps.brandExists(body.brandId))) throw new ApiError(404, "BRAND_NOT_FOUND", "La marca no existe.");
    const connection = await service.create({ ...body, createdBy: actor.email ?? actor.userId }).catch(asApiError);
    request.log.info({ event: "wiwo_talk_connection_created", connectionId: connection.id }, "Conexión de WiWO Talk creada.");
    return reply.code(201).send({ data: { connections: await listView() }, meta: { ...meta(), connectionId: connection.id } });
  });

  app.put("/api/wiwo-talk/connections/:id/token", async (request) => {
    requireMaster(request);
    const { id } = idParams.parse(request.params);
    const body = tokenBody.parse(request.body);
    await service.replaceToken(id, body.token).catch(asApiError);
    request.log.info({ event: "wiwo_talk_token_replaced", connectionId: id }, "Token de WiWO Talk reemplazado.");
    return { data: { connections: await listView() }, meta: meta() };
  });

  app.post("/api/wiwo-talk/connections/:id/webhook-secret", async (request) => {
    requireMaster(request);
    const { id } = idParams.parse(request.params);
    await service.rotateWebhookSecret(id).catch(asApiError);
    return { data: { connections: await listView() }, meta: meta() };
  });

  app.post("/api/wiwo-talk/connections/:id/pause", async (request) => {
    requireMaster(request);
    const { id } = idParams.parse(request.params);
    const body = pauseBody.parse(request.body);
    await service.setPaused(id, body.paused).catch(asApiError);
    return { data: { connections: await listView() }, meta: meta() };
  });

  /** Lee ahora las conversaciones recientes (la primera vez, como historial). */
  app.post("/api/wiwo-talk/connections/:id/sync", async (request) => {
    requireMaster(request);
    const { id } = idParams.parse(request.params);
    const result = await service.syncNow(id).catch((error: unknown) => {
      if (error instanceof WiwoTalkServiceError) asApiError(error);
      const code = (error as { code?: string }).code ?? "WIWO_TALK_SYNC_FAILED";
      throw new ApiError(502, code, error instanceof Error ? error.message : "No se pudo leer WiWO Talk.");
    });
    return { data: { ...result, connections: await listView() }, meta: meta() };
  });

  app.delete("/api/wiwo-talk/connections/:id", async (request) => {
    requireMaster(request);
    const { id } = idParams.parse(request.params);
    await service.remove(id).catch(asApiError);
    return { data: { connections: await listView() }, meta: meta() };
  });

  /** Solo demo: deja un mensaje ficticio por el mismo camino que uno real. */
  app.post("/api/wiwo-talk/connections/:id/demo-message", async (request) => {
    requireMaster(request);
    if (!deps.demoMode) throw new ApiError(404, "NOT_FOUND", "Ruta no encontrada.");
    const { id } = idParams.parse(request.params);
    const body = demoBody.parse(request.body ?? {});
    return { data: await service.simulateInbound(id, body.text).catch(asApiError), meta: meta() };
  });

  /**
   * Aviso del workflow de la subcuenta. Responde 200 al instante y lee la conversación después;
   * una clave incorrecta recibe 404, como una conexión que no existe.
   */
  app.post(`${WIWO_TALK_WEBHOOK_PREFIX}:id`, { bodyLimit: 256 * 1024 }, async (request, reply) => {
    const params = idParams.safeParse(request.params);
    const query = webhookQuery.safeParse(request.query);
    const headerKey = request.headers["x-wiwo-talk-key"];
    const key = typeof headerKey === "string" && headerKey ? headerKey : query.success ? query.data.key : undefined;
    const accepted = params.success ? await service.acceptWebhook(params.data.id, key, request.body).catch(() => false) : false;
    if (!accepted) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Ruta no encontrada." }, meta: meta() });
    return { data: { received: true }, meta: meta() };
  });
}
