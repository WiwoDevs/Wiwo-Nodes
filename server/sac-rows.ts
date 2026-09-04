/**
 * Proyección de la bandeja al formato de fila SAC que consume METRIQ.
 *
 * METRIQ arma sus reportes desde planillas de Google Sheets con una fila por reclamo y
 * columnas fijas (fecha, plataforma, canal, usuario, reclamo, categoría, tonalidad,
 * estado, observación, mes). Este módulo produce exactamente esa forma a partir de las
 * interacciones ya sincronizadas, para que Nodes pueda reemplazar la planilla manual sin
 * que METRIQ cambie su manera de leer.
 *
 * Solo se proyectan mensajes ENTRANTES: una fila SAC representa algo que dijo un cliente,
 * no la respuesta del equipo. Las respuestas viajan aparte, en la observación.
 */
import type { Brand, Channel, Interaction, InteractionStatus, Sentiment } from "./types.js";

/** Fila SAC, con los mismos nombres de campo que usa METRIQ. */
export interface SacRow {
  brandKey: string;
  brandLabel: string;
  /** ISO YYYY-MM-DD, o null si la fecha no es utilizable. */
  fechaComentario: string | null;
  plataforma: string;
  canal: string;
  usuario: string;
  reclamo: string;
  categoria: string;
  tonalidad: string;
  estado: string;
  observacion: string;
  mes: string;
}

export interface SacRowsResult {
  rows: SacRow[];
  /** Entrantes descartados por no tener fecha utilizable. METRIQ audita este número. */
  droppedNoDate: number;
}

const PLATAFORMA: Record<Channel, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  google_business: "Google Business",
};

const TONALIDAD: Record<Sentiment, string> = {
  positive: "Positiva",
  neutral: "Neutra",
  negative: "Negativa",
};

const ESTADO: Record<InteractionStatus, string> = {
  new: "Nuevo",
  pending: "Pendiente",
  drafted: "Borrador",
  replied: "Respondido",
  escalated: "Escalado",
  resolved: "Resuelto",
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** Fecha en YYYY-MM-DD, o null si no se puede interpretar. */
function fechaIso(value: string): string | null {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function mesDe(fecha: string | null): string {
  if (!fecha) return "";
  const mes = Number(fecha.slice(5, 7));
  return MESES[mes - 1] ?? "";
}

/** Handle legible del cliente, sin duplicar la arroba. */
function usuarioDe(interaction: Interaction): string {
  const handle = interaction.customerHandle?.trim();
  const nombre = interaction.customerName?.trim();
  if (handle && nombre && handle.replace(/^@/, "") !== nombre) return `${nombre} (${handle})`;
  return nombre || handle || "Usuario social";
}

/**
 * Observación: contexto interno que el equipo agregó. Se incluye el conteo de notas
 * y la respuesta enviada, porque en la planilla manual ese campo cumple el mismo papel.
 * No se copia el texto de las notas: puede contener datos que no deben salir a un reporte.
 */
function observacionDe(interaction: Interaction): string {
  const partes: string[] = [];
  if (interaction.type === "comment") partes.push("Comentario en publicación");
  if (interaction.type === "review") partes.push("Reseña");
  const notas = interaction.internalNotes?.length ?? 0;
  if (notas) partes.push(`${notas} ${notas === 1 ? "nota interna" : "notas internas"}`);
  if (interaction.respondedAt) {
    const fecha = fechaIso(interaction.respondedAt);
    if (fecha) partes.push(`Respondido el ${fecha}`);
  }
  if (interaction.statusReason?.code) partes.push(`Motivo: ${interaction.statusReason.code}`);
  return partes.join(" · ");
}

export interface SacRowsOptions {
  /** Límite inferior inclusive, YYYY-MM-DD. */
  from?: string;
  /** Límite superior inclusive, YYYY-MM-DD. */
  to?: string;
}

/**
 * Proyecta las interacciones de una marca a filas SAC dentro del período pedido.
 * El recorte se hace sobre la fecha ya normalizada, para que "agosto" signifique lo mismo
 * aquí y en la planilla, sin depender de la zona horaria del proceso.
 */
export function buildSacRows(
  brand: Brand,
  interactions: Interaction[],
  options: SacRowsOptions = {},
): SacRowsResult {
  const rows: SacRow[] = [];
  let droppedNoDate = 0;

  for (const interaction of interactions) {
    if (interaction.brandId !== brand.id) continue;
    if (interaction.direction !== "inbound") continue;

    const fecha = fechaIso(interaction.createdAt);
    if (!fecha) {
      droppedNoDate += 1;
      continue;
    }
    if (options.from && fecha < options.from) continue;
    if (options.to && fecha > options.to) continue;

    rows.push({
      brandKey: brand.id,
      brandLabel: brand.name,
      fechaComentario: fecha,
      plataforma: PLATAFORMA[interaction.channel] ?? interaction.channel,
      canal: brand.account.handle || brand.account.name,
      usuario: usuarioDe(interaction),
      reclamo: interaction.text ?? "",
      categoria: interaction.category ?? "",
      tonalidad: TONALIDAD[interaction.sentiment] ?? "",
      estado: ESTADO[interaction.status] ?? interaction.status,
      observacion: observacionDe(interaction),
      mes: mesDe(fecha),
    });
  }

  rows.sort((left, right) => (right.fechaComentario ?? "").localeCompare(left.fechaComentario ?? ""));
  return { rows, droppedNoDate };
}
