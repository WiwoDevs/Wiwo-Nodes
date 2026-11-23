/**
 * Miniaturas de publicaciones guardadas por wiwo.sac.
 *
 * Meta firma los enlaces de imagen con fecha de vencimiento (`oe=`): a los pocos días dejan de
 * cargar y Metricool solo entrega uno nuevo cuando la publicación recibe comentarios. Para que la
 * miniatura siga viéndose, la API guarda una copia la primera vez que alguien la pide (normalmente
 * cuando el enlace está fresco, porque el post acaba de recibir comentarios) y desde entonces la
 * sirve desde `/api/media/post-thumbnail/:key`.
 *
 * Seguridad: solo se descargan imágenes HTTPS de CDNs de las redes sociales conocidas (nunca una
 * dirección arbitraria), sin credenciales en la URL, sin seguir redirecciones a otros dominios,
 * con límite de tamaño y de tiempo y solo con tipo `image/*`. Los videos (reels) no se guardan:
 * la web los muestra como su primer cuadro mientras el enlace vive.
 */
import { createHash } from "node:crypto";

/** Dominios de las CDNs de redes sociales desde donde se aceptan miniaturas. */
const ALLOWED_HOST_SUFFIXES = [
  ".cdninstagram.com",
  ".fbcdn.net",
  ".licdn.com",
  ".ytimg.com",
  ".tiktokcdn.com",
  ".tiktokcdn-us.com",
  ".tiktokcdn-eu.com",
  ".twimg.com",
  ".metricool.com",
];
const VIDEO_PATH = /\.(mp4|mov|m4v|webm|m3u8)$/i;
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REGISTRY_ENTRIES = 20_000;

export interface StoredPostThumbnail {
  key: string;
  /** Marca dueña de la publicación: el acceso a la miniatura sigue el alcance de marcas. */
  brandId: string;
  contentType: string;
  data: Buffer;
  sourceHost: string;
  fetchedAt: string;
}

/** Clave opaca y estable de la miniatura de una publicación (no revela IDs de la red). */
export function postThumbnailKey(accountId: string, postId: string): string {
  return createHash("sha256").update(`post-thumbnail\u0000${accountId}\u0000${postId}`).digest("base64url").slice(0, 43);
}

export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Enlace de imagen que la API puede descargar: HTTPS, sin credenciales y de una CDN conocida. */
export function isCacheableThumbnailUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    if (!ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return false;
    return !VIDEO_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * Último enlace conocido de cada miniatura (en memoria, acotado). Se registra al armar el contexto
 * de cada comentario, así que siempre apunta al enlace más reciente que trajo Metricool.
 */
const registry = new Map<string, { brandId: string; url: string }>();

/** Vencimiento firmado del enlace (`oe=`, segundos en hexadecimal); 0 si no lo trae. */
function signedExpiry(url: string): number {
  try {
    const value = new URL(url).searchParams.get("oe");
    return value && /^[0-9a-f]{6,12}$/i.test(value) ? parseInt(value, 16) : 0;
  } catch {
    return 0;
  }
}

export function registerPostThumbnail(key: string, brandId: string, url: string): void {
  const current = registry.get(key);
  // Varios comentarios del mismo post traen enlaces de distintas fechas: gana el que vence después.
  if (current && signedExpiry(current.url) > signedExpiry(url)) return;
  if (current) registry.delete(key);
  registry.set(key, { brandId, url });
  if (registry.size > MAX_REGISTRY_ENTRIES) {
    const oldest = registry.keys().next().value;
    if (oldest !== undefined) registry.delete(oldest);
  }
}

export function registeredPostThumbnail(key: string): { brandId: string; url: string } | undefined {
  return registry.get(key);
}

/** Solo para pruebas. */
export function clearPostThumbnailRegistry(): void {
  registry.clear();
}

export type ThumbnailFetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Descarga una miniatura con los límites de seguridad. Devuelve undefined si el enlace venció, no
 * es una imagen, es muy grande o la CDN no responde: la web muestra entonces el ícono.
 */
export async function downloadPostThumbnail(
  url: string,
  fetcher: ThumbnailFetcher = fetch,
): Promise<{ contentType: string; data: Buffer; sourceHost: string } | undefined> {
  if (!isCacheableThumbnailUrl(url)) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    let response: Response | undefined;
    // Hasta 3 redirecciones, y solo hacia otra CDN permitida.
    for (let hop = 0; hop < 4; hop += 1) {
      response = await fetcher(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      const next = location ? new URL(location, current).toString() : undefined;
      if (!next || !isCacheableThumbnailUrl(next)) return undefined;
      current = next;
    }
    if (!response || !response.ok) return undefined;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(contentType)) return undefined;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_THUMBNAIL_BYTES) return undefined;
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > MAX_THUMBNAIL_BYTES) return undefined;
    return { contentType, data, sourceHost: new URL(current).hostname };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
