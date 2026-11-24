/**
 * Fotos de perfil: la de cada cuenta (catálogo de marcas de Metricool) en Clientes y la de quien
 * escribe (`imageProfileUrl` del participante) en Gestión DMs. Se guardan como las miniaturas y
 * siguen el alcance de marcas de quien las pide. Todo con un cliente Metricool simulado.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { groupInboxContacts } from "../../server/inbox-contacts.js";
import type { MetricoolGateway } from "../../server/metricool-client.js";
import {
  clearPostThumbnailRegistry,
  contactAvatarKey,
  downloadPostThumbnail,
  isDefaultProfilePicture,
  largeProfilePictureUrl,
  sniffImageType,
  isCacheableThumbnailUrl,
  registerPostThumbnail,
  registeredPostThumbnail,
  type ThumbnailFetcher,
} from "../../server/post-thumbnails.js";
import type { Interaction } from "../../server/types.js";

const API_KEY = "clave-de-api-de-pruebas-para-fotos-123";
const PICTURE = "https://scontent.xx.fbcdn.net/v/t39/perfil.jpg?oe=6B097628&oh=abc";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]);

const apps: SacFlowApp[] = [];
const directories: string[] = [];
afterEach(async () => {
  clearPostThumbnailRegistry();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function fakeMetricool(catalog: unknown[]): MetricoolGateway {
  return {
    listBrands: vi.fn(async () => catalog),
    listConversations: vi.fn(async () => []),
    listPostComments: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    replyToConversation: vi.fn(async () => ({})),
    replyToPostComment: vi.fn(async () => ({})),
    replyToReview: vi.fn(async () => ({})),
  };
}

async function makeApp(env: Record<string, string>, client?: MetricoolGateway, fetcher?: ThumbnailFetcher) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-pictures-"));
  directories.push(directory);
  const app = await buildApp({
    config: loadConfig({
      SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
      SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
      ...env,
    }, directory),
    ...(client ? { metricoolClient: client } : {}),
    ...(fetcher ? { thumbnailFetcher: fetcher } : {}),
  });
  apps.push(app);
  return app;
}

describe("foto de quien escribe", () => {
  it("nunca guarda enlaces con credenciales ni de la Graph API", () => {
    expect(isCacheableThumbnailUrl("https://platform-lookaside.fbsbx.com/platform/profilepic/?psid=1&ext=1")).toBe(true);
    expect(isCacheableThumbnailUrl("https://graph.facebook.com/v24.0/123/picture?access_token=x&appsecret_proof=y")).toBe(false);
    // La foto pública de una página sí (Metricool la usa en su catálogo de cuentas), sin token.
    expect(isCacheableThumbnailUrl("https://graph.facebook.com/100999318401857/picture")).toBe(true);
    expect(isCacheableThumbnailUrl("https://graph.facebook.com/v24.0/100999318401857/picture")).toBe(true);
    expect(isCacheableThumbnailUrl("https://graph.facebook.com/v24.0/100999318401857/picture?access_token=x")).toBe(false);
    expect(isCacheableThumbnailUrl("https://graph.facebook.com/me/accounts")).toBe(false);
    expect(isCacheableThumbnailUrl("https://graph.facebook.com/100999318401857/feed")).toBe(false);
    expect(largeProfilePictureUrl("https://graph.facebook.com/100999318401857/picture")).toBe("https://graph.facebook.com/100999318401857/picture?type=large");
    expect(largeProfilePictureUrl(PICTURE)).toBe(PICTURE);
    expect(isCacheableThumbnailUrl(`${PICTURE}&access_token=x`)).toBe(false);
    expect(isCacheableThumbnailUrl("https://facebook.com.evil.example/picture")).toBe(false);
  });

  it("el contacto entrega la copia guardada de su foto y nunca el enlace de Meta", () => {
    const dm = {
      id: "dm-1", brandId: "brand-01", accountId: "account-01", channel: "instagram", type: "dm",
      direction: "inbound", status: "pending", text: "Hola", createdAt: "2026-11-20T10:00:00.000Z",
      customerName: "Cliente Ficticio", customerHandle: "cliente_ficticio",
      audit: [], version: 1, priority: "normal",
      metricoolRef: { threadId: "thread-1", customerPictureUrl: PICTURE },
    } as unknown as Interaction;
    const [contact] = groupInboxContacts([dm]);
    const key = contactAvatarKey("account-01", contact.contactKey);
    expect(contact.customerAvatarUrl).toBe(`/api/media/image/${key}`);
    expect(JSON.stringify(contact)).not.toContain("fbcdn");
    expect(registeredPostThumbnail(key)).toEqual({ brandId: "brand-01", url: PICTURE });

    const [withoutPicture] = groupInboxContacts([{ ...dm, metricoolRef: { threadId: "thread-1" } } as Interaction]);
    expect(withoutPicture.customerAvatarUrl).toBeUndefined();
  });

  it("GET /api/media/image/:key sirve la foto a quien ve la marca", async () => {
    let downloads = 0;
    const app = await makeApp(
      { METRICOOL_MODE: "demo", SAC_FLOW_TRUST_ACTOR_HEADERS: "true" },
      undefined,
      async () => { downloads += 1; return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } }); },
    );
    const key = contactAvatarKey("account-01", "persona-1");
    const actor = (brandIds: string) => ({
      "x-sac-user-id": "user-agent", "x-sac-user-name": "Agente", "x-sac-tenant-id": "tenant-test", "x-sac-role": "agent", "x-sac-brand-ids": brandIds,
    });
    registerPostThumbnail(key, "brand-01", PICTURE);
    expect((await app.inject({ method: "GET", url: `/api/media/image/${key}`, headers: actor("brand-02") })).statusCode).toBe(404);
    expect(downloads).toBe(0);
    const response = await app.inject({ method: "GET", url: `/api/media/image/${key}`, headers: actor("brand-01") });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(PNG)).toBe(true);
  });
});

describe("GET /api/media/brand-picture/:brandId", () => {
  it("descarga la foto del catálogo una vez y después la sirve guardada", async () => {
    const client = fakeMetricool([
      { id: "1001", userId: "u-1", label: "Marca Real Uno", instagram: "marcarealuno", picture: PICTURE },
    ]);
    let downloads = 0;
    const app = await makeApp({
      METRICOOL_MODE: "live",
      METRICOOL_API_TOKEN: "token-de-prueba-nunca-registrado",
      METRICOOL_USER_ID: "u-1",
      SAC_FLOW_API_KEY: API_KEY,
    }, client, async () => { downloads += 1; return new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } }); });
    const headers = { "x-api-key": API_KEY };
    expect((await app.inject({ method: "POST", url: "/api/sync", headers: { ...headers, "idempotency-key": "fotos-sync-1" }, payload: {} })).statusCode).toBe(200);
    const brand = (await app.sacFlow.repository.snapshot()).brands.find((item) => item.name === "Marca Real Uno");
    expect(brand).toBeDefined();

    const first = await app.inject({ method: "GET", url: `/api/media/brand-picture/${brand!.id}`, headers });
    expect(first.statusCode).toBe(200);
    expect(first.rawPayload.equals(PNG)).toBe(true);
    const again = await app.inject({ method: "GET", url: `/api/media/brand-picture/${brand!.id}`, headers });
    expect(again.statusCode).toBe(200);
    expect(downloads).toBe(1);

    expect((await app.inject({ method: "GET", url: "/api/media/brand-picture/brand-inexistente", headers })).statusCode).toBe(404);
  });

  it("si el enlace del catálogo murió, usa la foto pública de la página de Facebook", async () => {
    const client = fakeMetricool([
      { id: "1001", userId: "u-1", label: "Marca Real Uno", instagram: "marcarealuno", picture: PICTURE, facebook: "100999318401857", facebookPageId: "100999318401857" },
    ]);
    const requested: string[] = [];
    const app = await makeApp({
      METRICOOL_MODE: "live",
      METRICOOL_API_TOKEN: "token-de-prueba-nunca-registrado",
      METRICOOL_USER_ID: "u-1",
      SAC_FLOW_API_KEY: API_KEY,
    }, client, async (input) => {
      const url = String(input);
      requested.push(new URL(url).hostname);
      return url.includes("graph.facebook.com")
        ? new Response(new Uint8Array(PNG), { headers: { "content-type": "image/png" } })
        : new Response(null, { status: 403 });
    });
    const headers = { "x-api-key": API_KEY };
    await app.inject({ method: "POST", url: "/api/sync", headers: { ...headers, "idempotency-key": "fotos-sync-fb" }, payload: {} });
    const brand = (await app.sacFlow.repository.snapshot()).brands.find((item) => item.name === "Marca Real Uno");
    const response = await app.inject({ method: "GET", url: `/api/media/brand-picture/${brand!.id}`, headers });
    expect(response.statusCode).toBe(200);
    expect(response.rawPayload.equals(PNG)).toBe(true);
    expect(requested).toEqual(["scontent.xx.fbcdn.net", "graph.facebook.com"]);
  });

  it("en modo demo no hay fotos: responde 404 y la web muestra las iniciales", async () => {
    const app = await makeApp({ METRICOOL_MODE: "demo", SAC_FLOW_TRUST_ACTOR_HEADERS: "true" });
    const response = await app.inject({
      method: "GET",
      url: "/api/media/brand-picture/brand-01",
      headers: { "x-sac-user-id": "user-admin", "x-sac-user-name": "Admin", "x-sac-tenant-id": "tenant-test", "x-sac-role": "admin", "x-sac-brand-ids": "*" },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("fotos servidas como application/octet-stream", () => {
  it("se aceptan si los bytes son una imagen y se rechazan si no", async () => {
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(Buffer.from("<html></html>"))).toBeUndefined();
    const octet = (body: Buffer): ThumbnailFetcher => async () => new Response(new Uint8Array(body), { headers: { "content-type": "application/octet-stream" } });
    expect((await downloadPostThumbnail(PICTURE, octet(JPEG)))?.contentType).toBe("image/jpeg");
    expect(await downloadPostThumbnail(PICTURE, octet(Buffer.from("<html></html>")))).toBeUndefined();
    expect(isDefaultProfilePicture(PNG)).toBe(false);
  });
});
