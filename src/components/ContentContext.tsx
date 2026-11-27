import { useState } from "react";
import type { InteractionContentContext, InteractionContentKind } from "../types";

interface ContentContextProps {
  text: string;
  context?: InteractionContentContext;
  compact?: boolean;
}

const LABELS: Record<InteractionContentKind, string> = {
  text: "Mensaje",
  story_reply: "Respuesta a una historia",
  story_mention: "Mención en una historia",
  reaction: "Reacción",
  attachment: "Archivo adjunto",
  unsupported: "Contenido no disponible desde Metricool",
  deleted: "Mensaje eliminado",
  unavailable: "Contenido no disponible",
};

const FALLBACKS: Partial<Record<InteractionContentKind, string>> = {
  story_reply: "La historia no está disponible; puede haber expirado o Metricool no entregó el archivo.",
  story_mention: "La historia no está disponible; puede haber expirado o Metricool no entregó el archivo.",
  attachment: "Metricool informó un archivo adjunto, pero no entregó un enlace visible.",
  unsupported: "Metricool registró esta interacción, pero no entregó texto, archivo ni vista previa. Puedes responder manualmente si corresponde.",
  deleted: "El contenido fue eliminado en la plataforma.",
  unavailable: "Metricool no entregó texto ni archivo para este evento.",
};

/** Archivo de WhatsApp que guarda la propia API (`/api/media/whatsapp/<sha256>?type=…`). */
const INTERNAL_WHATSAPP_MEDIA = /^\/api\/media\/whatsapp\/[0-9a-f]{64}\?type=(image|video|audio|sticker|document)$/;

function safeHttpsUrl(value?: string): string | undefined {
  if (!value) return undefined;
  if (INTERNAL_WHATSAPP_MEDIA.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "localhost"
      || hostname.endsWith(".localhost")
      || hostname.startsWith("[")
      || !hostname.includes(".")
    ) return undefined;
    const octets = hostname.split(".").map(Number);
    if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
      const [first, second] = octets;
      if (
        first === 0
        || first === 10
        || first === 127
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || first >= 224
      ) return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function mediaType(url: string): "image" | "video" | "audio" | "link" | "unknown" {
  // Los archivos de WhatsApp dicen su clase en `type`: los documentos van directo al enlace.
  const internal = INTERNAL_WHATSAPP_MEDIA.exec(url)?.[1];
  if (internal) return internal === "sticker" ? "image" : internal === "document" ? "link" : internal as "image" | "video" | "audio";
  const value = new URL(url).pathname.toLocaleLowerCase("en");
  if (/\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/u.test(value)) return "image";
  if (/\.(?:m4v|mov|mp4|webm)$/u.test(value)) return "video";
  if (/\.(?:aac|flac|m4a|mp3|oga|ogg|wav)$/u.test(value)) return "audio";
  return "unknown";
}

function isSemanticPlaceholder(text: string, kind: InteractionContentKind): boolean {
  const value = text.trim();
  if (!value) return true;
  if (value === LABELS[kind]) return true;
  if (kind === "unsupported" && value === "Tipo de contenido no disponible en la API") return true;
  if (kind === "attachment" && /^\d+ archivos adjuntos$/u.test(value)) return true;
  if (kind === "reaction" && /^Reacción(?: a una historia)?$/u.test(value)) return true;
  return false;
}

/**
 * Vista previa de un adjunto. Sin `crossOrigin`: la CDN de mensajes de Instagram
 * (lookaside.fbsbx.com/ig_messaging_cdn) no envía cabeceras CORS, y pedirla en modo CORS hacía
 * fallar la imagen y mostrar «Vista previa no disponible» aunque el enlace funcionara. La web no
 * lee los píxeles, solo los muestra, así que no necesita CORS.
 */
function MediaPreview({ url, index }: { url: string; index: number }) {
  const inferred = mediaType(url);
  const [mode, setMode] = useState<"image" | "video" | "audio" | "link">(
    inferred === "unknown" ? "image" : inferred,
  );
  const label = `Archivo adjunto ${index + 1}`;

  return (
    <span className="content-context__media-item">
      {mode === "image" ? (
        <img
          src={url}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setMode(inferred === "unknown" ? "video" : "link")}
        />
      ) : mode === "video" ? (
        <video
          src={url}
          controls
          preload="metadata"
          aria-label={label}
          onError={() => setMode("link")}
        />
      ) : mode === "audio" ? (
        <audio
          src={url}
          controls
          preload="metadata"
          aria-label={label}
          onError={() => setMode("link")}
        />
      ) : inferred === "link" ? (
        <small>Documento adjunto.</small>
      ) : (
        <small>Vista previa no disponible: el archivo pudo vencer en la red social.</small>
      )}
      <a href={url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        Abrir archivo {index + 1}
      </a>
    </span>
  );
}

export function ContentContext({ text, context, compact = false }: ContentContextProps) {
  const kind = context?.kind ?? "text";
  const mediaUrls = [...new Set((context?.mediaUrls ?? []).map(safeHttpsUrl).filter(Boolean))] as string[];
  const permalink = safeHttpsUrl(context?.permalink);
  if (kind === "text" && (compact || (!mediaUrls.length && !permalink))) {
    return <span className="content-context__text">{text}</span>;
  }

  const label = kind === "attachment" && mediaUrls.length > 1
    ? `${mediaUrls.length} archivos adjuntos`
    : LABELS[kind];
  const showText = !isSemanticPlaceholder(text, kind);

  return (
    <span className={`content-context content-context--${kind}${compact ? " content-context--compact" : ""}`}>
      {kind !== "text" ? <strong className="content-context__label">{label}</strong> : null}
      {showText ? (
        <span className="content-context__text">{text}</span>
      ) : null}
      {!compact && mediaUrls.length ? (
        <span className="content-context__media">
          {mediaUrls.map((url, index) => <MediaPreview key={url} url={url} index={index} />)}
        </span>
      ) : null}
      {!compact && mediaUrls.length === 0 && FALLBACKS[kind] ? (
        <small className="content-context__fallback">{FALLBACKS[kind]}</small>
      ) : null}
      {!compact && permalink ? (
        <a
          className="content-context__permalink"
          href={permalink}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
        >
          Abrir contenido relacionado
        </a>
      ) : null}
    </span>
  );
}
