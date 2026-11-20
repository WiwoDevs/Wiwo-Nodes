/**
 * Plazos de respuesta que informa Metricool para Instagram y Facebook: 7 días para DMs y
 * 24 horas para comentarios, contados desde el último mensaje del cliente en la
 * conversación. Fuera de plazo la UI igual permite redactar e intentar una respuesta manual
 * (Metricool/Meta deciden); esto solo sirve para priorizar y para archivar el histórico.
 * Debe coincidir con src/lib/reply-window.ts.
 */
import { conversationKey } from "./sac-automation.js";
import type { Interaction } from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export function replyWindowMs(channel: string, type: string): number | undefined {
  if (channel !== "instagram" && channel !== "facebook") return undefined;
  if (type === "dm") return 7 * DAY_MS;
  if (type === "comment") return DAY_MS;
  return undefined;
}

/** Estados que todavía esperan una acción del equipo. */
export const ACTIONABLE_STATUSES = new Set<Interaction["status"]>(["new", "pending", "drafted", "escalated"]);

/**
 * Interacciones entrantes abiertas cuyo plazo de respuesta ya venció. Para DMs el plazo se
 * cuenta desde el último mensaje entrante de su conversación (si el cliente volvió a
 * escribir, la conversación sigue en plazo); para comentarios, desde el propio comentario.
 */
export function expiredOpenInteractions(interactions: Interaction[], now = Date.now()): Interaction[] {
  const latestInboundByConversation = new Map<string, number>();
  for (const interaction of interactions) {
    if (interaction.direction !== "inbound") continue;
    const key = conversationKey(interaction);
    const at = Date.parse(interaction.createdAt);
    if (Number.isFinite(at) && at > (latestInboundByConversation.get(key) ?? 0)) latestInboundByConversation.set(key, at);
  }
  return interactions.filter((interaction) => {
    if (interaction.direction !== "inbound" || !ACTIONABLE_STATUSES.has(interaction.status)) return false;
    const windowMs = replyWindowMs(interaction.channel, interaction.type);
    if (windowMs === undefined) return false;
    const from = interaction.type === "dm"
      ? latestInboundByConversation.get(conversationKey(interaction)) ?? Date.parse(interaction.createdAt)
      : Date.parse(interaction.createdAt);
    return Number.isFinite(from) && now - from > windowMs;
  });
}

/**
 * Casos sensibles que nunca se archivan en lote: deben seguir disponibles para revisión
 * humana aunque estén fuera de plazo (sentimiento negativo, riesgo alto o crítico).
 */
export function isSensitiveCase(interaction: Interaction): boolean {
  const risk = interaction.automation?.risk;
  return interaction.sentiment === "negative"
    || risk === "high"
    || risk === "critical"
    || interaction.aiTriage?.sensible === true;
}
