/**
 * Miniatura de una publicación (Gestión comentarios, detalle del caso).
 *
 * Metricool entrega en `mediaUrls` lo que tenga la publicación: en reels y videos de Instagram el
 * primer enlace es el .mp4, que un <img> no puede mostrar. Además, los enlaces de Meta vienen
 * firmados con fecha de vencimiento (`oe=`) y dejan de cargar a los pocos días. Por eso:
 * - un video se muestra como su primer cuadro (<video> sin sonido ni controles, solo metadatos);
 * - si la imagen o el video no cargan (vencido o borrado), queda el ícono en vez de la imagen rota.
 * Las imágenes de las CDNs de las redes llegan como `/api/media/post-thumbnail/:key`: la copia que
 * guarda wiwo.sac, que sigue viéndose aunque el enlace de Meta venza (server/post-thumbnails.ts).
 */
import { ImageSquare } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

const VIDEO_PATH = /\.(mp4|mov|m4v|webm|m3u8)$/i;
const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const STORED_THUMBNAIL = /^\/api\/media\/post-thumbnail\/[A-Za-z0-9_-]{16,64}$/;

/** Miniatura usable: la copia guardada por wiwo.sac (misma API) o un enlace HTTPS externo. */
export function safeThumbnailUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (STORED_THUMBNAIL.test(value)) return `${API_BASE}${value.slice("/api".length)}`;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Enlace a un archivo de video (por su ruta, sin mirar los parámetros firmados). */
export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function PostThumbnail({ url, iconSize = 20 }: { url?: string; iconSize?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  if (!url || failed) return <ImageSquare size={iconSize} weight="duotone" aria-hidden="true" />;
  if (isVideoUrl(url)) {
    return (
      <video
        className="post-thumbnail"
        src={`${url}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        disablePictureInPicture
        aria-hidden="true"
        tabIndex={-1}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <img
      className="post-thumbnail"
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
