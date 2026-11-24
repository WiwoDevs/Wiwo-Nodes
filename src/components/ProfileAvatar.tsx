/**
 * Foto de perfil (de una cuenta en Clientes o de quien escribe en Gestión DMs) con las iniciales
 * como respaldo: si no hay foto, o la copia guardada por wiwo.sac no carga, quedan las iniciales.
 * Solo acepta la copia servida por la misma API (`/api/media/...`, ver server/post-thumbnails.ts).
 */
import { useEffect, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const STORED_PICTURE = /^\/api\/media\/(image\/[A-Za-z0-9_-]{16,64}|brand-picture\/[A-Za-z0-9_.:-]{1,128})$/;

export function profilePictureUrl(value?: string): string | undefined {
  return value && STORED_PICTURE.test(value) ? `${API_BASE}${value.slice("/api".length)}` : undefined;
}

export function ProfileAvatar({ url, initials }: { url?: string; initials: string }) {
  const src = profilePictureUrl(url);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <>{initials}</>;
  return (
    <img
      className="profile-avatar-img"
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
