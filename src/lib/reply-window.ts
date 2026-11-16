/**
 * Plazos de respuesta que informa Metricool para Instagram y Facebook: 7 días para DMs y
 * 24 horas para comentarios, desde el último mensaje del cliente. Solo ordenan y filtran:
 * fuera de plazo igual se puede redactar e intentar una respuesta manual.
 * Debe coincidir con server/reply-window.ts.
 */
import type { Interaction } from "../types";

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

export function replyWindowMs(platform: string, kind: string): number | undefined {
  if (platform !== "instagram" && platform !== "facebook") return undefined;
  if (kind === "dm") return 7 * DAY_MS;
  if (kind === "comment") return DAY_MS;
  return undefined;
}

/** El caso espera una acción del equipo (sin responder o en revisión humana). */
export function needsAction(interaction: Pick<Interaction, "status">): boolean {
  return interaction.status === "pending" || interaction.status === "needs_review";
}

/** Momento en que vence el plazo, o undefined si el canal no tiene plazo. */
export function replyDeadline(interaction: Pick<Interaction, "platform" | "kind" | "receivedAt" | "latestInboundAt">): number | undefined {
  const windowMs = replyWindowMs(interaction.platform, interaction.kind);
  if (windowMs === undefined) return undefined;
  const from = Date.parse(interaction.latestInboundAt ?? interaction.receivedAt);
  return Number.isFinite(from) ? from + windowMs : undefined;
}

/** Caso por atender cuyo plazo ya venció. */
export function isExpired(interaction: Pick<Interaction, "status" | "platform" | "kind" | "receivedAt" | "latestInboundAt">, now = Date.now()): boolean {
  if (!needsAction(interaction)) return false;
  const deadline = replyDeadline(interaction);
  return deadline !== undefined && deadline <= now;
}

/** "Vence en 3 h", "Vence en 2 d", "Venció hace 12 d"; undefined si no hay plazo. */
export function deadlineLabel(interaction: Pick<Interaction, "platform" | "kind" | "receivedAt" | "latestInboundAt">, now = Date.now()): string | undefined {
  const deadline = replyDeadline(interaction);
  if (deadline === undefined) return undefined;
  const diff = deadline - now;
  const amount = (ms: number) => {
    const abs = Math.abs(ms);
    if (abs < HOUR_MS) return `${Math.max(1, Math.round(abs / 60_000))} min`;
    if (abs < DAY_MS) return `${Math.round(abs / HOUR_MS)} h`;
    return `${Math.round(abs / DAY_MS)} d`;
  };
  return diff > 0 ? `Vence en ${amount(diff)}` : `Venció hace ${amount(diff)}`;
}
