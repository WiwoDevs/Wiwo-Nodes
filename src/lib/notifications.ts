/**
 * Notificaciones de la campana: lo nuevo que llegó a la bandeja (mensajes, comentarios y reseñas
 * de clientes), sacado de las mismas filas en vivo de la Bandeja SAC. Una fila es una persona en
 * una cuenta y red; avisa cuando su último mensaje es del cliente.
 *
 * No avisa: lo que la cuenta respondió (el último mensaje es del equipo), casos resueltos
 * (incluido el historial importado de WhatsApp), spam detectado por reglas, ni WhatsApp para
 * quien lo tiene apagado.
 */
import type { Interaction, InteractionKind } from "../types";

/** Cuántas notificaciones muestra el panel. */
export const NOTIFICATION_LIMIT = 30;
/** Sin nada leído todavía, cuenta como no leído lo de las últimas 24 horas. */
export const FIRST_VISIT_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface NotificationItem {
  interaction: Interaction;
  /** Cuándo llegó el mensaje del cliente que la produce. */
  at: string;
  unread: boolean;
}

export interface NotificationsSummary {
  items: NotificationItem[];
  /** No leídas entre todas las que califican (no solo las del panel). */
  unreadCount: number;
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Fecha desde la que todo cuenta como no leído. */
export function effectiveSeenAt(seenAt: string | undefined, now = Date.now()): number {
  return seenAt ? timestamp(seenAt) : now - FIRST_VISIT_WINDOW_MS;
}

export function notificationTitle(kind: InteractionKind): string {
  if (kind === "comment") return "Comentario nuevo";
  if (kind === "review") return "Reseña nueva";
  return "Mensaje nuevo";
}

export function buildNotifications(
  interactions: Interaction[],
  options: { seenAt?: string; whatsappEnabled?: boolean; now?: number; limit?: number },
): NotificationsSummary {
  const seenFrom = effectiveSeenAt(options.seenAt, options.now);
  const qualifying = interactions
    .filter((interaction) => interaction.direction === "inbound")
    .filter((interaction) => interaction.status !== "resolved")
    .filter((interaction) => interaction.noise?.origen !== "reglas")
    .filter((interaction) => interaction.platform !== "whatsapp" || options.whatsappEnabled !== false)
    .map((interaction) => {
      const at = interaction.latestInboundAt ?? interaction.receivedAt;
      return { interaction, at, unread: timestamp(at) > seenFrom };
    })
    .sort((left, right) => timestamp(right.at) - timestamp(left.at));
  return {
    items: qualifying.slice(0, options.limit ?? NOTIFICATION_LIMIT),
    unreadCount: qualifying.filter((item) => item.unread).length,
  };
}

/** "ahora", "hace 5 min", "hace 3 h", "hace 2 días" o la fecha. */
export function notificationAge(at: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - timestamp(at)) / 60_000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `hace ${days} ${days === 1 ? "día" : "días"}`;
  return new Date(timestamp(at)).toLocaleDateString("es-CL", { day: "numeric", month: "short" });
}
