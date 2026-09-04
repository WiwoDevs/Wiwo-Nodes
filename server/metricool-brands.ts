/**
 * Descubrimiento de marcas reales en Metricool.
 *
 * `/admin/simpleProfiles` es el único endpoint que responde sin conocer un `blogId`:
 * devuelve el catálogo completo de marcas visibles para el token, con el handle de cada
 * red conectada. Sirve para dar de alta las cuentas del portafolio sin transcribir
 * identificadores a mano, que es la vía habitual de equivocarse de marca.
 *
 * Este módulo solo normaliza. No crea marcas ni escribe en Metricool.
 */
import type { Channel } from "./types.js";

export interface DiscoveredMetricoolBrand {
  /** `blogId` en la nomenclatura del resto del API. */
  blogId: string;
  label: string;
  userId: string;
  channels: Channel[];
  /** Handle de Instagram, usado como handle por defecto de la cuenta local. */
  instagramHandle?: string;
  pictureUrl?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function connectedValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return Boolean(normalized) && !["null", "false", "{}", "[]"].includes(normalized);
  }
  if (typeof value === "number") return value !== 0;
  return true;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

/**
 * Redes conectadas según `simpleProfiles`. El criterio es el mismo que usa Metricool en su
 * propia UI: la red cuenta como conectada cuando su campo trae un identificador o handle.
 */
function channelsFromProfile(profile: Record<string, unknown>): Channel[] {
  const fields: Array<[Channel, string[]]> = [
    ["instagram", ["instagram", "fbBusinessId"]],
    ["facebook", ["facebook", "facebookPageId"]],
    ["x", ["twitter"]],
    ["tiktok", ["tiktok", "tiktokads"]],
    ["youtube", ["youtube"]],
    ["linkedin", ["linkedinCompany", "linkedin"]],
    ["google_business", ["gmb"]],
  ];
  return fields.flatMap(([channel, keys]) =>
    keys.some((key) => connectedValue(profile[key])) ? [channel] : []);
}

/** Normaliza la respuesta de `/admin/simpleProfiles` a marcas descubiertas. */
export function normalizeDiscoveredBrands(payload: unknown): DiscoveredMetricoolBrand[] {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.profiles)
        ? root.profiles
        : [];

  const discovered: DiscoveredMetricoolBrand[] = [];
  for (const value of list) {
    const profile = asRecord(value);
    if (!profile) continue;
    const blogId = stringValue(profile.id);
    const userId = stringValue(profile.userId) || stringValue(profile.ownerUserId);
    if (!blogId || !userId) continue;
    const instagramHandle = stringValue(profile.instagram);
    discovered.push({
      blogId,
      userId,
      label: stringValue(profile.label)
        || stringValue(profile.title)
        || instagramHandle
        || `Marca ${blogId}`,
      channels: channelsFromProfile(profile),
      instagramHandle,
      pictureUrl: stringValue(profile.picture),
    });
  }

  discovered.sort((left, right) => left.label.localeCompare(right.label, "es"));
  return discovered;
}
