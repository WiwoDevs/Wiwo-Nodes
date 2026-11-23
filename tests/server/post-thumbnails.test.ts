/**
 * Miniaturas de publicaciones guardadas: solo imágenes de CDNs de redes, descarga con límites y
 * la ruta que sirve la copia aunque el enlace de Meta haya vencido.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type SacFlowApp } from "../../server/app.js";
import { loadConfig } from "../../server/config.js";
import { publicPostContext } from "../../server/inbox-contacts.js";
import {
  clearPostThumbnailRegistry,
  downloadPostThumbnail,
  isCacheableThumbnailUrl,
  postThumbnailKey,
  registerPostThumbnail,
  registeredPostThumbnail,
  type ThumbnailFetcher,
} from "../../server/post-thumbnails.js";
import type { Interaction } from "../../server/types.js";

const IMAGE = "https://scontent-lhr11-1.cdninstagram.com/v/t51/cover.jpg?oe=6B097628&oh=abc";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const apps: SacFlowApp[] = [];
const directories: string[] = [];
afterEach(async () => {
  clearPostThumbnailRegistry();
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function imageResponse(body: Buffer = PNG, type = "image/png", status = 200, headers: Record<string, string> = {}): Response {
  return new Response(status === 200 ? new Uint8Array(body) : null, { status, headers: { "content-type": type, ...headers } });
}

describe("enlaces de miniatura", () => {
  it("acepta solo imágenes HTTPS de CDNs de redes sociales", () => {
    expect(isCacheableThumbnailUrl(IMAGE)).toBe(true);
    expect(isCacheableThumbnailUrl("https://media.licdn.com/dms/image/v2/abc/feedshare.jpg")).toBe(true);
    expect(isCacheableThumbnailUrl("https://scontent.cdninstagram.com/o1/v/t2/reel.mp4?oe=1")).toBe(false);
    expect(isCacheableThumbnailUrl("http://scontent.cdninstagram.com/cover.jpg")).toBe(false);
    expect(isCacheableThumbnailUrl("https://evil.example.com/cover.jpg")).toBe(false);
    expect(isCacheableThumbnailUrl("https://cdninstagram.com.evil.example/cover.jpg")).toBe(false);
    expect(isCacheableThumbnailUrl("https://user:pass@scontent.cdninstagram.com/cover.jpg")).toBe(false);
    expect(isCacheableThumbnailUrl("https://169.254.169.254/latest")).toBe(false);
  });

  it("descarga imágenes con límites y no sigue redirecciones a otros dominios", async () => {
    const ok: ThumbnailFetcher = async () => imageResponse();
    expect((await downloadPostThumbnail(IMAGE, ok))?.data.equals(PNG)).toBe(true);
    expect(await downloadPostThumbnail(IMAGE, async () => imageResponse(PNG, "text/html"))).toBeUndefined();
    expect(await downloadPostThumbnail(IMAGE, async () => imageResponse(PNG, "image/png", 403))).toBeUndefined();
    expect(await downloadPostThumbnail(IMAGE, async () => imageResponse(PNG, "image/png", 200, { "content-length": String(3 * 1024 * 1024) }))).toBeUndefined();
    const redirectAway: ThumbnailFetcher = async () => new Response(null, { status: 302, headers: { location: "https://evil.example.com/x.jpg" } });
    expect(await downloadPostThumbnail(IMAGE, redirectAway)).toBeUndefined();
    let calls = 0;
    const redirectCdn: ThumbnailFetcher = async () => (calls++ === 0
      ? new Response(null, { status: 302, headers: { location: "https://scontent-lhr6-1.cdninstagram.com/v/other.jpg" } })
      : imageResponse());
    expect((await downloadPostThumbnail(IMAGE, redirectCdn))?.sourceHost).toBe("scontent-lhr6-1.cdninstagram.com");
  });

  it("el contexto del comentario apunta a la copia guardada solo para imágenes de CDNs", () => {
    const comment = (mediaUrl: string) => ({
      id: "c1", brandId: "brand-01", accountId: "account-01", type: "comment",
      metricoolRef: { postId: "post-1", post: { id: "post-1", mediaUrl } },
    }) as unknown as Interaction;
    expect(publicPostContext(comment(IMAGE))?.thumbnailUrl).toBe(`/api/media/post-thumbnail/${postThumbnailKey("account-01", "post-1")}`);
    const reel = "https://scontent.cdninstagram.com/o1/v/t2/reel.mp4?oe=1";
    expect(publicPostContext(comment(reel))?.thumbnailUrl).toBe(reel);
  });

  it("entre varios enlaces del mismo post se queda con el que vence después", () => {
    const older = "https://scontent.cdninstagram.com/v/t51/cover.jpg?oe=6B000000";
    const newer = "https://scontent.cdninstagram.com/v/t51/cover.jpg?oe=6B100000";
    registerPostThumbnail("clave-de-prueba-0000", "brand-01", newer);
    registerPostThumbnail("clave-de-prueba-0000", "brand-01", older);
    expect(registeredPostThumbnail("clave-de-prueba-0000")?.url).toBe(newer);
  });
});

describe("GET /api/media/post-thumbnail/:key", () => {
  it("guarda la miniatura la primera vez y la sigue sirviendo aunque el enlace ya no responda", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sac-flow-thumbs-"));
    directories.push(directory);
    let online = true;
    let downloads = 0;
    const app = await buildApp({
      config: loadConfig({
        METRICOOL_MODE: "demo",
        SAC_FLOW_DATA_FILE: path.join(directory, "store.json"),
        SAC_FLOW_CREDENTIALS_ENCRYPTION_KEY: "test-automation-credentials-key-32-chars",
        SAC_FLOW_TRUST_ACTOR_HEADERS: "true",
      }, directory),
      thumbnailFetcher: async () => {
        downloads += 1;
        return online ? imageResponse() : imageResponse(PNG, "image/png", 403);
      },
    });
    apps.push(app);
    const key = postThumbnailKey("account-01", "post-1");
    const url = `/api/media/post-thumbnail/${key}`;
    const actor = (brandIds: string) => ({
      "x-sac-user-id": "user-agent", "x-sac-user-name": "Agente", "x-sac-tenant-id": "tenant-test", "x-sac-role": "agent", "x-sac-brand-ids": brandIds,
    });

    expect((await app.inject({ method: "GET", url, headers: actor("*") })).statusCode).toBe(404);
    registerPostThumbnail(key, "brand-01", IMAGE);
    // Quien no tiene acceso a la marca no la ve ni dispara la descarga.
    expect((await app.inject({ method: "GET", url, headers: actor("brand-02") })).statusCode).toBe(404);
    expect(downloads).toBe(0);

    const first = await app.inject({ method: "GET", url, headers: actor("*") });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toBe("image/png");
    expect(first.rawPayload.equals(PNG)).toBe(true);

    online = false;
    clearPostThumbnailRegistry();
    const later = await app.inject({ method: "GET", url, headers: actor("brand-01") });
    expect(later.statusCode).toBe(200);
    expect(later.rawPayload.equals(PNG)).toBe(true);
    expect(downloads).toBe(1);
    expect((await app.inject({ method: "GET", url, headers: actor("brand-02") })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/media/post-thumbnail/..%2Fstore", headers: actor("*") })).statusCode).toBe(404);
  });
});
