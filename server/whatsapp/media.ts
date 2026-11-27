/**
 * Archivos de WhatsApp (fotos, videos, audios, stickers y documentos). WhatsApp no entrega un
 * enlace público: el worker descarga cada archivo y la API guarda su propia copia, identificada
 * por su sha256, junto a la marca dueña. Solo quien ve esa marca puede abrirla
 * (`GET /api/media/whatsapp/:key`), y los adjuntos que envía el equipo se guardan igual.
 */
import { createHash } from "node:crypto";

/** Tamaño máximo de un archivo (16 MB, como WhatsApp para fotos y videos). */
export const WHATSAPP_MEDIA_MAX_BYTES = 16 * 1024 * 1024;

export type WhatsAppMediaKind = "image" | "video" | "audio" | "sticker" | "document";

/** Tipos aceptados. Cualquier otro se descarta: el mensaje queda con su texto y la etiqueta. */
const MIME_KIND: Record<string, WhatsAppMediaKind> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "video/mp4": "video",
  "video/3gpp": "video",
  "audio/ogg": "audio",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "audio/aac": "audio",
  "audio/amr": "audio",
  "audio/wav": "audio",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "text/plain": "document",
  "text/csv": "document",
};

/** Tipo base sin parámetros ("audio/ogg; codecs=opus" → "audio/ogg"). */
export function baseMime(value: string | undefined): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}

/** Clase de archivo según su tipo, o undefined si no se acepta. */
export function mediaKindFor(mime: string | undefined, sticker = false): WhatsAppMediaKind | undefined {
  const kind = MIME_KIND[baseMime(mime)];
  if (!kind) return undefined;
  return sticker && kind === "image" ? "sticker" : kind;
}

export function mediaKey(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function isMediaKey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

/** URL interna del archivo, con su clase para que la web elija imagen, video, audio o enlace. */
export function whatsappMediaUrl(key: string, kind: WhatsAppMediaKind): string {
  return `/api/media/whatsapp/${key}?type=${kind}`;
}

/** Nombre de archivo seguro para mostrar y descargar (sin rutas ni caracteres de control). */
export function safeFileName(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .trim()
    .slice(0, 120);
  return cleaned || undefined;
}

/** Referencia al archivo que viaja con el mensaje (sin los bytes). */
export interface WhatsAppMediaRef {
  key: string;
  mimeType: string;
  kind: WhatsAppMediaKind;
  size: number;
  fileName?: string;
}

/** Archivo guardado por la API. */
export interface StoredWhatsAppMedia extends WhatsAppMediaRef {
  /** Marca dueña: abrirlo sigue el alcance de marcas de quien lo pide. */
  brandId: string;
  data: Buffer;
  createdAt: string;
}

/** Opciones de un envío por WhatsApp que no caben en la entrega común: adjunto y cita. */
export interface WhatsAppDeliveryOptions {
  attachment?: WhatsAppMediaRef;
  /** Mensaje del cliente que se cita al responder. */
  quote?: { messageId: string; text: string };
}
