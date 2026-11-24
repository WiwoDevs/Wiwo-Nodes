/**
 * Miniaturas de publicaciones guardadas por wiwo.sac.
 *
 * Meta firma los enlaces de imagen con fecha de vencimiento (`oe=`): a los pocos días dejan de
 * cargar y Metricool solo entrega uno nuevo cuando la publicación recibe comentarios. Para que la
 * miniatura siga viéndose, la API guarda una copia la primera vez que alguien la pide (normalmente
 * cuando el enlace está fresco, porque el post acaba de recibir comentarios) y desde entonces la
 * sirve desde `/api/media/post-thumbnail/:key`.
 *
 * Lo mismo vale para las fotos de perfil: la de cada marca (catálogo de Metricool) y la de quien
 * escribe (`imageProfileUrl` de los participantes): ver `brandPictureKey` y `contactAvatarKey`.
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
  // Fotos de perfil de Messenger (platform-lookaside). graph.facebook.com NO: Metricool entrega
  // ahí la foto con su access_token de Facebook en el enlace, y eso nunca se guarda ni se pide.
  ".fbsbx.com",
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

/** Clave de la foto de perfil de una marca. */
export function brandPictureKey(brandId: string): string {
  return createHash("sha256").update(`brand-picture\u0000${brandId}`).digest("base64url").slice(0, 43);
}

/** Clave de la foto de perfil de quien escribe (por persona dentro de la cuenta). */
export function contactAvatarKey(accountId: string, contactKey: string): string {
  return createHash("sha256").update(`contact-avatar\u0000${accountId}\u0000${contactKey}`).digest("base64url").slice(0, 43);
}

export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Parámetros que delatan una credencial en el enlace (tokens de la Graph API y similares). */
const CREDENTIAL_PARAMS = /^(access_token|appsecret_proof|appsecret_time|token|client_secret|api_key|apikey|key|signature|sig)$/i;

/**
 * Enlace de imagen que la API puede guardar y descargar: HTTPS, de una CDN conocida y sin
 * credenciales (ni usuario/clave ni tokens en la consulta: esos enlaces se descartan enteros).
 */
export function isCacheableThumbnailUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    if ([...url.searchParams.keys()].some((name) => CREDENTIAL_PARAMS.test(name))) return false;
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
export function signedExpiry(url: string): number {
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
/** Tipo de imagen por sus primeros bytes (JPEG, PNG, GIF o WebP); undefined si no es una de ellas. */
export function sniffImageType(data: Buffer): string | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length >= 6 && /^GIF8[79]a$/.test(data.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return undefined;
}

/**
 * Silueta genérica que Metricool pone como foto a las cuentas que no tienen una (SHA-256 de la
 * imagen): no es una foto, así que se muestran las iniciales.
 */
const METRICOOL_DEFAULT_PICTURE_SHA256 = "054b70a24876c80a0c05b410fe6675c9ffcd1e25aba06dec4efe452c1b49bd94";
export function isDefaultProfilePicture(data: Buffer): boolean {
  return createHash("sha256").update(data).digest("hex") === METRICOOL_DEFAULT_PICTURE_SHA256;
}

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
    const declaredType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    // Metricool sirve varias fotos de perfil como `application/octet-stream`: en ese caso el tipo
    // se decide por los primeros bytes, y solo si es una imagen conocida.
    const generic = declaredType === "" || declaredType === "application/octet-stream" || declaredType === "binary/octet-stream";
    if (!generic && !/^image\/(jpeg|png|webp|gif|avif)$/.test(declaredType)) return undefined;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_THUMBNAIL_BYTES) return undefined;
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length || data.length > MAX_THUMBNAIL_BYTES) return undefined;
    const contentType = generic ? sniffImageType(data) : declaredType;
    if (!contentType) return undefined;
    return { contentType, data, sourceHost: new URL(current).hostname };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
