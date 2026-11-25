/**
 * «Claridad del tema» (antes «confianza»): qué tan claro le quedó al sistema de qué trata el
 * mensaje. No la calcula una IA: sale de reglas por palabras clave (`classify` en
 * server/sac-automation.ts), que solo dan cuatro valores:
 * - 97 % / 92 %: el mensaje calza con una regla (delicada / normal) → Alta;
 * - 84 % o más: sin regla clara, se usa la categoría que el caso ya tenía → Media;
 * - 55 %: no se reconoció el tema → Baja.
 * Por eso se muestra como nivel con su motivo y no como un porcentaje.
 */
export type TopicClarityLevel = "alta" | "media" | "baja";

export const CLARITY_HIGH_MIN = 0.9;
export const CLARITY_MEDIUM_MIN = 0.8;

export interface TopicClarity {
  level: TopicClarityLevel;
  label: string;
  reason: string;
  /** Motivo corto para espacios chicos (la ficha del caso). */
  short: string;
}

export function topicClarity(confidence: number | undefined): TopicClarity {
  const value = Number.isFinite(confidence) ? Number(confidence) : 0;
  if (value >= CLARITY_HIGH_MIN) {
    return { level: "alta", label: "Alta", reason: "El mensaje calza con una regla de tema conocida.", short: "Calza con una regla" };
  }
  if (value >= CLARITY_MEDIUM_MIN) {
    return { level: "media", label: "Media", reason: "Sin regla clara: se usa la categoría que el caso ya tenía.", short: "Por la categoría del caso" };
  }
  return { level: "baja", label: "Baja", reason: "No se reconoció el tema: necesita la revisión de una persona.", short: "Tema no reconocido" };
}

/**
 * Ajuste de Configuración: desde qué claridad se permite el envío automático. Se guarda como el
 * mismo umbral numérico de siempre (`minimumConfidence`), elegido entre dos opciones simples.
 */
export type ClarityRequirement = "alta" | "alta_media";

export function clarityRequirementFromThreshold(thresholdPercent: number): ClarityRequirement {
  return thresholdPercent / 100 > 0.84 ? "alta" : "alta_media";
}

export function thresholdForClarityRequirement(requirement: ClarityRequirement): number {
  // 82 % es el valor de siempre: deja pasar la claridad media (84 % o más) y no la baja (55 %).
  return requirement === "alta" ? CLARITY_HIGH_MIN * 100 : 82;
}
